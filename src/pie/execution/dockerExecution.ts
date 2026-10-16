import { z } from "zod";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { OwnedCommandFailure } from "../../process/OwnedCommand.js";
import type { ProviderProcessSnapshot } from "../../process/ProviderProcess.js";
import { DockerCommand } from "./dockerCommand.js";
import {
  inspectDockerOwnership,
  validateDockerSandbox,
  type DockerPlan,
} from "./dockerPlan.js";
import { normalizeNodeResult, type NodeCapture } from "./nodeResults.js";

const imageSchema = z
  .array(
    z.object({
      Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      Os: z.literal("linux"),
      Config: z.object({
        Volumes: z.record(z.string(), z.unknown()).nullable(),
      }),
    }),
  )
  .length(1);
const stateSchema = z
  .array(
    z.object({
      Id: z.string(),
      State: z.object({
        Running: z.boolean(),
        Status: z.string(),
        ExitCode: z.number().int(),
        OOMKilled: z.boolean(),
        Error: z.string(),
      }),
    }),
  )
  .length(1);
const json = (output: ProviderProcessSnapshot): unknown => {
  if (
    output.exitCode !== 0 ||
    output.stdout.invalidUtf8 ||
    output.diagnosticTruncated
  )
    throw new AnalysisOutputError(
      "pie.docker",
      "Resposta Docker indisponível ou incompleta.",
    );
  try {
    return JSON.parse(output.stdout.text);
  } catch {
    throw new AnalysisOutputError(
      "pie.docker",
      "Resposta Docker não contém JSON válido.",
    );
  }
};

export interface DockerExecutionResult {
  readonly result: ReturnType<typeof normalizeNodeResult>;
  readonly containerId: string | null;
  readonly failure: string | null;
  readonly cleanup: "complete" | "incomplete";
  /** Caller must retain this owner AND its workspace until close succeeds. */
  readonly cleanupOwner: DockerExecution | null;
}
export type DockerResourceEvent = {
  phase: "creating" | "created" | "removed";
  containerId: string | null;
};

/** One owner per grant; uncertain creation is never interpreted as absence. */
export class DockerExecution {
  #started = false;
  #attempted = false;
  #createConfirmed = false;
  #id: string | null = null;
  #closed = false;
  #closing: Promise<void> | undefined;
  constructor(
    readonly plan: DockerPlan,
    private readonly client: DockerCommand,
    private readonly record?: (
      event: DockerResourceEvent,
    ) => void | Promise<void>,
  ) {}

