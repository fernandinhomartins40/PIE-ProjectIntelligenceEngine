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
import { planRetestsResult } from "../../src/pie/retestPlan.js";

const exec = promisify(execFile);

it("planeja retestes pelo impacto dos dois grafos sem conceder execução ou inventar cobertura", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-retest-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(join(repo, "service.ts"), "export const value=1;");
  await writeFile(
    join(repo, "linked.test.ts"),
    "import {value} from './service'; export {value};",
  );
  await writeFile(
    join(repo, "other.test.ts"),
    "throw new Error('não executar');",
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "history.sqlite"), repo);
  const service = new PieService(store);
  try {
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const before = await service.discover(policy);
    await writeFile(join(repo, "service.ts"), "export const value=2;");
    const after = await service.discover(policy);
    const beforeSnapshot = await store.snapshot(before.snapshot.id);
    const afterSnapshot = await store.snapshot(after.snapshot.id);
    const request = {
      beforeId: before.snapshot.id,
      afterId: after.snapshot.id,
    };
    expect(
      planRetestsResult(beforeSnapshot, afterSnapshot, {
        ...request,
        mode: "automatic",
      }),
    ).toEqual({ ok: false, error: { kind: "invalid_input" } });
    expect(planRetestsResult({}, afterSnapshot, request)).toEqual({
      ok: false,
      error: { kind: "invalid_snapshot", side: "before" },
    });
    expect(
      planRetestsResult(beforeSnapshot, afterSnapshot, {
        ...request,
        beforeId: after.snapshot.id,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "policy_denied", reason: "snapshot_mismatch" },
    });
    const affected = await service.retestPlan(request);
    expect(affected).toMatchObject({
      state: "unverified",
      executionAuthorized: false,
      runtimeVerified: false,
      candidates: {
        total: 1,
        items: [
          {
            path: "linked.test.ts",
            reason: "recorded_dependency_impact",
            runnerCompatibility: "not_probed",
          },
        ],
      },
      coverage: { observedCurrentTests: 2, selectedTests: 1 },
    });
    const proof = await service.evidence(
      affected.candidates.items[0]!.evidenceIds[0]!,
    );
    expect(proof.snapshotId).toBe(after.snapshot.id);
    const full = await service.retestPlan({
      ...request,
      mode: "full",
      limit: 1,
    });
    expect(full.candidates).toMatchObject({ total: 2, nextOffset: 1 });
    expect(
      (await service.retestPlan({ ...request, mode: "full", offset: 1 }))
        .candidates.items[0]!.path,
    ).toBe("other.test.ts");
    expect(
      (
        await service.retestPlan({
          beforeId: after.snapshot.id,
          afterId: after.snapshot.id,
        })
      ).candidates.total,
    ).toBe(0);
    await exec("git", ["-C", repo, "add", "service.ts"]);
    await exec("git", ["-C", repo, "rm", "--cached", "service.ts"]);
    const removed = await service.discover(policy);
    expect(
      (
        await service.retestPlan({
          beforeId: after.snapshot.id,
          afterId: removed.snapshot.id,
        })
      ).candidates.items.map((item) => item.path),
    ).toEqual(["linked.test.ts"]);
    await expect(
      service.retestPlan({ ...request, mode: "automatic" }),
    ).rejects.toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("regressão compara declarações com provas dos dois snapshots sem afirmar endpoint removido", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-declaration-diff-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, "app", "api"), { recursive: true });
  await exec("git", ["init", repo]);
  const file = join(repo, "app", "api", "route.ts");
  await writeFile(file, "export function GET(){}\nexport function POST(){}");
  const repeated =
    "const express=require('express');const app=express();\napp.get('/same',a);\napp.get('/same',b);";
  await writeFile(join(repo, "api.ts"), repeated);
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "history.sqlite"), repo);
  const service = new PieService(store);
  try {
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const first = await service.discover(policy);
    await writeFile(
      file,
      "// shifted\nexport function GET(){throw new Error('não executar')}\nexport function PUT(){}",
    );
    await writeFile(join(repo, "api.ts"), `// shifted\n${repeated}`);
    const second = await service.discover(policy);
    const result = await service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
      limit: 1,
    });
    expect(result.declarationChanges).toMatchObject({
      total: 4,
      nextOffset: 1,
      items: [expect.any(Object)],
    });
    expect(result.status).toBe("changed");
    const all = await service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
    });
    const changes = all.declarationChanges.items;
    expect(
      changes.find((item) => item.before[0]?.name === "GET /same"),
    ).toMatchObject({
      state: "ambiguous",
      before: [expect.any(Object), expect.any(Object)],
      after: [expect.any(Object), expect.any(Object)],
    });
    expect(
      changes.find((item) => item.before[0]?.name === "GET /api"),
    ).toMatchObject({
      state: "source_changed",
      before: [{ source: { line: 1 } }],
      after: [{ source: { line: 2 } }],
    });
    expect(
      changes.find((item) => item.before[0]?.name === "POST /api"),
    ).toMatchObject({
      state: "observed_only_before",
      interpretation: "observed_change",
      after: [],
    });
    expect(
      changes.find((item) => item.after[0]?.name === "PUT /api"),
    ).toMatchObject({
      state: "observed_only_after",
      interpretation: "observed_change",
      before: [],
    });
    expect(changes.find((item) => item.state === "ambiguous")).toMatchObject({
      interpretation: "ambiguous",
    });
    expect(
      changes.find((item) => item.state === "source_changed"),
    ).toMatchObject({ interpretation: "observed_change" });
    for (const item of changes)
      for (const fact of [...item.before, ...item.after])
        expect((await service.evidence(fact.evidenceId)).source).toEqual(
          fact.source,
        );
    const partial = await service.discover({ ...policy, maxFileBytes: 1 });
    const incomplete = await service.compare({
      beforeId: second.snapshot.id,
      afterId: partial.snapshot.id,
    });
    expect(
      incomplete.declarationChanges.items.every(
        (item) =>
          item.state === "observed_only_before" &&
          item.interpretation === "unknown_after",
      ),
    ).toBe(true);
    expect(incomplete.status).toBe("inconclusive");
    expect(incomplete.runtimeVerified).toBe(false);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
    await writeFile(join(repo, "service.ts"), "export const value = 2;");
    const second = await service.discover(policy);
    const beforeSnapshot = await store.snapshot(first.snapshot.id);
    const afterSnapshot = await store.snapshot(second.snapshot.id);
    const comparison = await service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
      limit: 1,
    });
    expect(comparison.status).toBe("changed");
    expect(comparison.counts.modified).toBe(1);
    expect(comparison.changes.nextOffset).toBeNull();
    expect(comparison.runtimeVerified).toBe(false);
    const all = await service.compare({
      beforeId: first.snapshot.id,
      afterId: second.snapshot.id,
    });
    expect(all).toMatchObject({ schemaVersion: 2 });
    const changedFile = all.impact.items.find(
      (item) => item.path === "service.ts" && item.changed,
    );
    expect(changedFile?.evidenceIds).toHaveLength(2);
    expect(changedFile?.relationEvidenceIds).toEqual([]);
    const dependent = all.impact.items.find((item) => item.path === "page.ts");
    expect(dependent).toMatchObject({
      changed: false,
      versions: ["before", "after"],
    });
    expect(dependent?.evidenceIds.length).toBeGreaterThan(0);
    expect(dependent?.relationEvidenceIds.length).toBeGreaterThan(0);
    const pageImport = beforeSnapshot.edges.find(
      (edge) =>
        edge.kind === "depends" &&
        beforeSnapshot.nodes.find((node) => node.id === edge.from)?.path ===
          "page.ts" &&
        beforeSnapshot.nodes.find((node) => node.id === edge.to)?.path ===
          "service.ts",
    );
    expect(pageImport).toBeDefined();
    expect(
      pageImport?.evidenceIds.every((id) =>
        dependent?.relationEvidenceIds.includes(id),
      ),
    ).toBe(true);
    expect(
      [
        ...(dependent?.relationEvidenceIds ?? []),
        ...(changedFile?.evidenceIds ?? []),
      ].every((id) =>
        [
          ...beforeSnapshot.evidence.map((item) => item.id),
          ...afterSnapshot.evidence.map((item) => item.id),
        ].includes(id),
      ),
    ).toBe(true);
    const partial = await service.discover({ ...policy, maxFiles: 1 });
    const incomplete = await service.compare({
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
      (
        await service.compare({
          beforeId: second.snapshot.id,
          afterId: second.snapshot.id,
        })
      ).status,
    ).toBe("unchanged");
    await exec("git", ["-C", repo, "add", "service.ts"]);
    await exec("git", ["-C", repo, "rm", "--cached", "service.ts"]);
    await writeFile(join(repo, "new.ts"), "export const added = true;");
    await exec("git", ["-C", repo, "add", "new.ts"]);
    const third = await service.discover(policy);
    const addedRemoved = await service.compare({
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
