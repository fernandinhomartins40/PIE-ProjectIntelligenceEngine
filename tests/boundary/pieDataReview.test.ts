import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { runPie } from "../../src/pie/cli.js";
import { createPieMcp } from "../../src/pie/mcp.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { readSqlMigration } from "../../src/pie/adapters/sqlMigration.js";
import { sha256 } from "../../src/pie/evidence.js";
import {
  dataReviewOutput,
  reviewDataResult,
} from "../../src/pie/dataReview.js";

const exec = promisify(execFile);

it("reconhece seletores inline de PK e UNIQUE", () => {
  const parsed = readSqlMigration(
    'CREATE TABLE "InlineSelectors" ("id" TEXT PRIMARY KEY, "email" TEXT UNIQUE);',
  );
  expect(parsed.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "primary_key",
        parent: "InlineSelectors",
      }),
      expect.objectContaining({ name: "unique", parent: "InlineSelectors" }),
    ]),
  );
});

it("nao infere a definicao de objetos protegidos por IF NOT EXISTS", () => {
  const parsed = readSqlMigration(
    [
      'CREATE TABLE IF NOT EXISTS "TableTarget" ("id" TEXT PRIMARY KEY);',
      'CREATE TABLE "IndexTarget" ("id" TEXT);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "IndexTarget_id_key" ON "IndexTarget" ("id");',
    ].join("\n"),
  );
  expect(parsed.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("linha 1"),
      expect.stringContaining("linha 3"),
    ]),
  );
  expect(parsed.declarations).toEqual([
    expect.objectContaining({ kind: "model", name: "IndexTarget" }),
  ]);
});

it("nao interpreta limites de particao como lista de colunas", () => {
  const parsed = readSqlMigration(
    [
      'CREATE TABLE "Parent" ("id" INTEGER PRIMARY KEY) PARTITION BY RANGE ("id");',
      'CREATE TABLE "Child" PARTITION OF "Parent" FOR VALUES FROM (1) TO (10);',
      'CREATE TABLE "Inherited" ("note" TEXT) INHERITS ("Parent");',
    ].join("\n"),
  );
  expect(parsed.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("linha 2"),
      expect.stringContaining("linha 3"),
    ]),
  );
  expect(parsed.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "model", name: "Parent" }),
      expect.objectContaining({
        kind: "config_directive",
        name: "primary_key",
        parent: "Parent",
      }),
    ]),
  );
  expect(parsed.declarations.some((item) => item.name === "Child")).toBe(false);
  expect(parsed.declarations.some((item) => item.name === "Inherited")).toBe(
    false,
  );
});

it("nao interpreta tabela temporaria ou CREATE TABLE AS como DDL declarativo", () => {
  const parsed = readSqlMigration(
    [
      'CREATE TEMP TABLE "TemporaryUser" ("id" INTEGER PRIMARY KEY);',
      'CREATE GLOBAL TEMPORARY TABLE "GlobalTemporaryUser" ("id" INTEGER PRIMARY KEY);',
      'CREATE TABLE "UserFromQuery" AS SELECT generate_series(1, 10) AS id;',
      'CREATE TABLE "UserFromQueryWithNames" ("id") AS SELECT generate_series(1, 10);',
    ].join("\n"),
  );
  expect(parsed.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("linha 1"),
      expect.stringContaining("linha 2"),
      expect.stringContaining("linha 3"),
      expect.stringContaining("linha 4"),
    ]),
  );
  expect(parsed.declarations).toEqual([]);
});

it("marca SELECT INTO e CTES com SELECT INTO como DDL nao resolvido", () => {
  const parsed = readSqlMigration(
    [
      'SELECT * INTO TABLE "GeneratedUser" FROM "Source";',
      'WITH source AS (SELECT 1 AS id) SELECT * INTO "CteUser" FROM source;',
      'INSERT INTO "User" SELECT "id" FROM "Source";',
      'SELECT "id" FROM "Source";',
    ].join("\n"),
  );
  expect(parsed.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("linha 1"),
      expect.stringContaining("linha 2"),
    ]),
  );
  expect(
    parsed.limitations.some((limitation) => limitation.includes("linha 3")),
  ).toBe(false);
  expect(
    parsed.limitations.some((limitation) => limitation.includes("linha 4")),
  ).toBe(false);
  expect(parsed.declarations).toEqual([]);
});

