import canonicalize from "canonicalize";
import { PieError, type Snapshot } from "../contracts.js";
import { validateSnapshot } from "../snapshotIntegrity.js";
import { verifyHttpProbe } from "./httpProbe.js";

export function validateHttpProbe(input: unknown, observation: Snapshot) {
  const record = verifyHttpProbe(input);
  const snapshot = validateSnapshot(observation);
  if (
    record.snapshotId !== snapshot.id ||
    record.evidence.projectId !== snapshot.projectId ||
    record.evidence.revision !== snapshot.revision ||
    record.authorization.treeDigest !== snapshot.treeDigest ||
    record.authorizedRoot !== snapshot.root ||
    record.evidence.createdAt !== record.completedAt ||
    record.evidence.source.line !== null ||
    record.evidence.expiresAt !==
      new Date(
        Date.parse(record.completedAt) + record.authorization.evidenceTtlMs,
      ).toISOString() ||
    Date.parse(record.createdAt) > Date.parse(record.completedAt)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Registro HTTP não corresponde ao snapshot ou tempo preservado.",
    );
  return record;
}
export function validateStoredHttpProbe(
  row: {
    id: string;
    snapshotId: string;
    evidenceId: string;
    createdAt: string;
    payload: unknown;
    evidence: unknown;
  },
  snapshot: Snapshot,
) {
  const record = validateHttpProbe(row.payload, snapshot);
  if (
    row.id !== record.id ||
    row.snapshotId !== record.snapshotId ||
    row.evidenceId !== record.evidence.id ||
    row.createdAt !== record.createdAt ||
    canonicalize(row.evidence) !== canonicalize(record.evidence)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Índices/prova HTTP divergem do registro preservado.",
    );
  return record;
}
