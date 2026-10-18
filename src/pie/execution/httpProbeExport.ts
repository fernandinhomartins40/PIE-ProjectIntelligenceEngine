import { z } from "zod";
import { PieError, type Snapshot } from "../contracts.js";
import { pageUtf8Artifact } from "../utf8Artifact.js";
import { validateHttpProbe } from "./httpIntegrity.js";
import { httpProbeSchema } from "./httpProbe.js";

export const httpProbeExportInput = z.strictObject({
  id: z.string().uuid(),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});

export const httpProbeExportOutput = z.strictObject({
  schemaVersion: z.literal(1),
  recordId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceId: z.string().uuid(),
  recordSha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.literal("json"),
  offset: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});

/** Exports a revalidated immutable HTTP observation without sending another request. */
export function exportHttpProbe(
  input: unknown,
  snapshotInput: Snapshot,
  request: unknown,
) {
  const options = httpProbeExportInput.parse(request);
  const record = validateHttpProbe(httpProbeSchema.parse(input), snapshotInput);
  if (record.id !== options.id)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Identidade do registro exportado diverge.",
    );
  const page = pageUtf8Artifact(
    JSON.stringify(record, null, 2),
    options.offset,
    options.limitBytes,
  );
  return httpProbeExportOutput.parse({
    schemaVersion: 1,
    recordId: record.id,
    snapshotId: record.snapshotId,
    treeDigest: snapshotInput.treeDigest,
    evidenceId: record.evidence.id,
    recordSha256: record.evidence.source.sha256,
    format: "json",
    offset: options.offset,
    ...page,
  });
}
