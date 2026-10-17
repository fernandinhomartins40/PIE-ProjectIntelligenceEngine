import { PieError, type Snapshot } from "../contracts.js";
import { verificationRunSchema, type VerificationRun } from "./runContracts.js";
import { verifyRunEvidence } from "./runEvidence.js";
import canonicalize from "canonicalize";
import { verifyEvidence } from "../evidence.js";
import { hasValidTestBindings } from "./testBindings.js";

export function validateVerificationRun(
  input: unknown,
  snapshot: Snapshot,
): VerificationRun {
  const run = verifyRunEvidence(verificationRunSchema.parse(input));
  if (
    run.projectId !== snapshot.projectId ||
    run.snapshotId !== snapshot.id ||
    run.evidence.revision !== snapshot.revision ||
    run.evidence.environment !== "local" ||
    Date.parse(run.completedAt) < Date.parse(run.createdAt)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Execução não corresponde ao contexto do snapshot.",
    );
  if (
    run.schemaVersion === 2 &&
    (run.authorizedRoot !== snapshot.root ||
      run.authorization.treeDigest !== snapshot.treeDigest)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Autorização não corresponde ao conteúdo ou raiz observados.",
    );
  if (
    run.schemaVersion === 2 &&
    !hasValidTestBindings(run.authorization, snapshot)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Bindings VERIFY não correspondem ao grant ou às declarações do snapshot.",
    );
  return run;
}

export function validateStoredVerification(
  row: {
    id: string;
    snapshotId: string;
    evidenceId: string;
    createdAt: string;
    payload: unknown;
    evidence: unknown;
  },
  snapshot: Snapshot,
): VerificationRun {
  const run = validateVerificationRun(row.payload, snapshot);
  if (
    run.id !== row.id ||
    run.snapshotId !== row.snapshotId ||
    run.evidence.id !== row.evidenceId ||
    run.createdAt !== row.createdAt ||
    canonicalize(verifyEvidence(row.evidence)) !== canonicalize(run.evidence)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Vínculo persistido da execução ou evidência inválido.",
    );
  return run;
}
