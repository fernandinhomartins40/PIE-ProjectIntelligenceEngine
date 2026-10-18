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
import type { Snapshot } from "../../src/pie/contracts.js";
import type { VerificationRun } from "../../src/pie/execution/runContracts.js";
import { verificationRunSchema } from "../../src/pie/execution/runContracts.js";
import {
  runEvidence,
  verifyRunEvidence,
} from "../../src/pie/execution/runEvidence.js";
import { validateVerificationRun } from "../../src/pie/execution/runIntegrity.js";
import { openStore } from "../../src/pie/store.js";
import { compareVerificationRunsResult } from "../../src/pie/regressionResults.js";

const exec = promisify(execFile);

function expectComparisonFailureTags(
  beforeRun: unknown,
  beforeSnapshot: Snapshot,
  afterRun: unknown,
  afterSnapshot: Snapshot,
  input: { beforeRunId: string; afterRunId: string; limit: number },
) {
  expect(
    compareVerificationRunsResult(
      beforeRun,
      beforeSnapshot,
      afterRun,
      afterSnapshot,
      { ...input, limit: -1 },
    ),
  ).toEqual({ ok: false, error: { kind: "invalid_input" } });
  expect(
    compareVerificationRunsResult(
      {},
      beforeSnapshot,
      afterRun,
      afterSnapshot,
      input,
    ),
  ).toEqual({
    ok: false,
    error: { kind: "invalid_run", side: "before" },
  });
  expect(
    compareVerificationRunsResult(
      beforeRun,
      beforeSnapshot,
      afterRun,
      afterSnapshot,
      { ...input, beforeRunId: input.afterRunId },
    ),
  ).toEqual({
    ok: false,
    error: { kind: "policy_denied", reason: "comparison_scope" },
  });
}
const image = `node@sha256:${"b".repeat(64)}`;
let nextRunTime = Date.now();

