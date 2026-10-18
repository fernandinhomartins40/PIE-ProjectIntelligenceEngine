import { z } from "zod";
import { sourceSchema } from "../source.js";

export const dockerfileInstructionSchema = z.strictObject({
  instruction: z.enum([
    "ADD",
    "ARG",
    "CMD",
    "COPY",
    "ENTRYPOINT",
    "ENV",
    "EXPOSE",
    "FROM",
    "HEALTHCHECK",
    "LABEL",
    "MAINTAINER",
    "ONBUILD",
    "RUN",
    "SHELL",
    "STOPSIGNAL",
    "USER",
    "VOLUME",
    "WORKDIR",
  ]),
  stage: z.number().int().nonnegative().nullable(),
  value: z.string().max(900).nullable(),
});

const dockerfileInstructionPrefix = "dockerfile_instruction:";

export function dockerfileInstructionName(
  instruction: z.infer<typeof dockerfileInstructionSchema>,
) {
  return `${dockerfileInstructionPrefix}${JSON.stringify(instruction)}`;
}

export function parseDockerfileInstructionName(name: string) {
  if (!name.startsWith(dockerfileInstructionPrefix)) return null;
  try {
    const parsed = dockerfileInstructionSchema.safeParse(
      JSON.parse(name.slice(dockerfileInstructionPrefix.length)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const relationShapeSchema = z.strictObject({
  field: z.string().max(1000).nullable(),
  sourceFields: z.array(z.string().min(1).max(1000)).nullable(),
  targetFields: z.array(z.string().min(1).max(1000)).nullable(),
});

export const composeServiceSettingSchema = z.strictObject({
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
  ]),
  value: z.string().max(900),
});

const composeServiceSettingPrefix = "compose_setting:";

export function composeServiceSettingName(
  setting: z.infer<typeof composeServiceSettingSchema>,
) {
  return `${composeServiceSettingPrefix}${JSON.stringify(setting)}`;
}

/** Decode only the adapter-owned representation; never reinterpret Compose source. */
export function parseComposeServiceSettingName(name: string) {
  if (!name.startsWith(composeServiceSettingPrefix)) return null;
  let value: unknown;
  try {
    value = JSON.parse(name.slice(composeServiceSettingPrefix.length));
  } catch (cause) {
    if (cause instanceof SyntaxError) return null;
    throw cause;
  }
  const parsed = composeServiceSettingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const adapterFactSchema = z.strictObject({
  provenanceVersion: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .default(1),
  id: z.string(),
  adapter: z.enum([
    "node-manifest",
    "composer-manifest",
    "npm-lockfile",
    "compose",
    "dockerfile",
    "openapi",
    "prisma-schema",
    "sql-migration",
    "next-app-convention",
    "next-pages-convention",
    "express-ast",
    "laravel-php",
    "nginx-config",
    "github-actions",
  ]),
  kind: z.enum([
    "dependency",
    "script",
    "service",
    "service_dependency",
    "schema_relation",
    "endpoint",
    "model",
    "field",
    "page",
    "location",
    "config_directive",
  ]),
  name: z.string().min(1).max(1000),
  parent: z.string().max(1000).nullable(),
  relation: relationShapeSchema.nullable().default(null),
  source: sourceSchema,
  evidenceId: z.string().uuid(),
  derivations: z
    .array(
      z.strictObject({
        evidenceId: z.string().uuid(),
        line: z.number().int().positive(),
        operation: z.literal("express_router_mount"),
        prefix: z.string().max(1000),
        sourcePath: z.string().min(1).optional(),
      }),
    )
    .default([]),
  method: z.literal("static"),
  state: z.literal("unverified"),
});
export type AdapterFact = z.infer<typeof adapterFactSchema>;
export const declarationDerivationSchema = z.strictObject({
  line: z.number().int().positive(),
  operation: z.literal("express_router_mount"),
  prefix: z.string().max(1000),
  sourcePath: z.string().min(1).optional(),
});
export type DeclarationDerivation = z.infer<typeof declarationDerivationSchema>;
export type Declaration = Pick<
  AdapterFact,
  "adapter" | "kind" | "name" | "parent"
> & {
  line: number;
  relation?: z.infer<typeof relationShapeSchema> | null;
  redactions?: string[];
  derivedFrom?: DeclarationDerivation[];
};

export function declarationEvidenceObservation(
  fact: Pick<AdapterFact, "adapter" | "kind" | "name" | "parent"> & {
    relation?: AdapterFact["relation"];
  },
) {
  const detail = fact.relation ? ` ${JSON.stringify(fact.relation)}` : "";
  return `Fato declarativo estático ${JSON.stringify([fact.adapter, fact.kind, fact.name, fact.parent])}${detail}; execução não verificada.`;
}

export function derivationEvidenceObservation(
  derivation: DeclarationDerivation,
) {
  const tuple = derivation.sourcePath
    ? [derivation.operation, derivation.prefix, derivation.sourcePath]
    : [derivation.operation, derivation.prefix];
  return `Derivação estática de rota ${JSON.stringify(tuple)}; registro em runtime não verificado.`;
}
export interface AdapterRead {
  declarations: Declaration[];
  limitations: string[];
}
