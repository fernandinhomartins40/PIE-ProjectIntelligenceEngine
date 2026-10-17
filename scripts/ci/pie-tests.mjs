import { appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const fullPieTests = [
  "tests/boundary/pieHttpTransport.test.ts",
  "tests/boundary/pieHttpPersistence.test.ts",
  "tests/boundary/pieFunctionalPersistence.test.ts",
  "tests/boundary/pieExecutionAdmission.test.ts",
  "tests/boundary/piePostgres.test.ts",
  "tests/boundary/pieJobs.test.ts",
  "tests/boundary/pieAdapters.test.ts",
  "tests/boundary/pieTrace.test.ts",
  "tests/boundary/pieFoundation.test.ts",
  "tests/boundary/pieComparison.test.ts",
  "tests/boundary/pieRetestAdmission.test.ts",
  "tests/boundary/pieRegressionResults.test.ts",
  "tests/boundary/pieApi.test.ts",
  "tests/boundary/mcp/pieMcp.test.ts",
];

export function selectPieTests(changedPaths, eventName = "push") {
  if (eventName === "workflow_dispatch" || changedPaths.length === 0)
    return {
      mode: "full",
      tests: fullPieTests,
      reason: "manual-or-unknown-diff",
    };
  const changed = [...new Set(changedPaths)].sort();
  if (changed.every((path) => fullPieTests.includes(path)))
    return {
      mode: "focused",
      tests: changed,
      reason: "allowlisted-tests-only",
    };
  return {
    mode: "full",
    tests: fullPieTests,
    reason: "production-or-unmapped-change",
  };
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout;
}

function changedFiles(base, head) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    git(["cat-file", "-e", `${base}^{commit}`]);
    git(["cat-file", "-e", `${head}^{commit}`]);
    return git(["diff", "--name-only", "-z", `${base}...${head}`])
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  const eventName = process.env.PIE_EVENT_NAME ?? "push";
  const paths =
    eventName === "workflow_dispatch"
      ? []
      : changedFiles(process.env.PIE_BASE_SHA, process.env.PIE_HEAD_SHA);
  const selection =
    paths && paths.some((path) => !existsSync(resolve(path)))
      ? selectPieTests([], eventName)
      : selectPieTests(paths ?? [], eventName);
  console.log(
    `PIE integration: ${selection.mode} (${selection.reason}); ${selection.tests.length} test files`,
  );
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    appendFileSync(
      output,
      `mode=${selection.mode}\nreason=${selection.reason}\ntests=${JSON.stringify(selection.tests)}\n`,
    );
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/vitest/vitest.mjs"), "run", ...selection.tests],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  main();
