import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import {
  PrivateRuntimeRoot,
  privateRuntimeRootCapability,
} from "../../process/PrivateRuntimeRoot.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
  AnalysisInputError,
  AnalysisTimeoutError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { sha256 } from "../evidence.js";
import { inventoryPath } from "../inventoryPath.js";
import { readInventoryFile } from "../readFile.js";
import { snapshotFiles } from "../snapshotFiles.js";
import { PieError } from "../contracts.js";
import type { AdmittedNodeTests } from "./admission.js";

export type WorkspaceError =
  | AnalysisInputError
  | AnalysisTimeoutError
  | AnalysisArtifactChangedError
  | AnalysisCancelledError
  | AnalysisCapabilityUnavailableError
  | AnalysisOutputError
  | AnalysisResourceConstraintError;
export interface PreparedWorkspace {
  readonly directory: string;
  readonly bytes: number;
  readonly files: number;
  close(): Promise<void>;
}
export interface WorkspaceFailure {
  readonly cause: WorkspaceError;
  /** Retained owner is mandatory when rollback could not remove the private directory. */
  readonly cleanupOwner: PrivateRuntimeRoot | null;
  readonly cleanupFailure: AnalysisOutputError | null;
}

function workspaceError(cause: unknown, cancelled: boolean): WorkspaceError {
  if (cancelled) return new AnalysisCancelledError("pie.verify");
  if (cause instanceof PieError && cause.code === "POLICY_DENIED")
    return new AnalysisInputError("pie.verify", { userMessage: cause.message });
  if (
    cause instanceof AnalysisInputError ||
    cause instanceof AnalysisTimeoutError ||
    cause instanceof AnalysisArtifactChangedError ||
    cause instanceof AnalysisResourceConstraintError ||
    cause instanceof AnalysisOutputError
  )
    return cause;
  return new AnalysisOutputError(
    "pie.verify",
    "Não foi possível preparar cópia privada e consistente.",
  );
}

/** Copy only observed bytes into an owned private directory; target files are never written. */
export async function prepareWorkspace(
  admitted: AdmittedNodeTests,
  parent: string,
  signal?: AbortSignal,
): Promise<Result<PreparedWorkspace, WorkspaceFailure>> {
  const capability = privateRuntimeRootCapability();
  if (!capability.available)
    return err({
      cause: new AnalysisCapabilityUnavailableError(
        "private-runtime",
        "pie.verify",
        capability.reason,
      ),
      cleanupOwner: null,
      cleanupFailure: null,
    });
  let owner: PrivateRuntimeRoot | null = null;
  try {
    const { snapshot, grant } = admitted;
    const started = performance.now();
    const checkpoint = (): number => {
      signal?.throwIfAborted();
      if (Date.parse(grant.expiresAt) <= Date.now())
        throw new AnalysisInputError("pie.verify", {
          userMessage: "Autorização expirou durante a preparação.",
        });
      const remaining = grant.limits.timeoutMs - (performance.now() - started);
      if (remaining <= 0)
        throw new AnalysisTimeoutError("pie.verify", grant.limits.timeoutMs);
      return remaining;
    };
    const delta = relative(realpathSync(snapshot.root), realpathSync(parent));
    if (
      delta === "" ||
      (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`))
    )
      throw new AnalysisOutputError(
        "pie.verify",
        "Diretório temporário deve ficar fora do projeto.",
      );
    checkpoint();
    owner = await PrivateRuntimeRoot.create({ parent, prefix: "pie-verify-" });
    const directory = join(owner.path, "source");
    await mkdir(directory);
    let bytes = 0;
    for (const { node, source } of snapshotFiles(snapshot)) {
      checkpoint();
      const path = await inventoryPath(snapshot.root, node.path);
      const remaining = grant.limits.sourceBytes - bytes;
      const content = await readInventoryFile(path, remaining, checkpoint);
      if (!content)
        throw new AnalysisResourceConstraintError(
          "pie.verify",
          "file-size",
          "Limite de cópia excedido.",
          { sourceBytes: grant.limits.sourceBytes },
        );
      if (sha256(content) !== source.source.sha256)
        throw new AnalysisArtifactChangedError(
          "pie.verify",
          node.path,
          "Conteúdo mudou desde a descoberta.",
        );
      bytes += content.length;
      const destination = join(directory, node.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, { flag: "wx", mode: 0o400 });
    }
    checkpoint();
    const retained = owner;
    return ok({
      directory,
      bytes,
      files: snapshot.nodes.length,
      close: () => retained.close(),
    });
  } catch (cause) {
    const failure = workspaceError(cause, signal?.aborted === true);
    let cleanupFailure: AnalysisOutputError | null = null;
    try {
      await owner?.close();
      owner = null;
    } catch (cleanupCause) {
      cleanupFailure = new AnalysisOutputError(
        "pie.verify",
        "Limpeza da cópia privada incompleta.",
        {
          cause: cleanupCause,
          cleanup: {
            reason: "Diretório privado ainda não removido.",
            resources: owner ? [owner.path] : [],
          },
        },
      );
    }
    return err({ cause: failure, cleanupOwner: owner, cleanupFailure });
  }
}
