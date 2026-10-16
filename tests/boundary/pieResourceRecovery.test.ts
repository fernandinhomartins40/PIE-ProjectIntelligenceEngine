import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { VerificationJournal } from "../../src/pie/execution/resourceJournal.js";
import { ResourceRecovery } from "../../src/pie/execution/resourceRecovery.js";
import { DockerCommand } from "../../src/pie/execution/dockerCommand.js";
import { orphanFixture } from "./pieOrphanFixture.js";
import type { ProviderProcessSnapshot } from "../../src/process/ProviderProcess.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const output = (text: string): ProviderProcessSnapshot => ({
  stdout: {
    text,
    bytes: Buffer.byteLength(text),
    observedBytes: Buffer.byteLength(text),
  },
  stderr: { text: "", bytes: 0, observedBytes: 0 },
  exitCode: 0,
  signal: null,
});

it.skipIf(process.platform !== "linux" || !process.env.PIE_TEST_DOCKER_IMAGE)(
  "Docker real recupera contêiner após saída abrupta antes de iniciar testes",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-recover-real-"));
    const executable = (
      await promisify(execFile)("which", ["docker"])
    ).stdout.trim();
    const record = await orphanFixture(root, "prepared", {
      image: process.env.PIE_TEST_DOCKER_IMAGE!,
      executable,
    });
    const journal = await VerificationJournal.open(
      join(root, "journal.sqlite"),
    );
    const config = join(root, "recovery-config");
    await mkdir(config, { mode: 0o700 });
    const recovery = new ResourceRecovery(
      journal,
      new DockerCommand(executable, "unix:///var/run/docker.sock", config),
      record.runId,
    );
    let cleaned = false;
    try {
      expect(journal.get(record.runId).phase).toBe("created");
      expect(await journal.ownerStatus(record.runId)).toBe("exited");
      expect(await recovery.recover()).toMatchObject({ state: "complete" });
      cleaned = true;
      const id = journal.get(record.runId).containerId!;
      const listed = await promisify(execFile)(
        executable,
        [
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          `id=${id}`,
          "--format",
          "{{.ID}}",
        ],
        { timeout: 10000 },
      );
      expect(listed.stdout.trim()).toBe("");
      expect(journal.get(record.runId).rootRemovedAt).not.toBeNull();
    } finally {
      if (!cleaned) cleaned = (await recovery.recover()).state === "complete";
      journal.close();
      if (cleaned) await rm(root, { recursive: true, force: true });
    }
  },
  40_000,
);

it.skipIf(process.platform !== "linux")(
  "recuperação remove somente raiz owned, registra conclusão e não repete limpeza",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-recover-"));
    const record = await orphanFixture(root, "prepared");
    const journal = await VerificationJournal.open(
      join(root, "journal.sqlite"),
    );
    const client = new DockerCommand(
      "/usr/bin/docker",
      "unix:///var/run/docker.sock",
      root,
    );
    const recovery = new ResourceRecovery(journal, client, record.runId);
    try {
      await writeFile(join(root, "retained.txt"), "user fixture");
      expect(await recovery.recover()).toMatchObject({ state: "complete" });
      expect(journal.get(record.runId)).toMatchObject({
        phase: "removed",
        rootRemovedAt: expect.any(String),
      });
      await mkdir(record.root, { mode: 0o700 });
      await writeFile(join(record.root, "foreign.txt"), "new directory");
      expect(await recovery.recover()).toMatchObject({ state: "complete" });
      expect(await readFile(join(record.root, "foreign.txt"), "utf8")).toBe(
        "new directory",
      );
      expect(await readFile(join(root, "retained.txt"), "utf8")).toBe(
        "user fixture",
      );
    } finally {
      journal.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "criação incerta retém raiz e retry recupera handshake tardio e falha de remoção",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-recover-late-"));
    const record = await orphanFixture(root);
    const journal = await VerificationJournal.open(
      join(root, "journal.sqlite"),
    );
    const client = new DockerCommand(
      "/usr/bin/docker",
      "unix:///var/run/docker.sock",
      root,
    );
    const calls = vi.spyOn(client, "run").mockResolvedValueOnce(output(""));
    const recovery = new ResourceRecovery(journal, client, record.runId);
    try {
      expect(await recovery.recover()).toMatchObject({ state: "blocked" });
      const id = "1".repeat(64);
      const inspect = JSON.stringify([
        {
          Id: id,
          Name: `/pie-verify-${record.runId}`,
          Config: { Labels: { "io.pie.verify.run": record.runId } },
        },
      ]);
      calls
        .mockResolvedValueOnce(output(id))
        .mockResolvedValueOnce(output(inspect))
        .mockResolvedValueOnce({ ...output(""), exitCode: 1 });
      expect(await recovery.recover()).toMatchObject({ state: "blocked" });
      expect(journal.get(record.runId).phase).toBe("created");
      calls
        .mockResolvedValueOnce(output(id))
        .mockResolvedValueOnce(output(inspect))
        .mockResolvedValueOnce(output(id));
      expect(await recovery.recover()).toMatchObject({ state: "complete" });
      expect(calls.mock.calls.at(-1)![0]).toEqual([
        "container",
        "rm",
        "--force",
        id,
      ]);
      expect(journal.get(record.runId).rootRemovedAt).not.toBeNull();
    } finally {
      journal.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
