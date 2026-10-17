import { z } from "zod";
import { randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import {
  functionalInput,
  functionalOutput,
  selectFunctionalTargets,
} from "./functional.js";
import { PieError, type Snapshot } from "./contracts.js";
import { sha256 } from "./evidence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { pagedOutput } from "./outputContracts.js";
export const functionalHistorySchema = pagedOutput(
  z.strictObject({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    modulePath: z.string(),
    offset: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    state: z.literal("unverified"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);
export function functionalSummary(record: FunctionalRecord) {
  return {
    id: record.id,
    snapshotId: record.snapshotId,
    createdAt: record.createdAt,
    modulePath: record.request.modulePath,
    offset: record.result.findings.offset,
    count: record.result.findings.items.length,
    total: record.result.findings.total,
    state: record.result.state,
    sha256: record.sha256,
  };
}

const payload = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  createdAt: z.iso.datetime({ precision: 3 }),
  request: functionalInput,
  result: functionalOutput,
});
export const functionalRecordSchema = payload.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FunctionalRecord = z.infer<typeof functionalRecordSchema>;
export function sealFunctional(
  request: unknown,
  result: unknown,
): FunctionalRecord {
  const value = payload.parse({
    schemaVersion: 1,
    id: randomUUID(),
    snapshotId: functionalInput.parse(request).snapshotId,
    createdAt: new Date().toISOString(),
    request,
    result,
  });
  return { ...value, sha256: sha256(canonicalize(value)!) };
}
/** Historical analyses are verified against their retained facts, never recomputed by a newer engine. */
export function validateFunctional(
  input: unknown,
  snapshotInput: Snapshot,
): FunctionalRecord {
  const record = functionalRecordSchema.parse(input);
  const snapshot = validateSnapshot(snapshotInput);
  const { sha256: digest, ...value } = record;
  const facts = new Map(snapshot.declarations.map((fact) => [fact.id, fact]));
  const expected = selectFunctionalTargets(snapshot, record.request);
  const actual = record.result.findings;
  if (
    actual.total !== expected.selected.total ||
    actual.nextOffset !== expected.selected.nextOffset ||
    record.result.scope.declaredTargets !== expected.targets.length ||
    record.result.scope.examinedTargets !== expected.selected.items.length ||
    canonicalize(actual.items.map((item) => item.declaration)) !==
      canonicalize(expected.selected.items)
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Cobertura da análise funcional diverge do escopo preservado.",
    );
  if (
    digest !== sha256(canonicalize(value)!) ||
    record.snapshotId !== snapshot.id ||
    record.request.snapshotId !== snapshot.id ||
    record.result.snapshotId !== snapshot.id ||
    record.result.scope.modulePath !== record.request.modulePath ||
    record.result.findings.offset !== record.request.offset
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Análise funcional sem integridade ou vínculo ao snapshot.",
    );
  for (const finding of record.result.findings.items) {
    const fact = facts.get(finding.declaration.id);
    if (
      !fact ||
      canonicalize(fact) !== canonicalize(finding.declaration) ||
      canonicalize(finding.evidenceIds) !==
        canonicalize([
          fact.evidenceId,
          ...fact.derivations.map((item) => item.evidenceId),
        ])
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Achado funcional perdeu proveniência da declaração.",
      );
  }
  return record;
}

export function validateStoredFunctional(
  row: { id: string; snapshotId: string; createdAt: string; payload: unknown },
  snapshot: Snapshot,
) {
  const record = validateFunctional(row.payload, snapshot);
  if (
    record.id !== row.id ||
    record.snapshotId !== row.snapshotId ||
    record.createdAt !== row.createdAt
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Índices da análise funcional divergem do registro.",
    );
  return record;
}
