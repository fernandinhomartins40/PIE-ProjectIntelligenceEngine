import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { compareSnapshots } from "../../src/pie/compare.js";
import { renderSnapshot } from "../../src/pie/reports.js";

const exec = promisify(execFile);

it("compara versões reais, preserva arestas removidas e não confirma exclusão em leitura parcial", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-comparison-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  const store = await openStore(join(root, "history.sqlite"), repo);
  try {
    await exec("git", ["init", repo]);
    await writeFile(
      join(repo, "page.ts"),
      "import { value } from './service.js'; export { value };",
    );
    await writeFile(join(repo, "service.ts"), "export const value = 1;");
    await exec("git", ["-C", repo, "add", "."]);
    const service = new PieService(store);
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const first = await service.discover(policy);
    await writeFile(join(repo, "page.ts"), "export const page = true;");
    await writeFile(join(repo, "service.ts"), "export const value = 2;");
    const second = await service.discover(policy);
    const comparison = service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
      limit: 1,
    });
    expect(comparison.status).toBe("changed");
    expect(comparison.counts.modified).toBe(2);
    expect(comparison.changes.nextOffset).toBe(1);
    expect(comparison.runtimeVerified).toBe(false);
    const all = service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
    });
    expect(all.impact.items.map((item) => item.path)).toContain("page.ts");
    expect(
      all.impact.items.find((item) => item.path === "page.ts")?.versions,
    ).toContain("before");
    const partial = await service.discover({ ...policy, maxFiles: 1 });
    const incomplete = service.compare({
      beforeId: second.snapshot.id,
      afterId: partial.snapshot.id,
    });
    expect(incomplete.counts.removed).toBe(0);
    expect(incomplete.counts.unknown).toBe(1);
    expect(incomplete.status).toBe("inconclusive");
    const snapshot = store.snapshot(second.snapshot.id);
    expect(() =>
      compareSnapshots(snapshot, { ...snapshot, projectId: randomUUID() }),
    ).toThrow("mesmo projeto");
    expect(
      service.compare({
        beforeId: second.snapshot.id,
        afterId: second.snapshot.id,
      }).status,
    ).toBe("unchanged");
    await exec("git", ["-C", repo, "add", "service.ts"]);
    await exec("git", ["-C", repo, "rm", "--cached", "service.ts"]);
    await writeFile(join(repo, "new.ts"), "export const added = true;");
    await exec("git", ["-C", repo, "add", "new.ts"]);
    const third = await service.discover(policy);
    const addedRemoved = service.compare({
      beforeId: second.snapshot.id,
      afterId: third.snapshot.id,
    });
    expect(addedRemoved.counts.added).toBe(1);
    expect(addedRemoved.counts.removed).toBe(1);
    const exported = {
      ...snapshot,
      coverage: {
        ...snapshot.coverage,
        limitations: [
          "<script>alert('fixture')</script>",
          "[link](javascript:fixture)",
        ],
      },
    };
    const html = renderSnapshot(exported, "html");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(renderSnapshot(exported, "md")).toContain("\\[link\\]");
    expect(JSON.parse(renderSnapshot(snapshot, "json"))).toEqual(snapshot);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
