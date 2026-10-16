import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PostgresPieStore } from "../../src/pie/postgresStore.js";
import { PieService } from "../../src/pie/service.js";
import { Pool } from "pg";
import { PostgresJobQueue } from "../../src/pie/jobs/postgresQueue.js";

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
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = new PostgresPieStore(url!);
    const peer = new PostgresPieStore(url!);
    const pool = new Pool({ connectionString: url!, max: 1 });
    const queue = new PostgresJobQueue(url!);
    const peerQueue = new PostgresJobQueue(url!);
    try {
      await store.connect();
      await peer.connect();
      const run = await new PieService(store).discover({
        profile: "OBSERVE",
        environment: "local",
        repositoryRoot: repo,
      });
      const snapshot = await store.snapshot(run.snapshot.id);
      expect(snapshot.nodes).toHaveLength(1);
      expect((await store.evidence(snapshot.evidence[0]!.id)).state).toBe(
        "unverified",
      );
      await Promise.all([
        store.saveSnapshot(snapshot),
        peer.saveSnapshot(snapshot),
      ]);
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
      expect(graph.rows[0].total).toBe(1);
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
