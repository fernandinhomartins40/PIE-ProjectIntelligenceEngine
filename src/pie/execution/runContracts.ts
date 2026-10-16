import { z } from "zod";
import { evidenceSchema } from "../contracts.js";
import { nodeResultSchema } from "./nodeResults.js";
import { nodeTestGrantSchema } from "./contracts.js";
import { pagedOutput } from "../outputContracts.js";
export const verificationRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  image: nodeTestGrantSchema.shape.image,
  createdAt: z.iso.datetime({ precision: 3 }),
  completedAt: z.iso.datetime({ precision: 3 }),
  result: nodeResultSchema,
  evidence: evidenceSchema,
  cleanup: z.enum(["complete", "incomplete"]),
  failure: z.object({ tag: z.string(), message: z.string() }).nullable(),
});
export type VerificationRun = z.infer<typeof verificationRunSchema>;
export const verificationHistorySchema = pagedOutput(
  z.strictObject({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    state: nodeResultSchema.shape.state,
    cleanup: verificationRunSchema.shape.cleanup,
    evidenceId: z.string().uuid(),
  }),
);
