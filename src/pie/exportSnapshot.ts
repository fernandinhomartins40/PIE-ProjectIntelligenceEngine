import { z } from "zod";
import { sha256 } from "./evidence.js";
import { PieError, type Snapshot } from "./contracts.js";
import { renderSnapshot } from "./reports.js";

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
  const bytes = Buffer.from(content, "utf8");
  if (input.offset > bytes.length)
    throw new PieError(
      "INVALID_INPUT",
      "Offset excede o tamanho da exportação.",
    );
  if (input.offset < bytes.length && (bytes[input.offset]! & 0xc0) === 0x80)
    throw new PieError(
      "INVALID_INPUT",
      "Offset precisa apontar para o início de um caractere UTF-8.",
    );
  let end = Math.min(bytes.length, input.offset + input.limitBytes);
  if (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    while (end > input.offset && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === input.offset)
      throw new PieError(
        "INVALID_INPUT",
        "Limite da página não comporta o próximo caractere UTF-8.",
      );
  }
  const nextOffset = end < bytes.length ? end : null;
  return exportSnapshotOutput.parse({
    schemaVersion: 1,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    format: input.format,
    offset: input.offset,
    totalBytes: bytes.length,
    nextOffset,
    sha256: sha256(bytes),
    content: bytes.subarray(input.offset, end).toString("utf8"),
  });
}
