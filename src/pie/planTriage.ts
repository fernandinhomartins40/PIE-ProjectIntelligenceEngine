import canonicalize from "canonicalize";
import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { sha256 } from "./evidence.js";
import { pageSchema } from "./graph.js";
import { planItemSchema } from "./planning.js";
import { planTriageStatus } from "./planStates.js";
import { priorityAssessmentSchema } from "./planPriority.js";
import { validateSnapshot } from "./snapshotIntegrity.js";

export const planTriageInput = z
  .strictObject({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
    itemId: z.string().min(1).max(500),
    expectedRevision: z.number().int().nonnegative(),
    owner: z.string().trim().min(1).max(160).nullable().optional(),
    status: planTriageStatus.optional(),
    priority: priorityAssessmentSchema.nullable().optional(),
    justification: z.string().trim().min(10).max(4_000),
  })
  .refine(
    (input) =>
      input.owner !== undefined ||
      input.status !== undefined ||
      input.priority !== undefined,
    { message: "Informe owner, status, prioridade ou uma combinação." },
  );

const planTriageEventV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  revision: z.number().int().positive(),
  previousOwner: z.string().max(160).nullable(),
  owner: z.string().max(160).nullable(),
  previousStatus: planTriageStatus,
  status: planTriageStatus,
  justification: z.string().min(10).max(4_000),
  actor: z.null(),
  createdAt: z.iso.datetime(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const planTriageEventV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  revision: z.number().int().positive(),
  previousOwner: z.string().max(160).nullable(),
  owner: z.string().max(160).nullable(),
  previousStatus: planTriageStatus,
  status: planTriageStatus,
  previousPriority: priorityAssessmentSchema.nullable(),
  priority: priorityAssessmentSchema.nullable(),
  justification: z.string().min(10).max(4_000),
  actor: z.null(),
  createdAt: z.iso.datetime(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const planTriageEventSchema = z.discriminatedUnion("schemaVersion", [
  planTriageEventV1Schema,
  planTriageEventV2Schema,
]);

export const planTriageHistoryInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
});

