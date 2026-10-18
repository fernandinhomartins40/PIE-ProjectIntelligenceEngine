import { z } from "zod";
import { PieError, type Snapshot } from "../contracts.js";
import { pageUtf8Artifact } from "../utf8Artifact.js";
import { validateHttpProbe } from "./httpIntegrity.js";
import { httpProbeSchema } from "./httpProbe.js";

export const httpProbeExportInput = z.strictObject({
  id: z.string().uuid(),
  format: z.enum(["json", "md", "html"]).default("json"),
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
  format: z.enum(["json", "md", "html"]),
  offset: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

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
  const json = JSON.stringify(record, null, 2);
  const content =
    options.format === "json"
      ? json
      : options.format === "md"
        ? `# Sondagem HTTP PIE\n\n- Registro: ${record.id}\n- Snapshot: ${record.snapshotId}\n- Digest da árvore: ${snapshotInput.treeDigest}\n- Evidence: ${record.evidence.id}\n- Estado: ${record.state}\n\n${json
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n")}`
        : `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Sondagem HTTP PIE</title><h1>Sondagem HTTP PIE</h1><p>Registro ${escapeHtml(record.id)} · snapshot ${escapeHtml(record.snapshotId)} · árvore ${snapshotInput.treeDigest} · Evidence ${escapeHtml(record.evidence.id)} · ${escapeHtml(record.state)}</p><pre>${escapeHtml(json)}</pre></html>`;
  const page = pageUtf8Artifact(content, options.offset, options.limitBytes);
  return httpProbeExportOutput.parse({
    schemaVersion: 1,
    recordId: record.id,
    snapshotId: record.snapshotId,
    treeDigest: snapshotInput.treeDigest,
    evidenceId: record.evidence.id,
    recordSha256: record.evidence.source.sha256,
    format: options.format,
    offset: options.offset,
    ...page,
  });
}
