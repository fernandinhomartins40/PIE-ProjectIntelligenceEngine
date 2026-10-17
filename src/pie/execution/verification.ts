import {
  verificationRunSchema,
  type VerificationRun,
  type VerificationPayload,
} from "./runContracts.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { sha256 } from "../evidence.js";
import { runEvidence, verifyRunEvidence } from "./runEvidence.js";
import { admitNodeTests, type AdmittedNodeTests } from "./admission.js";
import { prepareWorkspace, type PreparedWorkspace } from "./workspace.js";
import { DockerCommand } from "./dockerCommand.js";
import { DockerExecution } from "./dockerExecution.js";
import { buildDockerPlan } from "./dockerPlan.js";
import { NODE_REPORTER_SOURCE } from "./nodeReporter.js";
import { normalizeNodeResult } from "./nodeResults.js";
import type { VerificationJournal } from "./resourceJournal.js";

export interface VerificationOptions {
  executable: string;
  endpoint: string;
  temporaryParent: string;
  journal?: VerificationJournal;
}

/** Composes admission, acquisition and execution; owns every resource until cleanup is proven. */
export class NodeVerification {
  #workspace: PreparedWorkspace | null = null;
  #rollback: PrivateRuntimeRoot | null = null;
  #execution: DockerExecution | null = null;
  #journalRunId: string | null = null;
  #operation: Promise<VerificationRun> | undefined;
  #closing: Promise<void> | undefined;
  #stopping = new AbortController();
  #closed = false;
  constructor(readonly options: VerificationOptions) {}

  execute(
    input: unknown,
    snapshot: unknown,
    signal?: AbortSignal,
    runId?: string,
  ): Promise<VerificationRun> {
    if (this.#operation || this.#closed)
      return Promise.reject(
        new AnalysisOutputError(
          "pie.verify",
          "Instância de verificação já utilizada ou encerrada.",
        ),
      );
    const effective = signal
      ? AbortSignal.any([signal, this.#stopping.signal])
      : this.#stopping.signal;
    this.#operation = this.#execute(
      input,
      snapshot,
      effective,
      runId === undefined ? randomUUID() : z.string().uuid().parse(runId),
    );
    return this.#operation;
  }

  async #resources(
    admitted: AdmittedNodeTests,
    id: string,
    signal: AbortSignal,
  ) {
    const prepared = await prepareWorkspace(
      admitted,
      this.options.temporaryParent,
      signal,
    );
    if (!prepared.ok) {
      this.#rollback = prepared.error.cleanupOwner;
      throw prepared.error.cause;
    }
    this.#workspace = prepared.value;
    const reporter = join(prepared.value.controlDirectory, "reporter.mjs");
    const config = join(prepared.value.controlDirectory, "docker-config");
    await writeFile(reporter, NODE_REPORTER_SOURCE, {
      flag: "wx",
      mode: 0o444,
    });
    await mkdir(config, { mode: 0o700 });
    const plan = buildDockerPlan(
      admitted.grant,
      prepared.value.directory,
      reporter,
      id,
    );
    if (!plan.ok) throw plan.error;
    const client = new DockerCommand(
      this.options.executable,
      this.options.endpoint,
      config,
    );
    await this.options.journal?.register({
      runId: id,
      root: prepared.value.controlDirectory,
      endpoint: this.options.endpoint,
      executable: this.options.executable,
    });
    if (this.options.journal) this.#journalRunId = id;
    this.#execution = new DockerExecution(
      plan.value,
      client,
      this.options.journal
        ? (event) => this.options.journal!.event(id, event)
        : undefined,
    );
    return this.#execution;
  }

  async #execute(
    input: unknown,
    snapshot: unknown,
    signal: AbortSignal,
    id: string,
  ): Promise<VerificationRun> {
    const admission = await admitNodeTests(input, snapshot);
    if (!admission.ok) throw admission.error;
    const { grant, snapshot: observed } = admission.value;
    const createdAt = new Date().toISOString();
    const deadline = AbortSignal.timeout(grant.limits.timeoutMs);
    const effective = AbortSignal.any([signal, deadline]);
    let result = normalizeNodeResult(
      Buffer.alloc(0),
      {
        started: false,
        completed: false,
        exitCode: null,
        signal: null,
        truncated: false,
      },
      { bytes: grant.limits.outputBytes, records: 100_000 },
    );
    let failure: VerificationRun["failure"] = null;
    try {
      const execution = await this.#resources(admission.value, id, effective);
      const output = await execution.execute(effective);
      result = output.result;
      if (output.failure)
        failure = { tag: "execution", message: output.failure };
    } catch (cause) {
      failure =
        cause instanceof AnalysisError
          ? {
              tag: cause._tag,
              message:
                cause.userMessage ??
                "Verificação não pôde iniciar ou concluir.",
            }
          : {
              tag: "unavailable",
              message: "Recurso de verificação indisponível.",
            };
    }
    let cleanup: VerificationRun["cleanup"] = "complete";
    try {
      await this.#cleanup();
    } catch {
      cleanup = "incomplete";
    }
    if (cleanup === "incomplete" || effective.aborted) {
      result = {
        ...result,
        state: result.state === "blocked" ? "blocked" : "inconclusive",
        coverage: {
          ...result.coverage,
          limitations: [
            ...result.coverage.limitations,
            cleanup === "incomplete"
              ? "Recursos retidos para nova tentativa de limpeza."
              : "Cancelamento ou deadline observado durante a finalização.",
          ],
        },
      };
    }
    const payload: Extract<VerificationPayload, { schemaVersion: 2 }> = {
      schemaVersion: 2,
      authorization: grant,
      authorizedRoot: observed.root,
      id,
      projectId: observed.projectId,
      snapshotId: observed.id,
      authorizationDigest: sha256(canonicalize(grant)!),
      image: grant.image,
      createdAt,
      completedAt: new Date().toISOString(),
      result,
      cleanup,
      failure,
    };
    return verifyRunEvidence(
      verificationRunSchema.parse({
        ...payload,
        evidence: runEvidence(payload, observed, grant.environment),
      }),
    );
  }

  async #cleanup(): Promise<void> {
    // Mounted files must outlive a container whose deletion is still uncertain.
    if (this.#execution) {
      await this.#execution.close();
      this.#execution = null;
    }
    if (this.#workspace) {
      await this.#workspace.close();
      this.#workspace = null;
    }
    if (this.#rollback) {
      await this.#rollback.close();
      this.#rollback = null;
    }
    if (this.#journalRunId) {
      await this.options.journal!.finishLive(this.#journalRunId);
      this.#journalRunId = null;
    }
  }
  close(): Promise<void> {
    this.#closed = true;
    this.#stopping.abort();
    this.#closing ??= (async () => {
      await this.#operation?.catch(() => undefined);
      await this.#cleanup();
    })().catch((cause) => {
      this.#closing = undefined;
      throw cause;
    });
    return this.#closing;
  }
}
