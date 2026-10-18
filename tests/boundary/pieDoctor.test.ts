import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inspectPieEnvironment } from "../../src/pie/doctor.js";
import { openStore } from "../../src/pie/store.js";

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

it("doctor inspeciona SQLite existente em leitura e não cria o banco ausente", async () => {
  vi.stubEnv("PIE_DATABASE_URL", "");
  const root = await mkdtemp(join(tmpdir(), "pie-doctor-"));
  temporary.push(root);
  const database = join(root, "existing.sqlite");
  const store = await openStore(database);
  await store.close();
  const before = await stat(database);

  const result = await inspectPieEnvironment(database);
  expect(result.checks.sqlite).toMatchObject({ status: "available" });
  const after = await stat(database);
  expect({ size: after.size, modified: after.mtimeMs }).toEqual({
    size: before.size,
    modified: before.mtimeMs,
  });

  const absent = join(root, "not-created.sqlite");
  const absentResult = await inspectPieEnvironment(absent);
  expect(absentResult.checks.sqlite.status).toBe("not_configured");
  await expect(access(absent)).rejects.toThrow();
});

it("doctor não expõe a URL nem credenciais do PostgreSQL", async () => {
  const secretUrl = "postgresql://doctor-user:doctor-secret@127.0.0.1:1/pie";
  vi.stubEnv("PIE_DATABASE_URL", secretUrl);
  const result = await inspectPieEnvironment(join(tmpdir(), "unused.sqlite"));
  expect(JSON.stringify(result)).not.toContain("doctor-secret");
  expect(JSON.stringify(result)).not.toContain("doctor-user");
  expect(result.checks.sqlite.status).toBe("not_configured");
  expect(result.checks.postgresql.status).toBe("unavailable");
});

it("doctor exige que a lista estrutural do PostgreSQL acompanhe todos os models Prisma", async () => {
  const sourcePath = fileURLToPath(
    new URL("../../src/pie/postgresStore.ts", import.meta.url),
  );
  const schemaPath = fileURLToPath(
    new URL("../../prisma/schema.prisma", import.meta.url),
  );
  const [implementation, schema] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);
  const inspectionStart = implementation.indexOf("async inspectSchema()");
  const inspectionEnd = implementation.indexOf(
    "async close()",
    inspectionStart,
  );
  const inspected =
    inspectionStart >= 0 && inspectionEnd > inspectionStart
      ? implementation.slice(inspectionStart, inspectionEnd)
      : undefined;
  expect(inspected).toBeDefined();
  const tables = [...schema.matchAll(/@@map\("(pie_[a-z_]+)"\)/gu)].map(
    (match) => match[1]!,
  );
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) expect(inspected).toContain(`"${table}"`);
  expect(inspected).toContain("information_schema.tables");
  expect(inspected).toContain('"_prisma_migrations"');
  expect(inspected).toContain("inspectAppliedMigrations");
  expect(inspected).not.toMatch(/CREATE|ALTER|DROP|migrate/u);
});
