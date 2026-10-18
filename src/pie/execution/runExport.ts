import { z } from "zod";
import { err, ok, type Result } from "../../domain/result.js";
import { PieError, type Snapshot } from "../contracts.js";
import { pageUtf8Artifact, renderJsonArtifact } from "../utf8Artifact.js";
import { validateVerificationRun } from "./runIntegrity.js";
import {
  verificationExportInput,
  verificationExportOutput,
  type VerificationRun,
} from "./runContracts.js";

/** Export the immutable retained VERIFY record without executing its grant. */
export function exportVerificationResult(
  input: unknown,
  snapshot: Snapshot,
  request: unknown,
): Result<
  ReturnType<typeof verificationExportOutput.parse>,
  | { kind: "invalid_input" }
  | { kind: "invalid_run" }
  | { kind: "policy_denied"; reason: "run_id_mismatch" }
> {
  const options = verificationExportInput.safeParse(request);
  if (!options.success) return err({ kind: "invalid_input" });

  let run: VerificationRun;
  try {
    run = validateVerificationRun(input, snapshot);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_run" });
    throw cause;
  }
  if (run.id !== options.data.id)
    return err({ kind: "policy_denied", reason: "run_id_mismatch" });

  const content = renderJsonArtifact(
    JSON.stringify(run, null, 2),
    options.data.format,
    "Execução VERIFY PIE",
    [
      ["Execução", run.id],
      ["Snapshot", run.snapshotId],
      ["Digest da árvore", snapshot.treeDigest],
      ["Estado", run.result.state],
      ["Limpeza", run.cleanup],
      ["Evidence", run.evidence.id],
    ],
  );
  const page = pageUtf8Artifact(
    content,
    options.data.offset,
    options.data.limitBytes,
  );
  return ok(
    verificationExportOutput.parse({
      schemaVersion: 1,
      runId: run.id,
      snapshotId: run.snapshotId,
      treeDigest: snapshot.treeDigest,
      evidenceId: run.evidence.id,
      runSha256: run.evidence.source.sha256,
      format: options.data.format,
      offset: options.data.offset,
      ...page,
    }),
  );
}
