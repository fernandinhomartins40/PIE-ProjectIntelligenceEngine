import { z } from "zod";
import { planContestationSchema } from "./planContestation.js";
import { planItemSchema } from "./planning.js";
import { planTriageEventSchema } from "./planTriage.js";
import { pageUtf8Artifact } from "./utf8Artifact.js";

export const planItemHistoryExportInput = z.strictObject({
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  format: z.enum(["json", "md", "html"]).default("json"),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});

const planItemHistorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  item: planItemSchema,
  triage: z.array(planTriageEventSchema),
  contestations: z.array(planContestationSchema),
});

export const planItemHistoryExportOutput = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1).max(500),
  triageEvents: z.number().int().nonnegative(),
  contestations: z.number().int().nonnegative(),
  format: z.enum(["json", "md", "html"]),
  offset: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
});

function html(value: string) {
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

export function renderPlanItemHistoryExport(
  rawHistory: unknown,
  rawInput: unknown,
) {
  const input = planItemHistoryExportInput.parse(rawInput);
  const history = planItemHistorySchema.parse(rawHistory);
  const content =
    input.format === "json"
      ? JSON.stringify(history, null, 2)
      : input.format === "md"
        ? `# Histórico do item ${history.item.id}\n\n- Snapshot: ${history.snapshotId}\n- Digest da árvore: ${history.treeDigest}\n- Digest do plano: ${history.planDigest}\n- Triagens: ${history.triage.length}\n- Contestações: ${history.contestations.length}\n\n## Triagem append-only\n\n${history.triage.map((event) => `### Revisão ${event.revision} — ${event.createdAt}\n\n- Responsável: ${event.owner ?? "não atribuído"}\n- Estado: ${event.status}\n- Prioridade humana: ${event.schemaVersion === 2 && event.priority ? `impacto ${event.priority.impact}, risco ${event.priority.risk}, esforço ${event.priority.effort}` : "não avaliada"}\n- Justificativa: ${event.justification}\n- Hash: ${event.eventHash}\n`).join("\n")}\n## Contestações append-only\n\n${history.contestations.map((event) => `### ${event.createdAt}\n\n- Justificativa: ${event.justification}\n- Evidence: ${event.evidenceIds.join(", ")}\n- Hash: ${event.eventHash}\n`).join("\n")}`
        : `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Histórico do plano PIE</title><h1>Histórico do item ${html(history.item.id)}</h1><p>Snapshot ${html(history.snapshotId)} · digest ${html(history.planDigest)}</p><h2>Triagem append-only</h2><pre>${html(JSON.stringify(history.triage, null, 2))}</pre><h2>Contestações append-only</h2><pre>${html(JSON.stringify(history.contestations, null, 2))}</pre></html>`;
  return planItemHistoryExportOutput.parse({
    schemaVersion: 1,
    snapshotId: history.snapshotId,
    treeDigest: history.treeDigest,
    planDigest: history.planDigest,
    itemId: history.item.id,
    triageEvents: history.triage.length,
    contestations: history.contestations.length,
    format: input.format,
    offset: input.offset,
    ...pageUtf8Artifact(content, input.offset, input.limitBytes),
  });
}
