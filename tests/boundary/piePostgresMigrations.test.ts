import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  expectedPostgresMigrations,
  inspectAppliedMigrations,
  missingMigrationHistory,
} from "../../src/pie/postgresMigrations.js";

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);
const migrationRows = expectedPostgresMigrations.map(
  ({ name: migration_name, checksum }) => ({
    migration_name,
    checksum,
    finished_at: new Date(0),
    rolled_back_at: null,
  }),
);

it("mantém o catálogo de migrations PostgreSQL alinhado aos diretórios Prisma reais", async () => {
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(expectedPostgresMigrations.map(({ name }) => name).sort()).toEqual(
    directories,
  );
  const checksums = await Promise.all(
    expectedPostgresMigrations.map(async ({ name }) => {
      const sql = await readFile(join(migrationsPath, name, "migration.sql"));
      return [name, createHash("sha256").update(sql).digest("hex")];
    }),
  );
  expect(checksums).toEqual(
    expectedPostgresMigrations.map(({ name, checksum }) => [name, checksum]),
  );
});

it("classifica histórico PostgreSQL aplicado, incompleto, ausente e à frente sem escrever", () => {
  expect(inspectAppliedMigrations(migrationRows)).toEqual({
    status: "current",
    missing: 0,
    unfinished: 0,
    unknown: 0,
    drifted: 0,
  });
  expect(inspectAppliedMigrations(migrationRows.slice(1)).status).toBe(
    "missing",
  );
  expect(
    inspectAppliedMigrations([
      ...migrationRows,
      {
        migration_name: "202610180001_interrupted",
        checksum: "e".repeat(64),
        finished_at: null,
        rolled_back_at: null,
      },
    ]),
  ).toMatchObject({ status: "unfinished", unfinished: 1 });
  expect(
    inspectAppliedMigrations([
      ...migrationRows,
      {
        migration_name: "209901010001_newer_release",
        checksum: "d".repeat(64),
        finished_at: new Date(0),
        rolled_back_at: null,
      },
    ]),
  ).toMatchObject({ status: "unknown", unknown: 1 });
  const changedChecksum = migrationRows.map((row, index) =>
    index === 0 ? { ...row, checksum: "f".repeat(64) } : row,
  );
  expect(inspectAppliedMigrations(changedChecksum)).toMatchObject({
    status: "drifted",
    drifted: 1,
  });
  expect(
    inspectAppliedMigrations([
      ...migrationRows,
      {
        migration_name: "202610180001_rolled_back",
        checksum: "c".repeat(64),
        finished_at: null,
        rolled_back_at: new Date(0),
      },
    ]).status,
  ).toBe("current");
  expect(missingMigrationHistory()).toMatchObject({
    status: "missing_history",
    missing: expectedPostgresMigrations.length,
  });
});
