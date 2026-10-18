import { z } from "zod";
import { posix } from "node:path";
import { type Snapshot, PieError } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import {
  adapterFactSchema,
  parseDockerfileInstructionName,
  parseComposeServiceSettingName,
} from "./adapters/contracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { err, ok, type Result } from "../domain/result.js";

export const infrastructureInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
});

export type InfrastructureFailure =
  | { kind: "invalid_input" }
  | { kind: "invalid_snapshot" }
  | { kind: "policy_denied"; reason: "snapshot_mismatch" };

const componentSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    "compose_service",
    "compose_volume",
    "compose_resource",
    "nginx_directive",
  ]),
  name: z.string().min(1).max(1000),
  parent: z.string().max(1000).nullable(),
  path: z.string().min(1),
  line: z.number().int().positive().nullable(),
  evidenceId: z.string().uuid(),
  dependencies: z.array(
    z.strictObject({
      name: z.string().min(1).max(1000),
      evidenceId: z.string().uuid(),
    }),
  ),
  settings: z.array(
    z.strictObject({
      key: z.enum([
        "image",
        "port",
        "restart",
        "healthcheck",
        "build_context",
        "build_dockerfile",
        "build_inline",
        "replicas",
        "cpus_limit",
        "memory_limit",
        "pids_limit",
        "cpus_reservation",
        "memory_reservation",
        "pids_reservation",
        "volume_mount",
        "volume_definition",
        "environment_key",
        "env_file",
        "secret_mount",
        "config_mount",
        "secret_definition",
        "config_definition",
        "profile",
        "depends_on_options",
      ]),
      value: z.string(),
      evidenceId: z.string().uuid(),
    }),
  ),
  builds: z.array(
    z.strictObject({
      context: z.string(),
      dockerfile: z.string().nullable(),
      candidatePath: z.string().nullable(),
      dockerfileObservation: z.enum([
        "observed_in_snapshot",
        "not_observed_in_snapshot",
        "unresolved",
        "inline_content_not_retained",
      ]),
      evidenceIds: z.array(z.string().uuid()).min(1),
      dockerfileAnalysis: z.enum([
        "unresolved",
        "not_observed_in_snapshot",
        "file_observed_no_supported_facts",
        "static_facts_observed",
        "inline_content_not_retained",
      ]),
      instructions: z.array(
        z.strictObject({
          instruction: z.string().min(1),
          stage: z.number().int().nonnegative().nullable(),
          line: z.number().int().positive(),
          value: z.string().max(900).nullable(),
          evidenceId: z.string().uuid(),
        }),
      ),
    }),
  ),
  redactionStatus: z.enum(["not_collected", "redacted", "not_required"]),
  evidenceLimitations: z.array(z.string()),
  state: z.literal("unverified"),
});