async function persistRun(
  store: Awaited<ReturnType<typeof openStore>>,
  snapshot: Awaited<ReturnType<typeof store.snapshot>>,
  outcomes: Array<{
    name: string;
    outcome: "passed" | "failed" | "skipped" | "todo";
  }>,
  runImage = image,
  declarationId?: string,
  runtimeLocations: Array<{ sourcePath: string; line: number }> = [],
  runtimeInstrumentation = true,
  runtimeReportComplete = true,
  testReportComplete = true,
  testCaseBinding?: { name: string; nesting: number },
) {
  const id = randomUUID();
  const authorization = nodeTestGrantSchema.parse({
    schemaVersion: declarationId === undefined ? 1 : testCaseBinding ? 3 : 2,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: snapshot.root,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    image: runImage,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testFiles: ["feature.test.mjs"],
    ...(declarationId === undefined
      ? {}
      : {
          testBindings: [
            {
              testFile: "feature.test.mjs",
              declarationId,
              ...(testCaseBinding ? { testCase: testCaseBinding } : {}),
            },
          ],
        }),
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
  nextRunTime = Math.max(
    nextRunTime + 2000,
    Date.parse(snapshot.createdAt) + 1000,
  );
  const time = nextRunTime;
  const createdAt = new Date(time).toISOString();
  const completedAt = new Date(time + 1000).toISOString();
  const counts = {
    cancelled: 0,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    passed: outcomes.filter((item) => item.outcome === "passed").length,
    skipped: outcomes.filter((item) => item.outcome === "skipped").length,
    suites: 0,
    tests: outcomes.length,
    todo: outcomes.filter((item) => item.outcome === "todo").length,
    topLevel: outcomes.length,
  };
  const failed = counts.failed > 0;
  const allPassed =
    outcomes.length > 0 &&
    counts.passed === outcomes.length &&
    testReportComplete;
  const nodeResult = {
    state: failed
      ? ("failed" as const)
      : allPassed
        ? ("passed" as const)
        : ("inconclusive" as const),
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
      reportComplete: testReportComplete,
      processCompleted: true,
      truncated: false,
      limitations: [],
    },
  };
  const result = runtimeInstrumentation
    ? {
        ...nodeResult,
        schemaVersion: 2 as const,
        runtimeLocations: {
          reportComplete: runtimeReportComplete,
          locations: runtimeLocations,
          limitations: [],
        },
      }
    : { ...nodeResult, schemaVersion: 1 as const };
  const payload = {
    schemaVersion: 2 as const,
    id,
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    authorizationDigest: sha256(canonicalize(authorization)!),
    image: runImage,
    createdAt,
    completedAt,
    result,
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

async function expectLegacyRunUninstrumented(input: {
  store: Awaited<ReturnType<typeof openStore>>;
  snapshot: Snapshot;
  service: PieService;
  instrumentedRun: VerificationRun;
  declarationId: string;
}) {
  const legacyRun = await persistRun(
    input.store,
    input.snapshot,
    [
      { name: "save", outcome: "passed" },
      { name: "load", outcome: "passed" },
    ],
    image,
    input.declarationId,
    [],
    false,
  );
  const comparison = await input.service.verificationComparison({
    beforeRunId: input.instrumentedRun.id,
    afterRunId: legacyRun.id,
  });
  expect(comparison.declaredBindings).toMatchObject({
    before: {
      bindings: {
        items: [
          {
            runtimeObservation: {
              state: "line_not_observed",
              evidenceId: input.instrumentedRun.evidence.id,
            },
            testExecution: {
              state: "failed_cases_observed",
              counts: { passed: 2, failed: 1, skipped: 0, todo: 0 },
              complete: true,
              evidenceId: input.instrumentedRun.evidence.id,
            },
          },
        ],
      },
    },
    after: {
      bindings: {
        items: [
          {
            runtimeObservation: { state: "not_instrumented", evidenceId: null },
            testExecution: {
              state: "all_reported_cases_passed",
              counts: { passed: 2, failed: 0, skipped: 0, todo: 0 },
              complete: true,
              evidenceId: legacyRun.evidence.id,
            },
          },
        ],
      },
    },
  });

  const incompleteRun = await persistRun(
    input.store,
    input.snapshot,
    [
      { name: "save", outcome: "passed" },
      { name: "load", outcome: "passed" },
    ],
    image,
    input.declarationId,
    [],
    true,
    false,
  );
  const incompleteComparison = await input.service.verificationComparison({
    beforeRunId: input.instrumentedRun.id,
    afterRunId: incompleteRun.id,
  });
  expect(
    incompleteComparison.declaredBindings.after.bindings.items,
  ).toMatchObject([
    {
      runtimeObservation: {
        state: "unknown",
        evidenceId: incompleteRun.evidence.id,
      },
      testExecution: {
        state: "all_reported_cases_passed",
        counts: { passed: 2, failed: 0, skipped: 0, todo: 0 },
        complete: true,
        evidenceId: incompleteRun.evidence.id,
      },
    },
  ]);
}

async function expectBindingIntegrityAndLegacyObservations(input: {
  store: Awaited<ReturnType<typeof openStore>>;
  snapshot: Snapshot;
  service: PieService;
  run: VerificationRun;
  declarationId: string;
}) {
  expectInvalidStoredBinding(input.run, input.snapshot);
  await expectLegacyRunUninstrumented({
    store: input.store,
    snapshot: input.snapshot,
    service: input.service,
    instrumentedRun: input.run,
    declarationId: input.declarationId,
  });
}

async function expectStableComparison(input: {
  store: Awaited<ReturnType<typeof openStore>>;
  snapshot: Snapshot;
  service: PieService;
  baselineRun: VerificationRun;
}) {
  const stableRun = await persistRun(input.store, input.snapshot, [
    { name: "save", outcome: "failed" },
    { name: "load", outcome: "passed" },
    { name: "new case", outcome: "passed" },
  ]);
  const stable = await input.service.verificationComparison({
    beforeRunId: input.baselineRun.id,
    afterRunId: stableRun.id,
  });
  expect(stable).toMatchObject({
    state: "no_regression_observed",
    coverage: { regressions: 0, unchanged: 3, onlyBefore: 0, onlyAfter: 0 },
    declaredBindings: {
      before: { state: "declared_unverified" },
      after: { state: "unknown" },
    },
  });
}

async function expectBoundTestExecutionStates(input: {
  store: Awaited<ReturnType<typeof openStore>>;
  snapshot: Snapshot;
  service: PieService;
  declarationId: string;
  baselineRunId: string;
}) {
  const skippedRun = await persistRun(
    input.store,
    input.snapshot,
    [
      { name: "skipped case", outcome: "skipped" },
      { name: "todo case", outcome: "todo" },
    ],
    image,
    input.declarationId,
  );
  const skippedComparison = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: skippedRun.id,
  });
  expect(skippedComparison.declaredBindings.after.bindings.items).toMatchObject(
    [
      {
        testExecution: {
          state: "skipped_or_todo_observed",
          counts: { passed: 0, failed: 0, skipped: 1, todo: 1 },
          complete: true,
          evidenceId: skippedRun.evidence.id,
        },
      },
    ],
  );

  const emptyRun = await persistRun(
    input.store,
    input.snapshot,
    [],
    image,
    input.declarationId,
  );
  const emptyComparison = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: emptyRun.id,
  });
  expect(emptyComparison.declaredBindings.after.bindings.items).toMatchObject([
    {
      testExecution: {
        state: "no_cases_reported",
        counts: { passed: 0, failed: 0, skipped: 0, todo: 0 },
        complete: true,
        evidenceId: emptyRun.evidence.id,
      },
    },
  ]);

  const partialRun = await persistRun(
    input.store,
    input.snapshot,
    [{ name: "partial case", outcome: "passed" }],
    image,
    input.declarationId,
    [],
    true,
    true,
    false,
  );
  const partialComparison = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: partialRun.id,
  });
  expect(partialComparison.declaredBindings.after.bindings.items).toMatchObject(
    [
      {
        testExecution: {
          state: "partial",
          counts: { passed: 1, failed: 0, skipped: 0, todo: 0 },
          complete: false,
          evidenceId: partialRun.evidence.id,
        },
      },
    ],
  );
}

