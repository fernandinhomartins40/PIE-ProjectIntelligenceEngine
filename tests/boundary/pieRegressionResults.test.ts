import canonicalize from "canonicalize";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { runPie } from "../../src/pie/cli.js";
import { nodeTestGrantSchema } from "../../src/pie/execution/contracts.js";
import { sha256 } from "../../src/pie/evidence.js";
import { createPieMcp } from "../../src/pie/mcp.js";
import { PieService } from "../../src/pie/service.js";
import { verificationRunSchema } from "../../src/pie/execution/runContracts.js";
import { runEvidence, verifyRunEvidence } from "../../src/pie/execution/runEvidence.js";
import { openStore } from "../../src/pie/store.js";

const exec = promisify(execFile);
const image = `node@sha256:${"b".repeat(64)}`;
let nextRunTime = Date.now();

async function persistRun(
  store: Awaited<ReturnType<typeof openStore>>,
  snapshot: Awaited<ReturnType<typeof store.snapshot>>,
  outcomes: Array<{ name: string; outcome: "passed" | "failed" }>,
  runImage = image,
) {
  const id = randomUUID();
  const authorization = nodeTestGrantSchema.parse({
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: snapshot.root,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    image: runImage,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testFiles: ["feature.test.mjs"],
    limits: {
      timeoutMs: 10_000,
      memoryMiB: 256,
      cpus: 1,
      pids: 32,
      workspaceMiB: 64,
      outputBytes: 65_536,
      sourceBytes: 100_000,
    },
  });
  nextRunTime = Math.max(nextRunTime + 2000, Date.parse(snapshot.createdAt) + 1000);
  const time = nextRunTime;
  const createdAt = new Date(time).toISOString();
  const completedAt = new Date(time + 1000).toISOString();
  const counts = {
    cancelled: 0,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    passed: outcomes.filter((item) => item.outcome === "passed").length,
    skipped: 0,
    suites: 0,
    tests: outcomes.length,
    todo: 0,
    topLevel: outcomes.length,
  };
  const failed = counts.failed > 0;
  const payload = {
    schemaVersion: 2 as const,
    id,
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    authorizationDigest: sha256(canonicalize(authorization)!),
    image: runImage,
    createdAt,
    completedAt,
    result: {
      schemaVersion: 1 as const,
      state: failed ? ("failed" as const) : ("passed" as const),
      counts,
      cases: outcomes.map((item) => ({
        protocolVersion: 1 as const,
        kind: "case" as const,
        name: item.name,
        file: "/source/feature.test.mjs",
        line: 1,
        nesting: 0,
        category: "test" as const,
        outcome: item.outcome,
      })),
      durationMs: 10,
      exitCode: failed ? 1 : 0,
      signal: null,
      coverage: {
        reportComplete: true,
        processCompleted: true,
        truncated: false,
        limitations: [],
      },
    },
    cleanup: "complete" as const,
    failure: null,
    authorization,
    authorizedRoot: snapshot.root,
  };
  const evidence = runEvidence(payload, snapshot, "local");
  const run = verifyRunEvidence(
    verificationRunSchema.parse({ ...payload, evidence }),
  );
  return store.saveVerification(run);
}

