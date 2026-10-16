import { z } from "zod";
import { policySchema } from "../contracts.js";

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
export const jobInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  kind: z.literal("discovery"),
  payload: jobPayload,
  maxAttempts: z.number().int().min(1).max(5).default(3),
  timeoutMs: z.number().int().min(10).max(300_000).default(30_000),
});
export const jobSchema = z.strictObject({
  id: z.string().uuid(),
  idempotencyKey: z.string(),
  kind: z.literal("discovery"),
  state: z.enum([
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  payload: jobPayload,
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
export type Job = z.infer<typeof jobSchema>;
type Awaitable<T> = T | Promise<T>;
export interface JobQueue {
  enqueue(input: unknown): Awaitable<Job>;
  get(id: string): Awaitable<Job>;
  claim(owner: string, leaseMs: number, root?: string): Awaitable<Job | null>;
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
