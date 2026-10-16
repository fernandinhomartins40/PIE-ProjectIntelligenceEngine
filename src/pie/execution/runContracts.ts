import { z } from "zod";
import { evidenceSchema } from "../contracts.js";
import { nodeResultSchema } from "./nodeResults.js";
import { nodeTestGrantSchema } from "./contracts.js";
import { pagedOutput } from "../outputContracts.js";
export const verificationRunV1Schema = z.strictObject({
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
export type VerificationPayload =
  | Omit<z.infer<typeof verificationRunV1Schema>, "evidence">
  | Omit<z.infer<typeof verificationRunV2Schema>, "evidence">;
export const verificationHistorySchema = pagedOutput(
  z.strictObject({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    state: nodeResultSchema.shape.state,
    cleanup: verificationRunV1Schema.shape.cleanup,
    evidenceId: z.string().uuid(),
  }),
);
