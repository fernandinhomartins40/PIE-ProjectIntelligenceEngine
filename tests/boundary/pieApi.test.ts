import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";
import { sha256 } from "../../src/pie/evidence.js";

async function verifyFunctionalHistory(
  url: string,
  headers: Record<string, string>,
  snapshotId: string,
  service: PieService,
) {
  const retests = await fetch(`${url}/v1/retest-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ beforeId: snapshotId, afterId: snapshotId }),
  });
  expect(retests.status).toBe(200);
  expect(await retests.json()).toEqual(
    await service.retestPlan({ beforeId: snapshotId, afterId: snapshotId }),
  );
  const functional = await fetch(`${url}/v1/functional`, {
    method: "POST",
    headers,
    body: JSON.stringify({ snapshotId: snapshotId }),
  });
  expect(functional.status).toBe(200);
  expect(await functional.json()).toEqual(
    await service.functional({ snapshotId: snapshotId }),
  );
  const product = await fetch(`${url}/v1/product`, {
    method: "POST",
    headers,
    body: JSON.stringify({ snapshotId }),
  });
  expect(product.status).toBe(200);
  expect(await product.json()).toEqual(await service.product({ snapshotId }));
  const retained = await fetch(`${url}/v1/functional-records`, {
    method: "POST",
    headers,
    body: JSON.stringify({ snapshotId: snapshotId }),
  });
  expect(retained.status).toBe(201);
  const record = (await retained.json()) as { id: string };
  expect(
    await (
      await fetch(`${url}/v1/functional-records/${record.id}`, {
        headers,
      })
    ).json(),
  ).toEqual(record);
  const exportUnauthenticated = await fetch(
    `${url}/v1/functional-records/${record.id}/export`,
  );
  expect(exportUnauthenticated.status).toBe(401);
  let exportOffset = 0;
  let exportContent = "";
  let exportIdentity:
    | {
        recordSha256: string;
        treeDigest: string;
        sha256: string;
        totalBytes: number;
      }
    | undefined;
  do {
    const page = await fetch(
      `${url}/v1/functional-records/${record.id}/export?offset=${exportOffset}&limitBytes=128`,
      { headers },
    );
    expect(page.status).toBe(200);
    const value = (await page.json()) as {
      recordId: string;
      snapshotId: string;
      recordSha256: string;
      treeDigest: string;
      nextOffset: number | null;
      sha256: string;
      totalBytes: number;
      content: string;
    };
    expect(value.recordId).toBe(record.id);
    expect(value.snapshotId).toBe(snapshotId);
    exportIdentity ??= value;
    expect(value.recordSha256).toBe(exportIdentity.recordSha256);
    expect(value.treeDigest).toBe(exportIdentity.treeDigest);
    expect(value.sha256).toBe(exportIdentity.sha256);
    expect(Buffer.byteLength(value.content, "utf8")).toBeLessThanOrEqual(128);
    exportContent += value.content;
    if (value.nextOffset === null) break;
    exportOffset = value.nextOffset;
  } while (true);
  expect(JSON.parse(exportContent)).toEqual(record);
  expect(Buffer.byteLength(exportContent, "utf8")).toBe(
    exportIdentity!.totalBytes,
  );
  expect(sha256(exportContent)).toBe(exportIdentity!.sha256);
  for (const format of ["md", "html"] as const) {
    const page = await fetch(
      `${url}/v1/functional-records/${record.id}/export?format=${format}&limitBytes=1000000`,
      { headers },
    );
    expect(page.status).toBe(200);
    const value = (await page.json()) as {
      recordId: string;
      format: string;
      sha256: string;
      content: string;
    };
    expect(value.recordId).toBe(record.id);
    expect(value.format).toBe(format);
    expect(sha256(value.content)).toBe(value.sha256);
    expect(value.content).toContain(
      format === "md" ? "# Análise funcional PIE" : '<html lang="pt-BR">',
    );
  }
  const invalidExportLimit = await fetch(
    `${url}/v1/functional-records/${record.id}/export?limitBytes=3`,
    { headers },
  );
  expect(invalidExportLimit.status).toBe(400);
  const artifactBytes = Buffer.from(exportContent, "utf8");
  const invalidUtf8Offset = artifactBytes.findIndex(
    (byte) => (byte & 0xc0) === 0x80,
  );
  expect(invalidUtf8Offset).toBeGreaterThan(0);
  const invalidExportOffset = await fetch(
    `${url}/v1/functional-records/${record.id}/export?offset=${invalidUtf8Offset}`,
    { headers },
  );
  expect(invalidExportOffset.status).toBe(400);
  const listed = await fetch(
    `${url}/v1/functional-records?snapshotId=${snapshotId}&limit=1`,
    { headers },
  );
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual(
    await service.functionalRecords(snapshotId, { limit: 1 }),
  );
}

async function verifySnapshotExportApi(
  url: string,
  headers: Record<string, string>,
  snapshotId: string,
) {
  expect(
    (await fetch(`${url}/v1/snapshots/${snapshotId}/export?format=md`)).status,
  ).toBe(401);
  const exportPages: Array<{
    snapshotId: string;
    treeDigest: string;
    format: string;
    offset: number;
    totalBytes: number;
    nextOffset: number | null;
    sha256: string;
    content: string;
  }> = [];
  let exportOffset = 0;
  do {
    const pageResponse = await fetch(
      `${url}/v1/snapshots/${snapshotId}/export?format=md&offset=${exportOffset}&limitBytes=128`,
      { headers },
    );
    expect(pageResponse.status).toBe(200);
    const page = (await pageResponse.json()) as (typeof exportPages)[number];
    exportPages.push(page);
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(exportOffset);
    exportOffset = page.nextOffset;
  } while (true);
  const exportContent = exportPages.map((page) => page.content).join("");
  const exportBytes = Buffer.from(exportContent, "utf8");
  expect(exportPages.every((page) => page.snapshotId === snapshotId)).toBe(
    true,
  );
  expect(new Set(exportPages.map((page) => page.sha256)).size).toBe(1);
  expect(exportBytes.length).toBe(exportPages[0]!.totalBytes);
  expect(sha256(exportBytes)).toBe(exportPages[0]!.sha256);
  expect(exportContent).toContain("# PIE");
  const multibyteOffset = exportBytes.findIndex((byte) => byte >= 0xc0);
  expect(multibyteOffset).toBeGreaterThan(0);
  const shortPage = await fetch(
    `${url}/v1/snapshots/${snapshotId}/export?format=md&offset=${multibyteOffset}&limitBytes=4`,
    { headers },
  );
  expect(shortPage.status).toBe(200);
  const shortPageData =
    (await shortPage.json()) as (typeof exportPages)[number];
  expect(Buffer.byteLength(shortPageData.content, "utf8")).toBeLessThanOrEqual(
    4,
  );
  expect(shortPageData.nextOffset).toBeGreaterThan(multibyteOffset);
  const invalidBoundary = exportBytes.findIndex(
    (byte) => (byte & 0xc0) === 0x80,
  );
  expect(invalidBoundary).toBeGreaterThan(0);
  expect(
    (
      await fetch(
        `${url}/v1/snapshots/${snapshotId}/export?format=md&offset=${invalidBoundary}`,
        { headers },
      )
    ).status,
  ).toBe(400);
}

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
  const service = new PieService(store);
  const api = await startPieApi(service, {
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
        await fetch(`${api.url}/v1/verify`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(403);
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
    await verifySnapshotExportApi(api.url, headers, result.snapshot.id);
    expect(
      await (
        await fetch(`${api.url}/v1/verifications/${result.snapshot.id}`, {
          headers,
        })
      ).json(),
    ).toMatchObject({ total: 0, items: [] });
    const graph = await fetch(`${api.url}/v1/graph/${result.snapshot.id}`, {
      headers,
    });
    await verifyFunctionalHistory(
      api.url,
      headers,
      result.snapshot.id,
      service,
    );
    const graphData = (await graph.json()) as {
      nodes: { items: Array<{ id: string }> };
    };
    expect(graphData).toMatchObject({
      nodes: { total: 1 },
      coverage: { runtime: false },
    });
    const trace = await fetch(`${api.url}/v1/trace`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        snapshotId: result.snapshot.id,
        nodeId: graphData.nodes.items[0]!.id,
      }),
    });
    expect(trace.status).toBe(200);
    expect(await trace.json()).toMatchObject({
      coverage: { runtime: false },
      nodes: { total: 1 },
    });
    const declarations = await fetch(
      `${api.url}/v1/declarations/${result.snapshot.id}`,
      { headers },
    );
    expect(declarations.status).toBe(200);
    expect(await declarations.json()).toMatchObject({
      declarations: { total: 0 },
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
    ).toMatchObject({
      state: "queued",
      payload: { repositoryRoot: await realpath(repo) },
    });
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

it("API retém responsabilidade e permite repetir fechamento após falha de finalização", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-api-close-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  const store = await openStore(join(root, "state.sqlite"), repo);
  const service = new PieService(store);
  const api = await startPieApi(service, {
    root: repo,
    token: "fixture-close-token-32-characters-minimum",
  });
  const closing = vi
    .spyOn(service, "close")
    .mockRejectedValueOnce(new Error("fixture: final cleanup unavailable"));
  try {
    await expect(api.close()).rejects.toThrow("cleanup unavailable");
    expect(store.projects().total).toBe(0);
    await api.close();
    expect(closing).toHaveBeenCalledTimes(2);
    await api.close();
  } finally {
    closing.mockRestore();
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});
