import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { PieError } from "../contracts.js";
import type { PieService } from "../service.js";
import type { JobQueue } from "./contracts.js";

/** Executes only the discovery workflow. It cannot run project scripts or mutate a target. */
export class DiscoveryWorker {
  readonly owner = randomUUID();
  #active: Promise<boolean> | undefined;
  #controller: AbortController | undefined;
  #closing = false;
  constructor(
    private readonly queue: JobQueue,
    private readonly service: PieService,
    private readonly authorizedRoot: string,
    private readonly leaseMs = 10_000,
  ) {}

  runOnce(): Promise<boolean> {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Worker em encerramento."),
      );
    if (this.#active)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Worker já está processando um job."),
      );
    const active = this.#run();
    this.#active = active;
    void active.then(
      () => {
        this.#active = undefined;
      },
      () => {
        this.#active = undefined;
      },
    );
    return active;
  }

  async #run(): Promise<boolean> {
    const root = await realpath(this.authorizedRoot);
    const job = await this.queue.claim(this.owner, this.leaseMs, root);
    if (!job) return false;
    const controller = new AbortController();
    this.#controller = controller;
    if (this.#closing) controller.abort();
    const timeout = setTimeout(
      () => controller.abort(new Error("JOB_TIMEOUT")),
      job.timeoutMs,
    );
    let renewing = false;
    let renewal: Promise<void> = Promise.resolve();
    const heartbeat = setInterval(
      () => {
        if (renewing) return;
        renewing = true;
        renewal = (async () => {
          if (
            !(await this.queue.heartbeat(job.id, job.leaseToken!, this.leaseMs))
          )
            controller.abort(new Error("LEASE_OR_CANCELLATION"));
        })()
          .catch(() => controller.abort(new Error("HEARTBEAT_FAILED")))
          .finally(() => {
            renewing = false;
          });
      },
      Math.max(50, Math.floor(this.leaseMs / 3)),
    );
    try {
      if (
        (await realpath(job.payload.repositoryRoot)) !==
        (await realpath(this.authorizedRoot))
      )
        throw new PieError(
          "POLICY_DENIED",
          "Job fora da raiz autorizada para este worker.",
        );
      const result = await this.service.discover(
        job.payload,
        controller.signal,
      );
      const accepted = await this.queue.finish(
        job.id,
        job.leaseToken!,
        "succeeded",
        result,
      );
      if (!accepted)
        throw new PieError(
          "POLICY_DENIED",
          "Lease expirada; resultado não assumido pelo worker antigo.",
        );
    } catch (cause) {
      const current = await this.queue.get(job.id);
      const cancelled = current.state === "cancelling";
      const errorCode = cancelled
        ? "CANCELLED"
        : controller.signal.aborted
          ? "ABORTED_OR_TIMEOUT"
          : cause instanceof PieError
            ? cause.code
            : "DISCOVERY_FAILED";
      await this.queue.finish(
        job.id,
        job.leaseToken!,
        cancelled ? "cancelled" : "failed",
        {},
        errorCode,
      );
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      await renewal;
      this.#controller = undefined;
    }
    return true;
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#controller?.abort();
    await this.#active;
  }
}
