import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { orphanFixture } from "./pieOrphanFixture.js";
import { expect, it } from "vitest";
import { VerificationJournal } from "../../src/pie/execution/resourceJournal.js";

it.skipIf(process.platform !== "linux")(
  "journal privado sobrevive reabertura e mantém transições e identidade do dono",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-journal-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { mode: 0o700 });
    const path = join(root, "journal.sqlite");
    let journal = await VerificationJournal.open(path);
    const runId = randomUUID();
    try {
      await journal.register({
        runId,
        root: workspace,
        endpoint: "unix:///var/run/docker.sock",
        executable: "/usr/bin/docker",
      });
      expect(await journal.ownerStatus(runId)).toBe("present");
      await expect(journal.claimRecovery(runId)).rejects.toThrow("vivo");
      journal.event(runId, { phase: "creating", containerId: null });
      const id = "1".repeat(64);
      journal.event(runId, { phase: "created", containerId: id });
      journal.close();
      journal = await VerificationJournal.open(path);
      expect(journal.get(runId)).toMatchObject({
        phase: "created",
        containerId: id,
        pid: process.pid,
      });
      expect(() =>
        journal.event(runId, { phase: "created", containerId: "2".repeat(64) }),
      ).toThrow();
      journal.event(runId, { phase: "removed", containerId: id });
      expect(() =>
        journal.event(runId, { phase: "creating", containerId: null }),
      ).toThrow();
      expect(journal.list()).toHaveLength(1);
      await expect(
        journal.register({
          runId: randomUUID(),
          root: workspace,
          endpoint: "tcp://credential@remote:2375",
          executable: "/usr/bin/docker",
        }),
      ).rejects.toThrow();
      expect(journal.list()).toHaveLength(1);
      expect(journal.list({ offset: 1, limit: 1 })).toEqual([]);
      await chmod(path, 0o644);
      await expect(VerificationJournal.open(path)).rejects.toThrow("privado");
      await chmod(path, 0o600);
      await expect(journal.finishLive(runId)).rejects.toThrow("existe");
      await rm(workspace, { recursive: true });
      await journal.finishLive(runId);
      expect(journal.get(runId).rootRemovedAt).not.toBeNull();
    } finally {
      journal.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "processo real deixa journal durável e sua saída é reconhecida sem depender só do PID",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-journal-exit-"));
    try {
      const { runId } = await orphanFixture(root);
      const journal = await VerificationJournal.open(
        join(root, "journal.sqlite"),
      );
      try {
        expect(await journal.ownerStatus(runId)).toBe("exited");
        expect(journal.get(runId)).toMatchObject({
          phase: "creating",
          containerId: null,
        });
        // Owner exit does not prove that a delayed daemon-side create was absent.
        expect(journal.list()).toHaveLength(1);
        const peer = await VerificationJournal.open(
          join(root, "journal.sqlite"),
        );
        try {
          const attempts = await Promise.allSettled([
            journal.claimRecovery(runId),
            peer.claimRecovery(runId),
          ]);
          expect(
            attempts.filter((result) => result.status === "fulfilled"),
          ).toHaveLength(1);
          const claimed = attempts.find(
            (result) => result.status === "fulfilled",
          );
          if (!claimed || claimed.status !== "fulfilled")
            throw new Error("Missing recovery claim");
          const claim = claimed.value;
          expect(await journal.rootStatus(runId, claim.token)).toBe("owned");
          const record = journal.get(runId);
          expect(() => journal.assertClaim(runId, randomUUID())).toThrow();
          expect(() =>
            journal.event(runId, { phase: "removed", containerId: null }),
          ).toThrow();
          await writeFile(join(record.root, ".pie-owner"), "foreign");
          expect(await journal.rootStatus(runId, claim.token)).toBe(
            "unverified",
          );
          await writeFile(join(record.root, ".pie-owner"), record.rootToken!);
          const moved = join(root, "retained-original");
          await rename(record.root, moved);
          await mkdir(record.root, { mode: 0o700 });
          expect(await journal.rootStatus(runId, claim.token)).toBe(
            "unverified",
          );
          await rm(record.root, { recursive: true });
          await rename(moved, record.root);
          expect(await journal.rootStatus(runId, claim.token)).toBe("owned");
          journal.event(
            runId,
            { phase: "removed", containerId: null },
            claim.token,
          );
          await rm(record.root, { recursive: true });
          expect(await journal.rootStatus(runId, claim.token)).toBe("absent");
          await chmod(root, 0o755);
          expect(await journal.rootStatus(runId, claim.token)).toBe(
            "unverified",
          );
          await chmod(root, 0o700);
        } finally {
          peer.close();
        }
      } finally {
        journal.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "linux")(
  "journal recusa plataforma sem controles de recuperação comprovados",
  async () => {
    await expect(
      VerificationJournal.open(resolve("not-created.sqlite")),
    ).rejects.toMatchObject({ _tag: "AnalysisCapabilityUnavailableError" });
  },
);
