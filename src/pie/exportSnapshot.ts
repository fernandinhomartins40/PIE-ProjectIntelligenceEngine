import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { renderSnapshot } from "./reports.js";
import { pageUtf8Artifact } from "./utf8Artifact.js";

export const exportSnapshotInput = z.strictObject({
  snapshotId: z.string().uuid(),
  format: z.enum(["json", "md", "html"]).default("json"),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});

export const exportSnapshotOutput = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(["json", "md", "html"]),
  offset: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});

/** Export a sealed snapshot in bounded UTF-8 pages with stable artifact identity. */
export function exportSnapshot(snapshot: Snapshot, rawInput: unknown) {
  const input = exportSnapshotInput.parse(rawInput);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Snapshot da exportação diverge.");
  const content = renderSnapshot(snapshot, input.format);
  const page = pageUtf8Artifact(content, input.offset, input.limitBytes);
  return exportSnapshotOutput.parse({
    schemaVersion: 1,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    format: input.format,
    offset: input.offset,
    ...page,
  });
}
