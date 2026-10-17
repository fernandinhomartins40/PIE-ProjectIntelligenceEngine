import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { PieError } from "../contracts.js";
import type { PiePersistence } from "../persistence.js";
import { nodeTestGrantSchema } from "./contracts.js";
import { NodeVerification } from "./verification.js";
import { privateState } from "./stateDirectory.js";
import { validateDockerClientSelection } from "./dockerCommand.js";
import { VerificationJournal } from "./resourceJournal.js";
import { admitNodeTests } from "./admission.js";
import { selectRetestCandidates } from "../retestPlan.js";
import type { NodeTestGrant } from "./contracts.js";
import type { Snapshot } from "../contracts.js";

/** Binds explicit test choices to a freshly recomputed, immutable snapshot plan. */
export function validateRetestAuthorization(
  grant: NodeTestGrant,
  before: Snapshot,
  after: Snapshot,
): void {
  const authorized = grant.retestPlan;
  if (!authorized) return;
  if (
    authorized.beforeSnapshotId !== before.id ||
    after.id !== grant.snapshotId
  )
    throw new PieError("POLICY_DENIED", "Plano de reteste fora do escopo.");
  const plan = selectRetestCandidates(before, after, authorized.mode);
  const candidates = new Set(plan.selected.map((item) => item.path));
  if (
    plan.planDigest !== authorized.planDigest ||
    grant.testFiles.some((path) => !candidates.has(path))
  )
    throw new PieError(
      "POLICY_DENIED",
      "Plano mudou ou teste autorizado não pertence à seleção recalculada.",
    );
}

export interface CoordinatorOptions {
  root: string;
  stateDirectory: string;
  executable: string;
  endpoint: string;
}
export type VerificationSelection = {
  stateDirectory?: string | undefined;
  executable?: string | undefined;
  endpoint?: string | undefined;
};
export async function openConfiguredVerifier(
  store: PiePersistence,
  root: string,
  selection?: VerificationSelection,
): Promise<VerificationCoordinator | undefined> {
  if (!selection) return undefined;
  const { stateDirectory, executable, endpoint } = selection;
  if (!stateDirectory || !executable || !endpoint)
    throw new PieError(
      "INVALID_INPUT",
      "Informe state-dir, docker-bin e docker-host para habilitar VERIFY.",
    );
  return VerificationCoordinator.open(store, {
    root,
    stateDirectory,
    executable,
    endpoint,
  });
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
  run(input: unknown, signal?: AbortSignal, runId?: string) {
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
      runId,
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
  async admit(input: unknown) {
    if (this.#closed)
      throw new PieError("POLICY_DENIED", "Verificador em encerramento.");
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
    const admitted = await admitNodeTests(grant, snapshot);
    if (!admitted.ok) throw admitted.error;
    await this.#validateRetestPlan(grant, snapshot);
    return { grant, snapshot };
  }
  async #validateRetestPlan(
    grant: NodeTestGrant,
    after: Snapshot,
  ): Promise<void> {
    if (!grant.retestPlan) return;
    const before = await this.store.snapshot(grant.retestPlan.beforeSnapshotId);
    validateRetestAuthorization(grant, before, after);
  }
  async #run(input: unknown, signal: AbortSignal, runId?: string) {
    signal.throwIfAborted();
    const { grant, snapshot } = await this.admit(input);
    signal.throwIfAborted();
    const owner = new NodeVerification({
      executable: this.options.executable,
      endpoint: this.options.endpoint,
      temporaryParent: this.options.stateDirectory,
      journal: this.journal,
      validateRetestPlan: (grant, snapshot) =>
        this.#validateRetestPlan(grant, snapshot),
    });
    this.#owners.add(owner);
    try {
      const run = await owner.execute(grant, snapshot, signal, runId);
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