it("nao assume enforcement de constraints em foreign tables", () => {
  const parsed = readSqlMigration(
    [
      'CREATE FOREIGN TABLE "RemoteUser" ("id" INTEGER NOT NULL) SERVER remote;',
      'ALTER FOREIGN TABLE "RemoteUser" ADD CONSTRAINT "remote_user_check" CHECK ("id" > 0);',
    ].join("\n"),
  );
  expect(parsed.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("linha 1"),
      expect.stringContaining("linha 2"),
    ]),
  );
  expect(parsed.declarations).toEqual([]);
});

async function collectDataReviewExport(
  service: PieService,
  snapshotId: string,
) {
  let offset = 0;
  let content = "";
  let first: Awaited<ReturnType<PieService["exportDataReview"]>> | undefined;
  do {
    const page = await service.exportDataReview({
      snapshotId,
      format: "json",
      offset,
      limitBytes: 2048,
    });
    if (
      first &&
      (page.sha256 !== first.sha256 || page.totalBytes !== first.totalBytes)
    )
      throw new Error("Data Review export changed between pages.");
    first ??= page;
    content += page.content;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  } while (true);
  if (
    !first ||
    Buffer.byteLength(content, "utf8") !== first.totalBytes ||
    sha256(content) !== first.sha256
  )
    throw new Error("Data Review export pages failed integrity verification.");
  return { first, content };
}

