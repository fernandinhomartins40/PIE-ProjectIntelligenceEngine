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
import {
  reviewSecurity,
  reviewSecurityResult,
} from "../../src/pie/security.js";

const exec = promisify(execFile);

async function expectSecurityInputFailures(
  snapshot: unknown,
  snapshotId: string,
) {
  await expect(
    reviewSecurityResult(snapshot, { snapshotId, limit: -1 }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "invalid_input" },
  });
  await expect(
    reviewSecurityResult(snapshot, {
      snapshotId: "00000000-0000-4000-8000-000000000000",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "policy_denied", reason: "snapshot_mismatch" },
  });
  await expect(reviewSecurityResult({}, { snapshotId })).resolves.toEqual({
    ok: false,
    error: { kind: "invalid_snapshot" },
  });
}

async function writeDependencyManifest(repo: string) {
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          mutable: "github:owner/repo#main",
          lockedMutable: "github:owner/locked#main",
          mismatchedLock: "github:owner/mismatch#main",
          pinned:
            "git+https://example.invalid/org/repo.git#0123456789abcdef0123456789abcdef01234567",
          pinnedSha256:
            "git+https://example.invalid/org/repo.git#0123456789abcdef0123456789abcdef012345670123456789abcdef01234567",
          registry: "^1.2.3",
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(repo, "package-lock.json"),
    JSON.stringify(
      {
        name: "fixture",
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: {
              lockedMutable: "github:owner/locked#main",
              mismatchedLock: "github:owner/mismatch#different",
            },
          },
          "node_modules/lockedMutable": {
            version: "1.0.0",
            resolved:
              "git+https://example.invalid/org/locked.git#0123456789abcdef0123456789abcdef01234567",
          },
          "node_modules/mismatchedLock": {
            version: "1.0.0",
            resolved:
              "git+https://example.invalid/org/mismatch.git#0123456789abcdef0123456789abcdef01234567",
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function writeActionReferenceWorkflow(repo: string) {
  await writeFile(
    join(repo, ".github", "workflows", "action-refs.yml"),
    [
      "name: Action references",
      "on: [push]",
      "jobs:",
      "  reusable:",
      "    uses: owner/repo/.github/workflows/ci.yml@main",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567",
      "      - uses: owner/setup@v4",
      "      - uses: ./local/action",
      "      - uses: docker://example/image:latest",
      "      - uses: ${{ inputs.action }}",
      "      - uses: owner/dynamic@${{ inputs.ref }}",
      "",
    ].join("\n"),
  );
}

async function expectStaleLockNotToSuppress(
  service: PieService,
  repo: string,
  snapshotId: string,
) {
  await writeFile(
    join(repo, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{"":{"dependencies":{"lockedMutable":"github:owner/locked#main"}}}}\n',
  );
  const staleLock = await service.security({ snapshotId, limit: 20 });
  expect(staleLock.findings.total).toBe(13);
  expect(
    staleLock.findings.items.some(
      (finding) =>
        finding.kind === "mutable_git_dependency_reference" &&
        finding.condition.includes("lockedMutable"),
    ),
  ).toBe(true);
  expect(staleLock.coverage.filesSkipped).toBe(3);
}

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

function expectExtendedSecurityFindings(
  report: Awaited<ReturnType<PieService["security"]>>,
) {
  expect(report.findings.items).toEqual(
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
      expect.objectContaining({
        category: "insecure_tls_configuration",
        kind: "tls_verification_disabled",
        source: { path: "dynamic.ts", line: 7 },
      }),
      expect.objectContaining({
        category: "insecure_tls_configuration",
        kind: "tls_verification_disabled",
        source: { path: "dynamic.ts", line: 8 },
      }),
      expect.objectContaining({
        category: "workflow_privilege",
        kind: "workflow_write_all_permissions",
        source: { path: ".github/workflows/ci.yml", line: 3 },
        evidenceIds: [expect.any(String)],
      }),
      expect.objectContaining({
        category: "workflow_privilege",
        kind: "workflow_write_all_permissions",
        condition: 'O job "deploy" declara permissions: write-all.',
        source: { path: ".github/workflows/job-permissions.yml", line: 5 },
        evidenceIds: [expect.any(String)],
      }),
      expect.objectContaining({
        category: "workflow_privilege",
        condition: 'O job "deploy\\nINJECTED" declara permissions: write-all.',
        source: {
          path: ".github/workflows/control-character-job.yml",
          line: 5,
        },
      }),
      expect.objectContaining({
        category: "supply_chain_configuration",
        kind: "mutable_git_dependency_reference",
        source: { path: "package.json", line: 3 },
        evidenceIds: [expect.any(String)],
      }),
      expect.objectContaining({
        category: "supply_chain_configuration",
        kind: "unpinned_github_reference",
        condition:
          'O job "reusable" referencia workflow GitHub reutilizável sem SHA completo.',
        source: { path: ".github/workflows/action-refs.yml", line: 5 },
      }),
      expect.objectContaining({
        category: "supply_chain_configuration",
        kind: "unpinned_github_reference",
        condition:
          'O job "build" usa action GitHub remota sem referência a SHA completo.',
        source: { path: ".github/workflows/action-refs.yml", line: 10 },
      }),
      expect.objectContaining({
        category: "container_configuration",
        kind: "compose_host_network_mode",
        condition: 'O servi\u00e7o Compose "api" declara network_mode: host.',
        source: { path: "compose.yaml", line: 3 },
        evidenceIds: [expect.any(String)],
      }),
    ]),
  );
  expect(report.findings.items).toHaveLength(15);
  expect(
    report.findings.items.some(
      (finding) =>
        finding.kind === "mutable_git_dependency_reference" &&
        finding.condition.includes("mismatchedLock"),
    ),
  ).toBe(true);
  expect(report.findings.items[0]).toMatchObject({
    condition: expect.any(String),
    impact: expect.any(String),
    probability: "unassessed",
    reproduction: expect.arrayContaining([expect.any(String)]),
    remediation: expect.any(String),
    regression: expect.arrayContaining([expect.any(String)]),
    verificationStatus: "not_run",
    owner: null,
  });
}

async function expectStaleComposeNotToReport(
  service: PieService,
  repo: string,
  snapshotId: string,
) {
  await writeFile(
    join(repo, "compose.yaml"),
    "services:\n  api:\n    network_mode: bridge\n",
  );
  const report = await service.security({ snapshotId });
  expect(report.findings.total).toBe(12);
  expect(
    report.findings.items.some(
      (item) => item.kind === "compose_host_network_mode",
    ),
  ).toBe(false);
  expect(report.coverage.filesSkipped).toBe(4);
}

async function verifySecurityFindings(
  service: PieService,
  snapshotId: string,
  canary: string,
) {
  const request = { snapshotId, limit: 1 };
  const expected = await service.security(request);
  expect(expected).toMatchObject({
    schemaVersion: 4,
    engine: "security",
    state: "suspected_findings",
    findings: {
      total: 15,
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
      workflowPermissionPatterns: "partial",
      supplyChainPatterns: "partial",
      containerConfigurationPatterns: "partial",
      astFilesExamined: 4,
      astFilesSkipped: 0,
      filesExamined: 11,
      filesSkipped: 0,
      runtime: false,
    },
  });
  expect(JSON.stringify(expected)).not.toContain(canary);
  expect(JSON.stringify(expected)).not.toContain("example.invalid");
  expect(JSON.stringify(expected)).not.toContain("owner/setup");

  const secondPage = await service.security({
    snapshotId,
    limit: 1,
    offset: 1,
  });
  expect(secondPage.findings.items[0]).toMatchObject({
    kind: "aws_access_key_id",
    source: { path: "config.ts", line: 2 },
  });

  const allFindings = await service.security({ snapshotId, limit: 20 });
  expectExtendedSecurityFindings(allFindings);
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
  await writeDependencyManifest(repo);
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
      "const agent = { rejectUnauthorized: false };",
      "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      "const secure = { rejectUnauthorized: true };",
      "",
    ].join("\n"),
  );
  await mkdir(join(repo, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(repo, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "permissions: write-all",
      "jobs:",
      "  build:",
      "    permissions:",
      "      contents: write",
      "    runs-on: ubuntu-latest",
      "    steps: []",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(repo, ".github", "workflows", "job-permissions.yml"),
    [
      "name: Job permissions",
      "on: [push]",
      "jobs:",
      "  deploy:",
      "    permissions: write-all",
      "    steps: []",
      "  build:",
      "    permissions:",
      "      contents: read",
      "    steps: []",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(repo, ".github", "workflows", "control-character-job.yml"),
    'name: Control character job\non: [push]\njobs:\n  "deploy\\nINJECTED":\n    permissions: write-all\n    steps: []\n',
  );
  await writeActionReferenceWorkflow(repo);
  await writeFile(
    join(repo, "compose.yaml"),
    "services:\n  api:\n    network_mode: host\n",
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
    expect(stale.findings.total).toBe(13);
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
    await writeFile(
      join(repo, ".github", "workflows", "ci.yml"),
      "name: CI\non: [push]\npermissions: read-all\njobs: {}\n",
    );
    const staleWorkflow = await service.security({
      snapshotId: discovered.snapshot.id,
      limit: 20,
    });
    expect(staleWorkflow.findings.total).toBe(12);
    expect(
      staleWorkflow.findings.items.some(
        (finding) =>
          finding.kind === "workflow_write_all_permissions" &&
          finding.source.path === ".github/workflows/ci.yml",
      ),
    ).toBe(false);
    expect(staleWorkflow.coverage.filesSkipped).toBe(2);
    await expectStaleLockNotToSuppress(service, repo, discovered.snapshot.id);
    await expectStaleComposeNotToReport(service, repo, discovered.snapshot.id);
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
    await expectSecurityInputFailures(snapshot, snapshot.id);
    expect(result.findings.total).toBe(10_000);
    expect(result.coverage.findingsTruncated).toBe(true);
    expect(result.state).toBe("incomplete");
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
