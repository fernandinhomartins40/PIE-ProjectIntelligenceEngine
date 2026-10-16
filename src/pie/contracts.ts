import { z } from "zod";
import { adapterFactSchema } from "./adapters/contracts.js";
import { digestSchema, sourceSchema } from "./source.js";
export { digestSchema, sourceSchema } from "./source.js";

export const verificationState = z.enum([
  "verified",
  "failing",
  "partial",
  "unverified",
  "not_found",
  "blocked",
]);
export const testState = z.enum([
  "passed",
  "failed",
  "skipped",
  "blocked",
  "inconclusive",
]);
export const engineName = z.enum([
  "functional",
  "product",
  "security",
  "infra",
  "data",
  "regression",
]);
export const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{40,64}$/)
  .nullable();
export const policySchema = z.strictObject({
  profile: z.enum(["OBSERVE", "VERIFY", "CHANGE"]),
  repositoryRoot: z.string().min(1),
  environment: z.enum(["local", "staging", "production"]),
  allowTargetExecution: z.boolean().default(false),
  allowTargetMutation: z.boolean().default(false),
  maxFiles: z.number().int().min(1).max(100_000).default(10_000),
  maxFileBytes: z.number().int().min(1).max(10_000_000).default(1_000_000),
  maxTotalBytes: z.number().int().min(1).max(500_000_000).default(50_000_000),
  maxGraphEdges: z.number().int().min(1).max(100_000).default(20_000),
  timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
});
export type Policy = z.infer<typeof policySchema>;

export const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  auditRunId: z.string().uuid().nullable(),
  revision: revisionSchema,
  environment: z.string().min(1),
  method: z.enum(["static", "runtime", "test", "inferred"]),
  confidence: z.enum(["observed", "derived", "inferred"]),
  state: verificationState,
  createdAt: z.iso.datetime(),
  source: sourceSchema,
  sensitivity: z.enum(["public", "internal", "sensitive"]),
  redactionStatus: z.enum(["not_collected", "redacted", "not_required"]),
  expiresAt: z.iso.datetime().nullable(),
  limitations: z.array(z.string()),
  // No source bodies or ambient environment values are persisted by discovery.
  observation: z.string().max(2000),
  sha256: digestSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const graphNodeSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    "file",
    "manifest",
    "test",
    "container",
    "schema",
    "page",
    "endpoint",
    "service",
  ]),
  path: z.string().min(1),
  evidenceIds: z.array(z.string().uuid()),
});
export const graphEdgeSchema = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["depends", "covers", "calls", "reads", "writes", "authorizes"]),
  evidenceIds: z.array(z.string().uuid()).min(1),
  confidence: z.enum(["observed", "derived", "inferred"]),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  root: z.string().min(1),
  revision: revisionSchema,
  dirty: z.boolean(),
  createdAt: z.iso.datetime(),
  treeDigest: digestSchema,
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  evidence: z.array(evidenceSchema),
  declarations: z.array(adapterFactSchema).default([]),
  coverage: z.strictObject({
    scope: z.literal("git-tracked-files"),
    status: z.enum(["complete", "partial"]),
    enumeratedFiles: z.number().int().nonnegative(),
    examinedFiles: z.number().int().nonnegative(),
    bytesRead: z.number().int().nonnegative(),
    runtime: z.literal(false),
    limitations: z.array(z.string()),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export class PieError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "POLICY_DENIED"
      | "LIMIT_EXCEEDED"
      | "IO_ERROR"
      | "INTEGRITY_ERROR"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "PieError";
  }
}
