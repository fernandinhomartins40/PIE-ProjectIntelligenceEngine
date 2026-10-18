import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";
import { JobWorker } from "../../src/pie/jobs/worker.js";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";
import { randomUUID } from "node:crypto";
import { scopedJob } from "../../src/pie/jobs/access.js";
import { JobDaemon } from "../../src/pie/jobs/daemon.js";

it.skipIf(process.platform !== "linux")(
  "CLI contínua real consome descoberta e encerra por SIGTERM sem novo job",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-daemon-cli-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const fixture = true;");
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const db = join(root, "history.sqlite");
    const queue = new SqliteJobQueue(db);
    const job = queue.enqueue({
      kind: "discovery",
      idempotencyKey: "cli-continuous",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    const child = spawn(
      process.execPath,
      [
        resolve("scripts/pie.mjs"),
        "work",
        repo,
        "--db",
        db,
        "--continuous",
        "--poll-ms",
        "100",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    const exited = once(child, "exit");
    try {
      await expect
        .poll(() => output.includes('"state":"listening"'), { timeout: 10000 })
        .toBe(true);
      await expect
        .poll(() => queue.get(job.id).state, { timeout: 10000 })
        .toBe("succeeded");
      child.kill("SIGTERM");
      expect(await exited, errors).toEqual([0, null]);
      const records = output
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as { mode: string; processed?: number },
        );
      expect(records.at(-1)).toMatchObject({
        mode: "continuous",
        processed: 1,
      });
      expect(queue.get(job.id).attempts).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      queue.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it("daemon real consome jobs que chegam depois de ocioso e encerra espera longa sem novo claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-daemon-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(join(repo, "index.ts"), "export const value = 1;");
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "history.sqlite"), repo);
  const service = new PieService(store);
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
  const worker = new JobWorker(queue, repo, { kind: "discovery", service });
  const daemon = new JobDaemon(worker, 100);
  const operation = daemon.run();
  try {
    await expect(daemon.run()).rejects.toThrow("iniciado");
    const input = {
      kind: "discovery",
      idempotencyKey: "first",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    };
    const first = queue.enqueue(input);
    await expect
      .poll(() => queue.get(first.id).state, { timeout: 5000 })
      .toBe("succeeded");
    const second = queue.enqueue({ ...input, idempotencyKey: "second" });
    await expect
      .poll(() => queue.get(second.id).state, { timeout: 5000 })
      .toBe("succeeded");
    await daemon.close();
    expect(await operation).toEqual({ processed: 2 });
    await daemon.close();
    await expect(daemon.run()).rejects.toThrow("encerrado");
    const idle = new JobDaemon(
      new JobWorker(queue, repo, { kind: "discovery", service }),
      30_000,
    );
    const waiting = idle.run();
    await idle.close();
    expect(await waiting).toEqual({ processed: 0 });
    const unavailable = new JobDaemon(
      new JobWorker(queue, join(root, "missing-root"), {
        kind: "discovery",
        service,
      }),
      100,
    );
    await expect(unavailable.run()).rejects.toThrow();
    await unavailable.close();
    await expect(unavailable.run()).rejects.toThrow("encerrado");
    expect(store.history(store.projects().items[0]!.id).total).toBe(2);
  } finally {
    await daemon.close();
    await service.close();
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

it("VERIFY preserva grant, separa workers e nunca repete execução interrompida", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "pie-verify-queue-")),
  );
  let now = 1000;
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"), () => now);
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: root,
    snapshotId: randomUUID(),
    treeDigest: "a".repeat(64),
    image: `node@sha256:${"1".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    testFiles: ["test.mjs"],
    limits: {
      timeoutMs: 1000,
      memoryMiB: 256,
      cpus: 1,
      pids: 32,
      workspaceMiB: 64,
      outputBytes: 65536,
      sourceBytes: 100000,
    },
  };
  try {
    const input = {
      kind: "verification",
      idempotencyKey: "verify",
      payload: grant,
    };
    const queued = queue.enqueue(input);
    expect(queued.payload).toEqual(grant);
    expect((await scopedJob(queue, root, queued.id, "verification")).id).toBe(
      queued.id,
    );
    await expect(
      scopedJob(queue, join(root, "other"), queued.id),
    ).rejects.toThrow("escopo");
    await expect(
      scopedJob(queue, root, queued.id, "discovery"),
    ).rejects.toThrow("escopo");
    expect(queue.enqueue(input).id).toBe(queued.id);
    expect(() => queue.enqueue({ ...input, maxAttempts: 2 })).toThrow();
    expect(() =>
      queue.enqueue({
        ...input,
        payload: { ...grant, testFiles: ["other.mjs"] },
      }),
    ).toThrow("idempotente");
    expect(queue.claim("discovery", 500, root)).toBeNull();
    const running = queue.claim("verification", 500, root, "verification")!;
    expect(running.id).toBe(queued.id);
    now = 1501;
    expect(queue.claim("replacement", 500, root, "verification")).toBeNull();
    expect(queue.get(queued.id)).toMatchObject({
      state: "failed",
      attempts: 1,
      errorCode: "EXECUTION_INTERRUPTED",
    });
    expect(
      queue.finish(queued.id, running.leaseToken!, "succeeded", {
        runId: queued.id,
      }),
    ).toBe(false);
    const cancellation = queue.enqueue({
      ...input,
      idempotencyKey: "cancel-verify",
    });
    const owned = queue.claim("verification", 500, root, "verification")!;
    queue.cancel(cancellation.id);
    now = 1800;
    expect(queue.heartbeat(owned.id, owned.leaseToken!, 500)).toBe(false);
    now = 2100;
    expect(queue.claim("peer", 500, root, "verification")).toBeNull();
    expect(queue.get(owned.id).state).toBe("cancelling");
    expect(queue.finish(owned.id, owned.leaseToken!, "cancelled")).toBe(true);
    const interrupted = queue.enqueue({
      ...input,
      idempotencyKey: "shutdown-verify",
    });
    const interruptedClaim = queue.claim(
      "verification",
      500,
      root,
      "verification",
    )!;
    expect(interruptedClaim.id).toBe(interrupted.id);
    expect(
      queue.interrupt(
        interrupted.id,
        interruptedClaim.leaseToken!,
        "WORKER_SHUTDOWN",
      ),
    ).toBe(true);
    expect(queue.get(interrupted.id)).toMatchObject({
      state: "failed",
      attempts: 1,
      errorCode: "WORKER_SHUTDOWN",
      result: null,
    });
    expect(queue.claim("replacement", 500, root, "verification")).toBeNull();
  } finally {
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("worker reconhece cancelamento imediatamente apÃ³s claim antes de iniciar discovery", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "pie-worker-cancel-before-dispatch-"),
  );
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(join(repo, "index.ts"), "export const value = 1;");
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "state.sqlite"), repo);
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
  const service = new PieService(store);
  const claim = queue.claim.bind(queue);
  queue.claim = (...args) => {
    const job = claim(...args);
    if (job) queue.cancel(job.id);
    return job;
  };
  const worker = new JobWorker(queue, repo, { kind: "discovery", service });
  try {
    const job = queue.enqueue({
      idempotencyKey: "cancel-before-dispatch",
      kind: "discovery",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    expect(await worker.runOnce()).toBe(true);
    expect(queue.get(job.id)).toMatchObject({
      state: "cancelled",
      attempts: 1,
      result: null,
      errorCode: "CANCELLED",
    });
    expect(store.projects().total).toBe(0);
  } finally {
    await worker.close();
    await service.close();
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("cancelamento na publicação final impede sucesso do job e preserva snapshot imutável", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-worker-cancel-finalize-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(join(repo, "index.ts"), "export const observed = true;");
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "state.sqlite"), repo);
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
  const service = new PieService(store);
  const finish = queue.finish.bind(queue);
  queue.finish = (id, token, state, result, errorCode) => {
    if (state === "succeeded") queue.cancel(id);
    return finish(id, token, state, result, errorCode);
  };
  const worker = new JobWorker(queue, repo, { kind: "discovery", service });
  try {
    const job = queue.enqueue({
      idempotencyKey: "cancel-during-final-publication",
      kind: "discovery",
      payload: {
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      },
    });
    expect(await worker.runOnce()).toBe(true);
    expect(queue.get(job.id)).toMatchObject({
      state: "cancelled",
      result: null,
    });
    expect(store.projects().total).toBe(1);
    expect(store.history(store.projects().items[0]!.id).total).toBe(1);
  } finally {
    await worker.close();
    await service.close();
    queue.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  ["timeout", "JOB_TIMEOUT"],
  ["shutdown", "WORKER_SHUTDOWN"],
  ["lease loss", "LEASE_LOST"],
  ["heartbeat failure", "HEARTBEAT_FAILED"],
] as const)(
  "registra a causa específica de aborto por %s",
  async (_scenario, expectedCode) => {
    const root = await mkdtemp(join(tmpdir(), "pie-worker-abort-cause-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const fixture = true;");
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "state.sqlite"), repo);
    const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
    const service = new PieService(store);
    let startedResolve: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    service.discover = async (_input, signal) => {
      startedResolve();
      return await new Promise<never>((_resolve, reject) => {
        const rejectOnAbort = () => reject(signal?.reason);
        if (signal?.aborted) rejectOnAbort();
        else signal?.addEventListener("abort", rejectOnAbort, { once: true });
      });
    };
    const worker = new JobWorker(
      queue,
      repo,
      { kind: "discovery", service },
      100,
    );
    try {
      const job = queue.enqueue({
        idempotencyKey: `abort-${expectedCode}`,
        kind: "discovery",
        payload: {
          repositoryRoot: repo,
          profile: "OBSERVE",
          environment: "local",
        },
        timeoutMs: 100,
      });
      const running = worker.runOnce();
      await started;
      if (_scenario === "shutdown") await worker.close();
      else if (_scenario === "lease loss") queue.heartbeat = () => false;
      else if (_scenario === "heartbeat failure")
        queue.heartbeat = () => {
          throw new Error("database unavailable");
        };
      await running;
      if (_scenario === "shutdown") {
        expect(queue.get(job.id)).toMatchObject({
          state: "queued",
          attempts: 1,
          result: null,
          errorCode: expectedCode,
          owner: null,
          leaseToken: null,
        });
        service.discover = async () =>
          ({}) as Awaited<ReturnType<PieService["discover"]>>;
        const retryingWorker = new JobWorker(queue, repo, {
          kind: "discovery",
          service,
        });
        try {
          expect(await retryingWorker.runOnce()).toBe(true);
          expect(queue.get(job.id)).toMatchObject({
            state: "succeeded",
            attempts: 2,
            errorCode: null,
          });
        } finally {
          await retryingWorker.close();
        }
      } else {
        expect(queue.get(job.id)).toMatchObject({
          state: "failed",
          result: null,
          errorCode: expectedCode,
        });
      }
    } finally {
      await worker.close();
      await service.close();
      queue.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
    for (const invalidLease of [
      0,
      -1,
      100.5,
      300_001,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        queue.heartbeat(first.id, owned.leaseToken!, invalidLease),
      ).toThrow();
      expect(() => queue.claim("invalid-duration", invalidLease)).toThrow();
    }
    expect(queue.get(first.id).leaseUntil).toBe(owned.leaseUntil);
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

it("interrupcao respeita limite de tentativas e cancelamento concorrente", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-interrupt-"));
  const queue = new SqliteJobQueue(join(root, "jobs.sqlite"));
  try {
    const terminal = queue.enqueue({
      idempotencyKey: "terminal-interruption",
      kind: "discovery",
      maxAttempts: 1,
      payload: {
        profile: "OBSERVE",
        environment: "local",
        repositoryRoot: root,
      },
    });
    const claim = queue.claim("worker", 500)!;
    expect(
      queue.interrupt(terminal.id, claim.leaseToken!, "WORKER_SHUTDOWN"),
    ).toBe(true);
    expect(queue.get(terminal.id)).toMatchObject({
      state: "failed",
      attempts: 1,
      result: null,
      errorCode: "WORKER_SHUTDOWN",
    });

    const cancelled = queue.enqueue({
      idempotencyKey: "cancelled-interruption",
      kind: "discovery",
      payload: {
        profile: "OBSERVE",
        environment: "local",
        repositoryRoot: root,
      },
    });
    const cancelClaim = queue.claim("worker", 500)!;
    expect(cancelClaim.id).toBe(cancelled.id);
    expect(queue.cancel(cancelled.id).state).toBe("cancelling");
    expect(
      queue.interrupt(cancelled.id, cancelClaim.leaseToken!, "WORKER_SHUTDOWN"),
    ).toBe(true);
    expect(queue.get(cancelled.id)).toMatchObject({
      state: "cancelled",
      attempts: 1,
      result: null,
      errorCode: "CANCELLED",
    });
  } finally {
    queue.close();
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
  const worker = new JobWorker(queue, repo, { kind: "discovery", service });
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
