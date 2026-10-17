import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

async function verifyDeclarations(
  client: Client,
  script: string,
  db: string,
  snapshotId: string,
) {
  const declared = await client.callTool({
    name: "pie_declarations_list",
    arguments: { snapshotId, limit: 1 },
  });
  expect(declared.structuredContent).toMatchObject({
    declarations: {
      total: 1,
      items: [{ name: "express", state: "unverified" }],
    },
  });
  const cli = await exec(process.execPath, [
    script,
    "declarations",
    snapshotId,
    "--db",
    db,
  ]);
  expect(JSON.parse(cli.stdout)).toEqual(declared.structuredContent);
  const value = declared.structuredContent as {
    declarations: { items: Array<{ id: string }> };
  };
  const nodeId = value.declarations.items[0]!.id;
  const trace = await client.callTool({
    name: "pie_graph_trace",
    arguments: { snapshotId, nodeId },
  });
  expect(trace.isError).not.toBe(true);
  expect(trace.structuredContent).toMatchObject({
    coverage: { runtime: false },
    nodes: { total: 2 },
  });
  const cliTrace = await exec(process.execPath, [
    script,
    "trace",
    snapshotId,
    nodeId,
    "--db",
    db,
  ]);
  expect(JSON.parse(cliTrace.stdout)).toEqual(trace.structuredContent);
}

async function verifyQueueCli(script: string, repo: string, db: string) {
  const enqueued = await exec(process.execPath, [
    script,
    "enqueue",
    repo,
    "--key",
    "cli-fixture-job",
    "--db",
    db,
  ]);
  const queued = JSON.parse(enqueued.stdout) as { id: string; state: string };
  expect(queued.state).toBe("queued");
  const worked = await exec(process.execPath, [
    script,
    "work",
    repo,
    "--db",
    db,
  ]);
  expect(JSON.parse(worked.stdout)).toMatchObject({ processed: true });
  const job = await exec(process.execPath, [
    script,
    "job",
    queued.id,
    "--db",
    db,
  ]);
  expect(JSON.parse(job.stdout)).toMatchObject({ state: "succeeded" });
}

async function verifyFunctional(
  client: Client,
  options: { script: string; db: string; snapshotId: string },
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
) {
  const { script, db, snapshotId } = options;
  const functional = await client.callTool({
    name: "pie_functional_review",
    arguments: { snapshotId: snapshotId },
  });
  expect(functional.structuredContent).toMatchObject({
    engine: "functional",
    state: "unverified",
    coverage: { runtime: false },
    findings: { total: 0 },
  });
  const functionalTool = catalog.find(
    (item) => item.name === "pie_functional_review",
  )!;
  expect(
    ajv.compile(functionalTool.outputSchema as AnySchema)(
      functional.structuredContent,
    ),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await exec(process.execPath, [
          script,
          "functional",
          snapshotId,
          "--db",
          db,
        ])
      ).stdout,
    ),
  ).toEqual(functional.structuredContent);
  const retained = await client.callTool({
    name: "pie_functional_retain",
    arguments: { snapshotId },
  });
  expect(retained.isError).not.toBe(true);
  const record = retained.structuredContent as { id: string; result: unknown };
  expect(record.result).toEqual(functional.structuredContent);
  const read = await client.callTool({
    name: "pie_functional_record_get",
    arguments: { id: record.id },
  });
  expect(read.structuredContent).toEqual(retained.structuredContent);
  const schema = catalog.find((item) => item.name === "pie_functional_retain")!;
  expect(
    ajv.compile(schema.outputSchema as AnySchema)(retained.structuredContent),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await exec(process.execPath, [
          script,
          "functional-record",
          record.id,
          "--db",
          db,
        ])
      ).stdout,
    ),
  ).toEqual(retained.structuredContent);
  const listed = await client.callTool({
    name: "pie_functional_records_list",
    arguments: { snapshotId, limit: 1 },
  });
  expect(listed.structuredContent).toMatchObject({
    total: 1,
    nextOffset: null,
    items: [{ id: record.id, state: "unverified" }],
  });
  const historySchema = catalog.find(
    (item) => item.name === "pie_functional_records_list",
  )!;
  expect(
    ajv.compile(historySchema.outputSchema as AnySchema)(
      listed.structuredContent,
    ),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await exec(process.execPath, [
          script,
          "functional-records",
          snapshotId,
          "--limit",
          "1",
          "--db",
          db,
        ])
      ).stdout,
    ),
  ).toEqual(listed.structuredContent);
}

