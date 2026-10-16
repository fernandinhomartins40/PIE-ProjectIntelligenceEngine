import { mkdir, realpath } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { PieError, type Snapshot } from "./contracts.js";
import { verifyEvidence } from "./evidence.js";
import { pageSchema } from "./graph.js";
import { projectsOutput, historyOutput } from "./outputContracts.js";
import type { PiePersistence } from "./persistence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import canonicalize from "canonicalize";
import {
  verificationRunSchema,
  verificationHistorySchema,
} from "./execution/runContracts.js";
import {
  validateVerificationRun,
  validateStoredVerification,
} from "./execution/runIntegrity.js";

/** SQLite is the optional local persistence mode. */
export class PieStore implements PiePersistence {
  readonly #db: DatabaseSync;
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(path);
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS pie_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS pie_projects(id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pie_snapshots(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES pie_projects(id), created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pie_snapshots_project ON pie_snapshots(project_id, created_at);
      CREATE TABLE IF NOT EXISTS pie_evidence(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id), payload TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS pie_snapshot_immutable BEFORE UPDATE ON pie_snapshots BEGIN SELECT RAISE(ABORT, 'snapshot imutável'); END;
      CREATE TRIGGER IF NOT EXISTS pie_evidence_immutable BEFORE UPDATE ON pie_evidence BEGIN SELECT RAISE(ABORT, 'evidência imutável'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(1);`);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS pie_verification_runs (
      id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id),
      evidence_id TEXT NOT NULL UNIQUE REFERENCES pie_evidence(id), created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pie_verification_snapshot ON pie_verification_runs(snapshot_id,created_at,id);
      CREATE TRIGGER IF NOT EXISTS pie_verification_immutable_update BEFORE UPDATE ON pie_verification_runs BEGIN SELECT RAISE(ABORT,'verification immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_verification_immutable_delete BEFORE DELETE ON pie_verification_runs BEGIN SELECT RAISE(ABORT,'verification immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_snapshot_immutable_delete BEFORE DELETE ON pie_snapshots BEGIN SELECT RAISE(ABORT,'snapshot imutável'); END;
      CREATE TRIGGER IF NOT EXISTS pie_evidence_immutable_delete BEFORE DELETE ON pie_evidence BEGIN SELECT RAISE(ABORT,'evidência imutável'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(2);`);
  }

  close(): void {
    this.#db.close();
  }

  async assertOutside(targetRoot: string): Promise<void> {
    const root = await realpath(targetRoot);
    const actual = await realpath(this.path);
    const delta = relative(root, actual);
    if (
      delta === "" ||
      (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta))
    )
      throw new PieError(
        "POLICY_DENIED",
        "O banco PIE deve ficar fora do projeto auditado.",
      );
  }