async function expectBoundTestCaseStates(input: {
  store: Awaited<ReturnType<typeof openStore>>;
  snapshot: Snapshot;
  service: PieService;
  declarationId: string;
  baselineRunId: string;
}) {
  const selected = { name: "selected case", nesting: 0 };
  const observedRun = await persistRun(
    input.store,
    input.snapshot,
    [
      { name: selected.name, outcome: "failed" },
      { name: "other case", outcome: "passed" },
    ],
    image,
    input.declarationId,
    [],
    true,
    true,
    true,
    selected,
  );
  const observed = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: observedRun.id,
  });
  expect(observed.declaredBindings.after.bindings.items).toMatchObject([
    {
      testCase: selected,
      caseExecution: {
        state: "observed",
        outcome: "failed",
        matches: 1,
        complete: true,
        evidenceId: observedRun.evidence.id,
      },
      interpretation: "declared_unverified",
    },
  ]);

  const absentRun = await persistRun(
    input.store,
    input.snapshot,
    [{ name: "different case", outcome: "passed" }],
    image,
    input.declarationId,
    [],
    true,
    true,
    true,
    selected,
  );
  const absent = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: absentRun.id,
  });
  expect(
    absent.declaredBindings.after.bindings.items[0]?.caseExecution,
  ).toEqual({
    state: "not_reported",
    testCase: selected,
    outcome: null,
    matches: 0,
    complete: true,
    evidenceId: absentRun.evidence.id,
  });

  const partialRun = await persistRun(
    input.store,
    input.snapshot,
    [{ name: "different case", outcome: "passed" }],
    image,
    input.declarationId,
    [],
    true,
    true,
    false,
    selected,
  );
  const partial = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: partialRun.id,
  });
  expect(
    partial.declaredBindings.after.bindings.items[0]?.caseExecution,
  ).toMatchObject({
    state: "unknown",
    outcome: null,
    matches: 0,
    complete: false,
    evidenceId: partialRun.evidence.id,
  });

  const duplicateRun = await persistRun(
    input.store,
    input.snapshot,
    [
      { name: selected.name, outcome: "passed" },
      { name: selected.name, outcome: "failed" },
    ],
    image,
    input.declarationId,
    [],
    true,
    true,
    true,
    selected,
  );
  const ambiguous = await input.service.verificationComparison({
    beforeRunId: input.baselineRunId,
    afterRunId: duplicateRun.id,
  });
  expect(
    ambiguous.declaredBindings.after.bindings.items[0]?.caseExecution,
  ).toMatchObject({
    state: "ambiguous",
    outcome: null,
    matches: 2,
    complete: true,
    evidenceId: duplicateRun.evidence.id,
  });
}

