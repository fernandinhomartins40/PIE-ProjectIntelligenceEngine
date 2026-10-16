import { z } from "zod";
import { startPieApi } from "./api.js";
import { openQueue } from "./jobs/openQueue.js";
import type { PieService } from "./service.js";

export async function serveApiCommand(
  service: PieService,
  root: string,
  dbPath: string,
  rawPort?: string,
): Promise<void> {
  const port = z.coerce
    .number()
    .int()
    .min(0)
    .max(65535)
    .parse(rawPort ?? 0);
  const queue = await openQueue(dbPath);
  try {
    const api = await startPieApi(service, {
      root,
      queue,
      port,
      token: process.env.PIE_API_TOKEN ?? "",
    });
    console.log(
      JSON.stringify({
        url: api.url,
        profile: "OBSERVE",
        authentication: "Bearer PIE_API_TOKEN",
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
    await queue.close();
    throw cause;
  }
}
