import { DatabaseSync } from "node:sqlite";
import { open, lstat, realpath, readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  observeProcessStartIdentity,
  observeProcessStartIdentityExit,
} from "../../process/ProcessOwnershipObservation.js";
import type { DockerResourceEvent } from "./dockerExecution.js";
import { sha256 } from "../evidence.js";
import { validateDockerClientSelection } from "./dockerCommand.js";

export const resourceRecordSchema = z
  .strictObject({
    runId: z.string().uuid(),
    name: z.string(),
    root: z.string().refine(isAbsolute),
    device: z.string(),
    inode: z.string(),
    pid: z.number().int().positive(),
    processIdentity: z.string().min(1),
    machineIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    bootIdentity: z.string().uuid(),
    endpoint: z.string(),
    executable: z.string(),
    phase: z.enum(["prepared", "creating", "created", "removed"]),
    containerId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(
    (record) => record.phase !== "created" || record.containerId !== null,
    { message: "Contêiner criado exige ID comprovado." },
  );
export type ResourceRecord = z.infer<typeof resourceRecordSchema>;

async function hostIdentity() {
  const machine = (await readFile("/etc/machine-id", "utf8")).trim();
  const bootIdentity = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim();
  if (
    !/^[a-f0-9]{32}$/.test(machine) ||
    !z.string().uuid().safeParse(bootIdentity).success
  )
    throw new AnalysisOutputError(
      "pie.journal",
      "Identidade do host não comprovada.",
    );
  return { machineIdentity: sha256(machine), bootIdentity };
}

/** Private local journal survives process exit; resource identity is distinct from readiness. */
export class VerificationJournal {
  private constructor(private readonly db: DatabaseSync) {}
  static async open(path: string): Promise<VerificationJournal> {
    if (process.platform !== "linux")
      throw new AnalysisCapabilityUnavailableError(
        "journal",
        "pie.verify",
        "Journal de recuperação implementado somente para Linux; demais hosts não comprovados.",
      );
    if (!isAbsolute(path))
      throw new AnalysisOutputError(
        "pie.journal",
        "Caminho absoluto requerido.",
      );
    const parent = await realpath(dirname(path));
    const stat = await lstat(parent);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new AnalysisOutputError(
        "pie.journal",
        "Journal exige diretório privado do usuário.",
      );
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.close();
    } catch (cause) {
      if (
        !(
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "EEXIST"
        )
      )
        throw cause;
    }
    const file = await lstat(path);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.uid !== stat.uid ||
      (file.mode & 0o077) !== 0
    )
      throw new AnalysisOutputError(
        "pie.journal",
        "Arquivo do journal não é privado ou regular.",
      );
    const db = new DatabaseSync(path);
    try {
      db.exec(`PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS pie_resource_journal(run_id TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
      return new VerificationJournal(db);
    } catch (cause) {
      db.close();
      throw cause;
    }
  }
  async register(input: {
    runId: string;
    root: string;
    endpoint: string;
    executable: string;
  }): Promise<ResourceRecord> {
    const processIdentity = await observeProcessStartIdentity(process.pid);
    if (processIdentity?.state !== "readable")
      throw new AnalysisOutputError(
        "pie.journal",
        "Identidade de início do processo não comprovada.",
      );
    const root = await realpath(input.root);
    validateDockerClientSelection(input.executable, input.endpoint, root);
    const stat = await lstat(root, { bigint: true });
    if (
      !stat.isDirectory() ||
      Number(stat.uid) !== process.getuid?.() ||
      (Number(stat.mode) & 0o077) !== 0
    )
      throw new AnalysisOutputError(
        "pie.journal",
        "Raiz de execução não é privada.",
      );
    const now = new Date().toISOString();
    const record = resourceRecordSchema.parse({
      ...input,
      ...(await hostIdentity()),
      root,
      name: `pie-verify-${input.runId}`,
      device: String(stat.dev),
      inode: String(stat.ino),
      pid: process.pid,
      processIdentity: processIdentity.identity,
      phase: "prepared",
      containerId: null,
      createdAt: now,
      updatedAt: now,
    });
    this.db
      .prepare("INSERT INTO pie_resource_journal(run_id,payload) VALUES(?,?)")
      .run(record.runId, JSON.stringify(record));
    return record;
  }
  get(runId: string): ResourceRecord {
    const row = this.db
      .prepare("SELECT payload FROM pie_resource_journal WHERE run_id=?")
      .get(runId);
    if (!row)
      throw new AnalysisOutputError("pie.journal", "Recurso não registrado.");
    const record = resourceRecordSchema.parse(JSON.parse(String(row.payload)));
    if (record.runId !== runId || record.name !== `pie-verify-${runId}`)
      throw new AnalysisOutputError(
        "pie.journal",
        "Identidade do registro inconsistente.",
      );
    return record;
  }
  event(runId: string, event: DockerResourceEvent): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(runId);
      const allowed =
        previous.phase === event.phase ||
        (previous.phase === "prepared" && event.phase === "creating") ||
        (previous.phase === "creating" && event.phase === "created") ||
        event.phase === "removed";
      if (
        !allowed ||
        (previous.containerId &&
          event.containerId &&
          previous.containerId !== event.containerId) ||
        (previous.phase === "removed" && event.phase !== "removed")
      )
        throw new AnalysisOutputError(
          "pie.journal",
          "Transição de ownership inválida.",
        );
      const record = resourceRecordSchema.parse({
        ...previous,
        phase: event.phase,
        containerId: event.containerId ?? previous.containerId,
        updatedAt: new Date().toISOString(),
      });
      this.db
        .prepare("UPDATE pie_resource_journal SET payload=? WHERE run_id=?")
        .run(JSON.stringify(record), runId);
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }
  async ownerStatus(
    runId: string,
  ): Promise<"exited" | "present" | "unverified"> {
    const record = this.get(runId);
    try {
      const host = await hostIdentity();
      if (host.machineIdentity !== record.machineIdentity) return "unverified";
      if (host.bootIdentity !== record.bootIdentity) return "exited";
    } catch {
      return "unverified";
    }
    return observeProcessStartIdentityExit(record.pid, record.processIdentity);
  }
  list(input: { offset: number; limit: number } = { offset: 0, limit: 50 }) {
    const { offset, limit } = z
      .strictObject({
        offset: z.number().int().nonnegative(),
        limit: z.number().int().min(1).max(200),
      })
      .parse(input);
    return this.db
      .prepare(
        "SELECT run_id FROM pie_resource_journal ORDER BY run_id LIMIT ? OFFSET ?",
      )
      .all(limit, offset)
      .map((row) => this.get(String(row.run_id)));
  }
  close(): void {
    this.db.close();
  }
}
