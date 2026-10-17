import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { expect, it, vi } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { runPie } from "../../src/pie/cli.js";
import { createPieMcp } from "../../src/pie/mcp.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";

const exec = promisify(execFile);

async function verifyPlanAdapters(input: {
  expected: unknown;
  snapshotId: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
  mcp: ReturnType<typeof createPieMcp>;
}) {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie([
      "plan",
      input.snapshotId,
      "--limit",
      "20",
      "--db",
      input.database,
    ]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(
      input.expected,
    );
  } finally {
    output.mockRestore();
  }
  const response = await fetch(`${input.apiUrl}/v1/plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snapshotId: input.snapshotId, limit: 20 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input.expected);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    input.client.connect(clientTransport),
    input.mcp.connect(serverTransport),
  ]);
  const tool = (await input.client.listTools()).tools.find(
    (item) => item.name === "pie_plan_generate",
  );
  expect(tool).toBeDefined();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
  const result = await input.client.callTool({
    name: "pie_plan_generate",
    arguments: { snapshotId: input.snapshotId, limit: 20 },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(input.expected);
}

it("agrega propostas de motores com Evidence e sem promover verificação", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-unified-plan-"));
  const repo = join(root, "repo");
  const storePath = join(root, "pie.sqlite");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "prisma", "migrations", "001"), {
    recursive: true,
  });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "src", "routes.js"),
    "import express from 'express';\nconst app = express();\napp.get('/accounts', handler);\n",
  );
  await writeFile(
    join(repo, "secrets.ts"),
    'export const token = "ghp_123456789012345678901234567890123456";\n',
  );
  await writeFile(
    join(repo, "prisma", "schema.prisma"),
    "model Account {\n  id String @id\n}\n",
  );
  await writeFile(
    join(repo, "prisma", "migrations", "001", "migration.sql"),
    'CREATE TABLE "Account" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));\n',
  );
  await exec("git", ["-C", repo, "add", "."]);

  const store = await openStore(storePath, repo);
  const service = new PieService(store);
  const token = "fixture-unified-plan-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repo, token });
  const mcp = createPieMcp(service, repo);
  const client = new Client({ name: "pie-unified-plan-test", version: "1" });
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const result = await service.plan({
      snapshotId: discovered.snapshot.id,
      limit: 20,
    });
    expect(result).toMatchObject({
      schemaVersion: 1,
      engine: "planning",
      state: "unverified",
      executionAuthorized: false,
      engines: expect.arrayContaining([
        expect.objectContaining({
          engine: "infrastructure",
          status: "not_implemented",
        }),
        expect.objectContaining({
          engine: "regression",
          status: "not_implemented",
        }),
      ]),
    });
    expect(result.items.items.map((item) => item.engine)).toEqual(
      expect.arrayContaining(["functional", "product", "security", "data"]),
    );
    for (const item of result.items.items) {
      expect(item.evidenceIds.length).toBeGreaterThan(0);
      expect(item.status).toBe("open");
      expect(item.priority).toBe("unassessed");
      expect(item.owner).toBeNull();
      expect(item.acceptance.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(result)).not.toContain(
      "ghp_123456789012345678901234567890123456",
    );
    await verifyPlanAdapters({
      expected: result,
      snapshotId: discovered.snapshot.id,
      database: storePath,
      apiUrl: api.url,
      token,
      client,
      mcp,
    });

    const page = await service.plan({
      snapshotId: discovered.snapshot.id,
      limit: 2,
      offset: 1,
    });
    expect(page.planDigest).toBe(result.planDigest);
    expect(page.items.items).toHaveLength(2);
    expect(page.items.offset).toBe(1);
  } finally {
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
