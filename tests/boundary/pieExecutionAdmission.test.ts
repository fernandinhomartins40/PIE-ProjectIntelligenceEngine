import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { discoverProject } from "../../src/pie/discovery.js";
import { admitNodeTests } from "../../src/pie/execution/admission.js";
import { prepareWorkspace } from "../../src/pie/execution/workspace.js";
import {
  PrivateRuntimeRoot,
  privateRuntimeRootCapability,
} from "../../src/process/PrivateRuntimeRoot.js";
import type { Snapshot } from "../../src/pie/contracts.js";
import { sealEvidence, sha256 } from "../../src/pie/evidence.js";
import { DatabaseSync } from "node:sqlite";
import { openVerificationPersistence } from "../../src/pie/openPersistence.js";
import type { NodeTestGrant } from "../../src/pie/execution/contracts.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-execution-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(
    join(repo, "sample.test.mjs"),
    "import { test } from 'node:test'; test('real', () => {});\n",
  );
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const snapshot = await discoverProject(
    { repositoryRoot: repo, profile: "OBSERVE", environment: "local" },
    randomUUID(),
  );
  return { root, repo, snapshot };
}
function grant(snapshot: Snapshot): NodeTestGrant {
  return {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: snapshot.root,
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
      outputBytes: 65_536,
      sourceBytes: 1_000_000,
    },
  };
}

