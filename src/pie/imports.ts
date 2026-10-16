import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";
import { dirname, posix } from "node:path";
import { sha256 } from "./evidence.js";
import type { GraphEdge, GraphNode } from "./contracts.js";

export interface ImportReference {
  sourcePath: string;
  specifier: string;
  line: number;
}

/** Parse syntax only. No module resolution through project code, plugins or execution. */
export function readImports(
  path: string,
  source: string,
  maxReferences: number,
): { references: ImportReference[]; omitted: number } {
  const tree = parse(source, {
    sourceType: "unambiguous",
    plugins:
      path.endsWith(".tsx") || path.endsWith(".jsx")
        ? ["typescript", "jsx"]
        : ["typescript"],
  });
  const references: ImportReference[] = [];
  let omitted = 0;
  traverseFast(tree, (node) => {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      if (references.length < maxReferences)
        references.push({
          sourcePath: path,
          specifier: node.source.value,
          line: node.loc?.start.line ?? 1,
        });
      else omitted++;
    }
  });
  return { references, omitted };
}

/** Bounded conventional relative resolution; aliases and conditional exports remain unknown. */
export function resolveImports(
  nodes: readonly GraphNode[],
  references: readonly ImportReference[],
  evidenceAt: (path: string, line: number) => string,
): { edges: GraphEdge[]; unresolved: number } {
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const edges: GraphEdge[] = [];
  let unresolved = 0;
  for (const reference of references) {
    if (!reference.specifier.startsWith(".")) {
      unresolved++;
      continue;
    }
    const base = posix.normalize(
      posix.join(
        dirname(reference.sourcePath).replaceAll("\\", "/"),
        reference.specifier,
      ),
    );
    const candidates = [base];
    if (/\.[cm]?js$/.test(base))
      candidates.push(
        base.replace(/\.([cm]?)js$/, ".$1ts"),
        base.replace(/\.js$/, ".tsx"),
      );
    if (!posix.extname(base))
      candidates.push(
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mts",
          ".mjs",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((extension) => base + extension),
      );
    const target = candidates.map((path) => byPath.get(path)).find(Boolean);
    const source = byPath.get(reference.sourcePath);
    if (!source || !target) {
      unresolved++;
      continue;
    }
    edges.push({
      id: sha256(JSON.stringify([source.id, target.id, reference.line])),
      from: source.id,
      to: target.id,
      kind: "depends",
      confidence: "derived",
      evidenceIds: [evidenceAt(reference.sourcePath, reference.line)],
    });
  }
  return { edges, unresolved };
}
