import { z } from "zod";
import { sourceSchema } from "../source.js";

export const adapterFactSchema = z.strictObject({
  provenanceVersion: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .default(1),
  id: z.string(),
  adapter: z.enum([
    "node-manifest",
    "composer-manifest",
    "compose",
    "openapi",
    "prisma-schema",
    "sql-migration",
    "next-app-convention",
    "next-pages-convention",
    "express-ast",
    "laravel-php",
    "nginx-config",
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
  redactions?: string[];
  derivedFrom?: DeclarationDerivation[];
};

export function declarationEvidenceObservation(
  fact: Pick<AdapterFact, "adapter" | "kind" | "name" | "parent">,
) {
  return `Fato declarativo estático ${JSON.stringify([fact.adapter, fact.kind, fact.name, fact.parent])}; execução não verificada.`;
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