const measurement = z.literal("NOT_MEASURED");
export const infrastructureOutput = z.strictObject({
  schemaVersion: z.literal(5),
  engine: z.literal("infrastructure"),
  snapshotId: z.string().uuid(),
  state: z.literal("unverified"),
  components: z.strictObject({
    items: z.array(componentSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  measurements: z.strictObject({
    cpu: measurement,
    memory: measurement,
    disk: measurement,
    io: measurement,
    network: measurement,
    latencyP95: measurement,
    latencyP99: measurement,
    restarts: measurement,
  }),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    sourceFacts: z.number().int().nonnegative(),
    runtimeMeasured: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

function resolveComposeDockerfilePath(
  composePath: string,
  context: string,
  dockerfile: string,
): string | null {
  if (
    !context ||
    !dockerfile ||
    context.includes("$") ||
    dockerfile.includes("$") ||
    context.includes("\\") ||
    dockerfile.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(context) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(dockerfile) ||
    posix.isAbsolute(context) ||
    posix.isAbsolute(dockerfile) ||
    /^[a-z]:[\\/]/i.test(context) ||
    /^[a-z]:[\\/]/i.test(dockerfile) ||
    context.startsWith("~") ||
    dockerfile.startsWith("~")
  )
    return null;
  const base = posix.normalize(posix.join(posix.dirname(composePath), context));
  const candidate = posix.normalize(posix.join(base, dockerfile));
  const withinProject = (path: string) =>
    path !== ".." && !path.startsWith("../") && !path.startsWith("/");
  return withinProject(base) && withinProject(candidate) ? candidate : null;
}

function inventoryFacts(snapshot: Snapshot) {
  const facts = snapshot.declarations.map((fact) =>
    adapterFactSchema.parse(fact),
  );
  const composeServices = facts.filter(
    (fact) => fact.adapter === "compose" && fact.kind === "service",
  );
  const dependencies = facts.filter(
    (fact) => fact.adapter === "compose" && fact.kind === "service_dependency",
  );
  const settings = facts.flatMap((fact) => {
    if (fact.adapter !== "compose" || fact.kind !== "config_directive")
      return [];
    const setting = parseComposeServiceSettingName(fact.name);
    return setting ? [{ fact, setting }] : [];
  });
  const nginxFacts = facts.filter(
    (fact) =>
      fact.adapter === "nginx-config" &&
      (fact.kind === "config_directive" || fact.kind === "location"),
  );
  const resourceDefinitions = settings.filter(
    ({ setting }) =>
      setting.key === "volume_definition" ||
      setting.key === "secret_definition" ||
      setting.key === "config_definition",
  );
  const composeFiles = snapshot.nodes.filter((node) =>
    /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$/i.test(node.path),
  );
  const dockerfileFacts = facts.flatMap((fact) => {
    if (fact.adapter !== "dockerfile" || fact.kind !== "config_directive")
      return [];
    const instruction = parseDockerfileInstructionName(fact.name);
    return instruction ? [{ fact, instruction }] : [];
  });
  const evidenceById = new Map(
    snapshot.evidence.map((item) => [item.id, item]),
  );
  const evidenceDetails = (evidenceId: string) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence)
      throw new PieError(
        "INTEGRITY_ERROR",
        "Evidence do inventário de infraestrutura não pertence ao snapshot.",
      );
    return {
      redactionStatus: evidence.redactionStatus,
      evidenceLimitations: evidence.limitations,
    };
  };
  const components: z.infer<typeof componentSchema>[] = composeServices.map(
    (service) => {
      const related = dependencies.filter(
        (fact) =>
          fact.source.path === service.source.path &&
          fact.parent === service.name,
      );
      const serviceSettings = settings
        .filter(
          ({ fact }) =>
            fact.source.path === service.source.path &&
            fact.parent === service.name,
        )
        .map(({ fact, setting }) => ({
          ...setting,
          evidenceId: fact.evidenceId,
        }));
      const buildSettings = serviceSettings.filter(
        (setting) =>
          setting.key === "build_context" ||
          setting.key === "build_dockerfile" ||
          setting.key === "build_inline",
      );
      const builds = buildSettings
        .filter((setting) => setting.key === "build_context")
        .map((contextSetting) => {
          const dockerfileSetting = buildSettings.find(
            (setting) => setting.key === "build_dockerfile",
          );
          const inlineSetting = buildSettings.find(
            (setting) => setting.key === "build_inline",
          );
          const dockerfile = dockerfileSetting?.value ?? null;
          const candidatePath =
            !inlineSetting && dockerfile && composeFiles.length === 1
              ? resolveComposeDockerfilePath(
                  service.source.path,
                  contextSetting.value,
                  dockerfile,
                )
              : null;
          const matched = candidatePath
            ? snapshot.nodes.some((node) => node.path === candidatePath)
            : false;
          const instructions = candidatePath
            ? dockerfileFacts
                .filter(({ fact }) => fact.source.path === candidatePath)
                .map(({ fact, instruction }) => ({
                  ...instruction,
                  line: fact.source.line ?? 1,
                  evidenceId: fact.evidenceId,
                }))
            : [];
          return {
            context: contextSetting.value,
            dockerfile,
            candidatePath,
            dockerfileObservation: inlineSetting
              ? ("inline_content_not_retained" as const)
              : !candidatePath
                ? ("unresolved" as const)
                : matched
                  ? ("observed_in_snapshot" as const)
                  : ("not_observed_in_snapshot" as const),
            dockerfileAnalysis: inlineSetting
              ? ("inline_content_not_retained" as const)
              : !candidatePath
                ? ("unresolved" as const)
                : !matched
                  ? ("not_observed_in_snapshot" as const)
                  : instructions.length > 0
                    ? ("static_facts_observed" as const)
                    : ("file_observed_no_supported_facts" as const),
            instructions,
            evidenceIds: [
              contextSetting.evidenceId,
              ...(dockerfileSetting
                ? [dockerfileSetting.evidenceId]
                : inlineSetting
                  ? [inlineSetting.evidenceId]
                  : []),
            ],
          };
        });
      return {
        id: service.id,
        kind: "compose_service" as const,
        name: service.name,
        parent: null,
        path: service.source.path,
        line: service.source.line,
        evidenceId: service.evidenceId,
        ...evidenceDetails(service.evidenceId),
        dependencies: related.map((fact) => ({
          name: fact.name,
          evidenceId: fact.evidenceId,
        })),
        settings: serviceSettings,
        builds,
        state: "unverified" as const,
      };
    },
  );
  components.push(
    ...resourceDefinitions.map(({ fact, setting }) => ({
      id: fact.id,
      kind:
        setting.key === "volume_definition"
          ? ("compose_volume" as const)
          : ("compose_resource" as const),
      name:
        fact.parent?.replace(/^(?:volumes|secrets|configs):/, "") ?? "resource",
      parent: null,
      path: fact.source.path,
      line: fact.source.line,
      evidenceId: fact.evidenceId,
      ...evidenceDetails(fact.evidenceId),
      dependencies: [],
      settings: [{ ...setting, evidenceId: fact.evidenceId }],
      builds: [],
      state: "unverified" as const,
    })),
    ...nginxFacts.map((fact) => ({
      id: fact.id,
      kind: "nginx_directive" as const,
      name: fact.name,
      parent: fact.parent,
      path: fact.source.path,
      line: fact.source.line,
      evidenceId: fact.evidenceId,
      ...evidenceDetails(fact.evidenceId),
      dependencies: [],
      settings: [],
      builds: [],
      state: "unverified" as const,
    })),
  );
  return {
    components: components.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    sourceFacts:
      composeServices.length +
      dependencies.length +
      settings.length +
      dockerfileFacts.length +
      nginxFacts.length,
  };
}

/** Read parsed Compose/Nginx facts only; no runtime, container, or load is inferred. */
function reviewValidatedInfrastructure(
  snapshot: Snapshot,
  request: z.infer<typeof infrastructureInput>,
) {
  const { components, sourceFacts } = inventoryFacts(snapshot);
  return infrastructureOutput.parse({
    schemaVersion: 5,
    engine: "infrastructure",
    snapshotId: snapshot.id,
    state: "unverified",
    components: page(components, {
      offset: request.offset,
      limit: request.limit,
    }),
    measurements: {
      cpu: "NOT_MEASURED",
      memory: "NOT_MEASURED",
      disk: "NOT_MEASURED",
      io: "NOT_MEASURED",
      network: "NOT_MEASURED",
      latencyP95: "NOT_MEASURED",
      latencyP99: "NOT_MEASURED",
      restarts: "NOT_MEASURED",
    },
    coverage: {
      discovery: snapshot.coverage.status,
      sourceFacts,
      runtimeMeasured: false,
      limitations: [
        "Dockerfile é interpretado somente por instruções estáticas reconhecidas. Corpos de RUN/CMD/ENTRYPOINT/HEALTHCHECK/COPY/ADD não são retidos; nomes de ARG/ENV não incluem valores. Fatos não comprovam expansão, segurança, conteúdo da imagem, build, deploy ou runtime. Arquivos não observados, sem fatos ou sintaxe não suportada não comprovam ausência de instruções.",
        "Referências de build identificam contexto e Dockerfile declarados; caminhos locais só são resolvidos com um único arquivo Compose observado no snapshot. Contextos externos, dinâmicos ou ambíguos ficam sem resolução; conteúdo de dockerfile_inline não é retido. Nenhum build é executado nem registry consultado.",
        "Limites/reservas e réplicas são valores declarados: não comprovam que Docker Compose/Swarm ou o host os aplicam. Também não se provam serviços ativos, relações de consumidores, funcionamento do healthcheck, persistência, exposição efetiva, segurança ou necessidade operacional.",
        "Métricas de CPU/RAM/disco/I/O/rede/latência p95/p99/reinícios são NOT_MEASURED; esta análise não executa Docker, carga ou comandos na aplicação-alvo.",
        ...(components.length === 0
          ? [
              "Nenhum fato Compose/Nginx suportado foi observado; isso não comprova ausência de infraestrutura.",
            ]
          : []),
        ...snapshot.coverage.limitations,
      ],
    },
  });
}

/** Expected caller and snapshot rejections are tagged; internal faults escape. */
export function reviewInfrastructureResult(
  snapshotInput: unknown,
  rawInput: unknown,
): Result<
  ReturnType<typeof reviewValidatedInfrastructure>,
  InfrastructureFailure
> {
  const request = infrastructureInput.safeParse(rawInput);
  if (!request.success) return err({ kind: "invalid_input" });

  let snapshot: Snapshot;
  try {
    snapshot = validateSnapshot(snapshotInput);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_snapshot" });
    throw cause;
  }
  if (request.data.snapshotId !== snapshot.id)
    return err({ kind: "policy_denied", reason: "snapshot_mismatch" });

  return ok(reviewValidatedInfrastructure(snapshot, request.data));
}

/** Compatibility boundary for planning and callers using the domain error algebra. */
export function reviewInfrastructure(
  snapshotInput: Snapshot,
  rawInput: unknown,
) {
  const result = reviewInfrastructureResult(snapshotInput, rawInput);
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError(
      "INTEGRITY_ERROR",
      "Snapshot de infraestrutura inválido.",
    );
  if (result.error.kind === "policy_denied")
    throw new PieError(
      "INVALID_INPUT",
      "Infraestrutura pertence a outro snapshot.",
    );
  throw new PieError("INVALID_INPUT", "Entrada de infraestrutura inválida.");
}
