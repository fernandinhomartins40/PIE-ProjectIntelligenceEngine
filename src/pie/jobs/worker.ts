import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { PieError } from "../contracts.js";
import type { PieService } from "../service.js";
import type { JobQueue } from "./contracts.js";
import type { VerificationCoordinator } from "../execution/coordinator.js";

type Workflow =
  | { kind: "discovery"; service: PieService }
  | { kind: "verification"; verifier: VerificationCoordinator };

const abortFailureCode = (reason: unknown, closing: boolean): string => {
  if (reason instanceof Error) {
    switch (reason.message) {
      case "JOB_TIMEOUT":
        return "JOB_TIMEOUT";
      case "LEASE_OR_CANCELLATION":
        return "LEASE_LOST";
      case "HEARTBEAT_FAILED":
        return "HEARTBEAT_FAILED";
    }
  }
  return closing ? "WORKER_SHUTDOWN" : "ABORTED";
};

/** Owns the lease through execution, persistence and final cleanup for one selected workflow. */
export class JobWorker {
  readonly owner = randomUUID();
  #active: Promise<boolean> | undefined;
  #controller: AbortController | undefined;
  #closing = false;
  constructor(
    private readonly queue: JobQueue,
    private readonly authorizedRoot: string,
    private readonly workflow: Workflow,
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
    if (this.#closing) return false;
    const job = await this.queue.claim(
      this.owner,
      this.leaseMs,
      root,
      this.workflow.kind,
    );
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
      // The periodic heartbeat alone leaves a lease-sized window in which a
      // cancellation immediately after claim could still start target work.
      // Renew and observe cancellation before dispatching either workflow.
      if (
        !(await this.queue.heartbeat(job.id, job.leaseToken!, this.leaseMs))
      ) {
        const current = await this.queue.get(job.id);
        if (
          current.leaseToken === job.leaseToken &&
          current.state === "cancelling"
        ) {
          await this.queue.finish(
            job.id,
            job.leaseToken!,
            "cancelled",
            {},
            "CANCELLED",
          );
          return true;
        }
        throw new PieError(
          "POLICY_DENIED",
          "Lease perdida antes do início do workflow.",
        );
      }
      if (controller.signal.aborted)
        throw new PieError(
          "POLICY_DENIED",
          "Job cancelado ou expirado antes do início do workflow.",
        );
      let result: object;
      if (job.kind === "discovery" && this.workflow.kind === "discovery") {
        result = await this.workflow.service.discover(
          job.payload,
          controller.signal,
        );
      } else if (
        job.kind === "verification" &&
        this.workflow.kind === "verification"
      ) {
        const run = await this.workflow.verifier.run(
          job.payload,
          controller.signal,
          job.id,
        );
        result = {
          runId: run.id,
          state: run.result.state,
          evidenceId: run.evidence.id,
        };
      } else
        throw new PieError(
          "POLICY_DENIED",
          "Job incompatível com o worker selecionado.",
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
          ? abortFailureCode(controller.signal.reason, this.#closing)
          : cause instanceof PieError
            ? cause.code
            : "WORKFLOW_FAILED";
      if (!cancelled && errorCode === "WORKER_SHUTDOWN")
        await this.queue.interrupt(job.id, job.leaseToken!, errorCode);
      else
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
