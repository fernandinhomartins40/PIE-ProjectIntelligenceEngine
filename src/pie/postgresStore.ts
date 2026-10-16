import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import canonicalize from "canonicalize";
import { PieError, type Snapshot } from "./contracts.js";
import { verifyEvidence } from "./evidence.js";
import { pageSchema } from "./graph.js";
import type { PiePersistence } from "./persistence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import {
  verificationRunSchema,
  verificationHistorySchema,
} from "./execution/runContracts.js";
import {
  validateVerificationRun,
  validateStoredVerification,
} from "./execution/runIntegrity.js";

const json = (value: object): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** PostgreSQL storage shares validation with SQLite and stores queryable graph rows. */
export class PostgresPieStore implements PiePersistence {
  readonly #client: PrismaClient;

  constructor(connectionString: string) {
    const parsed = new URL(connectionString);
    if (!["postgresql:", "postgres:"].includes(parsed.protocol))
      throw new PieError(
        "INVALID_INPUT",
        "Informe uma conexão PostgreSQL direta.",
      );
    this.#client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10_000,
      }),
    });
  }

  async connect(): Promise<void> {
    await this.#client.$connect();
    await this.#client.$queryRaw`SELECT 1 FROM pie_projects LIMIT 1`;
  }
  async close(): Promise<void> {
    await this.#client.$disconnect();
  }
  async assertOutside(_root: string): Promise<void> {
    // A PostgreSQL connection owns no file path inside the audited repository.
  }

  async addProject(id: string, root: string, name: string) {
    const project = await this.#client.project.upsert({
      where: { root },
      create: { id, root, name },
      update: {},
    });
    return { id: project.id, root: project.root, name: project.name };
  }

  async projects(input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const [total, rows] = await this.#client.$transaction(
      [
        this.#client.project.count(),
        this.#client.project.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: limit,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        root: row.root,
        name: row.name,
        created_at: row.createdAt.toISOString(),
      })),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    };
  }

  async saveSnapshot(input: unknown): Promise<Snapshot> {
    const snapshot = validateSnapshot(input);
    await this.#client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${snapshot.id}))`;
        const existing = await tx.snapshot.findUnique({
          where: { id: snapshot.id },
        });
        if (existing) {
          if (
            canonicalize(validateSnapshot(existing.payload)) !==
            canonicalize(snapshot)
          )
            throw new PieError(
              "INTEGRITY_ERROR",
              "Snapshot histórico não pode ser substituído.",
            );
          return;
        }
        await tx.snapshot.create({
          data: {
            id: snapshot.id,
            projectId: snapshot.projectId,
            createdAt: new Date(snapshot.createdAt),
            payload: json(snapshot),
          },
        });
        // Chunk writes avoid PostgreSQL parameter limits on larger repositories.
        for (let i = 0; i < snapshot.evidence.length; i += 500)
          await tx.evidence.createMany({
            data: snapshot.evidence.slice(i, i + 500).map((item) => ({
              id: item.id,
              snapshotId: snapshot.id,
              payload: json(item),
            })),
          });
        for (let i = 0; i < snapshot.nodes.length; i += 500)
          await tx.graphNode.createMany({
            data: snapshot.nodes.slice(i, i + 500).map((item) => ({
              id: item.id,
              snapshotId: snapshot.id,
              kind: item.kind,
              path: item.path,
              payload: json(item),
            })),
          });
        for (let i = 0; i < snapshot.edges.length; i += 500)
          await tx.graphEdge.createMany({
            data: snapshot.edges.slice(i, i + 500).map((item) => ({
              id: item.id,
              snapshotId: snapshot.id,
              sourceId: item.from,
              targetId: item.to,
              kind: item.kind,
              payload: json(item),
            })),
          });
      },
      { maxWait: 5000, timeout: 60_000 },
    );
    return snapshot;
  }

  async snapshot(id: string): Promise<Snapshot> {
    const row = await this.#client.snapshot.findUnique({ where: { id } });
    if (!row) throw new PieError("NOT_FOUND", "Snapshot não encontrado.");
    return validateSnapshot(row.payload);
  }

  async evidence(id: string) {
    const row = await this.#client.evidence.findUnique({ where: { id } });
    if (!row) throw new PieError("NOT_FOUND", "Evidência não encontrada.");
    return verifyEvidence(row.payload);
  }

  async history(projectId: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const [total, rows] = await this.#client.$transaction(
      [
        this.#client.snapshot.count({ where: { projectId } }),
        this.#client.snapshot.findMany({
          where: { projectId },
          select: { id: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: limit,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt.toISOString(),
      })),
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    };
  }

  async saveVerification(input: unknown) {
    const parsed = verificationRunSchema.parse(input);
    const snapshot = await this.snapshot(parsed.snapshotId);
    const run = validateVerificationRun(parsed, snapshot);
    await this.#client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${run.id}))`;
        const previous = await tx.verificationRun.findUnique({
          where: { id: run.id },
          include: { evidence: true },
        });
        if (previous) {
          const stored = validateStoredVerification(
            {
              ...previous,
              createdAt: previous.createdAt.toISOString(),
              evidence: previous.evidence.payload,
            },
            snapshot,
          );
          if (canonicalize(stored) !== canonicalize(run))
            throw new PieError(
              "INTEGRITY_ERROR",
              "Execução histórica não pode ser substituída.",
            );
          return;
        }
        await tx.evidence.create({
          data: {
            id: run.evidence.id,
            snapshotId: run.snapshotId,
            payload: json(run.evidence),
          },
        });
        await tx.verificationRun.create({
          data: {
            id: run.id,
            snapshotId: run.snapshotId,
            evidenceId: run.evidence.id,
            createdAt: new Date(run.createdAt),
            payload: json(run),
          },
        });
      },
      { maxWait: 5000, timeout: 15_000 },
    );
    return run;
  }
  async verification(id: string) {
    const row = await this.#client.verificationRun.findUnique({
      where: { id },
      include: { evidence: true, snapshot: true },
    });
    if (!row) throw new PieError("NOT_FOUND", "Execução não encontrada.");
    return validateStoredVerification(
      {
        ...row,
        createdAt: row.createdAt.toISOString(),
        evidence: row.evidence.payload,
      },
      validateSnapshot(row.snapshot.payload),
    );
  }
  async verifications(snapshotId: string, input: unknown = {}) {
    const snapshot = await this.snapshot(snapshotId);
    const { offset, limit } = pageSchema.parse(input);
    const [total, rows] = await this.#client.$transaction(
      [
        this.#client.verificationRun.count({ where: { snapshotId } }),
        this.#client.verificationRun.findMany({
          where: { snapshotId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: limit,
          include: { evidence: true },
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return verificationHistorySchema.parse({
      items: rows.map((row) => {
        const run = validateStoredVerification(
          {
            ...row,
            createdAt: row.createdAt.toISOString(),
            evidence: row.evidence.payload,
          },
          snapshot,
        );
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
