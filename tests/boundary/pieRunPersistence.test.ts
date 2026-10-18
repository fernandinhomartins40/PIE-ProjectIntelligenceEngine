import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Pool } from "pg";
import { openStore } from "../../src/pie/store.js";
import { PostgresPieStore } from "../../src/pie/postgresStore.js";
import { PieService } from "../../src/pie/service.js";
import { NodeVerification } from "../../src/pie/execution/verification.js";
import type { PiePersistence } from "../../src/pie/persistence.js";
import { runEvidence } from "../../src/pie/execution/runEvidence.js";
import { sealEvidence, sha256 } from "../../src/pie/evidence.js";
import { startPieApi } from "../../src/pie/api.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { VerificationRun } from "../../src/pie/execution/runContracts.js";
import { exportVerificationResult } from "../../src/pie/execution/runExport.js";

async function verifyFormattedApiExports(
  url: string,
  headers: Record<string, string>,
  run: VerificationRun,
) {
  for (const format of ["md", "html"] as const) {
    const response = await fetch(
      `${url}/v1/verifications/${run.id}/export?format=${format}&limitBytes=1000000`,
      { headers },
    );
    expect(response.status).toBe(200);
    const value = (await response.json()) as {
      runId: string;
      format: string;
      sha256: string;
      content: string;
    };
    expect(value.runId).toBe(run.id);
    expect(value.format).toBe(format);
    expect(sha256(value.content)).toBe(value.sha256);
    expect(value.content).toContain(
      format === "md" ? "# " : '<html lang="pt-BR">',
    );
  }
}

async function verifyFormattedAdapters(
  client: Client,
  script: string,
  path: string,
  run: VerificationRun,
) {
  for (const format of ["md", "html"] as const) {
    const page = await client.callTool({
      name: "pie_verification_export",
      arguments: { id: run.id, format, limitBytes: 1_000_000 },
    });
    expect(page.isError).not.toBe(true);
    const value = page.structuredContent as {
      runId: string;
      format: string;
      sha256: string;
      content: string;
    };
    expect(value.runId).toBe(run.id);
    expect(value.format).toBe(format);
    expect(sha256(value.content)).toBe(value.sha256);
    const cli = await promisify(execFile)(process.execPath, [
      script,
      "verification-export",
      run.id,
      "--db",
      path,
      "--format",
      format,
    ]);
    expect(cli.stdout.trim()).toBe(value.content);
  }
}

async function readAdapters(path: string, repo: string, run: VerificationRun) {
  const script = resolve("scripts/pie.mjs");
  const cli = await promisify(execFile)(process.execPath, [
    script,
    "verification",
    run.id,
    "--db",
    path,
  ]);
  expect(JSON.parse(cli.stdout)).toEqual(run);
  const cliExport = await promisify(execFile)(process.execPath, [
    script,
    "verification-export",
    run.id,
    "--db",
    path,
  ]);
  expect(JSON.parse(cliExport.stdout)).toEqual(run);
  const token = "fixture-run-history-token-32-characters-minimum";
  const peer = await openStore(path, repo);
  const api = await startPieApi(new PieService(peer), { root: repo, token });
  const client = new Client({ name: "pie-run-history-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script, "mcp", repo, "--db", path],
    stderr: "pipe",
  });
  try {
    const headers = { Authorization: `Bearer ${token}` };
    expect(
      await (
        await fetch(`${api.url}/v1/verification/${run.id}`, { headers })
      ).json(),
    ).toEqual(run);
    expect(
      (await fetch(`${api.url}/v1/verifications/${run.id}/export`)).status,
    ).toBe(401);
    let offset = 0;
    let content = "";
    let artifactHash: string | undefined;
    do {
      const page = await fetch(
        `${api.url}/v1/verifications/${run.id}/export?offset=${offset}&limitBytes=128`,
        { headers },
      );
      expect(page.status).toBe(200);
      const value = (await page.json()) as {
        runId: string;
        snapshotId: string;
        evidenceId: string;
        runSha256: string;
        sha256: string;
        nextOffset: number | null;
        content: string;
      };
      expect(value.runId).toBe(run.id);
      expect(value.snapshotId).toBe(run.snapshotId);
      expect(value.evidenceId).toBe(run.evidence.id);
      expect(value.runSha256).toBe(run.evidence.source.sha256);
      artifactHash ??= value.sha256;
      expect(value.sha256).toBe(artifactHash);
      expect(Buffer.byteLength(value.content, "utf8")).toBeLessThanOrEqual(128);
      content += value.content;
      if (value.nextOffset === null) break;
      offset = value.nextOffset;
    } while (true);
    expect(JSON.parse(content)).toEqual(run);
    expect(sha256(content)).toBe(artifactHash);
    await verifyFormattedApiExports(api.url, headers, run);
    await client.connect(transport);
    const read = await client.callTool({
      name: "pie_verification_get",
      arguments: { id: run.id },
    });
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toEqual(run);
    let mcpOffset = 0;
    let mcpContent = "";
    let mcpHash: string | undefined;
    do {
      const page = await client.callTool({
        name: "pie_verification_export",
        arguments: { id: run.id, offset: mcpOffset, limitBytes: 128 },
      });
      expect(page.isError).not.toBe(true);
      const value = page.structuredContent as {
        runId: string;
        nextOffset: number | null;
        sha256: string;
        content: string;
      };
      expect(value.runId).toBe(run.id);
      mcpHash ??= value.sha256;
      expect(value.sha256).toBe(mcpHash);
      mcpContent += value.content;
      if (value.nextOffset === null) break;
      mcpOffset = value.nextOffset;
    } while (true);
    expect(JSON.parse(mcpContent)).toEqual(run);
    expect(mcpContent).toBe(content);
    await verifyFormattedAdapters(client, script, path, run);
    const listed = await client.callTool({
      name: "pie_verifications_list",
      arguments: { snapshotId: run.snapshotId, limit: 1 },
    });
    expect(listed.structuredContent).toMatchObject({
      total: 1,
      items: [{ id: run.id, state: "blocked" }],
    });
  } finally {
    await client.close();
    await api.close();
  }
}

