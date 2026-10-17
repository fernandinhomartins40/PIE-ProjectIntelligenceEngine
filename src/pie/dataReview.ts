import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { adapterFactSchema } from "./adapters/contracts.js";

export const dataReviewInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
});

const findingSchema = z.strictObject({
  id: z.string(),
  category: z.literal("model_selector_not_observed"),
  state: z.literal("unverified"),
  severity: z.literal("info"),
  model: adapterFactSchema,
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
});

export const dataReviewOutput = z.strictObject({
  schemaVersion: z.literal(1),
  engine: z.literal("data"),
  snapshotId: z.string().uuid(),
  state: z.literal("unverified"),
  models: pagedOutput(findingSchema),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    runtime: z.literal(false),
    schemaFiles: z.number().int().nonnegative(),
    examinedModels: z.number().int().nonnegative(),
    unexaminedSchemaFiles: z.number().int().nonnegative(),
    limitations: z.array(z.string()),
  }),
});

function schemaFileIncomplete(snapshot: Snapshot, path: string): boolean {
  return snapshot.coverage.limitations.some((limitation) => {
    const normalized = limitation
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return (
      limitation.includes(path) &&
      (normalized.includes("omitidas por") ||
        normalized.includes("formato declarativo nao analisado"))
    );
  });
}

/** Reviews only Prisma facts retained by discovery; it never opens a database. */
export function reviewData(snapshotInput: unknown, rawInput: unknown) {
  const input = dataReviewInput.parse(rawInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Snapshot de dados diverge.");

  const schemaFiles = snapshot.nodes.filter(
    (node) => node.kind === "schema" && node.path.endsWith(".prisma"),
  );
  const declarations = snapshot.declarations.filter(
    (fact) => fact.adapter === "prisma-schema",
  );
  const models = declarations.filter((fact) => fact.kind === "model");
  const selectorOwners = new Set(
    declarations
      .filter(
        (fact) =>
          fact.kind === "config_directive" &&
          ["@id", "@unique", "@@id", "@@unique"].includes(fact.name),
      )
      .map((fact) =>
        JSON.stringify([fact.source.path, fact.parent?.split(".")[0]]),
      ),
  );
  const findings = models.flatMap((model) => {
    if (
      schemaFileIncomplete(snapshot, model.source.path) ||
      selectorOwners.has(JSON.stringify([model.source.path, model.name]))
    )
      return [];
    return [
      {
        id: `data:model-selector-unobserved:${model.id}`,
        category: "model_selector_not_observed" as const,
        state: "unverified" as const,
        severity: "info" as const,
        model,
        evidenceIds: [model.evidenceId],
        observation:
          "Nenhuma diretiva Prisma @id, @@id, @unique ou @@unique foi observada para este modelo no schema analisado.",
        uncertainty: [
          "Este resultado nao valida o schema Prisma, migrations, constraints efetivas ou banco conectado.",
          "A descoberta estatica pode estar parcial; ausencia de diretiva observada nao prova falta de seletor unico na tabela real.",
        ],
      },
    ];
  });
  const selected = page(findings, {
    offset: input.offset,
    limit: input.limit,
  });
  return dataReviewOutput.parse({
    schemaVersion: 1,
    engine: "data",
    snapshotId: snapshot.id,
    state: "unverified",
    models: selected,
    coverage: {
      discovery: snapshot.coverage.status,
      runtime: false,
      schemaFiles: schemaFiles.length,
      examinedModels: models.filter(
        (model) => !schemaFileIncomplete(snapshot, model.source.path),
      ).length,
      unexaminedSchemaFiles: schemaFiles.filter((file) =>
        schemaFileIncomplete(snapshot, file.path),
      ).length,
      limitations: [
        "A analise consome somente fatos Prisma estaticos do snapshot; nao conecta nem consulta banco ou migrations.",
        "Diretivas reconhecidas: @id, @@id, @unique e @@unique. Ausencia observada gera item informativo unverified, nunca defeito confirmado.",
        ...snapshot.coverage.limitations,
      ],
    },
  });
}
