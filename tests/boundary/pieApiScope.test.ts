import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";

it("API local limita leituras históricas à raiz configurada", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pie-api-scope-"));
  const rootA = join(parent, "repo-a");
  const rootB = join(parent, "repo-b");
  await Promise.all([mkdir(rootA), mkdir(rootB)]);
  const git = promisify(execFile);
  for (const root of [rootA, rootB]) {
    await git("git", ["init", root]);
    await writeFile(join(root, "index.ts"), `export const root = "${root}";`);
    await git("git", ["-C", root, "add", "."]);
  }

  const store = await openStore(join(parent, "state.sqlite"), rootA);
  const service = new PieService(store);
  const token = "fixture-api-scope-token-32-characters-minimum";
  const api = await startPieApi(service, { root: rootA, token });
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const own = await service.discover({
      repositoryRoot: rootA,
      profile: "OBSERVE",
      environment: "local",
    });
    const foreign = await service.discover({
      repositoryRoot: rootB,
      profile: "OBSERVE",
      environment: "local",
    });
    const foreignSnapshotId = foreign.snapshot.id;
    const foreignEvidenceId = (await service.store.snapshot(foreignSnapshotId))
      .evidence[0]!.id;
    const endpoints = [
      `/v1/graph/${foreignSnapshotId}`,
      `/v1/declarations/${foreignSnapshotId}`,
      `/v1/evidence/${foreignEvidenceId}`,
      `/v1/history/${foreign.project.id}`,
      `/v1/snapshots/${foreignSnapshotId}/export`,
      `/v1/verifications/${foreignSnapshotId}/export`,
      `/v1/http-probes?snapshotId=${foreignSnapshotId}`,
      `/v1/functional-records?snapshotId=${foreignSnapshotId}`,
    ];
    for (const endpoint of endpoints) {
      const response = await fetch(`${api.url}${endpoint}`, { headers });
      expect(response.status, endpoint).toBe(404);
      expect(await response.json(), endpoint).toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    }
    const projects = await fetch(`${api.url}/v1/projects`, { headers });
    expect(projects.status).toBe(200);
    expect(await projects.json()).toMatchObject({
      total: 1,
      items: [{ root: await realpath(rootA) }],
    });
    const nextProjectPage = await fetch(`${api.url}/v1/projects?offset=1`, {
      headers,
    });
    expect(await nextProjectPage.json()).toMatchObject({
      total: 1,
      offset: 1,
      items: [],
      nextOffset: null,
    });
    for (const endpoint of [
      "/v1/functional",
      "/v1/product",
      "/v1/data-review",
    ] as const) {
      const response = await fetch(`${api.url}${endpoint}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: foreignSnapshotId }),
      });
      expect(response.status, endpoint).toBe(404);
    }
    expect(own.snapshot.id).not.toBe(foreignSnapshotId);
  } finally {
    await api.close();
    await rm(parent, { recursive: true, force: true });
  }
});
