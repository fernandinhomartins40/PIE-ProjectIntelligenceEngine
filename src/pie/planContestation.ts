import canonicalize from "canonicalize";
import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { sha256 } from "./evidence.js";
import { planItemSchema } from "./planning.js";
import { validateSnapshot } from "./snapshotIntegrity.js";

export const planContestationInput = z.strictObject({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  justification: z.string().trim().min(10).max(4_000),
  evidenceIds: z.array(z.string().uuid()).min(1).max(10),
});

export const planContestationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  item: planItemSchema,
  action: z.literal("contest"),
  justification: z.string().min(10).max(4_000),
  evidenceIds: z.array(z.string().uuid()).min(1).max(10),
  author: z.null(),
  createdAt: z.iso.datetime(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const planContestHistoryInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const planContestHistorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.strictObject({
    items: z.array(planContestationSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

export type PlanContestation = z.infer<typeof planContestationSchema>;

export function samePlanContestationIntent(
  a: PlanContestation,
  b: PlanContestation,
) {
  return (
    canonicalize({ ...a, createdAt: undefined, eventHash: undefined }) ===
    canonicalize({ ...b, createdAt: undefined, eventHash: undefined })
  );
}

export function sealPlanContestation(
  requestInput: unknown,
  itemInput: unknown,
  createdAt = new Date().toISOString(),
): PlanContestation {
  const request = planContestationInput.parse(requestInput);
  const item = planItemSchema.parse(itemInput);
  if (item.id !== request.itemId)
    throw new PieError("INVALID_INPUT", "Item contestado diverge do plano.");
  const body = {
    schemaVersion: 1 as const,
    id: request.id,
    snapshotId: request.snapshotId,
    planDigest: request.planDigest,
    itemId: request.itemId,
    item,
    action: "contest" as const,
    justification: request.justification,
    evidenceIds: [...new Set(request.evidenceIds)].sort(),
    author: null,
    createdAt,
  };
  return planContestationSchema.parse({
    ...body,
    eventHash: sha256(canonicalize(body)!),
  });
}

export function validatePlanContestation(input: unknown): PlanContestation {
  const record = planContestationSchema.parse(input);
  const { eventHash, ...body } = record;
  if (sha256(canonicalize(body)!) !== eventHash)
    throw new PieError("INTEGRITY_ERROR", "Hash da contestação inválido.");
  if (record.item.id !== record.itemId)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Item histórico da contestação diverge.",
    );
  return record;
}

export function validateContestationSnapshot(
  input: unknown,
  snapshotInput: Snapshot,
) {
  const record = validatePlanContestation(input);
  const snapshot = validateSnapshot(snapshotInput);
  if (record.snapshotId !== snapshot.id)
    throw new PieError("INTEGRITY_ERROR", "Snapshot da contestação diverge.");
  const knownEvidence = new Set(
    snapshot.evidence.map((evidence) => evidence.id),
  );
  if (
    [...record.evidenceIds, ...record.item.evidenceIds].some(
      (id) => !knownEvidence.has(id),
    )
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Evidence da contestação não pertence ao snapshot original.",
    );
  return record;
}

export function contestationHistory(
  snapshotInput: Snapshot,
  rawInput: unknown,
  records: unknown[],
) {
  const request = planContestHistoryInput.parse(rawInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (request.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Histórico pertence a outro snapshot.");
  const valid = records.map((record) =>
    validateContestationSnapshot(record, snapshot),
  );
  const selected = valid
    .filter((record) => record.planDigest === request.planDigest)
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
  return planContestHistorySchema.parse({
    schemaVersion: 1,
    snapshotId: snapshot.id,
    planDigest: request.planDigest,
    items: page(selected, { offset: request.offset, limit: request.limit }),
  });
}
