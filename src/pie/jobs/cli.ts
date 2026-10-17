import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { PieService } from "../service.js";
import { openQueue } from "./openQueue.js";
import { JobWorker } from "./worker.js";
import {
  openConfiguredVerifier,
  type VerificationSelection,
} from "../execution/coordinator.js";
import { readNodeTestGrant } from "../execution/grantFile.js";
import { openVerificationPersistence } from "../openPersistence.js";
import { enqueueVerification } from "./verification.js";
import { PieError } from "../contracts.js";

export async function enqueueVerificationCli(
  path: string,
  localPath: string,
  key: string | undefined,
  selection?: VerificationSelection,
) {
  const grant = await readNodeTestGrant(path);
  const { store, snapshot } = await openVerificationPersistence(
    localPath,
    grant,
  );
  let queue: Awaited<ReturnType<typeof openQueue>> | undefined;
  let verifier: Awaited<ReturnType<typeof openConfiguredVerifier>>;
  try {
    verifier = await openConfiguredVerifier(store, snapshot.root, selection);
    if (!verifier)
      throw new PieError(
        "INVALID_INPUT",
        "Enfileirar VERIFY exige configuração explícita.",
      );
    queue = await openQueue(localPath);
    return await enqueueVerification(queue, verifier, {
      idempotencyKey: key,
      authorization: grant,
    });
  } finally {
    try {
      await verifier?.close();
    } finally {
      await queue?.close();
      await store.close();
    }
  }
}

export async function runJobCommand(
  command: string,
  target: string,
  localPath: string,
  service: PieService,
  key?: string,
  verification?: VerificationSelection,
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
      case "work":
      case "work-verify": {
        const root = await realpath(resolve(target));
        const verifier =
          command === "work-verify"
            ? await openConfiguredVerifier(service.store, root, verification)
            : undefined;
        if (command === "work-verify" && !verifier)
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
            profile: verifier ? "VERIFY" : "OBSERVE",
          };
        } finally {
          await worker.close();
          await verifier?.close();
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
