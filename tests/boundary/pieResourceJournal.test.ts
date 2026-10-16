import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
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
    const script = join(root, "child.mjs");
    const moduleUrl = pathToFileURL(
      resolve("dist/pie/execution/resourceJournal.js"),
    ).href;
    await writeFile(
      script,
      `import {VerificationJournal} from ${JSON.stringify(moduleUrl)};
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=process.argv[2]; const workspace=join(root,'orphan'); await mkdir(workspace,{mode:0o700});
const journal=await VerificationJournal.open(join(root,'journal.sqlite'));
const record=await journal.register({runId:randomUUID(),root:workspace,endpoint:'unix:///var/run/docker.sock',executable:'/usr/bin/docker'});
journal.event(record.runId,{phase:'creating',containerId:null});
process.stdout.write(JSON.stringify(record),()=>process.exit(0));
`,
    );
    try {
      const output = await promisify(execFile)(
        process.execPath,
        [script, root],
        { timeout: 10_000, maxBuffer: 100_000 },
      );
      const { runId } = JSON.parse(output.stdout) as { runId: string };
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
