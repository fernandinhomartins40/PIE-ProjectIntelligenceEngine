import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local HTTP port");
  return address.port;
}

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

async function verifyFunctionalRecordExport(
  client: Client,
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
  script: string,
  db: string,
  record: { id: string },
) {
  const exportTool = catalog.find(
    (item) => item.name === "pie_functional_record_export",
  )!;
  let exportOffset = 0;
  let exportContent = "";
  let exportDigest: string | undefined;
  do {
    const page = await client.callTool({
      name: "pie_functional_record_export",
      arguments: { id: record.id, offset: exportOffset, limitBytes: 128 },
    });
    expect(page.isError).not.toBe(true);
    const validateExport = ajv.compile(exportTool.outputSchema as AnySchema);
    expect(
      validateExport(page.structuredContent),
      JSON.stringify(validateExport.errors),
    ).toBe(true);
    const value = page.structuredContent as {
      recordId: string;
      nextOffset: number | null;
      sha256: string;
      content: string;
    };
    expect(value.recordId).toBe(record.id);
    exportDigest ??= value.sha256;
    expect(value.sha256).toBe(exportDigest);
    exportContent += value.content;
    if (value.nextOffset === null) break;
    exportOffset = value.nextOffset;
  } while (true);
  expect(JSON.parse(exportContent)).toEqual(record);
  expect(createHash("sha256").update(exportContent).digest("hex")).toBe(
    exportDigest,
  );
  const cliExport = await exec(process.execPath, [
    script,
    "functional-record-export",
    record.id,
    "--db",
    db,
  ]);
  expect(cliExport.stdout).toBe(`${exportContent}\n`);
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
  await verifyFunctionalRecordExport(client, catalog, ajv, script, db, record);
  const retests = await client.callTool({
    name: "pie_retest_plan",
    arguments: { beforeId: snapshotId, afterId: snapshotId, mode: "full" },
  });
  expect(retests.structuredContent).toMatchObject({
    state: "unverified",
    executionAuthorized: false,
    candidates: { total: 0 },
  });
  const retestTool = catalog.find((item) => item.name === "pie_retest_plan")!;
  expect(
    ajv.compile(retestTool.outputSchema as AnySchema)(
      retests.structuredContent,
    ),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await exec(process.execPath, [
          script,
          "retest-plan",
          snapshotId,
          snapshotId,
          "--mode",
          "full",
          "--db",
          db,
        ])
      ).stdout,
    ),
  ).toEqual(retests.structuredContent);
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

async function verifyProductReview(
  client: Client,
  options: { script: string; db: string; snapshotId: string },
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
) {
  const { script, db, snapshotId } = options;
  const product = await client.callTool({
    name: "pie_product_review",
    arguments: { snapshotId },
  });
  expect(product.isError).not.toBe(true);
  expect(product.structuredContent).toMatchObject({
    engine: "product",
    state: "insufficient_evidence",
    coverage: { observedJourneys: false },
  });
  const tool = catalog.find((item) => item.name === "pie_product_review")!;
  expect(
    ajv.compile(tool.outputSchema as AnySchema)(product.structuredContent),
  ).toBe(true);
  const cli = await exec(process.execPath, [
    script,
    "product-review",
    snapshotId,
    "--db",
    db,
  ]);
  expect(JSON.parse(cli.stdout)).toEqual(product.structuredContent);
}

async function verifyVerificationList(
  client: Client,
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
  snapshotId: string,
) {
  const runs = await client.callTool({
    name: "pie_verifications_list",
    arguments: { snapshotId },
  });
  expect(runs.structuredContent).toMatchObject({ total: 0, items: [] });
  const tool = catalog.find((item) => item.name === "pie_verifications_list")!;
  expect(
    ajv.compile(tool.outputSchema as AnySchema)(runs.structuredContent),
  ).toBe(true);
}

async function verifyHttpProbeAdapters(
  client: Client,
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
  details: {
    script: string;
    db: string;
    repository: string;
    root: string;
    snapshotId: string;
    treeDigest: string;
    port: number;
    responseBody: string;
  },
) {
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowLocalHttpRequests: true,
    environment: "local",
    repositoryRoot: details.repository,
    snapshotId: details.snapshotId,
    treeDigest: details.treeDigest,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    evidenceTtlMs: 30_000,
    request: {
      address: "127.0.0.1",
      port: details.port,
      method: "GET",
      path: "/mcp-cli",
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    },
    expectedStatus: 200,
    expectedBodySha256: createHash("sha256")
      .update(details.responseBody)
      .digest("hex"),
  };
  const grantPath = join(details.root, "http-grant.json");
  await writeFile(grantPath, JSON.stringify(grant));
  const probed = await client.callTool({
    name: "pie_http_probe_run",
    arguments: grant,
  });
  expect(probed.isError).not.toBe(true);
  expect(probed.structuredContent).toMatchObject({
    schemaVersion: 1,
    record: { state: "passed", capture: { complete: true } },
  });
  const record = (probed.structuredContent as { record: { id: string } })
    .record;
  const runTool = catalog.find((tool) => tool.name === "pie_http_probe_run")!;
  const validate = ajv.compile(runTool.outputSchema as AnySchema);
  expect(
    validate(probed.structuredContent),
    JSON.stringify(validate.errors),
  ).toBe(true);
  expect(
    (
      await client.callTool({
        name: "pie_http_probe_get",
        arguments: { id: record.id },
      })
    ).structuredContent,
  ).toEqual(record);

  const cli = await exec(process.execPath, [
    details.script,
    "http-probe-run",
    grantPath,
    "--db",
    details.db,
  ]);
  const outcome = JSON.parse(cli.stdout) as {
    ok: boolean;
    value: { id: string; state: string };
  };
  expect(outcome).toMatchObject({ ok: true, value: { state: "passed" } });
  expect(
    (
      await client.callTool({
        name: "pie_http_probe_get",
        arguments: { id: outcome.value.id },
      })
    ).structuredContent,
  ).toEqual(outcome.value);
  const history = await client.callTool({
    name: "pie_http_probes_list",
    arguments: { snapshotId: details.snapshotId, limit: 1 },
  });
  expect(history.structuredContent).toMatchObject({
    total: 2,
    offset: 0,
    nextOffset: 1,
    items: [{ state: "passed" }],
  });
  const historyTool = catalog.find(
    (tool) => tool.name === "pie_http_probes_list",
  )!;
  const validateHistory = ajv.compile(historyTool.outputSchema as AnySchema);
  expect(
    validateHistory(history.structuredContent),
    JSON.stringify(validateHistory.errors),
  ).toBe(true);
  expect(
    JSON.parse(
      (
        await exec(process.execPath, [
          details.script,
          "http-probes",
          details.snapshotId,
          "--limit",
          "1",
          "--db",
          details.db,
        ])
      ).stdout,
    ),
  ).toEqual(history.structuredContent);
}

