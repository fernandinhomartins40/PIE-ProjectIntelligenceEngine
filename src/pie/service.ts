import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PieError, policySchema } from "./contracts.js";
import { discoverProject, projectName } from "./discovery.js";
import { page } from "./graph.js";
import type { PiePersistence } from "./persistence.js";
import { compareSnapshots, comparisonInput } from "./compare.js";
import { traceInput, traceSnapshot } from "./knowledgeGraph.js";

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
  verifications(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => this.store.verifications(snapshotId, input));
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
}
