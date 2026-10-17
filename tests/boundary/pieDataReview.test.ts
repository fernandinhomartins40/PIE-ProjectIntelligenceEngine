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

const exec = promisify(execFile);

function expectPrismaSelectors(
  snapshot: Awaited<
    ReturnType<Awaited<ReturnType<typeof openStore>>["snapshot"]>
  >,
) {
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@id",
        parent: "Product.id",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@id",
        parent: "Pair",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@unique",
        parent: "NaturalKey.code",
      }),
      expect.objectContaining({
        adapter: "prisma-schema",
        kind: "config_directive",
        name: "@@unique",
        parent: "CompoundUnique",
      }),
    ]),
  );
  expect(snapshot.declarations.some((fact) => fact.name === "Commented")).toBe(
    false,
  );
}

it("analisa seletores Prisma somente de Evidence e compartilha service, CLI, MCP e API", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-data-review-"));
  const repo = join(root, "repo");
  const db = join(root, "pie.sqlite");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "schema.prisma"),
    [
      "model Product {",
      "  id String @id",
      "}",
      "model NaturalKey {",
      "  code String @unique",
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
      "// model Commented { id String @id }",
    ].join("\n"),
  );
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

    const request = { snapshotId: snapshot.id, limit: 1 };
    const expected = await service.dataReview(request);
    expect(expected).toMatchObject({
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
        examinedModels: 5,
        unexaminedSchemaFiles: 0,
      },
    });
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

    await runPie(["data-review", snapshot.id, "--limit", "1", "--db", db]);
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
  } finally {
    output.mockRestore();
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
