import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { NODE_REPORTER_SOURCE } from "../../src/pie/execution/nodeReporter.js";
import {
  normalizeNodeResult,
  nodeResultSchema,
  parseNodeReport,
} from "../../src/pie/execution/nodeResults.js";

const limits = { bytes: 1_000_000, records: 10_000 };
const completed = {
  started: true,
  completed: true,
  exitCode: 0,
  signal: null,
  truncated: false,
};

async function runFixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), "pie-node-results-"));
  try {
    const reporter = join(root, "reporter.mjs");
    const test = join(root, "case.test.mjs");
    await writeFile(reporter, NODE_REPORTER_SOURCE);
    await writeFile(
      test,
      `import { test, describe } from 'node:test';\n${body}`,
    );
    return await new Promise<{ stdout: Buffer; exitCode: number }>(
      (accept, reject) => {
        execFile(
          process.execPath,
          ["--test", `--test-reporter=${pathToFileURL(reporter).href}`, test],
          {
            encoding: "buffer",
            timeout: 10_000,
            maxBuffer: limits.bytes,
            windowsHide: true,
            env: {
              PATH: process.env.PATH,
              ...(process.env.SystemRoot
                ? { SystemRoot: process.env.SystemRoot }
                : {}),
            },
          },
          (error, stdout) => {
            if (error && typeof error.code !== "number") reject(error);
            else
              accept({
                stdout,
                exitCode: typeof error?.code === "number" ? error.code : 0,
              });
          },
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("normaliza eventos reais Node: aprovação, falha, skip, TODO e mistura", async () => {
  for (const [body, state] of [
    ["describe('suite', () => { test('works', () => {}); });", "passed"],
    ["test('fails', () => { throw new Error('fixture failure'); });", "failed"],
    ["test.skip('ignored', () => {});", "skipped"],
    ["test.todo('pending');", "skipped"],
    ["test('ignored', { skip: '' }, () => {});", "skipped"],
    [
      "test('works', () => {}); test.skip('ignored', () => {});",
      "inconclusive",
    ],
  ] as const) {
    const output = await runFixture(body);
    const result = normalizeNodeResult(
      output.stdout,
      { ...completed, exitCode: output.exitCode },
      limits,
    );
    expect(result.state).toBe(state);
    expect(result.coverage.reportComplete).toBe(true);
    expect(result.cases.length).toBeGreaterThan(0);
  }
}, 20_000);

it("mantém resultados parciais sem transformar truncamento ou saída zero em aprovação", async () => {
  const output = await runFixture("test('works', () => {});");
  for (const capture of [
    { ...completed, truncated: true },
    { ...completed, completed: false },
    { ...completed, signal: "SIGTERM" },
    { ...completed, exitCode: null },
  ])
    expect(normalizeNodeResult(output.stdout, capture, limits).state).toBe(
      "inconclusive",
    );
  expect(
    normalizeNodeResult(output.stdout, { ...completed, started: false }, limits)
      .state,
  ).toBe("blocked");
  expect(normalizeNodeResult(Buffer.alloc(0), completed, limits).state).toBe(
    "inconclusive",
  );
  const lines = output.stdout.toString("utf8").trimEnd().split("\n");
  const contradictoryCase = { ...JSON.parse(lines[0]!), outcome: "failed" };
  expect(
    parseNodeReport(
      Buffer.from(`${JSON.stringify(contradictoryCase)}\n${lines.at(-1)}\n`),
      limits,
    ).ok,
  ).toBe(false);
  const passed = normalizeNodeResult(output.stdout, completed, limits);
  expect(
    nodeResultSchema.safeParse({
      ...passed,
      coverage: { ...passed.coverage, reportComplete: false },
    }).success,
  ).toBe(false);
  expect(nodeResultSchema.safeParse({ ...passed, cases: [] }).success).toBe(
    false,
  );
  const summary = JSON.parse(lines.at(-1)!) as {
    counts: { tests: number; passed: number };
  };
  summary.counts.tests++;
  summary.counts.passed++;
  expect(
    parseNodeReport(
      Buffer.from(`${lines[0]}\n${JSON.stringify(summary)}\n`),
      limits,
    ).ok,
  ).toBe(false);
  const partial = parseNodeReport(Buffer.from(`${lines[0]}\n`), limits);
  expect(partial).toMatchObject({
    ok: false,
    error: { partial: { cases: [{ outcome: "passed" }], summary: null } },
  });
  for (const bytes of [
    Buffer.from("not json\n"),
    Buffer.from([255, 10]),
    output.stdout.subarray(0, -1),
    Buffer.concat([output.stdout, output.stdout]),
  ])
    expect(parseNodeReport(bytes, limits).ok).toBe(false);
  expect(parseNodeReport(output.stdout, { ...limits, bytes: 1 }).ok).toBe(
    false,
  );
  expect(parseNodeReport(output.stdout, { ...limits, records: 1 }).ok).toBe(
    false,
  );
});

it("não aprova arquivo vazio nem falha de processo sem testes", async () => {
  for (const [body, state] of [
    ["", "inconclusive"],
    ["throw new Error('fixture startup failure');", "failed"],
  ] as const) {
    const output = await runFixture(body);
    expect(
      normalizeNodeResult(
        output.stdout,
        { ...completed, exitCode: output.exitCode },
        limits,
      ).state,
    ).toBe(state);
  }
});