  addProject(
    id: string,
    root: string,
    name: string,
  ): { id: string; root: string; name: string } {
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO pie_projects(id,root,name,created_at) VALUES(?,?,?,?)",
      )
      .run(id, root, name, new Date().toISOString());
    const row = this.#db
      .prepare("SELECT id,root,name FROM pie_projects WHERE root=?")
      .get(root);
    if (!row) throw new PieError("INTEGRITY_ERROR", "Projeto não registrado.");
    return {
      id: String(row.id),
      root: String(row.root),
      name: String(row.name),
    };
  }

  projects(input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const total = Number(
      this.#db.prepare("SELECT count(*) AS total FROM pie_projects").get()!
        .total,
    );
    return projectsOutput.parse({
      items: this.#db
        .prepare(
          "SELECT id,root,name,created_at FROM pie_projects ORDER BY created_at,id LIMIT ? OFFSET ?",
        )
        .all(limit, offset),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    });
  }

  saveSnapshot(input: unknown): Snapshot {
    const snapshot = validateSnapshot(input);
    const payload = JSON.stringify(snapshot);
    const existing = this.#db
      .prepare("SELECT payload FROM pie_snapshots WHERE id=?")
      .get(snapshot.id);
    if (existing) {
      if (
        canonicalize(validateSnapshot(JSON.parse(String(existing.payload)))) !==
        canonicalize(snapshot)
      )
        throw new PieError(
          "INTEGRITY_ERROR",
          "Snapshot histórico não pode ser substituído.",
        );
      return snapshot;
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          "INSERT INTO pie_snapshots(id,project_id,created_at,payload) VALUES(?,?,?,?)",
        )
        .run(snapshot.id, snapshot.projectId, snapshot.createdAt, payload);
      const insert = this.#db.prepare(
        "INSERT INTO pie_evidence(id,snapshot_id,payload) VALUES(?,?,?)",
      );
      for (const evidence of snapshot.evidence)
        insert.run(evidence.id, snapshot.id, JSON.stringify(evidence));
      this.#db.exec("COMMIT");
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
    return snapshot;
  }

  snapshot(id: string): Snapshot {
    const row = this.#db
      .prepare("SELECT payload FROM pie_snapshots WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Snapshot não encontrado.");
    return validateSnapshot(JSON.parse(String(row.payload)));
  }

  evidence(id: string) {
    const row = this.#db
      .prepare("SELECT payload FROM pie_evidence WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Evidência não encontrada.");
    return verifyEvidence(JSON.parse(String(row.payload)));
  }

  history(projectId: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const total = Number(
      this.#db
        .prepare(
          "SELECT count(*) AS total FROM pie_snapshots WHERE project_id=?",
        )
        .get(projectId)!.total,
    );
    return historyOutput.parse({
      items: this.#db
        .prepare(
          "SELECT id,created_at FROM pie_snapshots WHERE project_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    });
  }

  saveVerification(input: unknown) {
    const parsed = verificationRunSchema.parse(input);
    const run = validateVerificationRun(
      parsed,
      this.snapshot(parsed.snapshotId),
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.#db
        .prepare("SELECT payload FROM pie_verification_runs WHERE id=?")
        .get(run.id);
      if (previous) {
        if (canonicalize(this.verification(run.id)) !== canonicalize(run))
          throw new PieError(
            "INTEGRITY_ERROR",
            "Execução histórica não pode ser substituída.",
          );
      } else {
        this.#db
          .prepare(
            "INSERT INTO pie_evidence(id,snapshot_id,payload) VALUES(?,?,?)",
          )
          .run(run.evidence.id, run.snapshotId, JSON.stringify(run.evidence));
        this.#db
          .prepare(
            "INSERT INTO pie_verification_runs(id,snapshot_id,evidence_id,created_at,payload) VALUES(?,?,?,?,?)",
          )
          .run(
            run.id,
            run.snapshotId,
            run.evidence.id,
            run.createdAt,
            JSON.stringify(run),
          );
      }
      this.#db.exec("COMMIT");
      return run;
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
  }
  verification(id: string) {
    const row = this.#db
      .prepare(
        "SELECT payload,evidence_id,snapshot_id,created_at FROM pie_verification_runs WHERE id=?",
      )
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Execução não encontrada.");
    return validateStoredVerification(
      {
        id,
        snapshotId: String(row.snapshot_id),
        evidenceId: String(row.evidence_id),
        createdAt: String(row.created_at),
        payload: JSON.parse(String(row.payload)),
        evidence: this.evidence(String(row.evidence_id)),
      },
      this.snapshot(String(row.snapshot_id)),
    );
  }
  verifications(snapshotId: string, input: unknown = {}) {
    this.snapshot(snapshotId);
    const { offset, limit } = pageSchema.parse(input);
    const total = Number(
      this.#db
        .prepare(
          "SELECT count(*) AS total FROM pie_verification_runs WHERE snapshot_id=?",
        )
        .get(snapshotId)!.total,
    );
    const rows = this.#db
      .prepare(
        "SELECT id FROM pie_verification_runs WHERE snapshot_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
      )
      .all(snapshotId, limit, offset);
    return verificationHistorySchema.parse({
      items: rows.map((row) => {
        const run = this.verification(String(row.id));
        return {
          id: run.id,
          snapshotId: run.snapshotId,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
          state: run.result.state,
          cleanup: run.cleanup,
          evidenceId: run.evidence.id,
        };
      }),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    });
  }
}

/** Preflight existing observations without creating tables or migrating the database. */
export function readStoredSnapshot(path: string, id: string): Snapshot {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT payload FROM pie_snapshots WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Snapshot não encontrado.");
    return validateSnapshot(JSON.parse(String(row.payload)));
  } finally {
    db.close();
  }
}

/** State must be outside audited trees, preserving OBSERVE semantics. */
export async function openStore(
  path: string,
  targetRoot?: string,
): Promise<PieStore> {
  const absolute = resolve(path);
  if (targetRoot) {
    const root = await realpath(targetRoot);
    // Resolve an existing ancestor before creating anything; reject redirected parents.
    let ancestor = dirname(absolute);
    const suffix: string[] = [];
    for (;;) {
      try {
        ancestor = await realpath(ancestor);
        break;
      } catch {
        const parent = dirname(ancestor);
        if (parent === ancestor)
          throw new PieError("IO_ERROR", "Diretório do banco indisponível.");
        suffix.unshift(ancestor.slice(parent.length + 1));
        ancestor = parent;
      }
    }
    let actual = resolve(
      ancestor,
      ...suffix,
      absolute.slice(dirname(absolute).length + 1),
    );
    try {
      actual = await realpath(absolute);
    } catch {
      /* File may not exist before first open. */
    }
    const delta = relative(root, actual);
    if (
      delta === "" ||
      (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta))
    )
      throw new PieError(
        "POLICY_DENIED",
        "O banco PIE deve ficar fora do projeto auditado.",
      );
  }
  await mkdir(dirname(absolute), { recursive: true });
  return new PieStore(absolute);
}
