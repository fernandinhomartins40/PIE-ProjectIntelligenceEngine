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
    await exec("git", ["-C", repo, "add", "index.ts"]);
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
    for (const tool of tools.tools) {
      expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
      expect(ajv.validateSchema(tool.outputSchema as AnySchema)).toBe(true);
    }
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
  } finally {
    await client.close();
    await transport.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
