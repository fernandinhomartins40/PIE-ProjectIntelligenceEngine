import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";
import { DiscoveryWorker } from "../../src/pie/jobs/worker.js";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";

it("fila real persiste, usa leases, recupera após perda de worker e impede resultado antigo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-jobs-"));
  const path = join(root, "jobs.sqlite");
  let now = 1000;
  const queue = new SqliteJobQueue(path, () => now);
  const peer = new SqliteJobQueue(path, () => now);
  const input = {
    idempotencyKey: "fixture-only",
    kind: "discovery",
    payload: { profile: "OBSERVE", environment: "local", repositoryRoot: root },
  };
  try {
    const first = queue.enqueue(input);
    expect(peer.enqueue(input).id).toBe(first.id);
    expect(() => peer.enqueue({ ...input, timeoutMs: 100 })).toThrow(
      "idempotente",
    );
    const owned = queue.claim("worker-a", 500)!;
    expect(peer.claim("worker-b", 500)).toBeNull();
    now = 1501;
    const recovered = peer.claim("worker-b", 500)!;
    expect(recovered.attempts).toBe(2);
    expect(recovered.leaseToken).not.toBe(owned.leaseToken);
    expect(
      queue.finish(first.id, owned.leaseToken!, "succeeded", { fake: true }),
    ).toBe(false);
    expect(peer.cancel(first.id).state).toBe("cancelling");
    expect(peer.heartbeat(first.id, recovered.leaseToken!, 500)).toBe(false);
    expect(
      peer.finish(first.id, recovered.leaseToken!, "succeeded", {
        shouldNotPublish: true,
      }),
    ).toBe(true);
    expect(queue.get(first.id)).toMatchObject({
      state: "cancelled",
      result: null,
    });
    const abandoned = queue.enqueue({
      ...input,
      idempotencyKey: "abandoned",
      maxAttempts: 1,
    });
    queue.claim("lost", 500);
    now = 2002;
    expect(peer.claim("next", 500)).toBeNull();
    expect(peer.get(abandoned.id).state).toBe("failed");
  } finally {
    queue.close();
    peer.close();
  }
  const reopened = new SqliteJobQueue(path);
  try {
    expect(reopened.enqueue(input).state).toBe("cancelled");
  } finally {
    reopened.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("worker executa descoberta real e publica recibo do snapshot sem executar código do alvo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-worker-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(
    join(repo, "index.ts"),
    "throw new Error('não executar alvo');",
  );
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "state.sqlite"), repo);
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
  const service = new PieService(store);
  const worker = new DiscoveryWorker(queue, service, repo);
  try {
    const job = queue.enqueue({
      idempotencyKey: "real",
      kind: "discovery",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    expect(await worker.runOnce()).toBe(true);
    expect(queue.get(job.id)).toMatchObject({
      state: "succeeded",
      attempts: 1,
    });
    const snapshotId = (queue.get(job.id).result!.snapshot as { id: string })
      .id;
    expect(store.snapshot(snapshotId).coverage.runtime).toBe(false);
    expect(await worker.runOnce()).toBe(false);
    expect(() =>
      queue.enqueue({
        idempotencyKey: "bad",
        kind: "discovery",
        payload: {
          repositoryRoot: repo,
          profile: "VERIFY",
          environment: "local",
          allowTargetExecution: true,
        },
      }),
    ).toThrow();
    const queued = queue.enqueue({
      idempotencyKey: "cancel",
      kind: "discovery",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    expect(queue.cancel(queued.id).state).toBe("cancelled");
    expect(await worker.runOnce()).toBe(false);
    const other = queue.enqueue({
      idempotencyKey: "other-project",
      kind: "discovery",
      payload: {
        repositoryRoot: root,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    expect(await worker.runOnce()).toBe(false);
    expect(queue.get(other.id).state).toBe("queued");
  } finally {
    await worker.close();
    await service.close();
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
});
