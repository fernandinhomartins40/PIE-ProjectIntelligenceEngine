import { z } from "zod";
import { PieError, policySchema } from "../contracts.js";
import { nodeTestGrantSchema } from "../execution/contracts.js";

export function validateLeaseMs(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000)
    throw new PieError(
      "INVALID_INPUT",
      "A duração da lease deve ser um inteiro entre 100 e 300000 ms.",
    );
}

export const jobPayload = policySchema.superRefine((policy, ctx) => {
  if (
    policy.profile !== "OBSERVE" ||
    policy.allowTargetExecution ||
    policy.allowTargetMutation
  )
    ctx.addIssue({
      code: "custom",
      message:
        "A fila de descoberta aceita somente OBSERVE sem execução ou mutação.",
    });
});
const discoveryInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  kind: z.literal("discovery"),
  payload: jobPayload,
  maxAttempts: z.number().int().min(1).max(5).default(3),
  timeoutMs: z.number().int().min(10).max(300_000).default(30_000),
});
const verificationInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  kind: z.literal("verification"),
  payload: nodeTestGrantSchema,
  maxAttempts: z.literal(1).default(1),
  timeoutMs: z.number().int().min(100).max(300_000).default(300_000),
});
export const jobInput = z.discriminatedUnion("kind", [
  discoveryInput,
  verificationInput,
]);
const jobFields = z.strictObject({
  id: z.string().uuid(),
  idempotencyKey: z.string(),
  state: z.enum([
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  result: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  timeoutMs: z.number().int(),
  owner: z.string().nullable(),
  leaseToken: z.string().uuid().nullable(),
  leaseUntil: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const jobSchema = z.discriminatedUnion("kind", [
  jobFields.extend({ kind: z.literal("discovery"), payload: jobPayload }),
  jobFields.extend({
    kind: z.literal("verification"),
    payload: nodeTestGrantSchema,
    maxAttempts: z.literal(1),
  }),
]);
export type Job = z.infer<typeof jobSchema>;
export type JobKind = Job["kind"];
type Awaitable<T> = T | Promise<T>;
export interface JobQueue {
  enqueue(input: unknown): Awaitable<Job>;
  get(id: string): Awaitable<Job>;
  claim(
    owner: string,
    leaseMs: number,
    root?: string,
    kind?: JobKind,
  ): Awaitable<Job | null>;
  /** Renews owned finalization even while cancelling; false requests execution abort. */
  heartbeat(id: string, token: string, leaseMs: number): Awaitable<boolean>;
  finish(
    id: string,
    token: string,
    state: "succeeded" | "failed" | "cancelled",
    result?: object,
    errorCode?: string,
  ): Awaitable<boolean>;
  cancel(id: string): Awaitable<Job>;
  close(): Awaitable<void>;
}