async function verifyDataReviewExportAdapters(input: {
  service: PieService;
  snapshotId: string;
  treeDigest: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
  expected: Awaited<ReturnType<PieService["dataReview"]>>;
}) {
  const exported = await collectDataReviewExport(
    input.service,
    input.snapshotId,
  );
  const fullExport = JSON.parse(exported.content) as typeof input.expected;
  expect(fullExport.schemaVersion).toBe(input.expected.schemaVersion);
  expect(fullExport.models.items).toHaveLength(input.expected.models.total);
  expect(fullExport.migrations.items).toHaveLength(
    input.expected.migrations.total,
  );
  expect(fullExport.relations.items).toHaveLength(
    input.expected.relations.total,
  );
  expect(exported.first).toMatchObject({
    treeDigest: input.treeDigest,
    state: "unverified",
    format: "json",
  });

  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  try {
    await runPie([
      "data-review-export",
      input.snapshotId,
      "--db",
      input.database,
      "--format",
      "json",
    ]);
    expect(
      JSON.parse(String(stdout.mock.calls.map((call) => call[0]).join(""))),
    ).toEqual(fullExport);
  } finally {
    stdout.mockRestore();
  }

  const response = await fetch(
    input.apiUrl +
      "/v1/data-review/export?snapshotId=" +
      input.snapshotId +
      "&format=json&limitBytes=2048",
    { headers: { Authorization: "Bearer " + input.token } },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(exported.first);

  const tool = (await input.client.listTools()).tools.find(
    (item) => item.name === "pie_data_review_export",
  );
  expect(tool).toBeDefined();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
  const result = await input.client.callTool({
    name: "pie_data_review_export",
    arguments: {
      snapshotId: input.snapshotId,
      format: "json",
      limitBytes: 2048,
    },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(exported.first);
  expect(
    ajv.compile(tool!.outputSchema as AnySchema)(result.structuredContent),
  ).toBe(true);
  expect(
    await input.service.exportDataReview({
      snapshotId: input.snapshotId,
      format: "md",
      limitBytes: 2048,
    }),
  ).toMatchObject({ format: "md", state: "unverified" });
  expect(
    await input.service.exportDataReview({
      snapshotId: input.snapshotId,
      format: "html",
      limitBytes: 2048,
    }),
  ).toMatchObject({ format: "html", state: "unverified" });
}

function expectPrismaSelectors(
  snapshot: Awaited<
    ReturnType<Awaited<ReturnType<typeof openStore>>["snapshot"]>
  >,
) {
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        adapter: "sql-migration",
        kind: "config_directive",
        name: "unique",
        parent: "natural_key",
        relation: {
          field: null,
          sourceFields: ["natural_code"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "sql-migration",
        kind: "config_directive",
        name: "unique",
        parent: "CompoundUnique",
        relation: {
          field: null,
          sourceFields: ["left", "right"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "sql-migration",
        kind: "config_directive",
        name: "unique",
        parent: "Membership",
        relation: {
          field: null,
          sourceFields: ["email"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "sql-migration",
        kind: "config_directive",
        name: "unique",
        parent: "Membership",
        relation: null,
      }),
    ]),
  );
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@id",
        parent: "Product.id",
        relation: {
          field: null,
          sourceFields: ["id"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@id",
        parent: "Pair",
        relation: {
          field: null,
          sourceFields: ["left", "right"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@unique",
        parent: "NaturalKey.code",
        relation: {
          field: null,
          sourceFields: ["code"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@unique",
        parent: "CompoundUnique",
        relation: {
          field: null,
          sourceFields: ["left", "right"],
          targetFields: null,
        },
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@map",
        parent: "NaturalKey.natural_key",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@map",
        parent: "UnresolvedMap",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@map",
        parent: "Account.ownerId.owner_id",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        provenanceVersion: 4,
        kind: "schema_relation",
        name: "Owner",
        parent: "Account",
        relation: {
          field: "owner",
          sourceFields: ["ownerId"],
          targetFields: ["id"],
        },
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        provenanceVersion: 4,
        kind: "schema_relation",
        name: "TenantUser",
        parent: "CompositeChild",
        relation: {
          field: "parent",
          sourceFields: ["tenantId", "parentId"],
          targetFields: ["tenantId", "id"],
        },
      }),
    ]),
  );
  expect(snapshot.declarations.some((fact) => fact.name === "Commented")).toBe(
    false,
  );
}

async function writeDataReviewFixture(repo: string) {
  await writeFile(
    join(repo, "schema.prisma"),
    [
      "model Product {",
      "  id String @id",
      "}",
      "model NaturalKey {",
      '  code String @unique @map("natural_code")',
      "  @@map(",
      '    "natural_key"',
      "  )",
      "}",
      "model Membership {",
      "  organizationId String",
      "  userId String",
      '  note String @default("@id must not be parsed from strings")',
      "  @@index([organizationId, userId])",
      "}",
      "model Pair {",
      "  left String",
      "  right String",
      "  @@id([left, right])",
      "}",
      "model CompoundUnique {",
      "  left String",
      "  right String",
      "  @@unique([left, right])",
      "}",
      "model UnresolvedMap {",
      "  id String @id",
      "  @@map(TABLE_NAME)",
      "}",
      "model MismatchedUnique {",
      "  code String @unique",
      "}",
      "model ColumnUnique {",
      "  email String @unique",
      "}",
      "model FunctionalUnique {",
      "  email String @unique",
      "}",
      "model MissingPrimaryKey {",
      "  id String @id",
      "}",
      "model Account {",
      "  id String @id",
      '  ownerId String @map("owner_id")',
      "  owner Owner @relation(fields: [ownerId], references: [id])",
      "}",
      "model Owner {",
      "  id String @id",
      "  accounts Account[]",
      "  logEntries LogEntry[]",
      "  auditEntries AuditEntry[]",
      "  orphanEntries OrphanEntry[]",
      "}",
      "model LogEntry {",
      "  id String @id",
      "  actorId String",
      "  actor Owner @relation(fields: [actorId], references: [id])",
      "}",
      "model AuditEntry {",
      "  id String @id",
      "  actorId String",
      "  actor Owner @relation(fields: [actorId], references: [id])",
      "}",
      "model OrphanEntry {",
      "  id String @id",
      "  actorId String",
      "  actor Owner @relation(fields: [actorId], references: [id])",
      "}",
      "model TenantUser {",
      "  tenantId String",
      "  id String",
      "  children CompositeChild[]",
      "  @@id([tenantId, id])",
      "}",
      "model CompositeChild {",
      "  id String @id",
      "  tenantId String",
      "  parentId String",
      "  parent TenantUser @relation(fields: [tenantId, parentId], references: [tenantId, id])",
      "}",
      "// model Commented { id String @id }",
    ].join("\n"),
  );
  await mkdir(join(repo, "prisma", "migrations", "001_init"), {
    recursive: true,
  });
  await writeFile(
    join(repo, "prisma", "migrations", "001_init", "migration.sql"),
    [
      "-- SELECT 'CREATE TABLE \"Membership\" (id text PRIMARY KEY)';",
      'CREATE TABLE "Product" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));',
      'CREATE TABLE "natural_key" ("natural_code" TEXT NOT NULL);',
      'CREATE UNIQUE INDEX "NaturalKey_code_key" ON "natural_key" ("natural_code");',
      'CREATE TABLE "Membership" ("id" TEXT, "unique" text, "email" text, note text DEFAULT $tag$UNIQUE fake$tag$);',
      'ALTER TABLE "Membership" ADD CONSTRAINT "Membership_email_key" UNIQUE ("email");',
      'CREATE UNIQUE INDEX "Membership_email_lower_key" ON "Membership" (lower("email"));',
      'CREATE TABLE "Pair" ("left" TEXT, "right" TEXT);',
      'ALTER TABLE "Pair" ADD CONSTRAINT "Pair_pkey" PRIMARY KEY ("left", "right");',
      'CREATE TABLE "CompoundUnique" ("left" TEXT, "right" TEXT, UNIQUE ("left", "right"));',
      'CREATE TABLE "Owner" ("id" TEXT PRIMARY KEY);',
      'CREATE TABLE "Account" ("id" TEXT PRIMARY KEY, "owner_id" TEXT, FOREIGN KEY ("owner_id") REFERENCES "Owner" ("id"));',
      'CREATE TABLE "LogEntry" ("id" TEXT PRIMARY KEY, "actorId" TEXT);',
      'ALTER TABLE "LogEntry" ADD CONSTRAINT "log_entry_actor_fk" FOREIGN KEY ("actorId") REFERENCES "Owner" ("id");',
      'CREATE TABLE "AuditEntry" ("id" TEXT PRIMARY KEY, "actor_ref" TEXT, FOREIGN KEY ("actor_ref") REFERENCES "Owner" ("id"));',
      'CREATE TABLE "OrphanEntry" ("id" TEXT PRIMARY KEY, "actorId" TEXT);',
      'CREATE TABLE "TenantUser" ("tenantId" TEXT, "id" TEXT, PRIMARY KEY ("tenantId", "id"));',
      'CREATE TABLE "CompositeChild" ("id" TEXT PRIMARY KEY, "tenantId" TEXT, "parentId" TEXT, FOREIGN KEY ("tenantId", "parentId") REFERENCES "TenantUser" ("tenantId", "id"));',
      'CREATE TABLE "MismatchedUnique" ("code" TEXT, UNIQUE ("other"));',
      'CREATE TABLE "ColumnUnique" ("email" TEXT UNIQUE);',
      'CREATE TABLE "FunctionalUnique" ("email" TEXT);',
      'CREATE UNIQUE INDEX "FunctionalUnique_email_lower_key" ON "FunctionalUnique" (lower("email"));',
      'CREATE TABLE "MissingPrimaryKey" ("id" TEXT);',
    ].join("\n"),
  );
}

function expectDataReview(input: unknown) {
  const expected = dataReviewOutput.parse(input);
  expect(expected).toMatchObject({
    schemaVersion: 5,
    engine: "data",
    state: "unverified",
    models: {
      total: 1,
      items: [
        {
          category: "model_selector_not_observed",
          model: { name: "Membership", source: { path: "schema.prisma" } },
        },
      ],
    },
    coverage: {
      runtime: false,
      schemaFiles: 1,
      examinedModels: 17,
      unexaminedSchemaFiles: 0,
      migrationFiles: 1,
      unexaminedMigrationFiles: 0,
      declaredRelations: 10,
    },
  });
  expect(expected.migrations.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        model: expect.objectContaining({ name: "Product" }),
        state: "unique_constraint_observed",
        selectors: expect.objectContaining({
          state: "aligned_observed",
          expected: [
            expect.objectContaining({ kind: "primary_key", columns: ["id"] }),
          ],
        }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "ColumnUnique" }),
        state: "unique_constraint_observed",
        selectors: expect.objectContaining({
          state: "aligned_observed",
          expected: [
            expect.objectContaining({ kind: "unique", columns: ["email"] }),
          ],
        }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "NaturalKey" }),
        state: "unique_constraint_observed",
        selectors: expect.objectContaining({
          state: "aligned_observed",
          expected: [
            expect.objectContaining({
              kind: "unique",
              columns: ["natural_code"],
            }),
          ],
        }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "Membership" }),
        state: "unique_constraint_observed",
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "Pair" }),
        state: "unique_constraint_observed",
        selectors: expect.objectContaining({
          state: "aligned_observed",
          expected: [
            expect.objectContaining({
              kind: "primary_key",
              columns: ["left", "right"],
            }),
          ],
        }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "CompoundUnique" }),
        selectors: expect.objectContaining({ state: "aligned_observed" }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "UnresolvedMap" }),
        state: "migration_inventory_incomplete",
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "MismatchedUnique" }),
        selectors: expect.objectContaining({ state: "mismatch_observed" }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "MissingPrimaryKey" }),
        selectors: expect.objectContaining({ state: "not_observed" }),
      }),
      expect.objectContaining({
        model: expect.objectContaining({ name: "FunctionalUnique" }),
        selectors: expect.objectContaining({ state: "inconclusive" }),
      }),
    ]),
  );
  expect(expected.relations.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relation: expect.objectContaining({ parent: "Account", name: "Owner" }),
        state: "foreign_key_columns_observed",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({ parent: "Owner", name: "Account" }),
        state: "foreign_key_columns_unverified",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({
          parent: "LogEntry",
          name: "Owner",
        }),
        state: "foreign_key_columns_observed",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({
          parent: "AuditEntry",
          name: "Owner",
        }),
        state: "foreign_key_columns_mismatch",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({
          parent: "OrphanEntry",
          name: "Owner",
        }),
        state: "foreign_key_not_observed",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({
          parent: "CompositeChild",
          name: "TenantUser",
        }),
        state: "foreign_key_columns_observed",
      }),
      expect.objectContaining({
        relation: expect.objectContaining({
          parent: "TenantUser",
          name: "CompositeChild",
        }),
        state: "foreign_key_columns_unverified",
      }),
    ]),
  );
}

