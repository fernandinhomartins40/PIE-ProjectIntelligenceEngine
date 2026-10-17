import type { PieService } from "../service.js";
import type { JobQueue } from "./contracts.js";
import { JobWorker } from "./worker.js";
import { JobDaemon } from "./daemon.js";
import {
  openConfiguredVerifier,
  type VerificationSelection,
} from "../execution/coordinator.js";
import { PieError } from "../contracts.js";

export interface WorkerCommandOptions {
  verification?: VerificationSelection | undefined;
  continuous?: boolean | undefined;
  pollMs?: number | undefined;
  verify: boolean;
}

/** Owns worker/coordinator shutdown; queue and store remain owned by the outer CLI. */
export async function runWorkerCommand(
  queue: JobQueue,
  service: PieService,
  root: string,
  options: WorkerCommandOptions,
) {
  const verifier = options.verify
    ? await openConfiguredVerifier(service.store, root, options.verification)
    : undefined;
  if (options.verify && !verifier)
    throw new PieError(
      "INVALID_INPUT",
      "VERIFY exige configuração explícita do Docker e estado privado.",
    );
  const worker = new JobWorker(
    queue,
    root,
    verifier
      ? { kind: "verification", verifier }
      : { kind: "discovery", service },
  );
  const daemon = options.continuous
    ? new JobDaemon(worker, options.pollMs)
    : undefined;
  const closeWorker = () => (daemon ? daemon.close() : worker.close());
  const dispose = async () => {
    try {
      await closeWorker();
    } finally {
      await verifier?.close();
    }
  };
  const shutdown = () => {
    void closeWorker().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const profile = verifier ? "VERIFY" : "OBSERVE";
  try {
    if (daemon) {
      console.log(
        JSON.stringify({
          state: "listening",
          mode: "continuous",
          profile,
          root,
          concurrency: 1,
        }),
      );
      return { ...(await daemon.run()), mode: "continuous", profile };
    }
    return { processed: await worker.runOnce(), mode: "one-job", profile };
  } finally {
    try {
      await dispose();
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
  }
}