async function assertProjectHistoryAdapters(input: {
  apiUrl: string;
  client: Client;
  db: string;
  projectId: string;
  service: PieService;
  runCli: (args: string[]) => Promise<unknown>;
  token: string;
  latestRunId: string;
  latestSnapshotId: string;
  ajv: Ajv2020;
}) {
  const history = await input.service.projectVerifications(input.projectId, {
    limit: 1,
    offset: 1,
  });
  expect(history).toMatchObject({
    total: 2,
    offset: 1,
    items: [{ id: input.latestRunId, snapshotId: input.latestSnapshotId }],
  });
  const headers = { Authorization: `Bearer ${input.token}` };
  const response = await fetch(
    `${input.apiUrl}/v1/projects/${input.projectId}/verifications?limit=1&offset=1`,
    { headers },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(history);
  const cli = await input.runCli([
    "project-verifications",
    input.projectId,
    "--limit",
    "1",
    "--offset",
    "1",
    "--db",
    input.db,
  ]);
  expect(cli).toEqual(history);
  const catalog = await input.client.listTools();
  const tool = catalog.tools.find(
    (candidate) => candidate.name === "pie_project_verifications_list",
  )!;
  const validate = input.ajv.compile(tool.outputSchema as AnySchema);
  const mcp = await input.client.callTool({
    name: "pie_project_verifications_list",
    arguments: { projectId: input.projectId, limit: 1, offset: 1 },
  });
  expect(mcp.structuredContent).toEqual(history);
  expect(validate(mcp.structuredContent)).toBe(true);
}

async function assertComparisonAdapters(input: {
  apiUrl: string;
  beforeRunId: string;
  afterRunId: string;
  client: Client;
  db: string;
  expected: Awaited<ReturnType<PieService["verificationComparison"]>>;
  output: ReturnType<typeof vi.spyOn>;
  token: string;
  ajv: Ajv2020;
}) {
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json",
  };
  const request = {
    beforeRunId: input.beforeRunId,
    afterRunId: input.afterRunId,
    limit: 1,
  };
  const http = await fetch(`${input.apiUrl}/v1/verification-comparison`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  expect(http.status).toBe(200);
  expect(await http.json()).toEqual(input.expected);
  await runPie([
    "verification-diff",
    input.beforeRunId,
    input.afterRunId,
    "--limit",
    "1",
    "--db",
    input.db,
  ]);
  expect(JSON.parse(String(input.output.mock.calls.at(-1)?.[0]))).toEqual(
    input.expected,
  );
  const catalog = await input.client.listTools();
  const tool = catalog.tools.find(
    (candidate) => candidate.name === "pie_verification_compare",
  )!;
  const validate = input.ajv.compile(tool.outputSchema as AnySchema);
  const mcp = await input.client.callTool({
    name: "pie_verification_compare",
    arguments: request,
  });
  expect(mcp.isError).not.toBe(true);
  expect(mcp.structuredContent).toEqual(input.expected);
  expect(validate(mcp.structuredContent), JSON.stringify(validate.errors)).toBe(
    true,
  );
}

function expectDeclaredBindings(
  result: Awaited<ReturnType<PieService["verificationComparison"]>>,
  beforeId: string,
  afterId: string,
) {
  expect(result.declaredBindings).toMatchObject({
    before: {
      state: "declared_unverified",
      bindings: {
        total: 1,
        items: [
          {
            testFile: "feature.test.mjs",
            declarationId: beforeId,
            declaration: { name: "verify-feature" },
            interpretation: "declared_unverified",
            runtimeObservation: {
              state: "line_observed",
              evidenceId: expect.any(String),
            },
            testExecution: {
              state: "all_reported_cases_passed",
              counts: { passed: 2, failed: 0, skipped: 0, todo: 0 },
              complete: true,
              evidenceId: expect.any(String),
            },
          },
        ],
      },
    },
    after: {
      state: "declared_unverified",
      bindings: {
        total: 1,
        items: [
          {
            testFile: "feature.test.mjs",
            declarationId: afterId,
            declaration: { name: "check-feature" },
            interpretation: "declared_unverified",
            runtimeObservation: {
              state: "line_not_observed",
              evidenceId: expect.any(String),
            },
            testExecution: {
              state: "failed_cases_observed",
              counts: { passed: 2, failed: 1, skipped: 0, todo: 0 },
              complete: true,
              evidenceId: expect.any(String),
            },
          },
        ],
      },
    },
  });
}

function expectInvalidStoredBinding(run: VerificationRun, snapshot: Snapshot) {
  if (run.schemaVersion !== 2 || run.authorization.schemaVersion !== 2)
    throw new Error("v2 run fixture required");
  const { evidence: _proof, ...payload } = run;
  const authorization = {
    ...run.authorization,
    testBindings: [{ testFile: "feature.test.mjs", declarationId: "missing" }],
  };
  const forgedPayload = {
    ...payload,
    authorization,
    authorizationDigest: sha256(canonicalize(authorization)!),
  };
  const forgedRun = verifyRunEvidence(
    verificationRunSchema.parse({
      ...forgedPayload,
      evidence: runEvidence(forgedPayload, snapshot, "local"),
    }),
  );
  expect(() => validateVerificationRun(forgedRun, snapshot)).toThrow(
    "Bindings VERIFY",
  );
}

function forgeRuntimeLocations(
  run: VerificationRun,
  snapshot: Snapshot,
  locations: Array<{ sourcePath: string; line: number }>,
  addTestFile = false,
) {
  if (run.schemaVersion !== 2 || run.result.schemaVersion !== 2)
    throw new Error("Versioned runtime result fixture required");
  const { evidence: _proof, ...payload } = run;
  const authorization = addTestFile
    ? nodeTestGrantSchema.parse({
        ...run.authorization,
        testFiles: [...run.authorization.testFiles, "second.test.mjs"],
      })
    : run.authorization;
  const forgedPayload = {
    ...payload,
    authorization,
    authorizationDigest: sha256(canonicalize(authorization)!),
    result: {
      ...run.result,
      runtimeLocations: { ...run.result.runtimeLocations, locations },
    },
  };
  return verifyRunEvidence(
    verificationRunSchema.parse({
      ...forgedPayload,
      evidence: runEvidence(forgedPayload, snapshot, "local"),
    }),
  );
}

function expectRuntimeLocationsBound(
  run: VerificationRun,
  snapshot: Snapshot,
  sourcePath: string,
  line: number,
) {
  for (const locations of [
    [{ sourcePath: "outside.ts", line }],
    [{ sourcePath, line: line + 1 }],
    [
      { sourcePath, line },
      { sourcePath, line },
    ],
  ])
    expect(() =>
      validateVerificationRun(
        forgeRuntimeLocations(run, snapshot, locations),
        snapshot,
      ),
    ).toThrow("Locais de runtime");
  expect(() =>
    validateVerificationRun(
      forgeRuntimeLocations(run, snapshot, [{ sourcePath, line }], true),
      snapshot,
    ),
  ).toThrow("Locais de runtime");
}

async function persistBoundRuntimeRun(
  store: Awaited<ReturnType<typeof openStore>>,
  snapshot: Awaited<ReturnType<typeof store.snapshot>>,
  declaration: Snapshot["declarations"][number],
) {
  const locations =
    declaration.source.line === null
      ? []
      : [
          {
            sourcePath: declaration.source.path,
            line: declaration.source.line,
          },
        ];
  const run = await persistRun(
    store,
    snapshot,
    [
      { name: "save", outcome: "passed" },
      { name: "load", outcome: "passed" },
    ],
    image,
    declaration.id,
    locations,
  );
  if (declaration.source.line !== null)
    expectRuntimeLocationsBound(
      run,
      snapshot,
      declaration.source.path,
      declaration.source.line,
    );
  return run;
}

async function assertAllComparisonAdapters(input: {
  apiUrl: string;
  beforeRunId: string;
  afterRunId: string;
  client: Client;
  mcpServer: ReturnType<typeof createPieMcp>;
  db: string;
  expected: Awaited<ReturnType<PieService["verificationComparison"]>>;
  output: ReturnType<typeof vi.spyOn>;
  token: string;
  projectId: string;
  service: PieService;
  latestRunId: string;
  latestSnapshotId: string;
}) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    input.client.connect(clientTransport),
    input.mcpServer.connect(serverTransport),
  ]);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  await assertComparisonAdapters({ ...input, ajv });
  await assertProjectHistoryAdapters({
    ...input,
    ajv,
    runCli: async (args) => {
      await runPie(args);
      return JSON.parse(String(input.output.mock.calls.at(-1)?.[0]));
    },
  });
}

