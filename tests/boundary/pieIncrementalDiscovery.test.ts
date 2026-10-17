import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  cachedAnalysis,
  clearAnalysisCache,
  analysisCacheStats,
} from "../../src/pie/analysisCache.js";
import { policySchema } from "../../src/pie/contracts.js";
import { discoverProject } from "../../src/pie/discovery.js";
import { validateSnapshot } from "../../src/pie/snapshotIntegrity.js";

const exec = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  clearAnalysisCache();
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "pie-incremental-"));
  temporary.push(root);
  await exec("git", ["init", root]);
  await writeFile(join(root, "package.json"), '{"dependencies":{"alpha":"1"}}');
  await writeFile(
    join(root, "index.ts"),
    "import './old.js';\nexport const value = 1;\n",
  );
  await exec("git", ["-C", root, "add", "."]);
  return {
    root,
    policy: policySchema.parse({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    }),
  };
}

describe("PIE incremental discovery", () => {
  it("reuses content-addressed parsing while issuing fresh snapshot Evidence", async () => {
    clearAnalysisCache();
    const { root, policy } = await repository();
    const projectId = randomUUID();

    const cold = await discoverProject(policy, projectId);
    expect(analysisCacheStats()).toMatchObject({
      misses: 2,
      hits: 0,
      entries: 2,
    });
    expect(validateSnapshot(cold).id).toBe(cold.id);

    const warm = await discoverProject(policy, projectId);
    expect(analysisCacheStats()).toMatchObject({
      misses: 2,
      hits: 2,
      entries: 2,
    });
    expect(warm.id).not.toBe(cold.id);
    expect(warm.treeDigest).toBe(cold.treeDigest);
    expect(warm.evidence.map((item) => item.id)).not.toEqual(
      cold.evidence.map((item) => item.id),
    );
    expect(warm.evidence.every((item) => item.snapshotId === warm.id)).toBe(
      true,
    );
    expect(validateSnapshot(warm).id).toBe(warm.id);

    await writeFile(
      join(root, "index.ts"),
      "import './new.js';\nexport const value = 2;\n",
    );
    await exec("git", ["-C", root, "add", "index.ts"]);
    const changed = await discoverProject(policy, projectId);
    expect(analysisCacheStats()).toMatchObject({
      misses: 3,
      hits: 3,
      entries: 3,
    });
    expect(changed.treeDigest).not.toBe(cold.treeDigest);
    expect(changed.edges).toHaveLength(0);
    expect(
      changed.evidence.every((item) => item.snapshotId === changed.id),
    ).toBe(true);
    expect(validateSnapshot(changed).id).toBe(changed.id);
  });

  it("inclui os limites de análise na identidade do resultado", async () => {
    const { readCodeFacts } = await import("../../src/pie/codeFacts.js");
    clearAnalysisCache();
    const source = "import './a';\nimport './b';\n";
    expect(readCodeFacts("index.ts", source, 1, 10).references).toHaveLength(1);
    expect(readCodeFacts("index.ts", source, 2, 10).references).toHaveLength(2);
    expect(analysisCacheStats()).toMatchObject({ misses: 2, hits: 0 });
  });

  it("respeita o limite LRU de entradas e ignora resultados superdimensionados", () => {
    clearAnalysisCache();
    const { maxEntries, maxEntryBytes } = analysisCacheStats();
    for (let index = 0; index <= maxEntries; index++)
      cachedAnalysis(["lru-boundary-test", index], () => index);

    expect(analysisCacheStats()).toMatchObject({
      entries: maxEntries,
      evictions: 1,
    });
    expect(cachedAnalysis(["lru-boundary-test", 0], () => "reparsed")).toBe(
      "reparsed",
    );
    expect(
      cachedAnalysis(["oversized-boundary-test"], () =>
        "x".repeat(maxEntryBytes + 1),
      ),
    ).toHaveLength(maxEntryBytes + 1);
    expect(analysisCacheStats()).toMatchObject({
      entries: maxEntries,
      evictions: 2,
    });
  });
});
