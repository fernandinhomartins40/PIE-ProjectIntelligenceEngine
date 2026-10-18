import { PieError, type Snapshot } from "../contracts.js";
import { verificationRunSchema, type VerificationRun } from "./runContracts.js";
import { verifyRunEvidence } from "./runEvidence.js";
import canonicalize from "canonicalize";
import { verifyEvidence } from "../evidence.js";
import { hasValidTestBindings } from "./testBindings.js";

function runtimeLocationsMatchAuthorization(
  run: Extract<VerificationRun, { schemaVersion: 2 }>,
  snapshot: Snapshot,
): boolean {
  if (run.result.schemaVersion !== 2) return true;
  const grant = run.authorization;
  const allowed = new Set<string>();
  if (grant.schemaVersion === 2 && grant.testFiles.length === 1) {
    const declarations = new Map(
      snapshot.declarations.map((declaration) => [declaration.id, declaration]),
    );
    for (const binding of grant.testBindings) {
      const declaration = declarations.get(binding.declarationId);
      if (declaration && declaration.source.line !== null)
        allowed.add(
          JSON.stringify([declaration.source.path, declaration.source.line]),
        );
    }
  }
  const observed = new Set<string>();
  for (const location of run.result.runtimeLocations.locations) {
    const identity = JSON.stringify([location.sourcePath, location.line]);
    if (!allowed.has(identity) || observed.has(identity)) return false;
    observed.add(identity);
  }
  return true;
}

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
  if (
    run.schemaVersion === 2 &&
    !runtimeLocationsMatchAuthorization(run, snapshot)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Locais de runtime excedem as declarações autorizadas e instrumentadas.",
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
