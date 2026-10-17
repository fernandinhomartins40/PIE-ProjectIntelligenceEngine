import { setTimeout as delay } from "node:timers/promises";
import { PieError } from "../contracts.js";
import type { JobWorker } from "./worker.js";

/** Owns one worker through sequential claims and abortable idle waits. Failures stop the loop. */
export class JobDaemon {
  readonly #controller = new AbortController();
  #operation: Promise<{ processed: number }> | undefined;
  #closing: Promise<void> | undefined;
  constructor(
    private readonly worker: JobWorker,
    private readonly idleMs = 1000,
  ) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 100 || idleMs > 30_000)
      throw new PieError(
        "INVALID_INPUT",
        "Intervalo do worker deve estar entre 100 e 30000 ms.",
      );
  }
  run(): Promise<{ processed: number }> {
    if (this.#operation || this.#controller.signal.aborted)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Daemon já iniciado ou encerrado."),
      );
    this.#operation = this.#run();
    return this.#operation;
  }
  async #run() {
    let processed = 0;
    try {
      while (!this.#controller.signal.aborted) {
        if (await this.worker.runOnce()) {
          processed++;
          continue;
        }
        try {
          await delay(this.idleMs, undefined, {
            signal: this.#controller.signal,
          });
        } catch (cause) {
          if (!this.#controller.signal.aborted) throw cause;
        }
      }
      return { processed };
    } finally {
      await this.worker.close();
    }
  }
  close(): Promise<void> {
    this.#controller.abort();
    this.#closing ??= (async () => {
      await this.worker.close();
      await this.#operation?.catch(() => undefined);
    })().catch((cause) => {
      this.#closing = undefined;
      throw cause;
    });
    return this.#closing;
  }
}
