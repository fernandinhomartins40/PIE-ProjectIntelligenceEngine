import { PieError } from "./contracts.js";
import { sha256 } from "./evidence.js";

export type JsonArtifactFormat = "json" | "md" | "html";

/** Render preserved JSON with traceable summary metadata in text formats. */
export function renderJsonArtifact(
  json: string,
  format: JsonArtifactFormat,
  title: string,
  summary: readonly (readonly [label: string, value: string])[],
) {
  if (format === "json") return json;
  if (format === "md") {
    const escapeMarkdown = (value: string) =>
      value.replace(/[\\`*_{}[\]<>()#+.!|>-]/g, "\\$&");
    return `# ${escapeMarkdown(title)}\n\n${summary
      .map(
        ([label, value]) =>
          `- ${escapeMarkdown(label)}: ${escapeMarkdown(value)}`,
      )
      .join("\n")}\n\n${json
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}`;
  }
  const escapeHtml = (value: string) =>
    value.replace(
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
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1><dl>${summary
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
    )
    .join("")}</dl><pre>${escapeHtml(json)}</pre></html>`;
}

/** Return stable byte-bounded pages without splitting UTF-8 code points. */
export function pageUtf8Artifact(
  content: string,
  offset: number,
  limitBytes: number,
) {
  const bytes = Buffer.from(content, "utf8");
  if (offset > bytes.length)
    throw new PieError("INVALID_INPUT", "Offset excede a exporta??o.");
  if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)
    throw new PieError("INVALID_INPUT", "Offset n?o inicia caractere UTF-8.");
  let end = Math.min(bytes.length, offset + limitBytes);
  if (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    while (end > offset && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === offset)
      throw new PieError(
        "INVALID_INPUT",
        "Limite n?o comporta caractere UTF-8.",
      );
  }
  return {
    totalBytes: bytes.length,
    nextOffset: end < bytes.length ? end : null,
    sha256: sha256(bytes),
    content: bytes.subarray(offset, end).toString("utf8"),
  };
}