it("compara execuções persistidas por casos e compartilha API, CLI e MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-regression-results-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(join(repo, "service.ts"), "export const value=1;\n");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { "verify-feature": "node --test" } }),
  );
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
  const cliOutput = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const before = await service.discover(policy);
    const beforeSnapshot = await store.snapshot(before.snapshot.id);
    const beforeDeclaration = beforeSnapshot.declarations.find(
      (item) => item.kind === "script" && item.name === "verify-feature",
    )!;
    const beforeRun = await persistBoundRuntimeRun(
      store,
      beforeSnapshot,
      beforeDeclaration,
    );

    await writeFile(join(repo, "service.ts"), "export const value=2;\n");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { "check-feature": "node --test" } }),
    );
    const after = await service.discover(policy);
    const afterSnapshot = await store.snapshot(after.snapshot.id);
    const afterDeclaration = afterSnapshot.declarations.find(
      (item) => item.kind === "script" && item.name === "check-feature",
    )!;
    const afterRun = await persistRun(
      store,
      afterSnapshot,
      [
        { name: "save", outcome: "failed" },
        { name: "load", outcome: "passed" },
        { name: "new case", outcome: "passed" },
      ],
      image,
      afterDeclaration.id,
    );

    const input = {
      beforeRunId: beforeRun.id,
      afterRunId: afterRun.id,
      limit: 1,
    };
    expectComparisonFailureTags(
      beforeRun,
      beforeSnapshot,
      afterRun,
      afterSnapshot,
      input,
    );
    const expected = await service.verificationComparison(input);
    expect(expected).toMatchObject({
      schemaVersion: 5,
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
    expectDeclaredBindings(expected, beforeDeclaration.id, afterDeclaration.id);

    await assertAllComparisonAdapters({
      apiUrl: api.url,
      beforeRunId: beforeRun.id,
      afterRunId: afterRun.id,
      client,
      mcpServer,
      db,
      expected,
      output: cliOutput,
      token,
      projectId: before.project.id,
      service,
      latestRunId: afterRun.id,
      latestSnapshotId: after.snapshot.id,
    });
    await expectBoundTestExecutionStates({
      store,
      snapshot: afterSnapshot,
      service,
      declarationId: afterDeclaration.id,
      baselineRunId: afterRun.id,
    });
    await expectBoundTestCaseStates({
      store,
      snapshot: afterSnapshot,
      service,
      declarationId: afterDeclaration.id,
      baselineRunId: afterRun.id,
    });

    await expectBindingIntegrityAndLegacyObservations({
      store,
      snapshot: afterSnapshot,
      service,
      run: afterRun,
      declarationId: afterDeclaration.id,
    });

    await expectStableComparison({
      store,
      snapshot: afterSnapshot,
      service,
      baselineRun: afterRun,
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
    const other = await persistRun(
      store,
      record,
      [{ name: "save", outcome: "failed" }],
      `node@sha256:${"c".repeat(64)}`,
    );
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
