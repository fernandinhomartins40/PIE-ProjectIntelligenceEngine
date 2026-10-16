import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { openStore } from "../../src/pie/store.js";
import { verifyRunEvidence } from "../../src/pie/execution/runEvidence.js";
import { verificationRunSchema } from "../../src/pie/execution/runContracts.js";

const script = resolve("scripts/pie.mjs");
function cli(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (accept, reject) => {
      execFile(
        process.execPath,
        [script, ...args],
        { timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") reject(error);
          else
            accept({
              code: typeof error?.code === "number" ? error.code : 0,
              stdout,
              stderr,
            });
        },
      );
    },
  );
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-verify-cli-"));
  const repo = join(root, "repo");
  const state = join(root, "state");
  const db = join(root, "history.sqlite");
  await mkdir(repo);
  await mkdir(state, { mode: 0o700 });
  await promisify(execFile)("git", ["init", repo]);
  const code =
    "import {test} from 'node:test'; test('fixture verified', () => {});";
  await writeFile(join(repo, "sample.test.mjs"), code);
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const discovery = await cli(["discover", repo, "--db", db]);
  if (discovery.code !== 0) throw new Error(discovery.stderr);
  const id = (JSON.parse(discovery.stdout) as { snapshot: { id: string } })
    .snapshot.id;
  const store = await openStore(db, repo);
  const snapshot = store.snapshot(id);
  store.close();
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: repo,
    snapshotId: id,
    treeDigest: snapshot.treeDigest,
    image: process.env.PIE_TEST_DOCKER_IMAGE ?? `node@sha256:${"1".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testFiles: ["sample.test.mjs"],
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
  const file = join(root, "grant.json");
  await writeFile(file, JSON.stringify(grant));
  return { root, repo, state, db, code, file, snapshot };
}

it.skipIf(process.platform === "linux")(
  "CLI recusa recursos VERIFY em plataforma não comprovada sem criar estado",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-cli-unsupported-"));
    try {
      const output = await cli(["resources", "--state-dir", root]);
      expect(output.code).toBe(1);
      expect(JSON.parse(output.stderr)).toMatchObject({
        error: { code: "POLICY_DENIED" },
      });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "CLI recusa estado dentro do alvo antes de criar journal ou executar Docker",
  async () => {
    const { root, repo, db, file } = await fixture();
    const state = join(repo, "state");
    await mkdir(state, { mode: 0o700 });
    try {
      const output = await cli([
        "verify",
        file,
        "--db",
        db,
        "--state-dir",
        state,
        "--docker-bin",
        "/missing/docker",
        "--docker-host",
        "unix:///var/run/docker.sock",
      ]);
      expect(output.code).toBe(1);
      expect(JSON.parse(output.stderr)).toMatchObject({
        error: { code: "POLICY_DENIED" },
      });
      expect(await readdir(state)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "linux" || !process.env.PIE_TEST_DOCKER_IMAGE)(
  "CLI executa grant real, persiste prova, lista recursos sem tokens e mantém stale snapshot bloqueado",
  async () => {
    const { root, repo, state, db, code, file, snapshot } = await fixture();
    const executable = (
      await promisify(execFile)("which", ["docker"])
    ).stdout.trim();
    const options = [
      "--db",
      db,
      "--state-dir",
      state,
      "--docker-bin",
      executable,
      "--docker-host",
      "unix:///var/run/docker.sock",
    ];
    try {
      const executed = await cli(["verify", file, ...options]);
      expect(executed.code, executed.stderr).toBe(0);
      const run = verifyRunEvidence(
        verificationRunSchema.parse(JSON.parse(executed.stdout)),
      );
      expect(run).toMatchObject({
        result: { state: "passed" },
        cleanup: "complete",
      });
      const read = await cli(["verification", run.id, "--db", db]);
      expect(JSON.parse(read.stdout)).toEqual(run);
      const resources = await cli(["resources", "--state-dir", state]);
      expect(resources.code).toBe(0);
      expect(resources.stdout).not.toContain("rootToken");
      expect(JSON.parse(resources.stdout)).toMatchObject({
        items: [
          {
            runId: run.id,
            phase: "removed",
            rootRemovedAt: expect.any(String),
          },
        ],
      });
      expect(await readFile(join(repo, "sample.test.mjs"), "utf8")).toBe(code);
      const recovered = await cli(["recover", run.id, ...options]);
      expect(recovered.code, recovered.stderr).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({ state: "complete" });
      await writeFile(join(repo, "sample.test.mjs"), "changed after snapshot");
      const stale = await cli(["verify", file, ...options]);
      expect(stale.code).toBe(1);
      expect(JSON.parse(stale.stdout)).toMatchObject({
        result: { state: "blocked" },
      });
      const store = await openStore(db, repo);
      try {
        expect(store.verifications(snapshot.id).total).toBe(2);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
