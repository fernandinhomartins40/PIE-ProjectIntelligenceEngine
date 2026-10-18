import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import canonicalize from "canonicalize";
import { httpProbeSchema, httpProbeSummary } from "./execution/httpProbe.js";
import {
  validateHttpProbe,
  validateStoredHttpProbe,
} from "./execution/httpIntegrity.js";
import {
  functionalRecordSchema,
  functionalHistorySchema,
  functionalSummary,
  validateFunctional,
  validateStoredFunctional,
} from "./functionalRecord.js";
import { PieError, type Snapshot } from "./contracts.js";
import { verifyEvidence } from "./evidence.js";
import { pageSchema } from "./graph.js";
import { httpProbeHistorySchema } from "./outputContracts.js";
import {
  inspectAppliedMigrations,
  missingMigrationHistory,
  type MigrationHistoryInspection,
} from "./postgresMigrations.js";
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
  }
  async inspectSchema(): Promise<{
    missingTables: string[];
    migrations: MigrationHistoryInspection;
  }> {
    const expectedTables = [
      "pie_projects",
      "pie_snapshots",
      "pie_evidence",
      "pie_verification_runs",
      "pie_functional_records",
      "pie_http_probes",
      "pie_plan_contestations",
      "pie_plan_triage_events",
      "pie_graph_nodes",
      "pie_graph_edges",
      "pie_jobs",
    ];
    const rows = await this.#client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
    `;
    const present = new Set(rows.map((row) => row.table_name));
    const migrations = present.has("_prisma_migrations")
      ? inspectAppliedMigrations(
          await this.#client.$queryRaw<
            Array<{
              migration_name: string;
              checksum: string;
              finished_at: Date | null;
              rolled_back_at: Date | null;
            }>
          >`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"`,
        )
      : missingMigrationHistory();
    return {
      missingTables: expectedTables.filter((table) => !present.has(table)),
      migrations,
    };
  }
  async close(): Promise<void> {
    await this.#client.$disconnect();
  }
  async saveHttpProbe(input: unknown) {
    const parsed = httpProbeSchema.parse(input);
    const snapshot = await this.snapshot(parsed.snapshotId);
    const record = validateHttpProbe(parsed, snapshot);
    await this.#client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${record.id}))`;
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          snapshot_id: string;
          evidence_id: string;
          created_at: Date;
          payload: unknown;
          evidence: unknown;
        }>
      >`SELECT r.id::text,r.snapshot_id::text,r.evidence_id::text,r.created_at,r.payload,e.payload AS evidence FROM pie_http_probes r JOIN pie_evidence e ON e.id=r.evidence_id WHERE r.id=${record.id}::uuid`;
      if (rows[0]) {
        if (
          canonicalize(
            validateStoredHttpProbe(
              {
                id: rows[0].id,
                snapshotId: rows[0].snapshot_id,
                evidenceId: rows[0].evidence_id,
                createdAt: rows[0].created_at.toISOString(),
                payload: rows[0].payload,
                evidence: rows[0].evidence,
              },
              snapshot,
            ),
          ) !== canonicalize(record)
        )
          throw new PieError(
            "INTEGRITY_ERROR",
            "Registro HTTP histórico não pode ser substituído.",
          );
        return;
      }
      await tx.evidence.create({
        data: {
          id: record.evidence.id,
          snapshotId: record.snapshotId,
          payload: json(record.evidence),
        },
      });
      await tx.$executeRaw`INSERT INTO pie_http_probes(id,snapshot_id,evidence_id,created_at,payload) VALUES(${record.id}::uuid,${record.snapshotId}::uuid,${record.evidence.id}::uuid,${new Date(record.createdAt)},${JSON.stringify(record)}::jsonb)`;
    });
    return record;
  }
  async httpProbe(id: string) {
    const rows = await this.#client.$queryRaw<
      Array<{
        id: string;
        snapshot_id: string;
        evidence_id: string;
        created_at: Date;
        payload: unknown;
        evidence: unknown;
      }>
    >`SELECT r.id::text,r.snapshot_id::text,r.evidence_id::text,r.created_at,r.payload,e.payload AS evidence FROM pie_http_probes r JOIN pie_evidence e ON e.id=r.evidence_id WHERE r.id=${id}::uuid`;
    const row = rows[0];
    if (!row) throw new PieError("NOT_FOUND", "Registro HTTP não encontrado.");
    return validateStoredHttpProbe(
      {
        id: row.id,
        snapshotId: row.snapshot_id,
        evidenceId: row.evidence_id,
        createdAt: row.created_at.toISOString(),
        payload: row.payload,
        evidence: row.evidence,
      },
      await this.snapshot(row.snapshot_id),
    );
  }
  async httpProbes(snapshotId: string, input: unknown = {}) {
    const snapshot = await this.snapshot(snapshotId);
    const { offset, limit } = pageSchema.parse(input);
    return this.#client.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<
          Array<{ total: bigint }>
        >`SELECT count(*) AS total FROM pie_http_probes WHERE snapshot_id=${snapshotId}::uuid`;
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            snapshot_id: string;
            evidence_id: string;
            created_at: Date;
            payload: unknown;
            evidence: unknown;
          }>
        >`SELECT r.id::text,r.snapshot_id::text,r.evidence_id::text,r.created_at,r.payload,e.payload AS evidence FROM pie_http_probes r JOIN pie_evidence e ON e.id=r.evidence_id WHERE r.snapshot_id=${snapshotId}::uuid ORDER BY r.created_at,r.id LIMIT ${limit} OFFSET ${offset}`;
        const total = Number(counts[0]!.total);
        return httpProbeHistorySchema.parse({
          items: rows.map((row) =>
            httpProbeSummary(
              validateStoredHttpProbe(
                {
                  id: row.id,
                  snapshotId: row.snapshot_id,
                  evidenceId: row.evidence_id,
                  createdAt: row.created_at.toISOString(),
                  payload: row.payload,
                  evidence: row.evidence,
                },
                snapshot,
              ),
            ),
          ),
          total,
          offset,
          nextOffset: offset + limit < total ? offset + limit : null,
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async functionalRecords(snapshotId: string, input: unknown = {}) {
    const snapshot = await this.snapshot(snapshotId);
    const { offset, limit } = pageSchema.parse(input);
    return this.#client.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<
          Array<{ total: bigint }>
        >`SELECT count(*) AS total FROM pie_functional_records WHERE snapshot_id=${snapshotId}::uuid`;
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            snapshot_id: string;
            created_at: Date;
            payload: unknown;
          }>
        >`SELECT id::text,snapshot_id::text,created_at,payload FROM pie_functional_records WHERE snapshot_id=${snapshotId}::uuid ORDER BY created_at,id LIMIT ${limit} OFFSET ${offset}`;
        const total = Number(counts[0]!.total);
        return functionalHistorySchema.parse({
          items: rows.map((row) =>
            functionalSummary(
              validateStoredFunctional(
                {
                  id: row.id,
                  snapshotId: row.snapshot_id,
                  createdAt: row.created_at.toISOString(),
                  payload: row.payload,
                },
                snapshot,
              ),
            ),
          ),
          total,
          offset,
          nextOffset: offset + limit < total ? offset + limit : null,
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async saveFunctional(input: unknown) {
    const parsed = functionalRecordSchema.parse(input);
    const record = validateFunctional(
      parsed,
      await this.snapshot(parsed.snapshotId),
    );
    await this.#client
      .$executeRaw`INSERT INTO pie_functional_records(id,snapshot_id,created_at,payload) VALUES(${record.id}::uuid,${record.snapshotId}::uuid,${new Date(record.createdAt)},${JSON.stringify(record)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    const stored = await this.functionalRecord(record.id);
    if (canonicalize(stored) !== canonicalize(record))
      throw new PieError(
        "INTEGRITY_ERROR",
        "Análise funcional histórica não pode ser substituída.",
      );
    return stored;
  }
  async functionalRecord(id: string) {
    const rows = await this.#client.$queryRaw<
      Array<{
        id: string;
        snapshot_id: string;
        created_at: Date;
        payload: unknown;
      }>
    >`SELECT id::text,snapshot_id::text,created_at,payload FROM pie_functional_records WHERE id=${id}::uuid`;
    const row = rows[0];
    if (!row)
      throw new PieError("NOT_FOUND", "Análise funcional não encontrada.");
    return validateStoredFunctional(
      {
        id: row.id,
        snapshotId: row.snapshot_id,
        createdAt: row.created_at.toISOString(),
        payload: row.payload,
      },
      await this.snapshot(row.snapshot_id),
    );
  }
  async savePlanContestation(input: unknown) {
    const record = planContestationSchema.parse(input);
    validateContestationSnapshot(
      record,
      await this.snapshot(record.snapshotId),
    );
    await this.#client
      .$executeRaw`INSERT INTO pie_plan_contestations(id,snapshot_id,plan_digest,created_at,payload) VALUES(${record.id}::uuid,${record.snapshotId}::uuid,${record.planDigest},${new Date(record.createdAt)},${JSON.stringify(record)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    const stored = await this.planContestation(record.id);
    if (!samePlanContestationIntent(stored, record))
      throw new PieError(
        "INTEGRITY_ERROR",
        "ContestaÃ§Ã£o histÃ³rica nÃ£o pode ser substituÃ­da.",
      );
    return stored;
  }
  async planContestation(id: string) {
    const rows = await this.#client.$queryRaw<
      Array<{ snapshot_id: string; payload: unknown }>
    >`SELECT snapshot_id::text,payload FROM pie_plan_contestations WHERE id=${id}::uuid`;
    const row = rows[0];
    if (!row) throw new PieError("NOT_FOUND", "ContestaÃ§Ã£o nÃ£o encontrada.");
    return validateContestationSnapshot(
      row.payload,
      await this.snapshot(row.snapshot_id),
    );
  }
  async planContestations(snapshotId: string, rawInput: unknown) {
    const request = planContestHistoryInput.parse({
      ...((rawInput ?? {}) as object),
      snapshotId,
    });
    const snapshot = await this.snapshot(snapshotId);
    return this.#client.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<
          Array<{ total: bigint }>
        >`SELECT count(*) AS total FROM pie_plan_contestations WHERE snapshot_id=${snapshotId}::uuid AND plan_digest=${request.planDigest}`;
        const rows = await tx.$queryRaw<
          Array<{ id: string; payload: unknown }>
        >`SELECT id::text,payload FROM pie_plan_contestations WHERE snapshot_id=${snapshotId}::uuid AND plan_digest=${request.planDigest} ORDER BY created_at,id LIMIT ${request.limit} OFFSET ${request.offset}`;
        const total = Number(counts[0]!.total);
        return planContestHistorySchema.parse({
          schemaVersion: 1,
          snapshotId,
          planDigest: request.planDigest,
          items: {
            items: rows.map((row) =>
              validateContestationSnapshot(row.payload, snapshot),
            ),
            total,
            offset: request.offset,
            nextOffset:
              request.offset + request.limit < total
                ? request.offset + request.limit
                : null,
          },
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async savePlanTriage(rawInput: unknown) {
    const input = planTriageInput.parse(rawInput);
    const snapshot = await this.snapshot(input.snapshotId);
    return this.#client.$transaction(
      async (tx) => {
        const lock = `${input.snapshotId}:${input.planDigest}:${input.itemId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
        const existingRows = await tx.$queryRaw<
          Array<{
            id: string;
            snapshot_id: string;
            plan_digest: string;
            item_id: string;
            revision: number;
            created_at: Date;
            payload: unknown;
          }>
        >`SELECT id::text,snapshot_id::text,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE id=${input.id}::uuid`;
        if (existingRows[0]) {
          const row = existingRows[0];
          const existing = validatePlanTriageRow(row.payload, {
            id: row.id,
            snapshotId: row.snapshot_id,
            planDigest: row.plan_digest,
            itemId: row.item_id,
            revision: row.revision,
            createdAt: row.created_at.toISOString(),
          });
          if (!matchesPlanTriageRetry(existing, input))
            throw new PieError(
              "INTEGRITY_ERROR",
              "Evento de triagem existente não pode ser substituído.",
            );
          return existing;
        }
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            snapshot_id: string;
            plan_digest: string;
            item_id: string;
            revision: number;
            created_at: Date;
            payload: unknown;
          }>
        >`SELECT id::text,snapshot_id::text,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE snapshot_id=${input.snapshotId}::uuid AND plan_digest=${input.planDigest} AND item_id=${input.itemId} ORDER BY revision`;
        const events = rows.map((row) =>
          validatePlanTriageRow(row.payload, {
            id: row.id,
            snapshotId: row.snapshot_id,
            planDigest: row.plan_digest,
            itemId: row.item_id,
            revision: row.revision,
            createdAt: row.created_at.toISOString(),
          }),
        );
        const history = validatePlanTriageHistory(events, snapshot, {
          snapshotId: input.snapshotId,
          planDigest: input.planDigest,
          itemId: input.itemId,
          limit: 1,
          offset: 0,
        });
        if (history.revision !== input.expectedRevision)
          throw new PieError(
            "BUSY",
            "A triagem foi alterada; recarregue o plano antes de salvar.",
          );
        const event = sealPlanTriageEvent(
          input,
          {
            owner: history.owner,
            status: history.status,
            priority: history.priorityAssessment,
          },
          history.revision + 1,
        );
        await tx.$executeRaw`INSERT INTO pie_plan_triage_events(id,snapshot_id,plan_digest,item_id,revision,created_at,payload) VALUES(${event.id}::uuid,${event.snapshotId}::uuid,${event.planDigest},${event.itemId},${event.revision},${new Date(event.createdAt)},${JSON.stringify(event)}::jsonb)`;
        return event;
      },
      { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15_000 },
    );
  }
  async planTriageEvents(
    snapshotId: string,
    planDigest: string,
    itemId: string,
  ) {
    const rows = await this.#client.$queryRaw<
      Array<{
        id: string;
        snapshot_id: string;
        plan_digest: string;
        item_id: string;
        revision: number;
        created_at: Date;
        payload: unknown;
      }>
    >`SELECT id::text,snapshot_id::text,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE snapshot_id=${snapshotId}::uuid AND plan_digest=${planDigest} AND item_id=${itemId} ORDER BY revision`;
    return rows.map((row) =>
      validatePlanTriageRow(row.payload, {
        id: row.id,
        snapshotId: row.snapshot_id,
        planDigest: row.plan_digest,
        itemId: row.item_id,
        revision: row.revision,
        createdAt: row.created_at.toISOString(),
      }),
    );
  }
  async latestPlanTriageEvents(
    snapshotId: string,
    planDigest: string,
    itemIds: string[],
  ) {
    if (itemIds.length === 0) return [];
    const rows = await this.#client.$queryRaw<
      Array<{
        id: string;
        snapshot_id: string;
        plan_digest: string;
        item_id: string;
        revision: number;
        created_at: Date;
        payload: unknown;
      }>
    >`SELECT DISTINCT ON (item_id) id::text,snapshot_id::text,plan_digest,item_id,revision,created_at,payload FROM pie_plan_triage_events WHERE snapshot_id=${snapshotId}::uuid AND plan_digest=${planDigest} AND item_id IN (${Prisma.join(itemIds)}) ORDER BY item_id,revision DESC`;
    return rows.map((row) =>
      validatePlanTriageRow(row.payload, {
        id: row.id,
        snapshotId: row.snapshot_id,
        planDigest: row.plan_digest,
        itemId: row.item_id,
        revision: row.revision,
        createdAt: row.created_at.toISOString(),
      }),
    );
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

  async projectsForRoot(root: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const [total, rows] = await this.#client.$transaction(
      [
        this.#client.project.count({ where: { root } }),
        this.#client.project.findMany({
          where: { root },
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

  async project(id: string) {
    const row = await this.#client.project.findUnique({ where: { id } });
    if (!row) throw new PieError("NOT_FOUND", "Projeto nÃ£o encontrado.");
    return { id: row.id, root: row.root, name: row.name };
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

  async evidenceSnapshotId(id: string) {
    const row = await this.#client.evidence.findUnique({
      where: { id },
      select: { snapshotId: true },
    });
    if (!row) throw new PieError("NOT_FOUND", "EvidÃªncia nÃ£o encontrada.");
    return row.snapshotId;
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

  async projectVerifications(projectId: string, input: unknown = {}) {
    const { offset, limit } = pageSchema.parse(input);
    const [total, rows] = await this.#client.$transaction(
      [
        this.#client.verificationRun.count({
          where: { snapshot: { projectId } },
        }),
        this.#client.verificationRun.findMany({
          where: { snapshot: { projectId } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: limit,
          include: { evidence: true, snapshot: true },
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
          validateSnapshot(row.snapshot.payload),
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
