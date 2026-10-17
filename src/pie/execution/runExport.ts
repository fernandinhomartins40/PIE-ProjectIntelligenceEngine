import { PieError, type Snapshot } from "../contracts.js";
import { pageUtf8Artifact } from "../utf8Artifact.js";
import { validateVerificationRun } from "./runIntegrity.js";
import {
  verificationExportInput,
  verificationExportOutput,
} from "./runContracts.js";

/** Export the immutable retained VERIFY record without executing its grant. */
export function exportVerification(
  input: unknown,
  snapshot: Snapshot,
  request: unknown,
) {
  const options = verificationExportInput.parse(request);
  const run = validateVerificationRun(input, snapshot);
  if (run.id !== options.id)
    throw new PieError("INVALID_INPUT", "Execução da exportação diverge.");
  const page = pageUtf8Artifact(
    JSON.stringify(run, null, 2),
    options.offset,
    options.limitBytes,
  );
  return verificationExportOutput.parse({
    schemaVersion: 1,
    runId: run.id,
    snapshotId: run.snapshotId,
    treeDigest: snapshot.treeDigest,
    evidenceId: run.evidence.id,
    runSha256: run.evidence.source.sha256,
    format: "json",
    offset: options.offset,
    ...page,
  });
}
