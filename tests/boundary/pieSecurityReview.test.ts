import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { discoverProject } from "../../src/pie/discovery.js";
import { reviewSecurity } from "../../src/pie/security.js";

const exec = promisify(execFile);

async function verifySecurityAdapters(input: {
  service: PieService;
  apiUrl: string;
  token: string;
  client: Client;
  mcp: ReturnType<typeof createPieMcp>;
  db: string;
  request: { snapshotId: string; limit: number };
  expected: unknown;
}) {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie([
      "security-review",
      input.request.snapshotId,
      "--limit",
      String(input.request.limit),
      "--db",
      input.db,
    ]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(
      input.expected,
    );
  } finally {
    output.mockRestore();
  }

  const response = await fetch(`${input.apiUrl}/v1/security-review`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.request),
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
    (item) => item.name === "pie_security_review",
  );
  expect(tool).toBeDefined();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
  const result = await input.client.callTool({
    name: "pie_security_review",
    arguments: input.request,
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(input.expected);
  expect(
    ajv.compile(tool!.outputSchema as AnySchema)(result.structuredContent),
  ).toBe(true);
}

async function verifySecurityFindings(
  service: PieService,
  snapshotId: string,
  canary: string,
) {
  const request = { snapshotId, limit: 1 };
  const expected = await service.security(request);
  expect(expected).toMatchObject({
    engine: "security",
    state: "suspected_findings",
    findings: {
      total: 5,
      items: [
        {
          category: "credential_like_material",
          state: "suspected",
          kind: "github_token",
          source: { path: "config.ts", line: 1 },
          evidenceIds: [expect.any(String)],
        },
      ],
      nextOffset: 1,
    },
    authorizationSurfaces: {
      total: 1,
      items: [
        {
          state: "unverified",
          declaration: expect.objectContaining({
            adapter: "express-ast",
            kind: "endpoint",
            name: "GET /accounts/:id",
          }),
          evidenceIds: [expect.any(String)],
        },
      ],
    },
    coverage: {
      authorization: "unverified",
      authorizationTargets: 1,
      dynamicCodePatterns: "partial",
      astFilesExamined: 4,
      astFilesSkipped: 0,
      filesExamined: 4,
      filesSkipped: 0,
      runtime: false,
    },
  });
  expect(JSON.stringify(expected)).not.toContain(canary);

  const secondPage = await service.security({
    snapshotId,
    limit: 1,
    offset: 1,
  });
  expect(secondPage.findings.items[0]).toMatchObject({
    kind: "aws_access_key_id",
    source: { path: "config.ts", line: 2 },
  });

  const allFindings = await service.security({ snapshotId, limit: 10 });
  expect(allFindings.findings.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: "dynamic_code_evaluation",
        kind: "global_eval",
        source: { path: "dynamic.ts", line: 1 },
      }),
      expect.objectContaining({
        category: "dynamic_code_evaluation",
        kind: "function_constructor",
        source: { path: "dynamic.ts", line: 2 },
      }),
      expect.objectContaining({
        category: "dynamic_code_evaluation",
        kind: "function_constructor",
        source: { path: "dynamic.ts", line: 3 },
      }),
    ]),
  );
  expect(allFindings.findings.items).toHaveLength(5);
  expect(allFindings.findings.items[0]).toMatchObject({
    condition: expect.any(String),
    impact: expect.any(String),
    probability: "unassessed",
    reproduction: expect.arrayContaining([expect.any(String)]),
    remediation: expect.any(String),
    regression: expect.arrayContaining([expect.any(String)]),
    verificationStatus: "not_run",
    owner: null,
  });
  return { request, expected };
}

it("detecta formatos de credencial sem revelar valores e compartilha CLI, API e MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-security-review-"));
  const repo = join(root, "repo");
  const db = join(root, "pie.sqlite");
  const canary = "ghp_123456789012345678901234567890123456";
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "config.ts"),
    `export const token = "${canary}";\nexport const key = "AKIA1234567890ABCDEF";\n`,
  );
  await writeFile(join(repo, "ordinary.ts"), "export const ready = true;\n");
  await writeFile(
    join(repo, "routes.js"),
    "import express from 'express';\nconst app = express();\napp.get('/accounts/:id', handler);\n",
  );
  await writeFile(
    join(repo, "dynamic.ts"),
    [
      "eval(userInput);",
      "new Function(userInput);",
      "Function(userInput);",
      `const example = "eval('ignored')"; // eval('comment')`,
      "function shadowed(eval: (value: string) => void) { eval('local'); }",
      "const object = { eval(value: string) {} }; object.eval(userInput);",
      "",
    ].join("\n"),
  );
  await exec("git", ["-C", repo, "add", "."]);

  const store = await openStore(db, repo);
  const service = new PieService(store);
  const token = "fixture-security-review-api-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repo, token });
  const mcp = createPieMcp(service, repo);
  const client = new Client({ name: "pie-security-review-test", version: "1" });
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const { request, expected } = await verifySecurityFindings(
      service,
      discovered.snapshot.id,
      canary,
    );

    await verifySecurityAdapters({
      service,
      apiUrl: api.url,
      token,
      client,
      mcp,
      db,
      request,
      expected,
    });

    await writeFile(
      join(repo, "config.ts"),
      "export const token = 'changed';\n",
    );
    const stale = await service.security({
      snapshotId: discovered.snapshot.id,
    });
    expect(stale.findings.total).toBe(3);
    expect(
      stale.findings.items.every(
        (finding) => finding.source.path !== "config.ts",
      ),
    ).toBe(true);
    expect(stale.state).toBe("incomplete");
    expect(stale.coverage.filesSkipped).toBe(1);
    expect(stale.coverage.limitations.join(" ")).toContain(
      "mudou desde o snapshot",
    );
  } finally {
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("bounds credential findings and reports incomplete coverage at the cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-security-cap-"));
  const token = "ghp_123456789012345678901234567890123456";
  try {
    await exec("git", ["init", root]);
    await writeFile(join(root, "tokens.txt"), `${`${token}\n`.repeat(10_001)}`);
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverProject(
      { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
      randomUUID(),
    );
    const result = await reviewSecurity(snapshot, { snapshotId: snapshot.id });
    expect(result.findings.total).toBe(10_000);
    expect(result.coverage.findingsTruncated).toBe(true);
    expect(result.state).toBe("incomplete");
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
