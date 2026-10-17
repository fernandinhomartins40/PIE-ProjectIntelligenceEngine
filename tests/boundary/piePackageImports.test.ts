import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { discoverProject } from "../../src/pie/discovery.js";
import { policySchema } from "../../src/pie/contracts.js";

const exec = promisify(execFile);

it("liga imports de pacote somente a dependências declaradas e mantém Evidence de ambas as pontas", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-package-import-"));
  const repo = join(root, "repo");
  await exec("git", ["init", repo]);
  try {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ dependencies: { "@scope/client": "^1.0.0" } }),
    );
    await writeFile(
      join(repo, "page.ts"),
      "import client from '@scope/client/subpath';\nimport missing from 'not-declared';\n",
    );
    await exec("git", ["-C", repo, "add", "."]);
    const snapshot = await discoverProject(
      policySchema.parse({
        profile: "OBSERVE",
        environment: "local",
        repositoryRoot: repo,
      }),
      "e2b0c93b-e1b4-4a78-9b0f-220f26ff7ef0",
    );
    expect(snapshot.edges).toHaveLength(1);
    const [edge] = snapshot.edges;
    expect(snapshot.nodes.find((node) => node.id === edge!.from)?.path).toBe(
      "page.ts",
    );
    expect(snapshot.nodes.find((node) => node.id === edge!.to)?.path).toBe(
      "package.json",
    );
    expect(
      edge!.evidenceIds.map((id) =>
        snapshot.evidence.find((item) => item.id === id),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { path: "page.ts", line: 1, sha256: expect.any(String) },
        }),
        expect.objectContaining({
          source: { path: "package.json", line: 1, sha256: expect.any(String) },
        }),
      ]),
    );
    expect(
      snapshot.coverage.limitations.some((item) =>
        item.includes("não resolvidas"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
