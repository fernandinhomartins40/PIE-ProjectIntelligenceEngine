import canonicalize from "canonicalize";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../contracts.js";
import { PieError } from "../contracts.js";
import { sealEvidence, sha256, verifyEvidence } from "../evidence.js";
import type { VerificationRun, VerificationPayload } from "./runContracts.js";

export function runEvidence(
  payload: VerificationPayload,
  observed: Snapshot,
  environment: string,
) {
  const { id, result, cleanup } = payload;
  const digest = sha256(canonicalize(payload)!);
  return sealEvidence({
    schemaVersion: 1,
    id: randomUUID(),
    projectId: observed.projectId,
    snapshotId: observed.id,
    auditRunId: id,
    revision: observed.revision,
    environment,
    method: "test",
    confidence: "observed",
    state:
      result.state === "passed"
        ? "verified"
        : result.state === "failed"
          ? "failing"
          : result.state === "blocked"
            ? "blocked"
            : "partial",
    createdAt: new Date().toISOString(),
    source: { path: `pie-run:${id}`, line: null, sha256: digest },
    sensitivity: "internal",
    redactionStatus: "not_collected",
    expiresAt: null,
    limitations: [
      ...result.coverage.limitations,
      "Execução Node cobre somente os arquivos explicitamente autorizados; não valida todos os comportamentos do projeto.",
      "Credenciais e ambiente do host não foram coletados.",
    ],
    observation: `Resultado Node ${result.state}; registro completo SHA-256 ${digest}; limpeza ${cleanup}.`,
  });
}

/** Binds the immutable proof to its owning run and normalized result. */
export function verifyRunEvidence(run: VerificationRun): VerificationRun {
  const { evidence: _evidence, ...payload } = run;
  const proof = verifyEvidence(run.evidence);
  if (
    run.schemaVersion === 2 &&
    (run.authorizationDigest !== sha256(canonicalize(run.authorization)!) ||
      run.image !== run.authorization.image ||
      run.snapshotId !== run.authorization.snapshotId ||
      proof.environment !== run.authorization.environment)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Autorização de execução diverge do registro.",
    );
  const expected =
    run.result.state === "passed"
      ? "verified"
      : run.result.state === "failed"
        ? "failing"
        : run.result.state === "blocked"
          ? "blocked"
          : "partial";
  if (
    proof.projectId !== run.projectId ||
    proof.snapshotId !== run.snapshotId ||
    proof.auditRunId !== run.id ||
    proof.method !== "test" ||
    proof.confidence !== "observed" ||
    proof.state !== expected ||
    proof.source.path !== `pie-run:${run.id}` ||
    proof.source.sha256 !== sha256(canonicalize(payload)!)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Resultado de execução diverge da evidência vinculada.",
    );
  if (run.cleanup !== "complete" && run.result.state === "passed")
    throw new PieError(
      "INTEGRITY_ERROR",
      "Limpeza incompleta não permite aprovação.",
    );
  return run;
}
