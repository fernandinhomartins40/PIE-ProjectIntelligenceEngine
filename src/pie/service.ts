import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PieError, policySchema } from "./contracts.js";
import { discoverProject, projectName } from "./discovery.js";
import { page } from "./graph.js";
import type { PiePersistence } from "./persistence.js";
import { compareSnapshots, comparisonInput } from "./compare.js";
import { traceInput, traceSnapshot } from "./knowledgeGraph.js";
import { assessFunctionalResult, functionalInput } from "./functional.js";
import { sealFunctional } from "./functionalRecord.js";
import { planRetests, retestInput } from "./retestPlan.js";
import { httpGrantSchema, probeLocalHttp } from "./execution/httpProbe.js";
import {
  compareVerificationRuns,
  verificationComparisonInput,
} from "./regressionResults.js";

function functionalValue(result: ReturnType<typeof assessFunctionalResult>) {
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError("INTEGRITY_ERROR", "Snapshot funcional inválido.");
  if (result.error.kind === "policy_denied")
    throw new PieError(
      "POLICY_DENIED",
      result.error.reason === "snapshot_mismatch"
        ? "Análise funcional pertence a outro snapshot."
        : "Análise funcional estática exige escopo OBSERVE correspondente.",
    );
  throw new PieError(
    "INVALID_INPUT",
    result.error.reason === "module_path"
      ? "Módulo deve ser caminho relativo canônico, sem segmentos vazios ou traversal."
      : "Entrada funcional inválida.",
  );
}

/** Shared application workflow used by CLI and MCP; no target code execution. */
export class PieService {
  readonly #active = new Map<AbortController, Promise<unknown>>();
  readonly #reads = new Set<Promise<unknown>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  constructor(readonly store: PiePersistence) {}

