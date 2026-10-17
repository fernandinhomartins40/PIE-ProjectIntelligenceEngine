import type { File, ExportNamedDeclaration } from "@babel/types";
import type { AdapterRead, Declaration } from "./contracts.js";

const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

function exportedNames(statement: ExportNamedDeclaration) {
  const names: Array<{ name: string; line: number }> = [];
  const declaration = statement.declaration;
  if (declaration?.type === "FunctionDeclaration" && declaration.id)
    names.push({
      name: declaration.id.name,
      line: statement.loc?.start.line ?? 1,
    });
  if (declaration?.type === "VariableDeclaration" && !declaration.declare) {
    for (const variable of declaration.declarations)
      if (variable.id.type === "Identifier")
        names.push({
          name: variable.id.name,
          line: variable.loc?.start.line ?? 1,
        });
  }
  for (const specifier of statement.specifiers) {
    if (specifier.type === "ExportSpecifier" && specifier.exportKind !== "type")
      names.push({
        name:
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value,
        line: specifier.loc?.start.line ?? 1,
      });
  }
  return names;
}

/** Interprets only conventional app paths and top-level exports, without claiming framework activation. */
export function readNextDeclarations(
  path: string,
  tree: File,
  limit: number,
): AdapterRead {
  const match =
    /^((?:[^/]+\/)*?)app\/((?:[^/]+\/)*)(page|route)\.[jt]sx?$/.exec(path);
  if (!match) return { declarations: [], limitations: [] };
  if (match[3] === "route" && /\.[jt]sx$/.test(path))
    return {
      declarations: [],
      limitations: [
        "Extensão JSX de Route Handler não convertida em endpoint Next.",
      ],
    };
  const parts = match[2]!.split("/").filter(Boolean);
  const limitations = [
    "Convenção Next App Router e exports AST; não confirma framework instalado, build, autenticação, rewrites/basePath, conflitos ou disponibilidade HTTP. Segmentos dinâmicos são padrões, não URLs concretas.",
    "Exports wildcard, métodos automáticos e resolução do valor exportado não examinados; ausência de declaração não prova ausência de rota.",
  ];
  if (
    parts.some(
      (part) =>
        part.startsWith("_") ||
        part.startsWith("@") ||
        part.startsWith("(.") ||
        ((part.includes("(") || part.includes(")")) &&
          !/^\([^()]+\)$/.test(part)),
    )
  ) {
    return {
      declarations: [],
      limitations: [
        ...limitations,
        "Segmento privado, paralelo ou interceptado não convertido em rota pública.",
      ],
    };
  }
  const route =
    "/" + parts.filter((part) => !/^\([^()]+\)$/.test(part)).join("/");
  const declarations: Declaration[] = [];
  let omitted = 0;
  const add = (name: string, kind: "endpoint" | "page", line: number) => {
    if (name.length > 1000 || declarations.length >= limit) {
      omitted++;
      return;
    }
    declarations.push({
      adapter: "next-app-convention",
      kind,
      name,
      parent: null,
      line,
    });
  };
  for (const statement of tree.program.body) {
    if (
      match[3] === "page" &&
      statement.type === "ExportDefaultDeclaration" &&
      statement.declaration.type !== "TSInterfaceDeclaration" &&
      statement.declaration.type !== "TSDeclareFunction"
    ) {
      add(route, "page", statement.loc?.start.line ?? 1);
    }
    if (
      match[3] !== "route" ||
      statement.type !== "ExportNamedDeclaration" ||
      statement.exportKind === "type"
    )
      continue;
    const names = exportedNames(statement);
    for (const entry of names)
      if (methods.has(entry.name))
        add(`${entry.name} ${route}`, "endpoint", entry.line);
  }
  return {
    declarations,
    limitations: [
      ...limitations,
      ...(omitted
        ? [
            `${omitted} declarações Next omitidas por limite de recursos/identificador.`,
          ]
        : []),
    ],
  };
}
