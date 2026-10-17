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

const migrationFindingSchema = z.strictObject({
  id: z.string(),
  model: adapterFactSchema,
  state: z.enum([
    "no_migration_files_observed",
    "table_not_observed",
    "table_observed_without_unique_constraint",
    "unique_constraint_observed",
    "migration_inventory_incomplete",
  ]),
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
});

export const dataReviewOutput = z.strictObject({
  schemaVersion: z.literal(2),
  engine: z.literal("data"),
  snapshotId: z.string().uuid(),
  state: z.literal("unverified"),
  models: pagedOutput(findingSchema),
  migrations: pagedOutput(migrationFindingSchema),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    runtime: z.literal(false),
    schemaFiles: z.number().int().nonnegative(),
    examinedModels: z.number().int().nonnegative(),
    unexaminedSchemaFiles: z.number().int().nonnegative(),
    migrationFiles: z.number().int().nonnegative(),
    unexaminedMigrationFiles: z.number().int().nonnegative(),
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
  const migrationFiles = snapshot.nodes.filter((node) =>
    /(?:^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/i.test(node.path),
  );
  const migrationFacts = snapshot.declarations.filter(
    (fact) => fact.adapter === "sql-migration",
  );
  const incompleteMigrationPaths = new Set(
    migrationFiles
      .filter((file) => schemaFileIncomplete(snapshot, file.path))
      .map((file) => file.path),
  );
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
  const migrationFindings = models.map((model) => {
    const tables = migrationFacts.filter(
      (fact) => fact.kind === "model" && fact.name === model.name,
    );
    const constraints = tables.flatMap((table) =>
      migrationFacts.filter(
        (fact) =>
          fact.kind === "config_directive" &&
          fact.parent === table.name &&
          fact.source.path === table.source.path &&
          ["primary_key", "unique"].includes(fact.name),
      ),
    );
    const incomplete =
      snapshot.coverage.status === "partial" ||
      incompleteMigrationPaths.size > 0;
    const state = incomplete
      ? "migration_inventory_incomplete"
      : migrationFiles.length === 0
        ? "no_migration_files_observed"
        : tables.length === 0
          ? "table_not_observed"
          : constraints.length > 0
            ? "unique_constraint_observed"
            : "table_observed_without_unique_constraint";
    const evidenceIds = [
      model.evidenceId,
      ...tables.map((table) => table.evidenceId),
      ...constraints.map((fact) => fact.evidenceId),
    ];
    return {
      id: `data:migration-review:${model.id}`,
      model,
      state,
      evidenceIds: [...new Set(evidenceIds)],
      observation:
        state === "unique_constraint_observed"
          ? "Uma declaracao de PRIMARY KEY, UNIQUE ou CREATE UNIQUE INDEX foi observada em migration para uma tabela com nome igual ao modelo Prisma."
          : state === "table_observed_without_unique_constraint"
            ? "A tabela foi observada em CREATE TABLE, sem constraint unica reconhecida nas formas SQL suportadas."
            : state === "table_not_observed"
              ? "Nenhum CREATE TABLE com nome igual ao modelo Prisma foi observado nas migrations analisadas."
              : state === "no_migration_files_observed"
                ? "Nenhum arquivo de migration Prisma foi observado no snapshot."
                : "A cobertura de migrations esta incompleta para determinar as observacoes estaticas deste modelo.",
      uncertainty: [
        "A comparacao usa nomes exatos de modelo/tabela e SQL estatico suportado; renames, mapeamentos Prisma, schemas SQL e migrations posteriores podem alterar o significado.",
        "A analise nao calcula o estado final, nao executa migrations e nao comprova constraints aplicadas ao banco.",
      ],
    };
  });
  const selectedMigrations = page(migrationFindings, {
    offset: input.offset,
    limit: input.limit,
  });
  return dataReviewOutput.parse({
    schemaVersion: 2,
    engine: "data",
    snapshotId: snapshot.id,
    state: "unverified",
    models: selected,
    migrations: selectedMigrations,
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
      migrationFiles: migrationFiles.length,
      unexaminedMigrationFiles: incompleteMigrationPaths.size,
      limitations: [
        "A analise consome fatos estaticos do snapshot; nao conecta nem consulta banco.",
        "Diretivas reconhecidas: @id, @@id, @unique e @@unique. Ausencia observada gera item informativo unverified, nunca defeito confirmado.",
        "Migrations: reconhece um subconjunto de PostgreSQL e compara nomes exatos; nao calcula estado final, renames, mapeamentos, SQL dinamico ou aplicacao no banco.",
        ...snapshot.coverage.limitations,
      ],
    },
  });
}