it("pré-leitura da autorização não migra banco dentro do alvo nem sob raiz divergente", async () => {
  const { root, repo, snapshot } = await fixture();
  const path = join(repo, "misplaced.sqlite");
  const sql = new DatabaseSync(path);
  sql.exec(
    "CREATE TABLE pie_snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
  );
  sql
    .prepare("INSERT INTO pie_snapshots(id,payload) VALUES(?,?)")
    .run(snapshot.id, JSON.stringify(snapshot));
  const other = join(root, "other");
  await mkdir(other);
  vi.stubEnv("PIE_DATABASE_URL", "");
  try {
    await expect(
      openVerificationPersistence(path, {
        ...grant(snapshot),
        repositoryRoot: other,
      }),
    ).rejects.toThrow();
    await expect(
      openVerificationPersistence(path, grant(snapshot)),
    ).rejects.toThrow("fora do projeto");
    expect(
      sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
    ).toEqual([{ name: "pie_snapshots" }]);
  } finally {
    vi.unstubAllEnvs();
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("vincula autorização a conteúdo, raiz, validade, testes e limites exatos", async () => {
  const { root, repo, snapshot } = await fixture();
  const input = grant(snapshot);
  try {
    expect((await admitNodeTests(input, snapshot)).ok).toBe(true);
    for (const change of [
      { profile: "OBSERVE" },
      { allowTargetExecution: false },
      { environment: "production" },
      { image: "node:latest" },
      { expiresAt: "2000-01-01T00:00:00.000Z" },
      { repositoryRoot: root },
      { snapshotId: randomUUID() },
      { treeDigest: "0".repeat(64) },
      { testFiles: ["../sample.test.mjs"] },
      { testFiles: ["missing.mjs"] },
      { testFiles: ["sample.test.mjs", "sample.test.mjs"] },
      { command: "shell" },
      { limits: { ...input.limits, pids: 0 } },
    ])
      expect((await admitNodeTests({ ...input, ...change }, snapshot)).ok).toBe(
        false,
      );
    expect(
      (
        await admitNodeTests(input, {
          ...snapshot,
          coverage: { ...snapshot.coverage, status: "partial" },
        })
      ).ok,
    ).toBe(false);
    const node = snapshot.nodes[0]!;
    const duplicate = { ...node, id: "another-id" };
    const duplicateSnapshot = {
      ...snapshot,
      nodes: [node, duplicate],
      treeDigest: sha256(
        JSON.stringify([
          [node.path, snapshot.evidence[0]!.source.sha256],
          [node.path, snapshot.evidence[0]!.source.sha256],
        ]),
      ),
    };
    expect(
      (
        await admitNodeTests(
          { ...input, treeDigest: duplicateSnapshot.treeDigest },
          duplicateSnapshot,
        )
      ).ok,
    ).toBe(false);
    const { sha256: _oldHash, ...payload } = snapshot.evidence[0]!;
    const conflicting = sealEvidence({
      ...payload,
      id: randomUUID(),
      source: { ...payload.source, sha256: "0".repeat(64) },
    });
    expect(
      (
        await admitNodeTests(input, {
          ...snapshot,
          nodes: [
            { ...node, evidenceIds: [...node.evidenceIds, conflicting.id] },
          ],
          evidence: [...snapshot.evidence, conflicting],
        })
      ).ok,
    ).toBe(false);
    expect(await readFile(join(repo, "sample.test.mjs"), "utf8")).toContain(
      "test('real'",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("prepara cópia privada por hash, detecta conteúdo alterado e limpa após cancelamento", async () => {
  const { root, repo, snapshot } = await fixture();
  try {
    const admitted = await admitNodeTests(grant(snapshot), snapshot);
    if (!admitted.ok) throw admitted.error;
    const result = await prepareWorkspace(admitted.value, root);
    if (!privateRuntimeRootCapability().available) {
      expect(result).toMatchObject({
        ok: false,
        error: {
          cause: { _tag: "AnalysisCapabilityUnavailableError" },
          cleanupOwner: null,
        },
      });
      return;
    }
    if (!result.ok) throw result.error.cause;
    try {
      expect(result.value).toMatchObject({ files: 1 });
      expect(await realpath(result.value.directory)).not.toBe(
        await realpath(repo),
      );
      expect(
        await readFile(join(result.value.directory, "sample.test.mjs")),
      ).toEqual(await readFile(join(repo, "sample.test.mjs")));
    } finally {
      await result.value.close();
      await result.value.close();
    }
    await writeFile(join(repo, "sample.test.mjs"), "changed");
    expect(await prepareWorkspace(admitted.value, root)).toMatchObject({
      ok: false,
      error: {
        cause: { _tag: "AnalysisArtifactChangedError" },
        cleanupOwner: null,
      },
    });
    const signal = AbortSignal.abort();
    expect(await prepareWorkspace(admitted.value, root, signal)).toMatchObject({
      ok: false,
      error: { cause: { _tag: "AnalysisCancelledError" }, cleanupOwner: null },
    });
    expect(await prepareWorkspace(admitted.value, repo)).toMatchObject({
      ok: false,
      error: { cause: { _tag: "AnalysisOutputError" }, cleanupOwner: null },
    });
    expect((await readdir(root)).sort()).toEqual(["repo"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "recusa links trocados após a observação e limite de cópia, sem resíduos",
  async () => {
    const { root, repo, snapshot } = await fixture();
    try {
      const admitted = await admitNodeTests(grant(snapshot), snapshot);
      if (!admitted.ok) throw admitted.error;
      const limited = {
        ...admitted.value,
        grant: {
          ...admitted.value.grant,
          limits: { ...admitted.value.grant.limits, sourceBytes: 1 },
        },
      };
      expect(await prepareWorkspace(limited, root)).toMatchObject({
        ok: false,
        error: {
          cause: { _tag: "AnalysisResourceConstraintError" },
          cleanupOwner: null,
        },
      });
      await writeFile(join(root, "outside.mjs"), "outside");
      await rm(join(repo, "sample.test.mjs"));
      await symlink(join(root, "outside.mjs"), join(repo, "sample.test.mjs"));
      expect((await prepareWorkspace(admitted.value, root)).ok).toBe(false);
      expect((await readdir(root)).sort()).toEqual(["outside.mjs", "repo"]);
      expect(await readFile(join(root, "outside.mjs"), "utf8")).toBe("outside");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(!privateRuntimeRootCapability().available)(
  "retém o dono quando a limpeza falha e permite retry após cancelamento na finalização",
  async () => {
    const { root, repo, snapshot } = await fixture();
    const controller = new AbortController();
    const close = PrivateRuntimeRoot.prototype.close;
    const failure = vi
      .spyOn(PrivateRuntimeRoot.prototype, "close")
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error("fixture: cleanup interrupted");
      });
    try {
      const admitted = await admitNodeTests(grant(snapshot), snapshot);
      if (!admitted.ok) throw admitted.error;
      await writeFile(join(repo, "sample.test.mjs"), "changed");
      const result = await prepareWorkspace(
        admitted.value,
        root,
        controller.signal,
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          cause: { _tag: "AnalysisArtifactChangedError" },
          cleanupFailure: { _tag: "AnalysisOutputError" },
        },
      });
      if (result.ok || !result.error.cleanupOwner)
        throw new Error("Missing cleanup owner");
      expect(await readdir(root)).toHaveLength(2);
      await close.call(result.error.cleanupOwner);
      expect(await readdir(root)).toEqual(["repo"]);
    } finally {
      failure.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
