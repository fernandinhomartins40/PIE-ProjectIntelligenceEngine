import { readdir } from "node:fs/promises";
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
const migrationRows = expectedPostgresMigrations.map((migration_name) => ({
  migration_name,
  finished_at: new Date(0),
  rolled_back_at: null,
}));

it("mantém o catálogo de migrations PostgreSQL alinhado aos diretórios Prisma reais", async () => {
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect([...expectedPostgresMigrations].sort()).toEqual(directories);
});

it("classifica histórico PostgreSQL aplicado, incompleto, ausente e à frente sem escrever", () => {
  expect(inspectAppliedMigrations(migrationRows)).toEqual({
    status: "current",
    missing: 0,
    unfinished: 0,
    unknown: 0,
  });
  expect(inspectAppliedMigrations(migrationRows.slice(1)).status).toBe(
    "missing",
  );
  expect(
    inspectAppliedMigrations([
      ...migrationRows,
      {
        migration_name: "202610180001_interrupted",
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
        finished_at: new Date(0),
        rolled_back_at: null,
      },
    ]),
  ).toMatchObject({ status: "unknown", unknown: 1 });
  expect(
    inspectAppliedMigrations([
      ...migrationRows,
      {
        migration_name: "202610180001_rolled_back",
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
