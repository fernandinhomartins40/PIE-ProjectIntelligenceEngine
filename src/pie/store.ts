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
import { createHttpSqlitePersistence } from "./httpSqlitePersistence.js";
import {
  functionalRecordSchema,
  functionalHistorySchema,
  functionalSummary,
  validateFunctional,
  validateStoredFunctional,
} from "./functionalRecord.js";
import {
  verificationRunSchema,
  verificationHistorySchema,
} from "./execution/runContracts.js";
import {
  validateVerificationRun,
  validateStoredVerification,
} from "./execution/runIntegrity.js";
import {
  planContestationSchema,
  planContestHistoryInput,
  planContestHistorySchema,
  samePlanContestationIntent,
  validateContestationSnapshot,
} from "./planContestation.js";
import {
  matchesPlanTriageRetry,
  planTriageInput,
  sealPlanTriageEvent,
  validatePlanTriageHistory,
  validatePlanTriageRow,
} from "./planTriage.js";

/** SQLite is the optional local persistence mode. */
export class PieStore implements PiePersistence {
  readonly #db: DatabaseSync;
  readonly #http: ReturnType<typeof createHttpSqlitePersistence>;
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
    this.#db
      .exec(`CREATE TABLE IF NOT EXISTS pie_functional_records(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id), created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pie_functional_snapshot ON pie_functional_records(snapshot_id,created_at,id);
      CREATE TRIGGER IF NOT EXISTS pie_functional_immutable_update BEFORE UPDATE ON pie_functional_records BEGIN SELECT RAISE(ABORT,'functional immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_functional_immutable_delete BEFORE DELETE ON pie_functional_records BEGIN SELECT RAISE(ABORT,'functional immutable'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(3);`);
    this.#db
      .exec(`CREATE TABLE IF NOT EXISTS pie_http_probes(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id), evidence_id TEXT NOT NULL UNIQUE REFERENCES pie_evidence(id), created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pie_http_probe_snapshot ON pie_http_probes(snapshot_id,created_at,id);
      CREATE TRIGGER IF NOT EXISTS pie_http_immutable_update BEFORE UPDATE ON pie_http_probes BEGIN SELECT RAISE(ABORT,'HTTP immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_http_immutable_delete BEFORE DELETE ON pie_http_probes BEGIN SELECT RAISE(ABORT,'HTTP immutable'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(4);`);
    this.#db
      .exec(`CREATE TABLE IF NOT EXISTS pie_plan_contestations(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id), plan_digest TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pie_plan_contestation_snapshot ON pie_plan_contestations(snapshot_id,plan_digest,created_at,id);
      CREATE TRIGGER IF NOT EXISTS pie_plan_contestation_immutable_update BEFORE UPDATE ON pie_plan_contestations BEGIN SELECT RAISE(ABORT,'plan contestation immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_plan_contestation_immutable_delete BEFORE DELETE ON pie_plan_contestations BEGIN SELECT RAISE(ABORT,'plan contestation immutable'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(5);`);
    this.#db
      .exec(`CREATE TABLE IF NOT EXISTS pie_plan_triage_events(id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES pie_snapshots(id), plan_digest TEXT NOT NULL, item_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(snapshot_id,plan_digest,item_id,revision));
      CREATE TRIGGER IF NOT EXISTS pie_plan_triage_immutable_update BEFORE UPDATE ON pie_plan_triage_events BEGIN SELECT RAISE(ABORT,'plan triage immutable'); END;
      CREATE TRIGGER IF NOT EXISTS pie_plan_triage_immutable_delete BEFORE DELETE ON pie_plan_triage_events BEGIN SELECT RAISE(ABORT,'plan triage immutable'); END;
      INSERT OR IGNORE INTO pie_migrations(version) VALUES(6);`);
    this.#http = createHttpSqlitePersistence({
      db: this.#db,
      snapshot: (id) => this.snapshot(id),
      evidence: (id) => this.evidence(id),
    });
  }

  close(): void {
    this.#db.close();
  }
  saveHttpProbe(input: unknown) {
    return this.#http.saveHttpProbe(input);
  }
  httpProbe(id: string) {
    return this.#http.httpProbe(id);
  }
  httpProbes(snapshotId: string, input: unknown = {}) {
    return this.#http.httpProbes(snapshotId, input);
  }
  functionalRecords(snapshotId: string, input: unknown = {}) {
    this.snapshot(snapshotId);
    const { offset, limit } = pageSchema.parse(input);
    this.#db.exec("BEGIN");
    try {
      const total = Number(
        this.#db
          .prepare(
            "SELECT count(*) AS total FROM pie_functional_records WHERE snapshot_id=?",
          )
          .get(snapshotId)!.total,
      );
      const rows = this.#db
        .prepare(
          "SELECT id FROM pie_functional_records WHERE snapshot_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
        )
        .all(snapshotId, limit, offset);
      const result = functionalHistorySchema.parse({
        items: rows.map((row) =>
          functionalSummary(this.functionalRecord(String(row.id))),
        ),
        total,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
      });
      this.#db.exec("COMMIT");
      return result;
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
  }
  saveFunctional(input: unknown) {
    const parsed = functionalRecordSchema.parse(input);
    const record = validateFunctional(parsed, this.snapshot(parsed.snapshotId));
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO pie_functional_records(id,snapshot_id,created_at,payload) VALUES(?,?,?,?)",
      )
      .run(
        record.id,
        record.snapshotId,
        record.createdAt,
        JSON.stringify(record),
      );
    const stored = this.functionalRecord(record.id);
    if (canonicalize(stored) !== canonicalize(record))
      throw new PieError(
        "INTEGRITY_ERROR",
        "Análise funcional histórica não pode ser substituída.",
      );
    return stored;
  }
  functionalRecord(id: string) {
    const row = this.#db
      .prepare(
        "SELECT snapshot_id,created_at,payload FROM pie_functional_records WHERE id=?",
      )
      .get(id);
    if (!row)
      throw new PieError("NOT_FOUND", "Análise funcional não encontrada.");
    return validateStoredFunctional(
      {
        id,
        snapshotId: String(row.snapshot_id),
        createdAt: String(row.created_at),
        payload: JSON.parse(String(row.payload)),
      },
      this.snapshot(String(row.snapshot_id)),
    );
  }
  savePlanContestation(input: unknown) {
    const record = planContestationSchema.parse(input);
    validateContestationSnapshot(record, this.snapshot(record.snapshotId));
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO pie_plan_contestations(id,snapshot_id,plan_digest,created_at,payload) VALUES(?,?,?,?,?)",
      )
      .run(
        record.id,
        record.snapshotId,
        record.planDigest,
        record.createdAt,
        JSON.stringify(record),
      );
    const stored = this.planContestation(record.id);
    if (!samePlanContestationIntent(stored, record))
      throw new PieError(
        "INTEGRITY_ERROR",
        "ContestaÃ§Ã£o histÃ³rica nÃ£o pode ser substituÃ­da.",
      );
    return stored;
  }
  planContestation(id: string) {
    const row = this.#db
      .prepare(
        "SELECT snapshot_id,payload FROM pie_plan_contestations WHERE id=?",
      )
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "ContestaÃ§Ã£o nÃ£o encontrada.");
    return validateContestationSnapshot(
      JSON.parse(String(row.payload)),
      this.snapshot(String(row.snapshot_id)),
    );
  }
  planContestations(snapshotId: string, rawInput: unknown) {
    const request = planContestHistoryInput.parse({
      ...((rawInput ?? {}) as object),
      snapshotId,
    });
    const snapshot = this.snapshot(snapshotId);
    const total = Number(
      this.#db
        .prepare(
          "SELECT count(*) AS total FROM pie_plan_contestations WHERE snapshot_id=? AND plan_digest=?",
        )
        .get(snapshotId, request.planDigest)!.total,
    );
    const rows = this.#db
      .prepare(
        "SELECT id FROM pie_plan_contestations WHERE snapshot_id=? AND plan_digest=? ORDER BY created_at,id LIMIT ? OFFSET ?",
      )
      .all(snapshotId, request.planDigest, request.limit, request.offset);
    return planContestHistorySchema.parse({
      schemaVersion: 1,
      snapshotId,
      planDigest: request.planDigest,
      items: {
        items: rows.map((row) =>
          validateContestationSnapshot(
            this.planContestation(String(row.id)),
            snapshot,
          ),
        ),
        total,
        offset: request.offset,
        nextOffset:
          request.offset + request.limit < total
            ? request.offset + request.limit
            : null,
      },
    });
  }
  savePlanTriage(rawInput: unknown) {
    const parsed = planTriageInput.parse(rawInput);
    this.snapshot(parsed.snapshotId);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = this.#db
        .prepare(
          "SELECT id,snapshot_id,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE id=?",
        )
        .get(parsed.id);
      if (existingRow) {
        const existing = validatePlanTriageRow(
          JSON.parse(String(existingRow.payload)),
          {
            id: String(existingRow.id),
            snapshotId: String(existingRow.snapshot_id),
            planDigest: String(existingRow.plan_digest),
            itemId: String(existingRow.item_id),
            revision: Number(existingRow.revision),
            createdAt: String(existingRow.created_at),
          },
        );
        if (!matchesPlanTriageRetry(existing, parsed))
          throw new PieError(
            "INTEGRITY_ERROR",
            "Evento de triagem existente não pode ser substituído.",
          );
        this.#db.exec("COMMIT");
        return existing;
      }
      const events = this.planTriageEvents(
        parsed.snapshotId,
        parsed.planDigest,
        parsed.itemId,
      );
      const history = validatePlanTriageHistory(
        events,
        this.snapshot(parsed.snapshotId),
        {
          snapshotId: parsed.snapshotId,
          planDigest: parsed.planDigest,
          itemId: parsed.itemId,
          limit: 1,
          offset: 0,
        },
      );
      if (history.revision !== parsed.expectedRevision)
        throw new PieError(
          "BUSY",
          "A triagem foi alterada; recarregue o plano antes de salvar.",
        );
      const event = sealPlanTriageEvent(
        parsed,
        {
          owner: history.owner,
          status: history.status,
          priority: history.priorityAssessment,
        },
        history.revision + 1,
      );
      this.#db
        .prepare(
          "INSERT INTO pie_plan_triage_events(id,snapshot_id,plan_digest,item_id,revision,created_at,payload) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          event.id,
          event.snapshotId,
          event.planDigest,
          event.itemId,
          event.revision,
          event.createdAt,
          JSON.stringify(event),
        );
      this.#db.exec("COMMIT");
      return event;
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
  }
  planTriageEvents(snapshotId: string, planDigest: string, itemId: string) {
    const rows = this.#db
      .prepare(
        "SELECT id,snapshot_id,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE snapshot_id=? AND plan_digest=? AND item_id=? ORDER BY revision",
      )
      .all(snapshotId, planDigest, itemId);
    return rows.map((row) =>
      validatePlanTriageRow(JSON.parse(String(row.payload)), {
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        planDigest: String(row.plan_digest),
        itemId: String(row.item_id),
        revision: Number(row.revision),
        createdAt: String(row.created_at),
      }),
    );
  }
  latestPlanTriageEvents(
    snapshotId: string,
    planDigest: string,
    itemIds: string[],
  ) {
    if (itemIds.length === 0) return [];
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = this.#db
      .prepare(
        `SELECT id,snapshot_id,plan_digest,item_id,revision,created_at,payload FROM (SELECT id,snapshot_id,plan_digest,item_id,revision,created_at,payload,ROW_NUMBER() OVER(PARTITION BY item_id ORDER BY revision DESC) AS position FROM pie_plan_triage_events WHERE snapshot_id=? AND plan_digest=? AND item_id IN (${placeholders})) WHERE position=1`,
      )
      .all(snapshotId, planDigest, ...itemIds);
    return rows.map((row) =>
      validatePlanTriageRow(JSON.parse(String(row.payload)), {
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        planDigest: String(row.plan_digest),
        itemId: String(row.item_id),
        revision: Number(row.revision),
        createdAt: String(row.created_at),
      }),
    );
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

  projectsForRoot(root: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const total = Number(
      this.#db
        .prepare("SELECT count(*) AS total FROM pie_projects WHERE root=?")
        .get(root)!.total,
    );
    return projectsOutput.parse({
      items: this.#db
        .prepare(
          "SELECT id,root,name,created_at FROM pie_projects WHERE root=? ORDER BY created_at,id LIMIT ? OFFSET ?",
        )
        .all(root, limit, offset),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    });
  }

  project(id: string) {
    const row = this.#db
      .prepare("SELECT id,root,name FROM pie_projects WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Projeto nÃ£o encontrado.");
    return {
      id: String(row.id),
      root: String(row.root),
      name: String(row.name),
    };
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

  evidenceSnapshotId(id: string) {
    const row = this.#db
      .prepare("SELECT snapshot_id FROM pie_evidence WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "EvidÃªncia nÃ£o encontrada.");
    return String(row.snapshot_id);
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

  projectVerifications(projectId: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    this.#db.exec("BEGIN");
    try {
      const total = Number(
        this.#db
          .prepare(
            "SELECT count(*) AS total FROM pie_verification_runs r JOIN pie_snapshots s ON s.id=r.snapshot_id WHERE s.project_id=?",
          )
          .get(projectId)!.total,
      );
      const rows = this.#db
        .prepare(
          "SELECT r.id FROM pie_verification_runs r JOIN pie_snapshots s ON s.id=r.snapshot_id WHERE s.project_id=? ORDER BY r.created_at,r.id LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset);
      const result = verificationHistorySchema.parse({
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
      this.#db.exec("COMMIT");
      return result;
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
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
