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

it("integra inventário Compose/Nginx com Evidence e métricas NOT_MEASURED", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-infrastructure-"));
  const repository = join(temporary, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "compose.yaml"),
    "services:\n  api:\n    depends_on:\n      - database\n  database:\n    image: postgres\n",
  );
  await writeFile(
    join(repository, "nginx.conf"),
    "events {}\nhttp { server { listen 8080; location /api { proxy_pass http://api:3000; } } }\n",
  );
  await exec("git", ["init", repository]);
  await exec("git", ["-C", repository, "add", "."]);
  const store = await openStore(join(temporary, "pie.sqlite"), repository);
  const service = new PieService(store);
  const token = "pie-infrastructure-test-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repository, token });
  const mcp = createPieMcp(service, repository);
  const client = new Client({ name: "pie-infrastructure-test", version: "1" });
  try {
    const discovered = await service.discover({
      repositoryRoot: repository,
      profile: "OBSERVE",
      environment: "local",
    });
    const input = { snapshotId: discovered.snapshot.id, limit: 50, offset: 0 };
    const result = await service.infrastructure(input);
    expect(result).toMatchObject({
      engine: "infrastructure",
      state: "unverified",
      measurements: {
        cpu: "NOT_MEASURED",
        memory: "NOT_MEASURED",
        disk: "NOT_MEASURED",
        io: "NOT_MEASURED",
        network: "NOT_MEASURED",
        latencyP95: "NOT_MEASURED",
        latencyP99: "NOT_MEASURED",
        restarts: "NOT_MEASURED",
      },
      coverage: { runtimeMeasured: false },
    });
    expect(result.components.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "compose_service",
          name: "api",
          dependencies: expect.arrayContaining([
            expect.objectContaining({
              name: "database",
              evidenceId: expect.any(String),
            }),
          ]),
        }),
        expect.objectContaining({ kind: "compose_service", name: "database" }),
        expect.objectContaining({ kind: "nginx_directive" }),
      ]),
    );
    expect(result.coverage.sourceFacts).toBeGreaterThan(
      result.components.total,
    );
    const evidence = new Set(
      (
        await service.declarations(discovered.snapshot.id, { limit: 200 })
      ).declarations.items.map((fact) => fact.evidenceId),
    );
    for (const component of result.components.items)
      expect(evidence.has(component.evidenceId)).toBe(true);
    const page = await service.infrastructure({
      snapshotId: discovered.snapshot.id,
      offset: 2,
      limit: 2,
    });
    expect(page.components.items).toEqual(result.components.items.slice(2, 4));
    expect(page.components.total).toBe(result.components.total);

    const plan = await service.plan({ ...input, limit: 200 });
    expect(plan.engines).toContainEqual(
      expect.objectContaining({
        engine: "infrastructure",
        status: "partial_static",
        sourceCount: result.components.total,
        runtimeVerified: false,
      }),
    );
    expect(
      plan.items.items.some((item) => item.engine === "infrastructure"),
    ).toBe(true);

    const response = await fetch(`${api.url}/v1/infrastructure-review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    const unauthenticated = await fetch(`${api.url}/v1/infrastructure-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(unauthenticated.status).toBe(401);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      mcp.connect(serverTransport),
    ]);
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "pie_infrastructure_review",
    );
    expect(tool).toBeDefined();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
    const mcpResult = await client.callTool({
      name: "pie_infrastructure_review",
      arguments: input,
    });
    expect(mcpResult.structuredContent).toEqual(result);

    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runPie([
        "infrastructure-review",
        discovered.snapshot.id,
        "--db",
        join(temporary, "pie.sqlite"),
      ]);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(result);
    } finally {
      output.mockRestore();
    }
  } finally {
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
