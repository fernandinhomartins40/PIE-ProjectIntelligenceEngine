import { DatabaseSync } from "node:sqlite";
import { open, lstat, realpath, readFile, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
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
import { readInventoryFile } from "../readFile.js";

export const resourceRecordSchema = z
  .strictObject({
    runId: z.string().uuid(),
    name: z.string(),
    root: z.string().refine(isAbsolute),
    device: z.string(),
    inode: z.string(),
    rootToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
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
    rootRemovedAt: z.iso.datetime().nullable().default(null),
  })
  .refine(
    (record) => record.phase !== "created" || record.containerId !== null,
    { message: "Contêiner criado exige ID comprovado." },
  );
export type ResourceRecord = z.infer<typeof resourceRecordSchema>;
const actorSchema = z.strictObject({
  pid: resourceRecordSchema.shape.pid,
  processIdentity: resourceRecordSchema.shape.processIdentity,
  machineIdentity: resourceRecordSchema.shape.machineIdentity,
  bootIdentity: resourceRecordSchema.shape.bootIdentity,
});
const claimSchema = actorSchema.extend({ token: z.string().uuid() });
export type RecoveryClaim = z.infer<typeof claimSchema>;

function sameActor(
  left: z.infer<typeof actorSchema>,
  right: z.infer<typeof actorSchema>,
): boolean {
  return (
    left.pid === right.pid &&
    left.processIdentity === right.processIdentity &&
    left.machineIdentity === right.machineIdentity &&
    left.bootIdentity === right.bootIdentity
  );
}
async function privateParent(root: string): Promise<boolean> {
  try {
    const path = dirname(root);
    const stat = await lstat(path);
    return (
      !stat.isSymbolicLink() &&
      stat.isDirectory() &&
      stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0 &&
      (await realpath(path)) === path
    );
  } catch {
    return false;
  }
}

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
  private constructor(
    private readonly db: DatabaseSync,
    private readonly actor: z.infer<typeof actorSchema>,
  ) {}
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
    const identity = await observeProcessStartIdentity(process.pid);
    if (identity?.state !== "readable")
      throw new AnalysisOutputError(
        "pie.journal",
        "Identidade do processo não comprovada.",
      );
    const actor = {
      ...(await hostIdentity()),
      pid: process.pid,
      processIdentity: identity.identity,
    };
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
        CREATE TABLE IF NOT EXISTS pie_resource_journal(run_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pie_resource_claims(run_id TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
      return new VerificationJournal(db, actor);
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
    const rootToken = randomBytes(32).toString("hex");
    await writeFile(join(root, ".pie-owner"), rootToken, {
      flag: "wx",
      mode: 0o600,
    });
    const record = resourceRecordSchema.parse({
      ...input,
      ...(await hostIdentity()),
      root,
      name: `pie-verify-${input.runId}`,
      device: String(stat.dev),
      inode: String(stat.ino),
      rootToken,
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
  event(runId: string, event: DockerResourceEvent, token?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(runId);
      const claim = this.#claim(runId);
      if (
        token
          ? !claim || claim.token !== token || !sameActor(claim, this.actor)
          : claim !== null || !sameActor(previous, this.actor)
      )
        throw new AnalysisOutputError(
          "pie.journal",
          "Dono do registro mudou ou claim não corresponde ao processo atual.",
        );
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
    return this.#status(this.get(runId));
  }
  async #status(
    record: z.infer<typeof actorSchema>,
  ): Promise<"exited" | "present" | "unverified"> {
    try {
      const host = await hostIdentity();
      if (host.machineIdentity !== record.machineIdentity) return "unverified";
      if (host.bootIdentity !== record.bootIdentity) return "exited";
    } catch {
      return "unverified";
    }
    return observeProcessStartIdentityExit(record.pid, record.processIdentity);
  }
  #claim(runId: string): RecoveryClaim | null {
    const row = this.db
      .prepare("SELECT payload FROM pie_resource_claims WHERE run_id=?")
      .get(runId);
    return row ? claimSchema.parse(JSON.parse(String(row.payload))) : null;
  }
  async claimRecovery(runId: string): Promise<RecoveryClaim> {
    const original = this.get(runId);
    if (original.rootRemovedAt !== null)
      throw new AnalysisOutputError(
        "pie.recovery",
        "Recuperação já concluída.",
      );
    if ((await this.#status(original)) !== "exited")
      throw new AnalysisOutputError(
        "pie.recovery",
        "Processo original vivo ou identidade não verificável.",
      );
    const previous = this.#claim(runId);
    if (previous && (await this.#status(previous)) !== "exited")
      throw new AnalysisOutputError(
        "pie.recovery",
        "Outra recuperação possui o recurso ou não pôde ser verificada.",
      );
    const claim = claimSchema.parse({ ...this.actor, token: randomUUID() });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        JSON.stringify(this.get(runId)) !== JSON.stringify(original) ||
        JSON.stringify(this.#claim(runId)) !== JSON.stringify(previous)
      )
        throw new AnalysisOutputError(
          "pie.recovery",
          "Registro mudou enquanto a identidade era verificada; consulte novamente.",
        );
      this.db
        .prepare(
          "INSERT INTO pie_resource_claims(run_id,payload) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload",
        )
        .run(runId, JSON.stringify(claim));
      this.db.exec("COMMIT");
      return claim;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }
  assertClaim(runId: string, token: string): ResourceRecord {
    const claim = this.#claim(runId);
    if (!claim || claim.token !== token || !sameActor(claim, this.actor))
      throw new AnalysisOutputError(
        "pie.recovery",
        "Claim de recuperação inválido ou substituído.",
      );
    return this.get(runId);
  }
  async rootStatus(
    runId: string,
    token: string,
  ): Promise<"owned" | "absent" | "unverified"> {
    const record = this.assertClaim(runId, token);
    if (!(await privateParent(record.root))) return "unverified";
    let stat;
    try {
      stat = await lstat(record.root, { bigint: true });
    } catch (cause) {
      this.assertClaim(runId, token);
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "ENOENT" &&
        (await privateParent(record.root))
      )
        return "absent";
      return "unverified";
    }
    try {
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        String(stat.dev) !== record.device ||
        String(stat.ino) !== record.inode ||
        Number(stat.uid) !== process.getuid?.() ||
        (Number(stat.mode) & 0o077) !== 0 ||
        (await realpath(record.root)) !== record.root ||
        record.rootToken === null
      )
        return "unverified";
      const marker = await readInventoryFile(
        join(record.root, ".pie-owner"),
        64,
        () => 1,
      );
      this.assertClaim(runId, token);
      return marker.ok && marker.value.toString("utf8") === record.rootToken
        ? "owned"
        : "unverified";
    } catch {
      this.assertClaim(runId, token);
      return "unverified";
    }
  }
  async finishRecovery(runId: string, token: string): Promise<void> {
    if ((await this.rootStatus(runId, token)) !== "absent")
      throw new AnalysisOutputError(
        "pie.recovery",
        "Remoção da raiz não comprovada.",
      );
    this.#completeRoot(runId, token);
  }
  async finishLive(runId: string): Promise<void> {
    const record = this.get(runId);
    if (!sameActor(record, this.actor) || this.#claim(runId))
      throw new AnalysisOutputError(
        "pie.journal",
        "Dono original não possui o recurso.",
      );
    if (!(await privateParent(record.root)))
      throw new AnalysisOutputError(
        "pie.journal",
        "Pai da raiz não comprovado.",
      );
    try {
      await lstat(record.root);
    } catch (cause) {
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "ENOENT" &&
        (await privateParent(record.root))
      ) {
        this.#completeRoot(runId);
        return;
      }
      throw cause;
    }
    throw new AnalysisOutputError(
      "pie.journal",
      "Raiz ainda existe; limpeza não concluída.",
    );
  }
  #completeRoot(runId: string, token?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const record = token ? this.assertClaim(runId, token) : this.get(runId);
      if (!token && (!sameActor(record, this.actor) || this.#claim(runId)))
        throw new AnalysisOutputError("pie.journal", "Dono original mudou.");
      if (record.phase !== "removed")
        throw new AnalysisOutputError(
          "pie.recovery",
          "Limpeza do contêiner não confirmada.",
        );
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE pie_resource_journal SET payload=? WHERE run_id=?")
        .run(
          JSON.stringify({
            ...record,
            rootRemovedAt: record.rootRemovedAt ?? now,
            updatedAt: now,
          }),
          runId,
        );
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
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