async function verifySnapshotExportAdapters(
  client: Client,
  tools: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
  script: string,
  db: string,
  snapshotId: string,
) {
  const exported = await exec(process.execPath, [
    script,
    "export",
    snapshotId,
    "--format",
    "html",
    "--db",
    db,
  ]);
  expect(exported.stdout).toContain('<html lang="pt-BR">');
  const exportTool = tools.find((tool) => tool.name === "pie_snapshot_export")!;
  let exportOffset = 0;
  let exportedMcp = "";
  let exportDigest: string | undefined;
  do {
    const page = await client.callTool({
      name: "pie_snapshot_export",
      arguments: {
        snapshotId: snapshotId,
        format: "html",
        offset: exportOffset,
        limitBytes: 128,
      },
    });
    expect(page.isError).not.toBe(true);
    expect(
      ajv.compile(exportTool.outputSchema as AnySchema)(page.structuredContent),
    ).toBe(true);
    const value = page.structuredContent as {
      snapshotId: string;
      nextOffset: number | null;
      sha256: string;
      content: string;
    };
    expect(value.snapshotId).toBe(snapshotId);
    exportDigest ??= value.sha256;
    expect(value.sha256).toBe(exportDigest);
    exportedMcp += value.content;
    if (value.nextOffset === null) break;
    exportOffset = value.nextOffset;
  } while (true);
  expect(exportedMcp).toContain('<html lang="pt-BR">');
  expect(exported.stdout).toBe(`${exportedMcp}\n`);
}

async function discoverMcpFixture(
  repository: string,
  db: string,
  script: string,
) {
  await mkdir(repository);
  await exec("git", ["init", repository]);
  await writeFile(join(repository, "index.ts"), "export const value = 1;");
  await writeFile(
    join(repository, "package.json"),
    '{"dependencies":{"express":"5"}}',
  );
  await exec("git", ["-C", repository, "add", "index.ts", "package.json"]);
  const cli = await exec(process.execPath, [
    script,
    "discover",
    repository,
    "--db",
    db,
  ]);
  return JSON.parse(cli.stdout) as {
    snapshot: { id: string; treeDigest: string };
  };
}

function verifySchemas(
  catalog: Awaited<ReturnType<Client["listTools"]>>["tools"],
  ajv: Ajv2020,
) {
  expect(catalog.map((tool) => tool.name)).toContain("pie_project_discover");
  expect(catalog.map((tool) => tool.name)).not.toContain("pie_test_run");
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
  const httpBody = "mcp and cli local probe";
  const httpServer = createServer((_request, response) =>
    response.end(httpBody),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script, "mcp", repo, "--db", db],
    stderr: "pipe",
  });
  try {
    const discovered = await discoverMcpFixture(repo, db, script);
    const httpPort = await listenLoopback(httpServer);
    await client.connect(transport);
    const tools = await client.listTools();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    verifySchemas(tools.tools, ajv);
    await verifyHttpProbeAdapters(client, tools.tools, ajv, {
      script,
      db,
      repository: repo,
      root,
      snapshotId: discovered.snapshot.id,
      treeDigest: discovered.snapshot.treeDigest,
      port: httpPort,
      responseBody: httpBody,
    });
    await verifyProductReview(
      client,
      { script, db, snapshotId: discovered.snapshot.id },
      tools.tools,
      ajv,
    );
    await verifyFunctional(
      client,
      { script, db, snapshotId: discovered.snapshot.id },
      tools.tools,
      ajv,
    );
    await verifyVerificationList(
      client,
      tools.tools,
      ajv,
      discovered.snapshot.id,
    );
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
    await verifySnapshotExportAdapters(
      client,
      tools.tools,
      ajv,
      script,
      db,
      discovered.snapshot.id,
    );
    await verifyQueueCli(script, repo, db);
    await verifyDeclarations(client, script, db, discovered.snapshot.id);
  } finally {
    await client.close();
    await transport.close();
    httpServer.closeAllConnections();
    if (httpServer.listening)
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
