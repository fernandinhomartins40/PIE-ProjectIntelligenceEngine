import type { Snapshot } from "./contracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { buildKnowledgeGraph } from "./knowledgeGraph.js";

const html = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const markdown = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

interface ReportTable {
  title: string;
  columns: string[];
  rows: string[][];
}
function tables(snapshot: Snapshot): ReportTable[] {
  const graph = buildKnowledgeGraph(snapshot);
  return [
    {
      title: "Arquivos observados",
      columns: ["ID", "Arquivo", "Tipo inferido", "Evidências"],
      rows: snapshot.nodes.map((node) => [
        node.id,
        node.path,
        node.kind,
        node.evidenceIds.join(", "),
      ]),
    },
    {
      title: "Cobertura das relações",
      columns: ["Escopo", "Relações não resolvidas", "Verificação em execução"],
      rows: [
        [
          "Somente fatos e relações registrados neste snapshot",
          String(graph.unresolvedRelations),
          "Não realizada",
        ],
      ],
    },
    {
      title: "Declarações estáticas",
      columns: [
        "ID",
        "Adapter",
        "Tipo",
        "Nome",
        "Contexto declarado",
        "Arquivo",
        "Linha",
        "Estado",
        "Evidência",
      ],
      rows: snapshot.declarations.map((fact) => [
        fact.id,
        fact.adapter,
        fact.kind,
        fact.name,
        fact.parent ?? "Não informado",
        fact.source.path,
        fact.source.line === null ? "Não informada" : String(fact.source.line),
        fact.state,
        [
          fact.evidenceId,
          ...fact.derivations.map((item) => item.evidenceId),
        ].join(", "),
      ]),
    },
    {
      title: "Relações registradas",
      columns: ["ID", "Origem", "Destino", "Tipo", "Confiança", "Evidências"],
      rows: graph.edges.map((edge) => [
        edge.id,
        edge.from,
        edge.to,
        edge.kind,
        edge.confidence,
        edge.evidenceIds.join(", "),
      ]),
    },
    {
      title: "Evidências preservadas",
      columns: [
        "ID",
        "Método",
        "Confiança",
        "Estado",
        "Fonte",
        "SHA-256 da evidência",
        "Observação",
        "Limitações",
        "Metadados preservados",
      ],
      rows: snapshot.evidence.map((proof) => [
        proof.id,
        proof.method,
        proof.confidence,
        proof.state,
        JSON.stringify(proof.source),
        proof.sha256,
        proof.observation,
        JSON.stringify(proof.limitations),
        JSON.stringify({
          schemaVersion: proof.schemaVersion,
          projectId: proof.projectId,
          snapshotId: proof.snapshotId,
          auditRunId: proof.auditRunId,
          revision: proof.revision,
          environment: proof.environment,
          createdAt: proof.createdAt,
          sensitivity: proof.sensitivity,
          redactionStatus: proof.redactionStatus,
          expiresAt: proof.expiresAt,
        }),
      ]),
    },
  ];
}
function markdownTable(table: ReportTable): string {
  return [
    `## ${table.title}`,
    "",
    `| ${table.columns.join(" | ")} |`,
    `|${table.columns.map(() => "---").join("|")}|`,
    ...table.rows.map((row) => `| ${row.map(markdown).join(" | ")} |`),
    ...(table.rows.length ? [] : ["", "Nenhum registro neste snapshot."]),
  ].join("\n");
}
function htmlTable(table: ReportTable): string {
  return `<section aria-label="${html(table.title)}"><h2>${html(table.title)}</h2><table><caption>${html(table.title)}</caption><thead><tr>${table.columns.map((column) => `<th scope="col">${html(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${html(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>${table.rows.length ? "" : "<p>Nenhum registro neste snapshot.</p>"}</section>`;
}

/** Export recorded observations only. Static inventory never becomes an audit approval. */
export function renderSnapshot(
  input: Snapshot,
  format: "json" | "md" | "html",
): string {
  const snapshot = validateSnapshot(input);
  if (format === "json") return JSON.stringify(snapshot, null, 2);
  const facts = [
    `Snapshot: ${snapshot.id}`,
    `Projeto: ${snapshot.projectId}`,
    `Revisão: ${snapshot.revision ?? "sem commit"}`,
    `Criado em: ${snapshot.createdAt}`,
    `Cobertura: ${snapshot.coverage.status}`,
    `Raiz observada: ${snapshot.root}`,
    `SHA-256 da árvore: ${snapshot.treeDigest}`,
    `Arquivos enumerados / examinados: ${snapshot.coverage.enumeratedFiles} / ${snapshot.coverage.examinedFiles}`,
    `Bytes lidos: ${snapshot.coverage.bytesRead}`,
    `Estado Git com alterações: ${snapshot.dirty ? "sim" : "não"}`,
    "Verificação funcional: não executada",
    "Este relatório contém observações estáticas; não incorpora resultados VERIFY separados nem aprova o projeto.",
  ];
  if (format === "md")
    return [
      "# PIE — Inventário de projeto",
      "",
      ...facts.map((fact) => `${markdown(fact)}  `),
      "",
      ...tables(snapshot).map(markdownTable),
      "",
      "## Limitações",
      "",
      ...snapshot.coverage.limitations.map((value) => `- ${markdown(value)}`),
      "",
    ].join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>PIE — Inventário</title><style>body{font:1rem system-ui;max-width:80rem;margin:auto;padding:1rem;color:#172033;background:#f7f8fa}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.6rem;border:1px solid #ccd2dd;overflow-wrap:anywhere}section{overflow:auto}dt{font-weight:bold}li{margin:.5rem 0}</style></head><body><h1>PIE — Inventário de projeto</h1>${facts.map((fact) => `<p>${html(fact)}</p>`).join("")}${tables(snapshot).map(htmlTable).join("")}<h2>Limitações</h2><ul>${snapshot.coverage.limitations.map((value) => `<li>${html(value)}</li>`).join("")}</ul></body></html>`;
}
