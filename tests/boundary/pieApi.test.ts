import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";

it("API local exige token, nega origem de navegador e compartilha descoberta persistente", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-api-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(join(repo, "index.ts"), "export const value = 1;");
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "api.sqlite"), repo);
  const token = "fixture-api-token-only-32-characters-minimum";
  const queue = new SqliteJobQueue(join(root, "jobs.sqlite"));
  const api = await startPieApi(new PieService(store), {
    root: repo,
    token,
    queue,
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  try {
    expect((await fetch(`${api.url}/v1/projects`)).status).toBe(401);
    expect(
      (
        await fetch(`${api.url}/v1/projects`, {
          headers: { ...headers, Origin: "https://untrusted.invalid" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${api.url}/v1/health`, { headers })).status).toBe(200);
    const discovery = await fetch(`${api.url}/v1/discover`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(discovery.status).toBe(201);
    const result = (await discovery.json()) as { snapshot: { id: string } };
    const graph = await fetch(`${api.url}/v1/graph/${result.snapshot.id}`, {
      headers,
    });
    expect(await graph.json()).toMatchObject({
      nodes: { total: 1 },
      coverage: { runtime: false },
    });
    expect(
      (
        await fetch(`${api.url}/v1/discover`, {
          method: "POST",
          headers,
          body: JSON.stringify({ repositoryRoot: "outside" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${api.url}/v1/discover`, {
          method: "POST",
          headers,
          body: " ".repeat(16_385),
        })
      ).status,
    ).toBe(413);
    expect(
      (await fetch(`${api.url}/v1/projects?limit=0`, { headers })).status,
    ).toBe(400);
    expect((await fetch(`${api.url}/v1/unknown`, { headers })).status).toBe(
      404,
    );
    const queuedResponse = await fetch(`${api.url}/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotencyKey: "api-job" }),
    });
    expect(queuedResponse.status).toBe(202);
    const queued = (await queuedResponse.json()) as { id: string };
    expect(
      await (
        await fetch(`${api.url}/v1/jobs/${queued.id}`, { headers })
      ).json(),
    ).toMatchObject({ state: "queued", payload: { repositoryRoot: await realpath(repo) } });
    expect(
      await (
        await fetch(`${api.url}/v1/jobs/${queued.id}/cancel`, {
          method: "POST",
          headers,
        })
      ).json(),
    ).toMatchObject({ state: "cancelled" });
  } finally {
    await api.close();
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
