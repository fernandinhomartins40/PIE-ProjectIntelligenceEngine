import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { discoverProject } from "../../src/pie/discovery.js";
import { NodeVerification } from "../../src/pie/execution/verification.js";
import { verifyRunEvidence } from "../../src/pie/execution/runEvidence.js";
import { openStore } from "../../src/pie/store.js";
import { PostgresPieStore } from "../../src/pie/postgresStore.js";
import type { PiePersistence } from "../../src/pie/persistence.js";
import { VerificationJournal } from "../../src/pie/execution/resourceJournal.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-verification-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  const code =
    "import {test} from 'node:test'; test('executed fixture', () => {});";
  await writeFile(join(repo, "fixture.test.mjs"), code);
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const snapshot = await discoverProject(
    { profile: "OBSERVE", environment: "local", repositoryRoot: repo },
    randomUUID(),
  );
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
    testFiles: ["fixture.test.mjs"],
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
  return { root, repo, code, snapshot, grant };
}

it("fluxo indisponível retorna prova blocked, preserva projeto e remove recursos", async () => {
  const { root, repo, code, snapshot, grant } = await fixture();
  const owner = new NodeVerification({
    executable: join(root, "missing-docker"),
    endpoint: "unix:///var/run/docker.sock",
    temporaryParent: root,
  });
  try {
    const run = await owner.execute(grant, snapshot);
    expect(run).toMatchObject({
      cleanup: "complete",
      result: { state: "blocked" },
      evidence: {
        state: "blocked",
        auditRunId: run.id,
        snapshotId: snapshot.id,
      },
    });
    expect(verifyRunEvidence(run)).toEqual(run);
    expect(() => verifyRunEvidence({ ...run, image: "different" })).toThrow();
    expect(() =>
      verifyRunEvidence({ ...run, authorizationDigest: "0".repeat(64) }),
    ).toThrow();
    expect(() =>
      verifyRunEvidence({ ...run, result: { ...run.result, state: "passed" } }),
    ).toThrow();
    expect(() =>
      verifyRunEvidence({ ...run, projectId: randomUUID() }),
    ).toThrow();
    expect(await readFile(join(repo, "fixture.test.mjs"), "utf8")).toBe(code);
    expect(await readdir(root)).toEqual(["repo"]);
    await expect(owner.execute(grant, snapshot)).rejects.toThrow();
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(!process.env.PIE_TEST_DOCKER_IMAGE || process.platform !== "linux")(
  "descoberta, cópia privada, execução e evidência usam o mesmo snapshot real",
  async () => {
    const { root, repo, code, snapshot, grant } = await fixture();
    const executable = (
      await promisify(execFile)("which", ["docker"])
    ).stdout.trim();
    const journal = await VerificationJournal.open(
      join(root, "journal.sqlite"),
    );
    const owner = new NodeVerification({
      executable,
      endpoint: "unix:///var/run/docker.sock",
      temporaryParent: root,
      journal,
    });
    try {
      const run = await owner.execute(grant, snapshot);
      expect(run).toMatchObject({
        cleanup: "complete",
        failure: null,
        result: { state: "passed", counts: { passed: 1 } },
        evidence: {
          method: "test",
          state: "verified",
          auditRunId: run.id,
          snapshotId: snapshot.id,
        },
      });
      verifyRunEvidence(run);
      expect(journal.get(run.id)).toMatchObject({
        phase: "removed",
        runId: run.id,
      });
      const stores: PiePersistence[] = [
        await openStore(join(root, "runs.sqlite"), repo),
      ];
      try {
        const url = process.env.PIE_TEST_DATABASE_URL;
        if (url) {
          if (!new URL(url).pathname.endsWith("_test"))
            throw new Error("Use banco dedicado _test.");
          const postgres = new PostgresPieStore(url);
          stores.push(postgres);
          await postgres.connect();
        }
        for (const store of stores) {
          await store.addProject(snapshot.projectId, snapshot.root, "fixture");
          await store.saveSnapshot(snapshot);
          await store.saveVerification(run);
          expect(await store.verification(run.id)).toEqual(run);
          expect(await store.evidence(run.evidence.id)).toEqual(run.evidence);
        }
      } finally {
        await Promise.all(stores.map((store) => store.close()));
      }
      expect(await readFile(join(repo, "fixture.test.mjs"), "utf8")).toBe(code);
      expect((await readdir(root)).sort()).toEqual([
        "journal.sqlite",
        "repo",
        "runs.sqlite",
      ]);
    } finally {
      await owner.close();
      journal.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