async function legacyCompatibility(
  store: PiePersistence,
  run: VerificationRun,
) {
  if (run.schemaVersion !== 2) throw new Error("Expected new versioned run");
  const {
    evidence: _proof,
    authorization: _grant,
    authorizedRoot: _root,
    ...base
  } = run;
  const payload = { ...base, schemaVersion: 1 as const, id: randomUUID() };
  const snapshot = await store.snapshot(run.snapshotId);
  const legacy = {
    ...payload,
    evidence: runEvidence(payload, snapshot, "local"),
  };
  await store.saveVerification(legacy);
  const restored = await store.verification(legacy.id);
  expect(restored.schemaVersion).toBe(1);
  expect("authorization" in restored).toBe(false);
  expect(restored).toEqual(legacy);
  return legacy;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-run-store-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(
    join(repo, "sample.test.mjs"),
    "import {test} from 'node:test'; test('fixture', () => {});",
  );
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  return { root, repo };
}

async function exercise(store: PiePersistence, root: string, repo: string) {
  const service = new PieService(store);
  const discovery = await service.discover({
    profile: "OBSERVE",
    environment: "local",
    repositoryRoot: repo,
  });
  const snapshot = await store.snapshot(discovery.snapshot.id);
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: repo,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    image: `node@sha256:${"1".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testFiles: ["sample.test.mjs"],
    limits: {
      timeoutMs: 5000,
      memoryMiB: 256,
      cpus: 1,
      pids: 32,
      workspaceMiB: 64,
      outputBytes: 65536,
      sourceBytes: 100000,
    },
  };
  // A genuine unavailable executable, not a mocked runner or invented passed result.
  const owner = new NodeVerification({
    executable: join(root, "missing-docker"),
    endpoint: "unix:///var/run/docker.sock",
    temporaryParent: root,
  });
  const run = await owner.execute(grant, snapshot);
  await owner.close();
  expect(run.result.state).toBe("blocked");
  await store.saveVerification(run);
  await store.saveVerification(run);
  expect(
    exportVerificationResult(run, snapshot, {
      id: run.id,
      limitBytes: 3,
    }),
  ).toEqual({ ok: false, error: { kind: "invalid_input" } });
  expect(exportVerificationResult({}, snapshot, { id: run.id })).toEqual({
    ok: false,
    error: { kind: "invalid_run" },
  });
  expect(exportVerificationResult(run, snapshot, { id: randomUUID() })).toEqual(
    {
      ok: false,
      error: { kind: "policy_denied", reason: "run_id_mismatch" },
    },
  );
  expect(await service.verification(run.id)).toEqual(run);
  expect(await service.evidence(run.evidence.id)).toEqual(run.evidence);
  expect(await service.verifications(snapshot.id, { limit: 1 })).toMatchObject({
    total: 1,
    nextOffset: null,
    items: [{ id: run.id, state: "blocked" }],
  });
  expect(await store.snapshot(snapshot.id)).toEqual(snapshot);
  expect(await service.verifications(snapshot.id, { offset: 1 })).toMatchObject(
    { total: 1, items: [] },
  );
  expect(
    await service.projectVerifications(snapshot.projectId, { limit: 1 }),
  ).toMatchObject({
    total: 1,
    items: [{ id: run.id, snapshotId: snapshot.id, state: "blocked" }],
  });
  for (const change of [
    { projectId: randomUUID() },
    { image: `node@sha256:${"2".repeat(64)}` },
    { evidence: { ...run.evidence, revision: "0".repeat(40) } },
  ]) {
    await expect(
      Promise.resolve().then(() =>
        store.saveVerification({ ...run, ...change }),
      ),
    ).rejects.toThrow();
  }
  const { evidence: _oldProof, ...payload } = run;
  const alteredPayload = {
    ...payload,
    failure: { tag: "different", message: "different outcome" },
  };
  const altered = {
    ...alteredPayload,
    evidence: runEvidence(alteredPayload, snapshot, "local"),
  };
  await expect(
    Promise.resolve().then(() => store.saveVerification(altered)),
  ).rejects.toThrow("substituída");
  await expect(
    Promise.resolve().then(() => store.evidence(altered.evidence.id)),
  ).rejects.toThrow();
  // Valid sealed record whose evidence ID collides: database must roll back the run.
  const collisionPayload = { ...payload, id: randomUUID() };
  const { sha256: _proofDigest, ...collisionProof } = runEvidence(
    collisionPayload,
    snapshot,
    "local",
  );
  const collision = {
    ...collisionPayload,
    evidence: sealEvidence({ ...collisionProof, id: run.evidence.id }),
  };
  await expect(
    Promise.resolve().then(() => store.saveVerification(collision)),
  ).rejects.toThrow();
  await expect(
    Promise.resolve().then(() => store.verification(collision.id)),
  ).rejects.toThrow();
  expect((await store.verifications(snapshot.id)).total).toBe(1);
  return run;
}

it("SQLite registra execução/evidência atomicamente, imutáveis e reabríveis", async () => {
  const { root, repo } = await fixture();
  const path = join(root, "state.sqlite");
  let store = await openStore(path, repo);
  try {
    const run = await exercise(store, root, repo);
    await readAdapters(path, repo, run);
    const legacy = await legacyCompatibility(store, run);
    const sql = new DatabaseSync(path);
    try {
      expect(() =>
        sql
          .prepare("UPDATE pie_verification_runs SET created_at=? WHERE id=?")
          .run(new Date().toISOString(), run.id),
      ).toThrow("immutable");
      expect(() =>
        sql.prepare("DELETE FROM pie_verification_runs WHERE id=?").run(run.id),
      ).toThrow("immutable");
      expect(() =>
        sql.prepare("DELETE FROM pie_evidence WHERE id=?").run(run.evidence.id),
      ).toThrow();
    } finally {
      sql.close();
    }
    store.close();
    store = await openStore(path, repo);
    expect(await store.verification(run.id)).toEqual(run);
    expect(await store.verification(legacy.id)).toEqual(legacy);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

const url = process.env.PIE_TEST_DATABASE_URL;
it.skipIf(!url)(
  "PostgreSQL real mantém execução/evidência atômicas e imutáveis",
  async () => {
    if (!new URL(url!).pathname.endsWith("_test"))
      throw new Error("Use banco dedicado _test.");
    const { root, repo } = await fixture();
    const store = new PostgresPieStore(url!);
    const pool = new Pool({ connectionString: url!, max: 1 });
    try {
      await store.connect();
      const run = await exercise(store, root, repo);
      await legacyCompatibility(store, run);
      await expect(
        pool.query(
          "UPDATE pie_verification_runs SET created_at=now() WHERE id=$1",
          [run.id],
        ),
      ).rejects.toThrow("immutable");
      await expect(
        pool.query("DELETE FROM pie_verification_runs WHERE id=$1", [run.id]),
      ).rejects.toThrow("immutable");
      const peer = new PostgresPieStore(url!);
      try {
        await peer.connect();
        await peer.saveVerification(run);
        expect(await peer.verification(run.id)).toEqual(run);
      } finally {
        await peer.close();
      }
    } finally {
      await store.close();
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
