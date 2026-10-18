import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, type Job as StoredJob } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
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

const decode = (row: StoredJob): Job =>
  jobSchema.parse({
    ...row,
    leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  });
const json = (value: object): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class PostgresJobQueue implements JobQueue {
  readonly #client: PrismaClient;
  constructor(connectionString: string) {
    this.#client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 5000,
      }),
    });
  }
  async close(): Promise<void> {
    await this.#client.$disconnect();
  }
  async #now(
    client: Pick<Prisma.TransactionClient, "$queryRaw">,
  ): Promise<bigint> {
    const rows = await client.$queryRaw<
      Array<{ now: bigint }>
    >`SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint AS now`;
    return rows[0]!.now;
  }
  async enqueue(input: unknown): Promise<Job> {
    const parsed = admitJob(input);
    return this.#client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${parsed.idempotencyKey}))`;
      const existing = await tx.job.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
      });
      if (existing) {
        const job = decode(existing);
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
      const now = await this.#now(tx);
      return decode(
        await tx.job.create({
          data: {
            ...parsed,
            id: randomUUID(),
            payload: json(parsed.payload),
            state: "queued",
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
    });
  }
  async get(id: string): Promise<Job> {
    const row = await this.#client.job.findUnique({ where: { id } });
    if (!row) throw new PieError("NOT_FOUND", "Job não encontrado.");
    return decode(row);
  }
  async claim(
    owner: string,
    leaseMs: number,
    root?: string,
    kind: JobKind = "discovery",
  ): Promise<Job | null> {
    if (!owner || leaseMs < 100)
      throw new PieError(
        "INVALID_INPUT",
        "Owner e lease válidos são obrigatórios.",
      );
    validateLeaseMs(leaseMs);
    return this.#client.$transaction(async (tx) => {
      const now = await this.#now(tx);
      await tx.$executeRaw`UPDATE pie_jobs SET state=CASE WHEN state='cancelling' THEN 'cancelled' WHEN kind='verification' OR attempts>=max_attempts THEN 'failed' ELSE 'queued' END, owner=NULL, lease_token=NULL, lease_until=NULL, error_code=CASE WHEN kind='verification' THEN 'EXECUTION_INTERRUPTED' ELSE 'LEASE_EXPIRED' END, updated_at=${now} WHERE state IN ('running','cancelling') AND lease_until<=${now}`;
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id::text FROM pie_jobs WHERE state='queued' AND kind=${kind} AND (${root ?? null}::text IS NULL OR payload->>'repositoryRoot'=${root ?? null}) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return null;
      return decode(
        await tx.job.update({
          where: { id: rows[0].id },
          data: {
            state: "running",
            owner,
            leaseToken: randomUUID(),
            leaseUntil: now + BigInt(leaseMs),
            attempts: { increment: 1 },
            updatedAt: now,
            errorCode: null,
          },
        }),
      );
    });
  }
  async heartbeat(
    id: string,
    token: string,
    leaseMs: number,
  ): Promise<boolean> {
    validateLeaseMs(leaseMs);
    return this.#client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id::text FROM pie_jobs WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.job.findUnique({ where: { id } });
      const now = await this.#now(tx);
      if (
        !row ||
        row.leaseToken !== token ||
        !["running", "cancelling"].includes(row.state) ||
        (row.leaseUntil ?? 0n) <= now
      )
        return false;
      await tx.job.update({
        where: { id },
        data: { leaseUntil: now + BigInt(leaseMs), updatedAt: now },
      });
      return row.state === "running";
    });
  }
  async finish(
    id: string,
    token: string,
    state: "succeeded" | "failed" | "cancelled",
    result: object = {},
    errorCode?: string,
  ): Promise<boolean> {
    return this.#client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id::text FROM pie_jobs WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.job.findUnique({ where: { id } });
      if (
        !row ||
        row.leaseToken !== token ||
        !["running", "cancelling"].includes(row.state) ||
        (row.leaseUntil ?? 0n) <= (await this.#now(tx))
      )
        return false;
      const finalState = row.state === "cancelling" ? "cancelled" : state;
      await tx.job.update({
        where: { id },
        data: {
          state: finalState,
          result: finalState === "succeeded" ? json(result) : Prisma.DbNull,
          errorCode: errorCode ?? null,
          owner: null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: await this.#now(tx),
        },
      });
      return true;
    });
  }
  async cancel(id: string): Promise<Job> {
    return this.#client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id::text FROM pie_jobs WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.job.findUnique({ where: { id } });
      if (!row) throw new PieError("NOT_FOUND", "Job não encontrado.");
      const state =
        row.state === "queued"
          ? "cancelled"
          : row.state === "running"
            ? "cancelling"
            : row.state;
      return decode(
        await tx.job.update({
          where: { id },
          data: { state, updatedAt: await this.#now(tx) },
        }),
      );
    });
  }
}
