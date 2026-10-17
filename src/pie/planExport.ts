import { z } from "zod";
import type { PieService } from "./service.js";
import { PieError } from "./contracts.js";
import { pageUtf8Artifact } from "./utf8Artifact.js";

export const planExportInput = z.strictObject({
  snapshotId: z.string().uuid(),
  format: z.enum(["json", "md", "html"]).default("json"),
  offset: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().min(4).max(1_000_000).default(65_536),
});
export const planExportOutput = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.literal("unverified"),
  executionAuthorized: z.literal(false),
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

/** Export the exact current shared plan projection; priority remains human-authored. */
export async function exportPlan(service: PieService, rawInput: unknown) {
  const input = planExportInput.parse(rawInput);
  const first = await service.plan({
    snapshotId: input.snapshotId,
    limit: 200,
    offset: 0,
  });
  const items = [...first.items.items];
  for (let offset = first.items.nextOffset; offset !== null;) {
    const next = await service.plan({
      snapshotId: input.snapshotId,
      limit: 200,
      offset,
    });
    if (
      next.planDigest !== first.planDigest ||
      next.items.total !== first.items.total
    )
      throw new PieError(
        "BUSY",
        "O plano mudou durante a exportação; tente novamente.",
      );
    items.push(...next.items.items);
    offset = next.items.nextOffset;
  }
  if (
    items.length !== first.items.total ||
    new Set(items.map((item) => item.id)).size !== items.length
  )
    throw new PieError(
      "BUSY",
      "A triagem mudou durante a exportação; tente novamente.",
    );
  const plan = {
    ...first,
    items: {
      ...first.items,
      offset: 0,
      items,
      count: items.length,
      nextOffset: null,
    },
  };
  const content =
    input.format === "json"
      ? JSON.stringify(plan, null, 2)
      : input.format === "md"
        ? `# Plano PIE\n\n- Snapshot: ${plan.snapshotId}\n- Digest: ${plan.planDigest}\n- Estado: ${plan.state}\n- Execução autorizada: não\n\n${items.map((item) => `## ${item.title}\n\n- ID: ${item.id}\n- Motor: ${item.engine}\n- Estado: ${item.status}\n- Responsável: ${item.owner ?? "não atribuído"}\n- Prioridade: ${item.priority}${item.priorityAssessment ? ` (impacto ${item.priorityAssessment.impact}, risco ${item.priorityAssessment.risk}, esforço ${item.priorityAssessment.effort})` : ""}\n- Evidence: ${item.evidenceIds.join(", ")}\n`).join("\n")}`
        : `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Plano PIE</title><h1>Plano PIE</h1><p>Snapshot ${escapeHtml(plan.snapshotId)} · Digest ${escapeHtml(plan.planDigest)} · ${plan.state} · execução não autorizada</p><ol>${items.map((item) => `<li><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.id)} · ${escapeHtml(item.engine)} · ${escapeHtml(item.status)} · ${escapeHtml(item.owner ?? "não atribuído")} · ${escapeHtml(item.priority)}</p><p>Evidence: ${escapeHtml(item.evidenceIds.join(", "))}</p></li>`).join("")}</ol></html>`;
  return planExportOutput.parse({
    schemaVersion: 1,
    snapshotId: plan.snapshotId,
    planDigest: plan.planDigest,
    state: plan.state,
    executionAuthorized: false,
    format: input.format,
    offset: input.offset,
    ...pageUtf8Artifact(content, input.offset, input.limitBytes),
  });
}
