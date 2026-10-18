import { z } from "zod";
import { PieError } from "./contracts.js";
import type { PieService } from "./service.js";
import { pageUtf8Artifact } from "./utf8Artifact.js";

export const dataReviewExportInput = z.strictObject({
  snapshotId: z.string().uuid(),
  format: z.enum(["json", "md", "html"]).default("json"),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});

export const dataReviewExportOutput = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.literal("unverified"),
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

/** Exports the complete shared Data Review projection without claiming runtime state. */
export async function exportDataReview(service: PieService, rawInput: unknown) {
  const input = dataReviewExportInput.parse(rawInput);
  const snapshot = await service.store.snapshot(input.snapshotId);
  const first = await service.dataReview({
    snapshotId: input.snapshotId,
    offset: 0,
    limit: 200,
  });
  const models = [...first.models.items];
  const migrations = [...first.migrations.items];
  const relations = [...first.relations.items];
  const maxTotal = Math.max(
    first.models.total,
    first.migrations.total,
    first.relations.total,
  );
  for (let offset = 200; offset < maxTotal; offset += 200) {
    const next = await service.dataReview({
      snapshotId: input.snapshotId,
      offset,
      limit: 200,
    });
    if (
      next.snapshotId !== first.snapshotId ||
      next.models.total !== first.models.total ||
      next.migrations.total !== first.migrations.total ||
      next.relations.total !== first.relations.total ||
      JSON.stringify(next.coverage) !== JSON.stringify(first.coverage)
    )
      throw new PieError(
        "BUSY",
        "A revisão de dados mudou durante a exportação; tente novamente.",
      );
    models.push(...next.models.items);
    migrations.push(...next.migrations.items);
    relations.push(...next.relations.items);
  }
  if (
    models.length !== first.models.total ||
    migrations.length !== first.migrations.total ||
    relations.length !== first.relations.total ||
    new Set(models.map((item) => item.id)).size !== models.length ||
    new Set(migrations.map((item) => item.id)).size !== migrations.length ||
    new Set(relations.map((item) => item.id)).size !== relations.length
  )
    throw new PieError(
      "BUSY",
      "A revisão de dados ficou incompleta durante a exportação; tente novamente.",
    );
  const report = {
    ...first,
    models: {
      items: models,
      total: models.length,
      offset: 0,
      nextOffset: null,
    },
    migrations: {
      items: migrations,
      total: migrations.length,
      offset: 0,
      nextOffset: null,
    },
    relations: {
      items: relations,
      total: relations.length,
      offset: 0,
      nextOffset: null,
    },
  };
  const json = JSON.stringify(report, null, 2);
  const content =
    input.format === "json"
      ? json
      : input.format === "md"
        ? "# Revisão de dados PIE\n\n" +
          "- Snapshot: " +
          report.snapshotId +
          "\n- Digest da árvore: " +
          snapshot.treeDigest +
          "\n- Estado: não verificado em runtime\n\n" +
          json
            .split("\n")
            .map((line) => "    " + line)
            .join("\n")
        : '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Revisão de dados PIE</title><h1>Revisão de dados PIE</h1><p>Snapshot ' +
          escapeHtml(report.snapshotId) +
          " · árvore " +
          snapshot.treeDigest +
          " · não verificado em runtime</p><pre>" +
          escapeHtml(json) +
          "</pre></html>";
  return dataReviewExportOutput.parse({
    schemaVersion: 1,
    snapshotId: report.snapshotId,
    treeDigest: snapshot.treeDigest,
    state: "unverified",
    format: input.format,
    offset: input.offset,
    ...pageUtf8Artifact(content, input.offset, input.limitBytes),
  });
}