it("compara execuções persistidas por casos e compartilha API, CLI e MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-regression-results-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(join(repo, "service.ts"), "export const value=1;\n");
  await writeFile(
    join(repo, "feature.test.mjs"),
    "import {test} from 'node:test'; test('save',()=>{});\n",
  );
  await exec("git", ["-C", repo, "add", "."]);
  const db = join(root, "pie.sqlite");
  const store = await openStore(db, repo);
  const service = new PieService(store);
  const token = "fixture-regression-api-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repo, token });
  const mcpServer = createPieMcp(service, repo);
  const client = new Client({ name: "pie-regression-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const cliOutput = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const before = await service.discover(policy);
    const beforeSnapshot = await store.snapshot(before.snapshot.id);
    const beforeRun = await persistRun(store, beforeSnapshot, [
      { name: "save", outcome: "passed" },
      { name: "load", outcome: "passed" },
    ]);

    await writeFile(join(repo, "service.ts"), "export const value=2;\n");
    const after = await service.discover(policy);
    const afterSnapshot = await store.snapshot(after.snapshot.id);
    const afterRun = await persistRun(store, afterSnapshot, [
      { name: "save", outcome: "failed" },
      { name: "load", outcome: "passed" },
      { name: "new case", outcome: "passed" },
    ]);

    const input = {
      beforeRunId: beforeRun.id,
      afterRunId: afterRun.id,
      limit: 1,
    };
    const expected = await service.verificationComparison(input);
    expect(expected).toMatchObject({
      schemaVersion: 1,
      engine: "regression",
      state: "regression_observed",
      cases: {
        total: 2,
        items: [
          {
            file: "feature.test.mjs",
            name: "save",
            before: "passed",
            after: "failed",
            classification: "regression_observed",
          },
        ],
      },
      coverage: {
        sameImage: true,
        sameSelection: true,
        reportsComplete: true,
        regressions: 1,
        unchanged: 1,
        onlyAfter: 1,
      },
    });

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const http = await fetch(`${api.url}/v1/verification-comparison`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(http.status).toBe(200);
    expect(await http.json()).toEqual(expected);

    await runPie([
      "verification-diff",
      beforeRun.id,
      afterRun.id,
      "--limit",
      "1",
      "--db",
      db,
    ]);
    expect(JSON.parse(String(cliOutput.mock.calls.at(-1)?.[0]))).toEqual(
      expected,
    );

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.connect(serverTransport),
    ]);
    const catalog = await client.listTools();
    const tool = catalog.tools.find(
      (candidate) => candidate.name === "pie_verification_compare",
    )!;
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const outputValid = ajv.compile(tool.outputSchema as AnySchema);
    const mcp = await client.callTool({
      name: "pie_verification_compare",
      arguments: input,
    });
    expect(mcp.isError).not.toBe(true);
    expect(mcp.structuredContent).toEqual(expected);
    expect(outputValid(mcp.structuredContent), JSON.stringify(outputValid.errors)).toBe(
      true,
    );

    const stableRun = await persistRun(store, afterSnapshot, [
      { name: "save", outcome: "failed" },
      { name: "load", outcome: "passed" },
      { name: "new case", outcome: "passed" },
    ]);
    const stable = await service.verificationComparison({
      beforeRunId: afterRun.id,
      afterRunId: stableRun.id,
    });
    expect(stable).toMatchObject({
      state: "no_regression_observed",
      coverage: { regressions: 0, unchanged: 3, onlyBefore: 0, onlyAfter: 0 },
    });
  } finally {
    cliOutput.mockRestore();
    await client.close();
    await mcpServer.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("rejeita execuções cruzadas e preserva inconclusivo com imagem divergente", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-regression-limits-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(join(repo, "feature.test.mjs"), "export {};\n");
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    const { snapshot } = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const record = await store.snapshot(snapshot.id);
    const baseline = await persistRun(store, record, [
      { name: "save", outcome: "passed" },
    ]);
    const other = await persistRun(store, record, [
      { name: "save", outcome: "failed" },
    ], `node@sha256:${"c".repeat(64)}`);
    const result = await service.verificationComparison({
      beforeRunId: baseline.id,
      afterRunId: other.id,
    });
    expect(result).toMatchObject({
      state: "inconclusive",
      coverage: { sameImage: false, matchedCases: 1, regressions: 0 },
    });
    expect(result.cases.items[0]?.classification).toBe("environment_changed");
    await expect(
      service.verificationComparison({
        beforeRunId: other.id,
        afterRunId: baseline.id,
      }),
    ).rejects.toThrow("ordenadas");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
