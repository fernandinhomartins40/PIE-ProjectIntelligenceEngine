import { z } from "zod";
import { startPieApi } from "./api.js";
import { openQueue } from "./jobs/openQueue.js";
import type { PieService } from "./service.js";
import { resolve } from "node:path";
import { VerificationCoordinator } from "./execution/coordinator.js";
import type { ExecutionCliOptions } from "./execution/cli.js";
import { PieError } from "./contracts.js";

interface ServeOptions {
  port?: string | undefined;
  apiOnly?: boolean | undefined;
  verification?:
    | Pick<ExecutionCliOptions, "stateDirectory" | "executable" | "endpoint">
    | undefined;
}

export async function serveApiCommand(
  service: PieService,
  root: string,
  dbPath: string,
  options: ServeOptions = {},
): Promise<void> {
  const port = z.coerce
    .number()
    .int()
    .min(0)
    .max(65535)
    .parse(options.port ?? 0);
  const queue = await openQueue(dbPath);
  let verifier: VerificationCoordinator | undefined;
  try {
    if (options.verification) {
      const { stateDirectory, executable, endpoint } = options.verification;
      if (!stateDirectory || !executable || !endpoint)
        throw new PieError(
          "INVALID_INPUT",
          "Informe state-dir, docker-bin e docker-host para habilitar VERIFY.",
        );
      verifier = await VerificationCoordinator.open(service.store, {
        root,
        stateDirectory,
        executable,
        endpoint,
      });
    }
    const api = await startPieApi(service, {
      root,
      queue,
      port,
      token: process.env.PIE_API_TOKEN ?? "",
      ...(verifier ? { verifier } : {}),
      ...(!options.apiOnly
        ? { webDirectory: resolve(import.meta.dirname, "../pie-web") }
        : {}),
    });
    console.log(
      JSON.stringify({
        url: api.url,
        profile: "OBSERVE",
        authentication: "Bearer PIE_API_TOKEN",
        verificationEnabled: verifier !== undefined,
      }),
    );
    let closing: Promise<void> | undefined;
    const shutdown = () => {
      closing ??= api.close().then(() => queue.close());
      void closing.catch(() => {
        process.stderr.write("Encerramento da API incompleto.\n");
        process.exitCode = 1;
        closing = undefined;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (cause) {
    try {
      await verifier?.close();
    } finally {
      await queue.close();
    }
    throw cause;
  }
}
