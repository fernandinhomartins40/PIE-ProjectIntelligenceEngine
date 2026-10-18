import { z } from "zod";
import { type Snapshot, PieError } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import {
  adapterFactSchema,
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
  kind: z.enum(["compose_service", "nginx_directive"]),
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
        "replicas",
        "cpus_limit",
        "memory_limit",
        "pids_limit",
        "cpus_reservation",
        "memory_reservation",
        "pids_reservation",
      ]),
      value: z.string(),
      evidenceId: z.string().uuid(),
    }),
  ),
  redactionStatus: z.enum(["not_collected", "redacted", "not_required"]),
  evidenceLimitations: z.array(z.string()),
  state: z.literal("unverified"),
});

const measurement = z.literal("NOT_MEASURED");
export const infrastructureOutput = z.strictObject({
  schemaVersion: z.literal(3),
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
        state: "unverified" as const,
      };
    },
  );
  components.push(
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
    schemaVersion: 3,
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
        "Inventário limitado a serviços, dependências, imagem, portas, política de reinício, presença de healthcheck, réplicas e limites/reservas literais de CPU/memória/PIDs no Compose já parseado, mais diretivas Nginx selecionadas com Evidence; não examina Dockerfile, CI, processos, volumes ou configuração efetiva.",
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
