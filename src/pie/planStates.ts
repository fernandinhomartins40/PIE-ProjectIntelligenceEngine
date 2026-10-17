import { z } from "zod";

/** Human triage labels; none of these claims technical verification. */
export const planTriageStatus = z.enum([
  "open",
  "accepted",
  "rejected",
  "in_progress",
  "completed",
]);