  async #create(
    command: (
      args: readonly string[],
      bytes?: number,
    ) => Promise<ProviderProcessSnapshot>,
  ): Promise<void> {
    const image = imageSchema.parse(
      json(await command(["image", "inspect", this.plan.image])),
    )[0]!;
    if (Object.keys(image.Config.Volumes ?? {}).length)
      throw new AnalysisOutputError(
        "pie.docker",
        "Imagem declara volumes não autorizados.",
      );
    await this.record?.({ phase: "creating", containerId: null });
    this.#attempted = true;
    const created = await command(this.plan.arguments);
    if (
      created.exitCode !== 0 ||
      !/^[a-f0-9]{64}\s*$/.test(created.stdout.text)
    )
      throw new AnalysisOutputError("pie.docker", "Criação não confirmada.");
    this.#createConfirmed = true;
    const inspected = json(
      await command(["container", "inspect", this.plan.name]),
    );
    const identity = inspectDockerOwnership(inspected, this.plan);
    if (!identity.ok) throw identity.error;
    this.#id = identity.value;
    if (this.#id !== created.stdout.text.trim())
      throw new AnalysisOutputError(
        "pie.docker",
        "ID criado diverge da inspeção.",
      );
    await this.record?.({ phase: "created", containerId: this.#id });
    const admission = validateDockerSandbox(inspected, this.plan, image.Id);
    if (!admission.ok) throw admission.error;
  }

  async execute(signal?: AbortSignal): Promise<DockerExecutionResult> {
    if (this.#started || this.#closed)
      throw new AnalysisOutputError(
        "pie.docker",
        "Execução já iniciada ou encerrada.",
      );
    this.#started = true;
    const startedAt = performance.now();
    let output = Buffer.alloc(0);
    let capture: NodeCapture = {
      started: false,
      completed: false,
      exitCode: null,
      signal: null,
      truncated: false,
    };
    let failure: string | null = null;
    const command = async (args: readonly string[], bytes = 1_000_000) => {
      signal?.throwIfAborted();
      const remaining = Math.min(
        this.plan.grant.limits.timeoutMs - (performance.now() - startedAt),
        Date.parse(this.plan.grant.expiresAt) - Date.now(),
      );
      if (remaining <= 0)
        throw new AnalysisOutputError(
          "pie.docker",
          "Prazo de execução ou autorização expirou.",
        );
      return this.client.run(args, remaining, bytes, signal);
    };
    try {
      await this.#create(command);
      capture.started = true;
      const attached = await command(
        ["container", "start", "--attach", this.#id!],
        this.plan.grant.limits.outputBytes,
      );
      output = Buffer.from(attached.stdout.text);
      capture.truncated =
        attached.diagnosticTruncated === true ||
        attached.stdout.invalidUtf8 === true;
      const final = stateSchema.parse(
        json(await command(["container", "inspect", this.#id!])),
      )[0]!;
      if (
        final.Id !== this.#id ||
        final.State.Running ||
        final.State.Status !== "exited" ||
        final.State.Error ||
        final.State.OOMKilled
      )
        throw new AnalysisOutputError(
          "pie.docker",
          "Contêiner não concluiu normalmente.",
        );
      capture.completed = true;
      capture.exitCode = final.State.ExitCode;
    } catch (cause) {
      failure =
        cause instanceof AnalysisOutputError
          ? cause.reason
          : "Execução interrompida ou provider indisponível.";
      if (cause instanceof OwnedCommandFailure && cause.snapshot) {
        output = Buffer.from(cause.snapshot.stdout.text);
        capture.truncated =
          cause.reason === "output-limit" ||
          cause.snapshot.diagnosticTruncated === true;
      }
    }
    let cleanup: "complete" | "incomplete" = "complete";
    try {
      await this.close();
    } catch {
      cleanup = "incomplete";
    }
    if (signal?.aborted) {
      capture.completed = false;
      failure ??= "Execução cancelada, inclusive durante finalização.";
    }
    if (cleanup === "incomplete") capture.completed = false;
    return {
      result: normalizeNodeResult(output, capture, {
        bytes: this.plan.grant.limits.outputBytes,
        records: 100_000,
      }),
      containerId: this.#id,
      failure,
      cleanup,
      cleanupOwner: cleanup === "incomplete" ? this : null,
    };
  }

  close(): Promise<void> {
    this.#closing ??= this.#close().catch((cause) => {
      this.#closing = undefined;
      throw cause;
    });
    return this.#closing;
  }
  async #close(): Promise<void> {
    await this.client.close();
    if (this.#closed) return;
    if (this.#attempted) {
      const list = await this.client.run(
        [
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          this.#id ? `id=${this.#id}` : `name=^/${this.plan.name}$`,
          "--format",
          "{{.ID}}",
        ],
        10_000,
        100_000,
      );
      if (list.exitCode !== 0 || list.diagnosticTruncated)
        throw new AnalysisOutputError(
          "pie.docker",
          "Não foi possível verificar recursos retidos.",
        );
      const ids = list.stdout.text.trim().split(/\s+/).filter(Boolean);
      if (ids.length === 0) {
        if (!this.#createConfirmed)
          throw new AnalysisOutputError(
            "pie.docker",
            "Criação pode concluir tardiamente; ownership retido para retry.",
          );
      } else {
        const inspected = json(
          await this.client.run(
            ["container", "inspect", this.#id ?? this.plan.name],
            10_000,
            1_000_000,
          ),
        );
        const identity = inspectDockerOwnership(inspected, this.plan);
        if (!identity.ok) throw identity.error;
        if (this.#id && this.#id !== identity.value)
          throw new AnalysisOutputError(
            "pie.docker",
            "Identidade mudou antes da limpeza.",
          );
        this.#id = identity.value;
        const removed = await this.client.run(
          ["container", "rm", "--force", this.#id],
          10_000,
          100_000,
        );
        if (removed.exitCode !== 0)
          throw new AnalysisOutputError(
            "pie.docker",
            "Remoção do contêiner incompleta.",
          );
      }
    }
    await this.client.close();
    await this.record?.({ phase: "removed", containerId: this.#id });
    this.#closed = true;
  }
}
