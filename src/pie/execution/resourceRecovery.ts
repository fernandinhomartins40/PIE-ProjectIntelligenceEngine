import { rm } from "node:fs/promises";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import type { DockerCommand } from "./dockerCommand.js";
import { inspectDockerOwnership } from "./dockerPlan.js";
import type {
  VerificationJournal,
  RecoveryClaim,
  ResourceRecord,
} from "./resourceJournal.js";

export type RecoveryResult = {
  runId: string;
  state: "complete" | "blocked";
  reason: string | null;
};

/** Cleanup only. Never reruns interrupted tests or turns an interrupted audit into passed. */
export class ResourceRecovery {
  #claim: RecoveryClaim | null = null;
  #operation: Promise<RecoveryResult> | undefined;
  constructor(
    private readonly journal: VerificationJournal,
    private readonly client: DockerCommand,
    readonly runId: string,
  ) {}

  recover(): Promise<RecoveryResult> {
    this.#operation ??= this.#recover().finally(() => {
      this.#operation = undefined;
    });
    return this.#operation;
  }
  #record(): ResourceRecord {
    if (!this.#claim)
      throw new AnalysisOutputError("pie.recovery", "Claim não adquirido.");
    return this.journal.assertClaim(this.runId, this.#claim.token);
  }
  async #containerId(
    record: ResourceRecord,
    listedId: string,
  ): Promise<string> {
    const inspected = await this.client.run(
      ["container", "inspect", record.containerId ?? record.name],
      10_000,
      1_000_000,
    );
    if (
      inspected.exitCode !== 0 ||
      inspected.diagnosticTruncated ||
      inspected.stdout.invalidUtf8
    )
      throw new AnalysisOutputError(
        "pie.recovery",
        "Inspeção de ownership indisponível.",
      );
    const identity = inspectDockerOwnership(
      JSON.parse(inspected.stdout.text) as unknown,
      record,
    );
    if (!identity.ok) throw identity.error;
    if (
      identity.value !== listedId ||
      (record.containerId && record.containerId !== identity.value)
    )
      throw new AnalysisOutputError(
        "pie.recovery",
        "Identidade mudou antes da recuperação.",
      );
    return identity.value;
  }
  async #container(): Promise<void> {
    let record = this.#record();
    if (record.phase === "removed") return;
    if (record.phase !== "prepared") {
      const listed = await this.client.run(
        [
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          record.containerId
            ? `id=${record.containerId}`
            : `name=^/${record.name}$`,
          "--format",
          "{{.ID}}",
        ],
        10_000,
        100_000,
      );
      if (
        listed.exitCode !== 0 ||
        listed.stdout.invalidUtf8 ||
        listed.diagnosticTruncated
      )
        throw new AnalysisOutputError(
          "pie.recovery",
          "Inventário de contêineres incompleto.",
        );
      const ids = listed.stdout.text.trim().split(/\s+/).filter(Boolean);
      if (ids.length > 1 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
        throw new AnalysisOutputError(
          "pie.recovery",
          "Identidade de contêiner ambígua.",
        );
      if (ids.length === 0) {
        if (record.phase === "creating")
          throw new AnalysisOutputError(
            "pie.recovery",
            "Criação tardia não descartada; registro e raiz retidos.",
          );
      } else {
        const id = await this.#containerId(record, ids[0]!);
        this.#record();
        if (record.phase === "creating")
          this.journal.event(
            this.runId,
            { phase: "created", containerId: id },
            this.#claim!.token,
          );
        record = this.#record();
        const removed = await this.client.run(
          ["container", "rm", "--force", id],
          10_000,
          100_000,
        );
        if (removed.exitCode !== 0)
          throw new AnalysisOutputError(
            "pie.recovery",
            "Remoção do contêiner incompleta.",
          );
      }
    }
    this.journal.event(
      this.runId,
      { phase: "removed", containerId: record.containerId },
      this.#claim!.token,
    );
  }
  async #recover(): Promise<RecoveryResult> {
    try {
      const initial = this.journal.get(this.runId);
      if (initial.rootRemovedAt !== null)
        return { runId: this.runId, state: "complete", reason: null };
      if (
        this.client.endpoint !== initial.endpoint ||
        this.client.executable !== initial.executable
      )
        throw new AnalysisOutputError(
          "pie.recovery",
          "Cliente/daemon selecionado diverge do registro.",
        );
      this.#claim ??= await this.journal.claimRecovery(this.runId);
      const status = await this.journal.rootStatus(
        this.runId,
        this.#claim.token,
      );
      if (status === "unverified")
        throw new AnalysisOutputError(
          "pie.recovery",
          "Identidade da raiz não comprovada; nenhum recurso removido.",
        );
      await this.client.close();
      await this.#container();
      await this.client.close();
      if (
        (await this.journal.rootStatus(this.runId, this.#claim.token)) ===
        "owned"
      ) {
        const record = this.#record();
        await rm(record.root, { recursive: true, force: false });
      }
      await this.journal.finishRecovery(this.runId, this.#claim.token);
      return { runId: this.runId, state: "complete", reason: null };
    } catch (cause) {
      return {
        runId: this.runId,
        state: "blocked",
        reason:
          cause instanceof AnalysisOutputError
            ? cause.reason
            : "Falha de recuperação; ownership e recursos pendentes retidos.",
      };
    }
  }
}
