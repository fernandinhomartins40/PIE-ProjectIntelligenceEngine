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

const relationFindingSchema = z.strictObject({
  id: z.string(),
  relation: adapterFactSchema,
  state: z.enum([
    "no_migration_files_observed",
    "foreign_key_not_observed",
    "foreign_key_columns_observed",
    "foreign_key_columns_mismatch",
    "foreign_key_columns_unverified",
    "migration_inventory_incomplete",
  ]),
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
});

export const dataReviewOutput = z.strictObject({
  schemaVersion: z.literal(4),
  engine: z.literal("data"),
  snapshotId: z.string().uuid(),
  state: z.literal("unverified"),
  models: pagedOutput(findingSchema),
  migrations: pagedOutput(migrationFindingSchema),
  relations: pagedOutput(relationFindingSchema),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    runtime: z.literal(false),
    schemaFiles: z.number().int().nonnegative(),
    examinedModels: z.number().int().nonnegative(),
    unexaminedSchemaFiles: z.number().int().nonnegative(),
    migrationFiles: z.number().int().nonnegative(),
    unexaminedMigrationFiles: z.number().int().nonnegative(),
    declaredRelations: z.number().int().nonnegative(),
    unexaminedRelations: z.number().int().nonnegative(),
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
        normalized.includes("formato declarativo nao analisado") ||
        normalized.includes("acima do limite"))
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
    const mapping = declarations.find(
      (fact) =>
        fact.kind === "config_directive" &&
        fact.name === "@@map" &&
        fact.source.path === model.source.path &&
        (fact.parent === model.name ||
          fact.parent?.startsWith(`${model.name}.`)),
    );
    const mappedTable = mapping?.parent?.startsWith(`${model.name}.`)
      ? mapping.parent.slice(model.name.length + 1)
      : null;
    const unresolvedMapping = mapping !== undefined && mappedTable === null;
    const tableName = mappedTable ?? model.name;
    const tables = migrationFacts.filter(
      (fact) => fact.kind === "model" && fact.name === tableName,
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
      incompleteMigrationPaths.size > 0 ||
      unresolvedMapping;
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
      ...(mapping ? [mapping.evidenceId] : []),
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
          ? "Uma declaracao de PRIMARY KEY, UNIQUE ou CREATE UNIQUE INDEX foi observada em migration para a tabela associada ao modelo Prisma, considerando @@map quando declarado."
          : state === "table_observed_without_unique_constraint"
            ? "A tabela foi observada em CREATE TABLE, sem constraint unica reconhecida nas formas SQL suportadas."
            : state === "table_not_observed"
              ? "Nenhum CREATE TABLE com nome igual ao modelo Prisma foi observado nas migrations analisadas."
              : state === "no_migration_files_observed"
                ? "Nenhum arquivo de migration Prisma foi observado no snapshot."
                : "A cobertura de migrations esta incompleta para determinar as observacoes estaticas deste modelo.",
      uncertainty: [
        "A comparacao de FKs aplica @@map/@map literais nas colunas associadas; schemas SQL, renames entre migrations e validacao semantica do DDL nao sao resolvidos.",
        "A analise nao calcula o estado final, nao executa migrations e nao comprova constraints aplicadas ao banco.",
      ],
    };
  });
  const selectedMigrations = page(migrationFindings, {
    offset: input.offset,
    limit: input.limit,
  });
  const prismaRelations = declarations.filter(
    (fact) => fact.kind === "schema_relation",
  );
  const mappedColumn = (
    model: (typeof models)[number] | undefined,
    field: string,
  ) => {
    if (
      !model ||
      !declarations.some(
        (fact) =>
          fact.kind === "field" &&
          fact.name === field &&
          fact.parent === model.name &&
          fact.source.path === model.source.path,
      )
    )
      return { name: null, evidenceId: undefined, unresolved: true };
    const prefix = `${model.name}.${field}`;
    const mapping = declarations.find(
      (fact) =>
        fact.kind === "config_directive" &&
        fact.name === "@map" &&
        fact.source.path === model.source.path &&
        (fact.parent === prefix || fact.parent?.startsWith(`${prefix}.`)),
    );
    if (!mapping)
      return { name: field, evidenceId: undefined, unresolved: false };
    if (!mapping.parent?.startsWith(`${prefix}.`))
      return { name: null, evidenceId: mapping.evidenceId, unresolved: true };
    return {
      name: mapping.parent.slice(prefix.length + 1),
      evidenceId: mapping.evidenceId,
      unresolved: false,
    };
  };
  const relationFindings = prismaRelations.map((relation) => {
    const sourceModel = models.find(
      (model) =>
        model.name === relation.parent &&
        model.source.path === relation.source.path,
    );
    const targetModels = models.filter((model) => model.name === relation.name);
    const targetModel = targetModels.length === 1 ? targetModels[0] : undefined;
    const mappedName = (model: typeof sourceModel) => {
      if (!model)
        return { name: null, evidenceId: undefined, unresolved: true };
      const modelMapping = declarations.find(
        (fact) =>
          fact.kind === "config_directive" &&
          fact.name === "@@map" &&
          fact.source.path === model.source.path &&
          (fact.parent === model.name ||
            fact.parent?.startsWith(`${model.name}.`)),
      );
      if (!modelMapping)
        return { name: model.name, evidenceId: undefined, unresolved: false };
      if (!modelMapping.parent?.startsWith(`${model.name}.`))
        return {
          name: null,
          evidenceId: modelMapping.evidenceId,
          unresolved: true,
        };
      return {
        name: modelMapping.parent.slice(model.name.length + 1),
        evidenceId: modelMapping.evidenceId,
        unresolved: false,
      };
    };
    const sourceTable = mappedName(sourceModel);
    const targetTable = mappedName(targetModel);
    const observed = migrationFacts.filter(
      (fact) =>
        fact.kind === "schema_relation" &&
        ((fact.parent === sourceTable.name && fact.name === targetTable.name) ||
          (fact.parent === targetTable.name && fact.name === sourceTable.name)),
    );
    const sourceColumns = relation.relation?.sourceFields?.map((field) =>
      mappedColumn(sourceModel, field),
    );
    const targetColumns = relation.relation?.targetFields?.map((field) =>
      mappedColumn(targetModel, field),
    );
    const columnMappings = [...(sourceColumns ?? []), ...(targetColumns ?? [])];
    const columnsComplete =
      Boolean(sourceColumns?.length) &&
      Boolean(targetColumns?.length) &&
      sourceColumns!.length === targetColumns!.length &&
      columnMappings.every((column) => !column.unresolved);
    const alignedForeignKey = observed.some((fact) => {
      const sqlRelation = fact.relation;
      if (
        !columnsComplete ||
        !sqlRelation?.sourceFields?.length ||
        !sqlRelation.targetFields?.length
      )
        return false;
      const sourceNames = sourceColumns!.map((column) => column.name);
      const targetNames = targetColumns!.map((column) => column.name);
      return (
        (JSON.stringify(sqlRelation.sourceFields) ===
          JSON.stringify(sourceNames) &&
          JSON.stringify(sqlRelation.targetFields) ===
            JSON.stringify(targetNames)) ||
        (JSON.stringify(sqlRelation.sourceFields) ===
          JSON.stringify(targetNames) &&
          JSON.stringify(sqlRelation.targetFields) ===
            JSON.stringify(sourceNames))
      );
    });
    const allObservedColumnsComparable = observed.every(
      (fact) =>
        Boolean(fact.relation?.sourceFields?.length) &&
        Boolean(fact.relation?.targetFields?.length),
    );
    const incomplete =
      snapshot.coverage.status === "partial" ||
      incompleteMigrationPaths.size > 0 ||
      schemaFileIncomplete(snapshot, relation.source.path) ||
      (targetModel
        ? schemaFileIncomplete(snapshot, targetModel.source.path)
        : true) ||
      targetModels.length !== 1 ||
      sourceTable.unresolved ||
      targetTable.unresolved;
    const state = incomplete
      ? "migration_inventory_incomplete"
      : migrationFiles.length === 0
        ? "no_migration_files_observed"
        : observed.length === 0
          ? "foreign_key_not_observed"
          : !columnsComplete || !allObservedColumnsComparable
            ? "foreign_key_columns_unverified"
            : alignedForeignKey
              ? "foreign_key_columns_observed"
              : "foreign_key_columns_mismatch";
    const evidenceIds = [
      relation.evidenceId,
      ...(sourceModel ? [sourceModel.evidenceId] : []),
      ...(targetModel ? [targetModel.evidenceId] : []),
      ...(sourceTable.evidenceId ? [sourceTable.evidenceId] : []),
      ...(targetTable.evidenceId ? [targetTable.evidenceId] : []),
      ...columnMappings.flatMap((column) =>
        column.evidenceId ? [column.evidenceId] : [],
      ),
      ...observed.map((fact) => fact.evidenceId),
    ];
    return {
      id: `data:relation-review:${relation.id}`,
      relation,
      state,
      evidenceIds: [...new Set(evidenceIds)],
      observation:
        state === "foreign_key_columns_observed"
          ? "FOREIGN KEY REFERENCES e suas colunas foram observadas e alinhadas aos fields/references Prisma explicitos, incluindo @@map/@map literais."
          : state === "foreign_key_columns_mismatch"
            ? "FOREIGN KEY REFERENCES foi observada entre as tabelas, mas as colunas nao correspondem aos fields/references Prisma explicitos."
            : state === "foreign_key_columns_unverified"
              ? "FOREIGN KEY REFERENCES foi observada entre as tabelas, mas a cobertura das colunas nao permite confirmar alinhamento."
              : state === "foreign_key_not_observed"
                ? "Nenhuma declaracao FOREIGN KEY REFERENCES entre as tabelas associadas foi observada nas migrations analisadas."
                : state === "no_migration_files_observed"
                  ? "Nenhum arquivo de migration Prisma foi observado para comparar esta relacao."
                  : "A cobertura de schema ou migrations nao permite comparar esta relacao com seguranca.",
      uncertainty: [
        "Relacoes Prisma e FOREIGN KEY estaticas nao comprovam integridade dos dados nem constraint efetiva no banco; diferenca de colunas e observacional, nao prova de runtime.",
        "Nomes SQL sao comparados sem schemas e sem calcular migrations posteriores; uma FK em qualquer direcao conta como relacao observada.",
      ],
    };
  });
  const selectedRelations = page(relationFindings, {
    offset: input.offset,
    limit: input.limit,
  });
  return dataReviewOutput.parse({
    schemaVersion: 4,
    engine: "data",
    snapshotId: snapshot.id,
    state: "unverified",
    models: selected,
    migrations: selectedMigrations,
    relations: selectedRelations,
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
      declaredRelations: prismaRelations.length,
      unexaminedRelations: relationFindings.filter((finding) =>
        [
          "migration_inventory_incomplete",
          "no_migration_files_observed",
          "foreign_key_columns_unverified",
        ].includes(finding.state),
      ).length,
      limitations: [
        "A analise consome fatos estaticos do snapshot; nao conecta nem consulta banco.",
        "Diretivas reconhecidas: @id, @@id, @unique e @@unique. Ausencia observada gera item informativo unverified, nunca defeito confirmado.",
        "Migrations: reconhece um subconjunto de PostgreSQL e compara colunas de FKs quando Prisma/SQL as declaram literalmente; unique constraints sao apenas observadas por tabela. Nao calcula estado final, renames, schemas SQL, SQL dinamico ou aplicacao no banco.",
        ...snapshot.coverage.limitations,
      ],
    },
  });
}