it("analisa seletores Prisma somente de Evidence e compartilha service, CLI, MCP e API", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-"));
  const repo = join(root, "repo");
  const db = join(root, "pie.sqlite");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeDataReviewFixture(repo);
  await exec("git", ["-C", repo, "add", "."]);

  const store = await openStore(db, repo);
  const service = new PieService(store);
  const token = "fixture-data-review-api-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repo, token });
  const mcp = createPieMcp(service, repo);
  const client = new Client({ name: "pie-data-review-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = await store.snapshot(discovered.snapshot.id);
    expectPrismaSelectors(snapshot);

    const request = { snapshotId: snapshot.id, limit: 10 };
    expect(reviewDataResult(snapshot, { snapshotId: "invalid" })).toEqual({
      ok: false,
      error: { kind: "invalid_input" },
    });
    expect(
      reviewDataResult(snapshot, {
        snapshotId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "policy_denied", reason: "snapshot_mismatch" },
    });
    expect(reviewDataResult({}, request)).toEqual({
      ok: false,
      error: { kind: "invalid_snapshot" },
    });
    await expect(
      service.dataReview({ snapshotId: snapshot.id, limit: -1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const expected = await service.dataReview(request);
    expectDataReview(expected);
    const migrationEvidence = expected.migrations.items.find(
      (finding) => finding.model.name === "NaturalKey",
    )!.evidenceIds;
    const migrationSources = await Promise.all(
      migrationEvidence.map(async (id) => (await service.evidence(id)).source),
    );
    expect(migrationSources).toContainEqual(
      expect.objectContaining({
        path: "prisma/migrations/001_init/migration.sql",
        line: 4,
      }),
    );
    expect(expected.models.items[0]!.evidenceIds).toEqual([
      expected.models.items[0]!.model.evidenceId,
    ]);
    expect(
      (await service.evidence(expected.models.items[0]!.evidenceIds[0]!))
        .source,
    ).toEqual(expected.models.items[0]!.model.source);

    const limitedDiscovery = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
      maxGraphEdges: 2,
    });
    const limited = await service.dataReview({
      snapshotId: limitedDiscovery.snapshot.id,
    });
    expect(limited.models.total).toBe(0);
    expect(limited.coverage).toMatchObject({
      discovery: "complete",
      unexaminedSchemaFiles: 1,
    });

    await runPie(["data-review", snapshot.id, "--limit", "10", "--db", db]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(expected);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(`${api.url}/v1/data-review`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    await Promise.all([
      client.connect(clientTransport),
      mcp.connect(serverTransport),
    ]);
    const tool = (await client.listTools()).tools.find(
      (item) => item.name === "pie_data_review",
    );
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("REFERENCES");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
    const result = await client.callTool({
      name: "pie_data_review",
      arguments: request,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(
      ajv.compile(tool!.outputSchema as AnySchema)(result.structuredContent),
    ).toBe(true);
    await verifyDataReviewExportAdapters({
      service,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      database: db,
      apiUrl: api.url,
      token,
      client,
      expected,
    });
  } finally {
    output.mockRestore();
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem seletores inconclusivos diante de DDL destrutivo nao suportado", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-destructive-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  const initial = join(repo, "prisma", "migrations", "001_init");
  const destructive = join(repo, "prisma", "migrations", "002_drop_key");
  await mkdir(initial, { recursive: true });
  await mkdir(destructive, { recursive: true });
  await writeFile(
    join(initial, "migration.sql"),
    'CREATE TABLE "User" ("id" TEXT PRIMARY KEY);\n',
  );
  await writeFile(
    join(destructive, "migration.sql"),
    'ALTER TABLE "User" DROP CONSTRAINT "User_pkey";\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items).toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ name: "User" }),
        state: "migration_inventory_incomplete",
        selectors: expect.objectContaining({ state: "inconclusive" }),
      }),
    ]);
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
    expect(review.coverage.limitations.join(" ")).toContain(
      "Migration SQL DDL fora do subconjunto suportado na linha 1",
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("nao associa tabela qualificada por schema ao nome Prisma homonimo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-schema-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, "prisma", "migrations", "001_other_schema"), {
    recursive: true,
  });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  await writeFile(
    join(repo, "prisma", "migrations", "001_other_schema", "migration.sql"),
    'CREATE TABLE other."User" ("id" TEXT PRIMARY KEY);\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
    expect(review.coverage.limitations.join(" ")).toContain(
      "Migration SQL DDL fora do subconjunto suportado",
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("nao assume schema default apos SET search_path em migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-search-path-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, "prisma", "migrations", "001_search_path"), {
    recursive: true,
  });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  await writeFile(
    join(repo, "prisma", "migrations", "001_search_path", "migration.sql"),
    'SET search_path TO other;\nCREATE TABLE "User" ("id" TEXT PRIMARY KEY);\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
    expect(review.coverage.limitations.join(" ")).toContain(
      "Migration SQL contexto de schema fora do subconjunto suportado na linha 1",
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("nao trata indice UNIQUE parcial como seletor global do Prisma", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-partial-index-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_partial_index");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    [
      'CREATE TABLE "User" ("id" TEXT NOT NULL, "deleted_at" TIMESTAMP);',
      'CREATE UNIQUE INDEX "User_active_id_key" ON "User" ("id") WHERE "deleted_at" IS NULL;',
    ].join("\n"),
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("marca CREATE TABLE LIKE com indices importados como inconclusivo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-like-indexes-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_like_indexes");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    'CREATE TABLE "User" (LIKE "Base" INCLUDING INDEXES);\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem CREATE TABLE IF NOT EXISTS inconclusivo no Data Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-if-not-exists-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_if_not_exists");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id String @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    'CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY);\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem particao PostgreSQL inconclusiva no Data Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-partition-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_partition");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id Int @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    [
      'CREATE TABLE "User" ("id" INTEGER PRIMARY KEY) PARTITION BY RANGE ("id");',
      'CREATE TABLE "User_1" PARTITION OF "User" FOR VALUES FROM (1) TO (10);',
    ].join("\n"),
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem CREATE TABLE AS inconclusivo no Data Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-ctas-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_ctas");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id Int @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    'CREATE TABLE "User" ("id") AS SELECT generate_series(1, 10);\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem SELECT INTO inconclusivo no Data Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-select-into-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_select_into");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id Int @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    'SELECT * INTO "User" FROM "Source";\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("mantem foreign table inconclusiva no Data Review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-foreign-table-"));
  const repo = join(root, "repo");
  const migration = join(repo, "prisma", "migrations", "001_foreign_table");
  await mkdir(migration, { recursive: true });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    ["model User {", "  id Int @id", "}"].join("\n"),
  );
  await writeFile(
    join(migration, "migration.sql"),
    'CREATE FOREIGN TABLE "User" ("id" INTEGER NOT NULL) SERVER remote;\n',
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const review = await service.dataReview({
      snapshotId: discovered.snapshot.id,
    });
    expect(review.migrations.items[0]).toMatchObject({
      state: "migration_inventory_incomplete",
      selectors: { state: "inconclusive" },
    });
    expect(review.coverage.unexaminedMigrationFiles).toBe(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