  discover(input: unknown, signal?: AbortSignal) {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    if (this.#active.size >= 2)
      return Promise.reject(
        new PieError(
          "LIMIT_EXCEEDED",
          "Limite de duas descobertas simultâneas; aguarde a conclusão.",
        ),
      );
    const controller = new AbortController();
    const effective = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const operation = this.#discover(input, effective);
    this.#active.set(controller, operation);
    void operation.then(
      () => this.#active.delete(controller),
      () => this.#active.delete(controller),
    );
    return operation;
  }

  probeHttp(input: unknown, authorizedRoot: string, signal?: AbortSignal) {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    if (this.#active.size >= 2)
      return Promise.reject(
        new PieError("LIMIT_EXCEEDED", "Limite de operações ativas atingido."),
      );
    const controller = new AbortController();
    const effective = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const operation = (async () => {
      const grant = httpGrantSchema.parse(input);
      const snapshot = await this.store.snapshot(grant.snapshotId);
      const result = await probeLocalHttp(
        grant,
        snapshot,
        authorizedRoot,
        effective,
      );
      if (!result.ok) return result;
      effective.throwIfAborted();
      return {
        ok: true as const,
        value: await this.store.saveHttpProbe(result.value),
      };
    })();
    this.#active.set(controller, operation);
    void operation.then(
      () => this.#active.delete(controller),
      () => this.#active.delete(controller),
    );
    return operation;
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= (async () => {
      for (const controller of this.#active.keys()) controller.abort();
      await Promise.allSettled([...this.#active.values(), ...this.#reads]);
      await this.store.close();
    })().catch((cause) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return this.#closePromise;
  }

  async #discover(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const policy = policySchema.parse(input);
    const root = await realpath(resolve(policy.repositoryRoot));
    await this.store.assertOutside(root);
    const project = await this.store.addProject(
      randomUUID(),
      root,
      projectName(root),
    );
    const snapshot = await discoverProject(
      { ...policy, repositoryRoot: root },
      project.id,
      signal,
    );
    // Cancellation cutoff: synchronous transaction commits a complete publication.
    signal.throwIfAborted();
    await this.store.saveSnapshot(snapshot);
    return {
      project,
      snapshot: {
        id: snapshot.id,
        revision: snapshot.revision,
        dirty: snapshot.dirty,
        createdAt: snapshot.createdAt,
        treeDigest: snapshot.treeDigest,
      },
      coverage: snapshot.coverage,
      nodeCount: snapshot.nodes.length,
      evidenceCount: snapshot.evidence.length,
      declarationCount: snapshot.declarations.length,
    };
  }

  #read<T>(action: () => Promise<T>): Promise<T> {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    const operation = action();
    this.#reads.add(operation);
    void operation.then(
      () => this.#reads.delete(operation),
      () => this.#reads.delete(operation),
    );
    return operation;
  }

  projects(input: unknown = {}) {
    return this.#read(async () => this.store.projects(input));
  }
  history(projectId: string, input: unknown = {}) {
    return this.#read(async () => this.store.history(projectId, input));
  }
  evidence(id: string) {
    return this.#read(async () => this.store.evidence(id));
  }
  verification(id: string) {
    return this.#read(async () => this.store.verification(id));
  }
  httpProbe(id: string) {
    return this.#read(async () => this.store.httpProbe(id));
  }
  httpProbes(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => this.store.httpProbes(snapshotId, input));
  }
  verifications(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => this.store.verifications(snapshotId, input));
  }
  projectVerifications(projectId: string, input: unknown = {}) {
    return this.#read(async () =>
      this.store.projectVerifications(projectId, input),
    );
  }
  verificationComparison(input: unknown) {
    return this.#read(async () => {
      const request = verificationComparisonInput.parse(input);
      const before = await this.store.verification(request.beforeRunId);
      const after = await this.store.verification(request.afterRunId);
      const [beforeSnapshot, afterSnapshot] = await Promise.all([
        this.store.snapshot(before.snapshotId),
        this.store.snapshot(after.snapshotId),
      ]);
      return compareVerificationRuns(
        before,
        beforeSnapshot,
        after,
        afterSnapshot,
        request,
      );
    });
  }

  graph(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => {
      const snapshot = await this.store.snapshot(snapshotId);
      return {
        snapshotId,
        nodes: page(snapshot.nodes, input),
        edges: page(snapshot.edges, input),
        coverage: snapshot.coverage,
      };
    });
  }

  declarations(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => {
      const snapshot = await this.store.snapshot(snapshotId);
      return {
        snapshotId,
        declarations: page(snapshot.declarations, input),
        coverage: snapshot.coverage,
      };
    });
  }

  trace(input: unknown) {
    return this.#read(async () => {
      const parsed = traceInput.parse(input);
      return traceSnapshot(
        await this.store.snapshot(parsed.snapshotId),
        parsed,
      );
    });
  }

  compare(input: unknown) {
    return this.#read(async () => {
      const { beforeId, afterId, ...paging } = comparisonInput.parse(input);
      const [before, after] = await Promise.all([
        this.store.snapshot(beforeId),
        this.store.snapshot(afterId),
      ]);
      return compareSnapshots(before, after, paging);
    });
  }
  retestPlan(input: unknown) {
    return this.#read(async () => {
      const request = retestInput.parse(input);
      const [before, after] = await Promise.all([
        this.store.snapshot(request.beforeId),
        this.store.snapshot(request.afterId),
      ]);
      return planRetests(before, after, request);
    });
  }
  functional(input: unknown) {
    return this.#read(async () => {
      const request = functionalInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      return functionalValue(
        assessFunctionalResult(snapshot, request, {
          profile: "OBSERVE",
          environment: "local",
          repositoryRoot: snapshot.root,
        }),
      );
    });
  }
  retainFunctional(input: unknown) {
    return this.#read(async () => {
      const request = functionalInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      const result = functionalValue(
        assessFunctionalResult(snapshot, request, {
          profile: "OBSERVE",
          environment: "local",
          repositoryRoot: snapshot.root,
        }),
      );
      return this.store.saveFunctional(sealFunctional(request, result));
    });
  }
  functionalRecord(id: string) {
    return this.#read(async () => this.store.functionalRecord(id));
  }
  functionalRecords(snapshotId: string, input: unknown = {}) {
    return this.#read(async () =>
      this.store.functionalRecords(snapshotId, input),
    );
  }
}