function verifySchemas(
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
) {
  for (const tool of catalog) {
    expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool.outputSchema as AnySchema)).toBe(true);
  }
}

it("CLI e MCP stdio usam o mesmo histórico real e anunciam schemas válidos", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-mcp-"));
  const repo = join(root, "target");
  const db = join(root, "pie.sqlite");
  const script = resolve("scripts/pie.mjs");
  const client = new Client({ name: "pie-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script, "mcp", repo, "--db", db],
    stderr: "pipe",
  });
  try {
    await mkdir(repo);
    await exec("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const value = 1;");
    await writeFile(
      join(repo, "package.json"),
      '{"dependencies":{"express":"5"}}',
    );
    await exec("git", ["-C", repo, "add", "index.ts", "package.json"]);
    const cli = await exec(process.execPath, [
      script,
      "discover",
      repo,
      "--db",
      db,
    ]);
    const discovered = JSON.parse(cli.stdout) as { snapshot: { id: string } };
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "pie_project_discover",
    );
    expect(tools.tools.map((tool) => tool.name)).not.toContain("pie_test_run");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    verifySchemas(tools.tools, ajv);
    const runs = await client.callTool({
      name: "pie_verifications_list",
      arguments: { snapshotId: discovered.snapshot.id },
    });
    await verifyFunctional(
      client,
      { script, db, snapshotId: discovered.snapshot.id },
      tools.tools,
      ajv,
    );
    expect(runs.structuredContent).toMatchObject({ total: 0, items: [] });
    const runSchema = tools.tools.find(
      (tool) => tool.name === "pie_verifications_list",
    )!;
    expect(
      ajv.compile(runSchema.outputSchema as AnySchema)(runs.structuredContent),
    ).toBe(true);
    const graph = await client.callTool({
      name: "pie_graph_query",
      arguments: { snapshotId: discovered.snapshot.id, limit: 1 },
    });
    expect(graph.isError).not.toBe(true);
    const content = graph.structuredContent as {
      nodes: { items: Array<{ path: string; evidenceIds: string[] }> };
      coverage: { runtime: boolean };
    };
    expect(content.nodes.items[0]!.path).toBe("index.ts");
    expect(content.coverage.runtime).toBe(false);
    const evidence = await client.callTool({
      name: "pie_evidence_get",
      arguments: { id: content.nodes.items[0]!.evidenceIds[0] },
    });
    expect(evidence.structuredContent).toMatchObject({
      state: "unverified",
      method: "static",
    });
    const invalid = await client.callTool({
      name: "pie_graph_query",
      arguments: { snapshotId: "invalid", limit: 0 },
    });
    expect(invalid.isError).toBe(true);
    const missing = await client.callTool({
      name: "pie_evidence_get",
      arguments: { id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    const rediscovered = await client.callTool({
      name: "pie_project_discover",
      arguments: { maxFiles: 1 },
    });
    expect(rediscovered.isError).not.toBe(true);
    const projects = await client.callTool({
      name: "pie_projects_list",
      arguments: {},
    });
    expect(projects.structuredContent).toMatchObject({ total: 1 });
    const compared = await client.callTool({
      name: "pie_change_impact",
      arguments: {
        beforeId: discovered.snapshot.id,
        afterId: discovered.snapshot.id,
      },
    });
    expect(compared.isError).not.toBe(true);
    expect(compared.structuredContent).toMatchObject({
      status: "unchanged",
      runtimeVerified: false,
    });
    for (const [name, response] of [
      ["pie_graph_query", graph],
      ["pie_evidence_get", evidence],
      ["pie_projects_list", projects],
      ["pie_change_impact", compared],
      ["pie_evidence_get", missing],
    ] as const) {
      const tool = tools.tools.find((item) => item.name === name)!;
      const validate = ajv.compile(tool.outputSchema as AnySchema);
      expect(
        validate(response.structuredContent),
        JSON.stringify(validate.errors),
      ).toBe(true);
    }
    const cliCompared = await exec(process.execPath, [
      script,
      "compare",
      discovered.snapshot.id,
      discovered.snapshot.id,
      "--db",
      db,
    ]);
    expect(JSON.parse(cliCompared.stdout)).toEqual(compared.structuredContent);
    const exported = await exec(process.execPath, [
      script,
      "export",
      discovered.snapshot.id,
      "--format",
      "html",
      "--db",
      db,
    ]);
    expect(exported.stdout).toContain('<html lang="pt-BR">');
    await verifyQueueCli(script, repo, db);
    await verifyDeclarations(client, script, db, discovered.snapshot.id);
  } finally {
    await client.close();
    await transport.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
