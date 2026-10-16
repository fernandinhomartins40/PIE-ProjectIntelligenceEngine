import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import {
  runOwnedCommand,
  OwnedCommandFailure,
} from "../../process/OwnedCommand.js";
import type { ProviderProcessSupervisor } from "../../process/ProviderProcess.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";

/** Docker client process ownership is separate from daemon-side container ownership. */
export class DockerCommand {
  readonly #clients = new Set<ProviderProcessSupervisor>();
  constructor(
    readonly executable: string,
    readonly endpoint: string,
    readonly configDirectory: string,
  ) {
    if (
      !isAbsolute(executable) ||
      !isAbsolute(configDirectory) ||
      !/^(unix:\/\/\/[^\r\n\0]+|npipe:\/\/\/\/\.\/pipe\/docker(?:DesktopLinuxEngine|_engine))$/.test(
        endpoint,
      )
    )
      throw new AnalysisInputError("pie.docker", {
        userMessage:
          "Selecione executável, configuração privada e daemon Docker local explícitos.",
      });
  }
  async run(
    args: readonly string[],
    timeoutMs: number,
    outputBytes: number,
    signal?: AbortSignal,
  ) {
    try {
      return await runOwnedCommand(
        {
          command: this.executable,
          arguments: [
            "--host",
            this.endpoint,
            "--config",
            this.configDirectory,
            ...args,
          ],
          runId: randomUUID(),
          hostEnvironment: {},
          env: process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {},
        },
        { timeoutMs, diagnosticBytes: outputBytes, acceptNonZeroExit: true },
        {
          ...(signal ? { signal } : {}),
          retainCleanup: (owner) => {
            this.#clients.add(owner);
          },
        },
      );
    } catch (cause) {
      if (cause instanceof OwnedCommandFailure && cause.cleanupOwner)
        this.#clients.add(cause.cleanupOwner);
      throw cause;
    }
  }
  async close(): Promise<void> {
    for (const owner of this.#clients) {
      const result = await owner.stop();
      if (result.status !== "incomplete") this.#clients.delete(owner);
    }
    if (this.#clients.size)
      throw new AnalysisOutputError(
        "pie.docker",
        "Limpeza de clientes Docker incompleta.",
      );
  }
}
