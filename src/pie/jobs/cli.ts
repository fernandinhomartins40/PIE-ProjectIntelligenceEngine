import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { PieService } from "../service.js";
import { openQueue } from "./openQueue.js";
import { runWorkerCommand } from "./workerCli.js";
import {
  openConfiguredVerifier,
  type VerificationSelection,
} from "../execution/coordinator.js";
import { readNodeTestGrant } from "../execution/grantFile.js";
import { openVerificationPersistence } from "../openPersistence.js";
import { enqueueVerification } from "./verification.js";
import { PieError } from "../contracts.js";

interface JobCommandOptions {
  key?: string | undefined;
  verification?: VerificationSelection | undefined;
  continuous?: boolean | undefined;
  pollMs?: number | undefined;
}

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
  options: JobCommandOptions = {},
) {
  const pollMs = z
    .number()
    .int()
    .min(100)
    .max(30_000)
    .parse(options.pollMs ?? 1000);
  if (
    (options.continuous || options.pollMs !== undefined) &&
    !["work", "work-verify"].includes(command)
  )
    throw new PieError(
      "INVALID_INPUT",
      "Modo contínuo só se aplica a workers.",
    );
  if (options.pollMs !== undefined && !options.continuous)
    throw new PieError("INVALID_INPUT", "poll-ms exige continuous.");
  const queue = await openQueue(localPath);
  try {
    switch (command) {
      case "enqueue": {
        const root = await realpath(resolve(target));
        await service.store.assertOutside(root);
        return await queue.enqueue({
          kind: "discovery",
          idempotencyKey: z.string().min(1).parse(options.key),
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
        return await runWorkerCommand(
          queue,
          service,
          await realpath(resolve(target)),
          { ...options, pollMs, verify: command === "work-verify" },
        );
      }
      default:
        throw new Error("Unsupported queue command");
    }
  } finally {
    await queue.close();
  }
}
