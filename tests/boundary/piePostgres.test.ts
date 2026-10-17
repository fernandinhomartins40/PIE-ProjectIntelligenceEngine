import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PostgresPieStore } from "../../src/pie/postgresStore.js";
import { PieService } from "../../src/pie/service.js";
import { Pool } from "pg";
import { PostgresJobQueue } from "../../src/pie/jobs/postgresQueue.js";

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local HTTP port");
  return address.port;
}

async function verifyInterruptedJob(
  queue: PostgresJobQueue,
  peerQueue: PostgresJobQueue,
  pool: Pool,
  snapshot: { id: string; treeDigest: string; root: string },
) {
  const repo = snapshot.root;
  const verification = await queue.enqueue({
    kind: "verification",
    idempotencyKey: randomUUID(),
    payload: {
      schemaVersion: 1,
      profile: "VERIFY",
      allowTargetExecution: true,
      environment: "local",
      repositoryRoot: repo,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      image: `node@sha256:${"1".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      testFiles: ["index.ts"],
      limits: {
        timeoutMs: 1000,
        memoryMiB: 256,
        cpus: 1,
        pids: 32,
        workspaceMiB: 64,
        outputBytes: 65536,
        sourceBytes: 100000,
      },
    },
  });
  expect(await queue.claim("discovery", 5000, repo)).toBeNull();
  const verifying = await peerQueue.claim("verify", 5000, repo, "verification");
  expect(verifying?.id).toBe(verification.id);
  await pool.query("UPDATE pie_jobs SET lease_until=0 WHERE id=$1", [
    verification.id,
  ]);
  expect(
    await queue.claim("replacement", 5000, repo, "verification"),
  ).toBeNull();
  expect(await peerQueue.get(verification.id)).toMatchObject({
    state: "failed",
    attempts: 1,
    errorCode: "EXECUTION_INTERRUPTED",
  });
  expect(
    await queue.finish(verification.id, verifying!.leaseToken!, "succeeded"),
  ).toBe(false);
}

async function verifyPostgresHttpProbe(details: {
  store: PostgresPieStore;
  peer: PostgresPieStore;
  pool: Pool;
  repository: string;
  snapshot: Awaited<ReturnType<PostgresPieStore["snapshot"]>>;
  port: number;
  responseBody: string;
}) {
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowLocalHttpRequests: true,
    environment: "local",
    repositoryRoot: details.repository,
    snapshotId: details.snapshot.id,
    treeDigest: details.snapshot.treeDigest,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    evidenceTtlMs: 30_000,
    request: {
      address: "127.0.0.1",
      port: details.port,
      method: "GET",
      path: "/status",
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    },
    expectedStatus: 200,
    expectedBodySha256: createHash("sha256")
      .update(details.responseBody)
      .digest("hex"),
  };
  const outcome = await new PieService(details.store).probeHttp(
    grant,
    details.repository,
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("PostgreSQL HTTP probe failed");
  expect(await details.peer.httpProbe(outcome.value.id)).toEqual(outcome.value);
  expect(await details.peer.saveHttpProbe(outcome.value)).toEqual(
    outcome.value,
  );
  expect(
    await details.peer.httpProbes(details.snapshot.id, { limit: 1 }),
  ).toMatchObject({
    total: 1,
    nextOffset: null,
    items: [
      {
        id: outcome.value.id,
        evidenceId: outcome.value.evidence.id,
        proofSha256: outcome.value.evidence.source.sha256,
      },
    ],
  });
  await expect(
    details.pool.query(
      "UPDATE pie_http_probes SET created_at=now() WHERE id=$1",
      [outcome.value.id],
    ),
  ).rejects.toThrow("immutable");
}

const url = process.env.PIE_TEST_DATABASE_URL;

// No fake database: explicitly skipped when a dedicated real server is absent.
it.skipIf(!url)(
  "PostgreSQL real: migração, concorrência, imutabilidade e reabertura",
  async () => {
    const parsed = new URL(url!);
    if (!parsed.pathname.endsWith("_test"))
      throw new Error("Use banco dedicado com nome terminado em _test.");
    const root = await mkdtemp(join(tmpdir(), "pie-pg-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const fixture = true;");
    await writeFile(
      join(repo, "schema.prisma"),
      "model Order {\n  id String @id\n}\n",
    );
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = new PostgresPieStore(url!);
    const peer = new PostgresPieStore(url!);
    const pool = new Pool({ connectionString: url!, max: 1 });
    const queue = new PostgresJobQueue(url!);
    const peerQueue = new PostgresJobQueue(url!);
    const responseBody = "postgres local HTTP";
    const httpServer = createServer((_request, response) =>
      response.end(responseBody),
    );
    try {
      await store.connect();
      await peer.connect();
      const httpPort = await listenLoopback(httpServer);
      const run = await new PieService(store).discover({
        profile: "OBSERVE",
        environment: "local",
        repositoryRoot: repo,
      });
      const snapshot = await store.snapshot(run.snapshot.id);
      await verifyPostgresHttpProbe({
        store,
        peer,
        pool,
        repository: repo,
        snapshot,
        port: httpPort,
        responseBody,
      });
      const retained = await new PieService(store).retainFunctional({
        snapshotId: snapshot.id,
      });
      expect(await peer.functionalRecord(retained.id)).toEqual(retained);
      expect(await peer.saveFunctional(retained)).toEqual(retained);
      expect(
        await peer.functionalRecords(snapshot.id, { limit: 1 }),
      ).toMatchObject({
        total: 1,
        nextOffset: null,
        items: [{ id: retained.id, state: "unverified" }],
      });
      await expect(
        pool.query(
          "UPDATE pie_functional_records SET created_at=now() WHERE id=$1",
          [retained.id],
        ),
      ).rejects.toThrow("immutable");
      await expect(
        pool.query("DELETE FROM pie_functional_records WHERE id=$1", [
          retained.id,
        ]),
      ).rejects.toThrow("immutable");
      expect(snapshot.nodes).toHaveLength(2);
      const model = snapshot.declarations.find(
        (fact) => fact.kind === "model",
      )!;
      const trace = await new PieService(peer).trace({
        snapshotId: snapshot.id,
        nodeId: model.id,
      });
      expect(trace.nodes.total).toBe(2);
      expect(trace.coverage.runtime).toBe(false);
      expect((await store.evidence(snapshot.evidence[0]!.id)).state).toBe(
        "unverified",
      );
      await Promise.all([
        store.saveSnapshot(snapshot),
        peer.saveSnapshot(snapshot),
      ]);
      httpServer.closeAllConnections();
      if (httpServer.listening)
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      await expect(
        peer.saveSnapshot({ ...snapshot, dirty: false }),
      ).rejects.toThrow("substituído");
      await expect(
        pool.query("UPDATE pie_snapshots SET created_at=now() WHERE id=$1", [
          snapshot.id,
        ]),
      ).rejects.toThrow("immutable");
      await expect(
        pool.query("DELETE FROM pie_evidence WHERE id=$1", [
          snapshot.evidence[0]!.id,
        ]),
      ).rejects.toThrow("immutable");
      const graph = await pool.query(
        "SELECT count(*)::int AS total FROM pie_graph_nodes WHERE snapshot_id=$1",
        [snapshot.id],
      );
      expect(graph.rows[0].total).toBe(2);
      const orphan = { ...snapshot, id: randomUUID(), projectId: randomUUID() };
      await expect(peer.saveSnapshot(orphan)).rejects.toThrow();
      expect((await store.history(run.project.id)).total).toBe(1);
      const request = {
        idempotencyKey: randomUUID(),
        kind: "discovery",
        payload: {
          repositoryRoot: repo,
          profile: "OBSERVE",
          environment: "local",
        },
      };
      const queued = await queue.enqueue(request);
      expect((await peerQueue.enqueue(request)).id).toBe(queued.id);
      const claims = await Promise.all([
        queue.claim("pg-a", 5000),
        peerQueue.claim("pg-b", 5000),
      ]);
      expect(claims.filter((job) => job?.id === queued.id)).toHaveLength(1);
      const claimed = claims.find((job) => job?.id === queued.id)!;
      await queue.cancel(queued.id);
      expect(
        await peerQueue.finish(queued.id, claimed.leaseToken!, "succeeded", {
          invalid: true,
        }),
      ).toBe(true);
      expect(await queue.get(queued.id)).toMatchObject({
        state: "cancelled",
        result: null,
      });
      await verifyInterruptedJob(queue, peerQueue, pool, snapshot);
    } finally {
      await Promise.all([
        store.close(),
        peer.close(),
        pool.end(),
        queue.close(),
        peerQueue.close(),
      ]);
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
