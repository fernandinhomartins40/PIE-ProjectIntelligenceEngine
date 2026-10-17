import { expect, it } from "vitest";
import { fullPieTests, selectPieTests } from "../../scripts/ci/pie-tests.mjs";

it("reduces the PIE lane only for allowlisted test-only changes", () => {
  expect(
    selectPieTests([
      "tests/boundary/pieApi.test.ts",
      "tests/boundary/mcp/pieMcp.test.ts",
    ]),
  ).toMatchObject({
    mode: "focused",
    tests: [
      "tests/boundary/mcp/pieMcp.test.ts",
      "tests/boundary/pieApi.test.ts",
    ],
  });
});

it("keeps the complete PIE suite for source, unknown, empty, or manual changes", () => {
  for (const paths of [
    ["src/pie/service.ts", "tests/boundary/pieApi.test.ts"],
    ["tests/boundary/pieNewEngine.test.ts"],
    [],
  ])
    expect(selectPieTests(paths)).toMatchObject({
      mode: "full",
      tests: fullPieTests,
    });
  expect(
    selectPieTests(["tests/boundary/pieApi.test.ts"], "workflow_dispatch"),
  ).toMatchObject({ mode: "full", tests: fullPieTests });
});
