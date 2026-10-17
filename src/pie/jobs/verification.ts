import { z } from "zod";
import type { VerificationCoordinator } from "../execution/coordinator.js";
import { nodeTestGrantSchema } from "../execution/contracts.js";
import type { JobQueue } from "./contracts.js";

export const verificationJobInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
  authorization: nodeTestGrantSchema,
});

/** Admission does not execute; the worker revalidates the complete grant before acquisition. */
export async function enqueueVerification(
  queue: JobQueue,
  verifier: VerificationCoordinator,
  input: unknown,
) {
  const request = verificationJobInput.parse(input);
  const { grant } = await verifier.admit(request.authorization);
  return queue.enqueue({
    kind: "verification",
    idempotencyKey: request.idempotencyKey,
    payload: grant,
    maxAttempts: 1,
    timeoutMs: grant.limits.timeoutMs,
  });
}
