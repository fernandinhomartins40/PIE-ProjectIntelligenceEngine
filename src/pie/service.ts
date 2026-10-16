import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PieError, policySchema } from "./contracts.js";
import { discoverProject, projectName } from "./discovery.js";
import { page } from "./graph.js";
import type { PieStore } from "./store.js";

/** Shared application workflow used by CLI and MCP; no target code execution. */
export class PieService {
  readonly #active = new Map<AbortController, Promise<unknown>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  constructor(readonly store: PieStore) {}

  discover(input: unknown, signal?: AbortSignal) {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
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
      await Promise.allSettled(this.#active.values());
      this.store.close();
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
    const project = this.store.addProject(
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
    this.store.saveSnapshot(snapshot);
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
    };
  }

  graph(snapshotId: string, input: unknown = {}) {
    const snapshot = this.store.snapshot(snapshotId);
    return {
      snapshotId,
      nodes: page(snapshot.nodes, input),
      edges: page(snapshot.edges, input),
      coverage: snapshot.coverage,
    };
  }
}
