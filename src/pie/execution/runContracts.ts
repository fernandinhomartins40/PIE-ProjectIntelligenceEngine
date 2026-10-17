import { z } from "zod";
import { evidenceSchema } from "../contracts.js";
import { nodeResultSchema } from "./nodeResults.js";
import { nodeImageSchema, nodeTestGrantSchema } from "./contracts.js";
import { pagedOutput } from "../outputContracts.js";
export const verificationRunV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  image: nodeImageSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  completedAt: z.iso.datetime({ precision: 3 }),
  result: nodeResultSchema,
  evidence: evidenceSchema,
  cleanup: z.enum(["complete", "incomplete"]),
  failure: z.object({ tag: z.string(), message: z.string() }).nullable(),
});
export const verificationRunV2Schema = verificationRunV1Schema.extend({
  schemaVersion: z.literal(2),
  authorization: nodeTestGrantSchema,
  authorizedRoot: z.string().min(1),
});
export const verificationRunSchema = z.discriminatedUnion("schemaVersion", [
  verificationRunV1Schema,
  verificationRunV2Schema,
]);
export type VerificationRun = z.infer<typeof verificationRunSchema>;
export const verificationExportInput = z.strictObject({
  id: z.string().uuid(),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});
export const verificationExportOutput = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceId: z.string().uuid(),
  runSha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.literal("json"),
  offset: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});
export type VerificationPayload =
  | Omit<z.infer<typeof verificationRunV1Schema>, "evidence">
  | Omit<z.infer<typeof verificationRunV2Schema>, "evidence">;
export const verificationHistorySchema = pagedOutput(
  z.strictObject({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    state: z.enum(["passed", "failed", "skipped", "blocked", "inconclusive"]),
    cleanup: verificationRunV1Schema.shape.cleanup,
    evidenceId: z.string().uuid(),
  }),
);
