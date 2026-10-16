import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { PieService } from "../service.js";
import { openQueue } from "./openQueue.js";
import { DiscoveryWorker } from "./worker.js";

export async function runJobCommand(
  command: string,
  target: string,
  localPath: string,
  service: PieService,
  key?: string,
) {
  const queue = await openQueue(localPath);
  try {
    switch (command) {
      case "enqueue": {
        const root = await realpath(resolve(target));
        await service.store.assertOutside(root);
        return await queue.enqueue({
          kind: "discovery",
          idempotencyKey: z.string().min(1).parse(key),
          payload: {
            repositoryRoot: root,
            profile: "OBSERVE",
            environment: "local",
          },
        });
      }
      case "job":
        return await queue.get(z.string().uuid().parse(target));
      case "cancel-job":
        return await queue.cancel(z.string().uuid().parse(target));
      case "work": {
        const worker = new DiscoveryWorker(
          queue,
          service,
          await realpath(resolve(target)),
        );
        const shutdown = () => {
          void worker.close().catch(() => {
            process.exitCode = 1;
          });
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
        try {
          return {
            processed: await worker.runOnce(),
            mode: "one-job",
            profile: "OBSERVE",
          };
        } finally {
          await worker.close();
          process.off("SIGINT", shutdown);
          process.off("SIGTERM", shutdown);
        }
      }
      default:
        throw new Error("Unsupported queue command");
    }
  } finally {
    await queue.close();
  }
}