export const planTriageHistorySchema = z.strictObject({
  schemaVersion: z.literal(2),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  owner: z.string().max(160).nullable(),
  status: planTriageStatus,
  priorityAssessment: priorityAssessmentSchema.nullable(),
  revision: z.number().int().nonnegative(),
  items: z.strictObject({
    items: z.array(planTriageEventSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

export type PlanTriageEvent = z.infer<typeof planTriageEventSchema>;

export function matchesPlanTriageRetry(
  event: PlanTriageEvent,
  rawInput: unknown,
) {
  const input = planTriageInput.parse(rawInput);
  return (
    event.id === input.id &&
    event.snapshotId === input.snapshotId &&
    event.planDigest === input.planDigest &&
    event.itemId === input.itemId &&
    event.revision === input.expectedRevision + 1 &&
    event.justification === input.justification &&
    (input.owner === undefined || event.owner === input.owner) &&
    (input.status === undefined || event.status === input.status) &&
    (input.priority === undefined ||
      (event.schemaVersion === 2 &&
        canonicalize(event.priority) === canonicalize(input.priority)))
  );
}

export function sealPlanTriageEvent(
  rawInput: unknown,
  previous: {
    owner: string | null;
    status: z.infer<typeof planTriageStatus>;
    priority: z.infer<typeof priorityAssessmentSchema> | null;
  },
  revision: number,
  createdAt = new Date().toISOString(),
): PlanTriageEvent {
  const input = planTriageInput.parse(rawInput);
  const body = {
    schemaVersion: 2 as const,
    id: input.id,
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    revision,
    previousOwner: previous.owner,
    owner: input.owner === undefined ? previous.owner : input.owner,
    previousStatus: previous.status,
    status: input.status ?? previous.status,
    previousPriority: previous.priority,
    priority: input.priority === undefined ? previous.priority : input.priority,
    justification: input.justification,
    actor: null,
    createdAt,
  };
  return planTriageEventSchema.parse({
    ...body,
    eventHash: sha256(canonicalize(body)!),
  });
}

export function validatePlanTriageEvent(input: unknown): PlanTriageEvent {
  const event = planTriageEventSchema.parse(input);
  const { eventHash, ...body } = event;
  if (sha256(canonicalize(body)!) !== eventHash)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Hash do evento de triagem inválido.",
    );
  return event;
}

export function validatePlanTriageRow(
  input: unknown,
  row: {
    id: string;
    snapshotId: string;
    planDigest: string;
    itemId: string;
    revision: number;
    createdAt: string;
  },
) {
  const event = validatePlanTriageEvent(input);
  if (
    event.id !== row.id ||
    event.snapshotId !== row.snapshotId ||
    event.planDigest !== row.planDigest ||
    event.itemId !== row.itemId ||
    event.revision !== row.revision ||
    event.createdAt !== row.createdAt
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Linha persistida diverge do evento de triagem.",
    );
  return event;
}

export function validatePlanTriageHistory(
  rawEvents: unknown[],
  snapshotInput: Snapshot,
  rawInput: unknown,
) {
  const request = planTriageHistoryInput.parse(rawInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (request.snapshotId !== snapshot.id)
    throw new PieError("INTEGRITY_ERROR", "Triagem pertence a outro snapshot.");
  const events = rawEvents
    .map(validatePlanTriageEvent)
    .sort((a, b) => a.revision - b.revision);
  let owner: string | null = null;
  let status: z.infer<typeof planTriageStatus> = "open";
  let priority: z.infer<typeof priorityAssessmentSchema> | null = null;
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const priorityEvidence =
      event.schemaVersion === 2
        ? [event.priority, event.previousPriority].flatMap(
            (assessment) => assessment?.evidenceIds ?? [],
          )
        : [];
    if (
      event.snapshotId !== snapshot.id ||
      event.planDigest !== request.planDigest ||
      event.itemId !== request.itemId ||
      event.revision !== index + 1 ||
      event.previousOwner !== owner ||
      event.previousStatus !== status ||
      (event.schemaVersion === 2 &&
        canonicalize(event.previousPriority) !== canonicalize(priority)) ||
      priorityEvidence.some((id) => !evidenceIds.has(id))
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Sequência histórica de triagem inválida.",
      );
    owner = event.owner;
    status = event.status;
    if (event.schemaVersion === 2) priority = event.priority;
  }
  const { offset, limit } = request;
  return planTriageHistorySchema.parse({
    schemaVersion: 2,
    snapshotId: snapshot.id,
    planDigest: request.planDigest,
    itemId: request.itemId,
    owner,
    status,
    priorityAssessment: priority,
    revision: events.length,
    items: {
      items: events.slice(offset, offset + limit),
      total: events.length,
      offset,
      nextOffset: offset + limit < events.length ? offset + limit : null,
    },
  });
}

export function applyPlanTriage<T extends z.infer<typeof planItemSchema>>(
  item: T,
  history: z.infer<typeof planTriageHistorySchema>,
) {
  if (history.itemId !== item.id)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Triagem não corresponde ao item do plano.",
    );
  return planItemSchema.parse({
    ...item,
    owner: history.owner,
    status: history.status,
    priority: history.priorityAssessment ? "assessed" : "unassessed",
    priorityAssessment: history.priorityAssessment,
    triageRevision: history.revision,
  });
}

export function applyLatestPlanTriage(
  item: z.infer<typeof planItemSchema>,
  eventInput?: unknown,
) {
  if (eventInput === undefined)
    return planItemSchema.parse({ ...item, triageRevision: 0 });
  const event = validatePlanTriageEvent(eventInput);
  if (event.itemId !== item.id)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Evento de triagem não corresponde ao item.",
    );
  return planItemSchema.parse({
    ...item,
    owner: event.owner,
    status: event.status,
    ...(event.schemaVersion === 2
      ? {
          priority: event.priority ? "assessed" : "unassessed",
          priorityAssessment: event.priority,
        }
      : {}),
    triageRevision: event.revision,
  });
}
