import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { VerificationCoordinator } from "../../src/pie/execution/coordinator.js";
import { VerificationJournal } from "../../src/pie/execution/resourceJournal.js";
import { startPieApi } from "../../src/pie/api.js";
import { verificationRunSchema } from "../../src/pie/execution/runContracts.js";
import { verifyRunEvidence } from "../../src/pie/execution/runEvidence.js";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-verify-api-"));
  const repo = join(root, "repo");
  const state = join(root, "state");
  await mkdir(repo);
  await mkdir(state, { mode: 0o700 });
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(
    join(repo, "test.mjs"),
    "import {test} from 'node:test';test('fixture',async()=>{await new Promise(resolve=>setTimeout(resolve,2000));});",
  );
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "history.sqlite"), repo);
  const service = new PieService(store);
  const observed = await service.discover({
    profile: "OBSERVE",
    environment: "local",
    repositoryRoot: repo,
  });
  const snapshot = store.snapshot(observed.snapshot.id);
  const executable = process.env.PIE_TEST_DOCKER_IMAGE
    ? (await promisify(execFile)("which", ["docker"])).stdout.trim()
    : join(root, "missing-docker");
  const verifier = await VerificationCoordinator.open(store, {
    root: repo,
    stateDirectory: state,
    executable,
    endpoint: "unix:///var/run/docker.sock",
  });
  const token = "fixture-verify-api-token-32-characters-minimum";
  const queue = new SqliteJobQueue(join(root, "queue.sqlite"));
  const api = await startPieApi(service, {
    root: repo,
    token,
    verifier,
    queue,
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: repo,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    image: process.env.PIE_TEST_DOCKER_IMAGE ?? `node@sha256:${"1".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testFiles: ["test.mjs"],
    limits: {
      timeoutMs: 15000,
      memoryMiB: 256,
      cpus: 1,
      pids: 32,
      workspaceMiB: 64,
      outputBytes: 65536,
      sourceBytes: 100000,
    },
  };
  return { root, repo, state, store, api, headers, grant, snapshot, queue };
}

it.skipIf(process.platform !== "linux")(
  "API exige autenticação e raiz fixa; grant permitido persiste resultado real",
  async () => {
    const { root, api, headers, grant, store, snapshot, queue } =
      await fixture();
    try {
      expect(
        (
          await fetch(`${api.url}/v1/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(grant),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${api.url}/v1/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...grant, repositoryRoot: root }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${api.url}/v1/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...grant, profile: "OBSERVE" }),
          })
        ).status,
      ).toBe(400);
      expect(store.verifications(snapshot.id).total).toBe(0);
      const enqueued = await fetch(`${api.url}/v1/jobs/verification`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          idempotencyKey: "api-grant",
          authorization: grant,
        }),
      });
      expect(enqueued.status).toBe(202);
      const job = (await enqueued.json()) as { id: string };
      expect(queue.get(job.id)).toMatchObject({
        kind: "verification",
        state: "queued",
        payload: grant,
        attempts: 0,
      });
      expect(store.verifications(snapshot.id).total).toBe(0);
      const repeated = await fetch(`${api.url}/v1/jobs/verification`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          idempotencyKey: "api-grant",
          authorization: grant,
        }),
      });
      expect(await repeated.json()).toMatchObject({ id: job.id });
      const cancelled = await fetch(`${api.url}/v1/jobs/${job.id}/cancel`, {
        method: "POST",
        headers,
      });
      expect(await cancelled.json()).toMatchObject({
        id: job.id,
        state: "cancelled",
      });
      const responses = await Promise.all(
        (process.env.PIE_TEST_DOCKER_IMAGE ? [1, 2] : [1]).map(() =>
          fetch(`${api.url}/v1/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify(grant),
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual(
        process.env.PIE_TEST_DOCKER_IMAGE ? [201, 429] : [201],
      );
      const response = responses.find((item) => item.status === 201)!;
      const run = verifyRunEvidence(
        verificationRunSchema.parse(await response.json()),
      );
      expect(run.result.state).toBe(
        process.env.PIE_TEST_DOCKER_IMAGE ? "passed" : "blocked",
      );
      expect(store.verification(run.id)).toEqual(run);
      const read = await fetch(`${api.url}/v1/verification/${run.id}`, {
        headers,
      });
      expect(await read.json()).toEqual(run);
      expect(
        await (await fetch(`${api.url}/v1/context`, { headers })).json(),
      ).toMatchObject({ verificationEnabled: true });
    } finally {
      await api.close();
      queue.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it.skipIf(process.platform !== "linux" || !process.env.PIE_TEST_DOCKER_IMAGE)(
  "fechamento da API cancela VERIFY, aguarda persistência e libera o journal",
  async () => {
    const { root, state, api, headers, grant, snapshot, queue } =
      await fixture();
    const journal = await VerificationJournal.open(
      join(state, "resources.sqlite"),
    );
    try {
      const request = fetch(`${api.url}/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(grant),
      });
      await expect
        .poll(
          () => journal.list().some((record) => record.phase === "created"),
          { timeout: 10_000 },
        )
        .toBe(true);
      await api.close();
      const response = await request;
      const run = verificationRunSchema.parse(await response.json());
      expect(run.snapshotId).toBe(snapshot.id);
      expect(run.result.state).toBe("inconclusive");
      expect(journal.get(run.id)).toMatchObject({
        phase: "removed",
        rootRemovedAt: expect.any(String),
      });
      await api.close();
    } finally {
      journal.close();
      await api.close();
      queue.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
