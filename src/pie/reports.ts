import { snapshotSchema, type Snapshot } from "./contracts.js";

const html = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const markdown = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

/** Export recorded observations only. Static inventory never becomes an audit approval. */
export function renderSnapshot(
  input: Snapshot,
  format: "json" | "md" | "html",
): string {
  const snapshot = snapshotSchema.parse(input);
  if (format === "json") return JSON.stringify(snapshot, null, 2);
  const facts = [
    `Snapshot: ${snapshot.id}`,
    `Projeto: ${snapshot.projectId}`,
    `Revisão: ${snapshot.revision ?? "sem commit"}`,
    `Criado em: ${snapshot.createdAt}`,
    `Cobertura: ${snapshot.coverage.status}`,
    "Verificação funcional: não executada",
  ];
  if (format === "md")
    return [
      "# PIE — Inventário de projeto",
      "",
      ...facts.map((fact) => `${markdown(fact)}  `),
      "",
      "| Arquivo | Tipo inferido | Evidências |",
      "|---|---|---|",
      ...snapshot.nodes.map(
        (node) =>
          `| ${markdown(node.path)} | ${node.kind} | ${node.evidenceIds.join(", ")} |`,
      ),
      "",
      "## Limitações",
      "",
      ...snapshot.coverage.limitations.map((value) => `- ${markdown(value)}`),
      "",
    ].join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>PIE — Inventário</title><style>body{font:1rem system-ui;max-width:80rem;margin:auto;padding:1rem;color:#172033;background:#f7f8fa}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.6rem;border:1px solid #ccd2dd;overflow-wrap:anywhere}section{overflow:auto}dt{font-weight:bold}li{margin:.5rem 0}</style></head><body><h1>PIE — Inventário de projeto</h1>${facts.map((fact) => `<p>${html(fact)}</p>`).join("")}<section aria-label="Arquivos observados"><table><thead><tr><th>Arquivo</th><th>Tipo inferido</th><th>Evidências</th></tr></thead><tbody>${snapshot.nodes.map((node) => `<tr><td>${html(node.path)}</td><td>${html(node.kind)}</td><td>${node.evidenceIds.map(html).join(", ")}</td></tr>`).join("")}</tbody></table></section><h2>Limitações</h2><ul>${snapshot.coverage.limitations.map((value) => `<li>${html(value)}</li>`).join("")}</ul></body></html>`;
}
