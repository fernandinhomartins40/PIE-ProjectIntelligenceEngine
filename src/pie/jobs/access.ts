import { PieError } from "../contracts.js";
import type { JobKind, JobQueue } from "./contracts.js";

/** Read authority uses the admitted source identity, never a display path or caller assertion. */
export async function scopedJob(
  queue: JobQueue,
  root: string,
  id: string,
  kind?: JobKind,
) {
  const job = await queue.get(id);
  if (
    job.payload.repositoryRoot !== root ||
    (kind !== undefined && job.kind !== kind)
  )
    throw new PieError(
      "POLICY_DENIED",
      "Job fora do escopo autorizado deste servidor.",
    );
  return job;
}
