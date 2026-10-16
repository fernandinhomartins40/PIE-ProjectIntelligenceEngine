import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { PieError } from "../contracts.js";
import type { PiePersistence } from "../persistence.js";
import { nodeTestGrantSchema } from "./contracts.js";
import { NodeVerification } from "./verification.js";
import { privateState } from "./stateDirectory.js";
import { validateDockerClientSelection } from "./dockerCommand.js";
import { VerificationJournal } from "./resourceJournal.js";

export interface CoordinatorOptions {
  root: string;
  stateDirectory: string;
  executable: string;
  endpoint: string;
}

/** One bounded execution at a time; the application, not an adapter, owns pending cleanup. */
export class VerificationCoordinator {
  readonly #owners = new Set<NodeVerification>();
  #operation: Promise<unknown> | undefined;
  #controller: AbortController | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;
  private constructor(
    private readonly store: PiePersistence,
    readonly options: Readonly<CoordinatorOptions>,
    private readonly journal: VerificationJournal,
  ) {}

  static async open(
    store: PiePersistence,
    options: CoordinatorOptions,
  ): Promise<VerificationCoordinator> {
    const root = await realpath(options.root);
    await store.assertOutside(root);
    const stateDirectory = await privateState(options.stateDirectory, root);
    validateDockerClientSelection(
      options.executable,
      options.endpoint,
      stateDirectory,
    );
    const journal = await VerificationJournal.open(
      join(stateDirectory, "resources.sqlite"),
    );
    return new VerificationCoordinator(
      store,
      Object.freeze({ ...options, root, stateDirectory }),
      journal,
    );
  }
  run(input: unknown, signal?: AbortSignal) {
    if (this.#closed)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Verificador em encerramento."),
      );
    if (this.#operation || this.#owners.size)
      return Promise.reject(
        new PieError(
          "BUSY",
          "Execução ativa ou limpeza pendente; aguarde antes de iniciar outra verificação.",
        ),
      );
    const controller = new AbortController();
    this.#controller = controller;
    const operation = this.#run(
      input,
      signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    );
    this.#operation = operation;
    void operation.then(
      () => this.#settled(operation),
      () => this.#settled(operation),
    );
    return operation;
  }
  #settled(operation: Promise<unknown>) {
    if (this.#operation === operation) {
      this.#operation = undefined;
      this.#controller = undefined;
    }
  }
  async #run(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const grant = nodeTestGrantSchema.parse(input);
    const snapshot = await this.store.snapshot(grant.snapshotId);
    if (
      (await realpath(grant.repositoryRoot)) !== this.options.root ||
      (await realpath(snapshot.root)) !== this.options.root
    )
      throw new PieError(
        "POLICY_DENIED",
        "Grant e snapshot devem pertencer à raiz autorizada na inicialização.",
      );
    signal.throwIfAborted();
    const owner = new NodeVerification({
      executable: this.options.executable,
      endpoint: this.options.endpoint,
      temporaryParent: this.options.stateDirectory,
      journal: this.journal,
    });
    this.#owners.add(owner);
    try {
      const run = await owner.execute(grant, snapshot, signal);
      await this.store.saveVerification(run);
      return run;
    } finally {
      try {
        await owner.close();
        this.#owners.delete(owner);
      } catch {
        /* Retain ownership and deny new work until cleanup is retried. */
      }
    }
  }
  async retryCleanup(): Promise<void> {
    if (this.#operation)
      throw new PieError(
        "POLICY_DENIED",
        "Aguarde o término da execução antes de repetir a limpeza.",
      );
    for (const owner of this.#owners) {
      await owner.close();
      this.#owners.delete(owner);
    }
  }
  close(): Promise<void> {
    this.#closed = true;
    this.#controller?.abort();
    this.#closing ??= (async () => {
      await this.#operation?.catch(() => undefined);
      // Clear the completed operation before cleanup admission, even when promise callbacks race.
      this.#operation = undefined;
      await this.retryCleanup();
      this.journal.close();
    })().catch((cause) => {
      this.#closing = undefined;
      throw cause;
    });
    return this.#closing;
  }
}
