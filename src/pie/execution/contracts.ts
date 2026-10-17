import { z } from "zod";
import { digestSchema } from "../source.js";

export const nodeImageSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/);

/** Exact grant selected by the operator, never derived from repository content. */
const nodeTestGrantFields = {
  profile: z.literal("VERIFY"),
  allowTargetExecution: z.literal(true),
  environment: z.literal("local"),
  repositoryRoot: z.string().min(1),
  snapshotId: z.string().uuid(),
  treeDigest: digestSchema,
  image: nodeImageSchema,
  expiresAt: z.iso.datetime(),
  testFiles: z.array(z.string().min(1)).min(1).max(1000),
  retestPlan: z
    .strictObject({
      beforeSnapshotId: z.string().uuid(),
      mode: z.enum(["affected", "full"]),
      planDigest: digestSchema,
    })
    .optional(),
  limits: z.strictObject({
    timeoutMs: z.number().int().min(100).max(300_000),
    memoryMiB: z.number().int().min(64).max(4096),
    cpus: z.number().min(0.1).max(4),
    pids: z.number().int().min(8).max(256),
    workspaceMiB: z.number().int().min(16).max(1024),
    outputBytes: z.number().int().min(1024).max(10_000_000),
    sourceBytes: z.number().int().min(1).max(500_000_000),
  }),
};
export const nodeTestBindingSchema = z.strictObject({
  testFile: z.string().min(1),
  declarationId: z.string().min(1),
});
export const nodeTestGrantV1Schema = z.strictObject({
  ...nodeTestGrantFields,
  schemaVersion: z.literal(1),
});
export const nodeTestGrantV2Schema = z.strictObject({
  ...nodeTestGrantFields,
  schemaVersion: z.literal(2),
  /** Operator-declared intent; this never proves executed coverage. */
  testBindings: z.array(nodeTestBindingSchema).max(5000),
});
export const nodeTestGrantSchema = z.discriminatedUnion("schemaVersion", [
  nodeTestGrantV1Schema,
  nodeTestGrantV2Schema,
]);
export type NodeTestGrant = z.infer<typeof nodeTestGrantSchema>;
