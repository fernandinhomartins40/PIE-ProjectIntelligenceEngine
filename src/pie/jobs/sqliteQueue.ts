import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import canonicalize from "canonicalize";
import { PieError } from "../contracts.js";
import {
  jobSchema,
  type Job,
  type JobKind,
  type JobQueue,
  validateLeaseMs,
} from "./contracts.js";
import { admitJob } from "./admission.js";

export class SqliteJobQueue implements JobQueue {
  readonly #db: DatabaseSync;
  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS pie_jobs(
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        lease_token TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pie_jobs_claim ON pie_jobs(state,created_at,id);`);
  }
  close(): void {
    this.#db.close();
  }
  #write(job: Job): void {
    this.#db
      .prepare(
        "UPDATE pie_jobs SET state=?,lease_token=?,lease_until=?,payload=? WHERE id=?",
      )
      .run(
        job.state,
        job.leaseToken,
        job.leaseUntil,
        JSON.stringify(job),
        job.id,
      );
  }
  #transaction<T>(action: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      this.#db.exec("COMMIT");
      return value;
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
  }
  enqueue(input: unknown): Job {
    const parsed = admitJob(input);
    return this.#transaction(() => {
      const existing = this.#db
        .prepare("SELECT payload FROM pie_jobs WHERE idempotency_key=?")
        .get(parsed.idempotencyKey);
      if (existing) {
        const job = jobSchema.parse(JSON.parse(String(existing.payload)));
        if (
          canonicalize({
            kind: job.kind,
            payload: job.payload,
            maxAttempts: job.maxAttempts,
            timeoutMs: job.timeoutMs,
          }) !==
          canonicalize({
            kind: parsed.kind,
            payload: parsed.payload,
            maxAttempts: parsed.maxAttempts,
            timeoutMs: parsed.timeoutMs,
          })
        )
          throw new PieError(
            "INTEGRITY_ERROR",
            "Chave idempotente reutilizada com outro pedido.",
          );
        return job;
      }
      const now = this.now();
      const job = jobSchema.parse({
        ...parsed,
        id: randomUUID(),
        state: "queued",
        result: null,
        errorCode: null,
        attempts: 0,
        owner: null,
        leaseToken: null,
        leaseUntil: null,
        createdAt: now,
        updatedAt: now,
      });
      this.#db
        .prepare(
          "INSERT INTO pie_jobs(id,idempotency_key,state,created_at,payload) VALUES(?,?,?,?,?)",
        )
        .run(job.id, job.idempotencyKey, job.state, now, JSON.stringify(job));
      return job;
    });
  }
  get(id: string): Job {
    const row = this.#db
      .prepare("SELECT payload FROM pie_jobs WHERE id=?")
      .get(id);
    if (!row) throw new PieError("NOT_FOUND", "Job não encontrado.");
    return jobSchema.parse(JSON.parse(String(row.payload)));
  }
  claim(
    owner: string,
    leaseMs: number,
    root?: string,
    kind: JobKind = "discovery",
  ): Job | null {
    if (!owner || leaseMs < 100)
      throw new PieError(
        "INVALID_INPUT",
        "Owner e lease válidos são obrigatórios.",
      );
    validateLeaseMs(leaseMs);
    return this.#transaction(() => {
      const now = this.now();
      const stale = this.#db
        .prepare(
          "SELECT id FROM pie_jobs WHERE state IN ('running','cancelling') AND lease_until<=?",
        )
        .all(now);
      for (const row of stale) {
        const job = this.get(String(row.id));
        this.#write({
          ...job,
          state:
            job.state === "cancelling"
              ? "cancelled"
              : job.kind === "verification" || job.attempts >= job.maxAttempts
                ? "failed"
                : "queued",
          owner: null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
          errorCode:
            job.kind === "verification"
              ? "EXECUTION_INTERRUPTED"
              : "LEASE_EXPIRED",
        });
      }
      const row = this.#db
        .prepare(
          "SELECT id FROM pie_jobs WHERE state='queued' AND json_extract(payload,'$.kind')=? AND (? IS NULL OR json_extract(payload,'$.payload.repositoryRoot')=?) ORDER BY created_at,id LIMIT 1",
        )
        .get(kind, root ?? null, root ?? null);
      if (!row) return null;
      const job = this.get(String(row.id));
      const claimed: Job = {
        ...job,
        state: "running",
        attempts: job.attempts + 1,
        owner,
        leaseToken: randomUUID(),
        leaseUntil: now + leaseMs,
        updatedAt: now,
        errorCode: null,
      };
      this.#write(claimed);
      return claimed;
    });
  }
  heartbeat(id: string, token: string, leaseMs: number): boolean {
    validateLeaseMs(leaseMs);
    return this.#transaction(() => {
      const job = this.get(id);
      if (
        job.leaseToken !== token ||
        !["running", "cancelling"].includes(job.state) ||
        (job.leaseUntil ?? 0) <= this.now()
      )
        return false;
      this.#write({
        ...job,
        leaseUntil: this.now() + leaseMs,
        updatedAt: this.now(),
      });
      return job.state === "running";
    });
  }
  finish(
    id: string,
    token: string,
    state: "succeeded" | "failed" | "cancelled",
    result: object = {},
    errorCode?: string,
  ): boolean {
    return this.#transaction(() => {
      const job = this.get(id);
      if (
        job.leaseToken !== token ||
        !["running", "cancelling"].includes(job.state) ||
        (job.leaseUntil ?? 0) <= this.now()
      )
        return false;
      const finalState = job.state === "cancelling" ? "cancelled" : state;
      this.#write(
        jobSchema.parse({
          ...job,
          state: finalState,
          result: finalState === "succeeded" ? result : null,
          errorCode: errorCode ?? null,
          owner: null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: this.now(),
        }),
      );
      return true;
    });
  }
  cancel(id: string): Job {
    return this.#transaction(() => {
      const job = this.get(id);
      const state =
        job.state === "queued"
          ? "cancelled"
          : job.state === "running"
            ? "cancelling"
            : job.state;
      const updated = { ...job, state, updatedAt: this.now() };
      this.#write(updated);
      return updated;
    });
  }
}
