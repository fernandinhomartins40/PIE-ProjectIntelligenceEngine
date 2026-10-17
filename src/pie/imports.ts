import { dirname, posix } from "node:path";
import { sha256 } from "./evidence.js";
import type { GraphEdge, GraphNode } from "./contracts.js";

export interface ImportReference {
  sourcePath: string;
  specifier: string;
  line: number;
}

export interface DeclaredPackage {
  name: string;
  evidenceId: string;
  manifestNodeId: string;
}

/** Bounded conventional relative resolution; aliases and conditional exports remain unknown. */
export function resolveImports(
  nodes: readonly GraphNode[],
  references: readonly ImportReference[],
  evidenceAt: (path: string, line: number) => string,
  packages: readonly DeclaredPackage[] = [],
): { edges: GraphEdge[]; unresolved: number } {
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const packageGroups = new Map<string, DeclaredPackage[]>();
  for (const item of packages) {
    const group = packageGroups.get(item.name) ?? [];
    group.push(item);
    packageGroups.set(item.name, group);
  }
  const packageByName = new Map(
    [...packageGroups]
      .filter(([, items]) => items.length === 1)
      .map(([name, [item]]) => [name, item!] as const),
  );
  const edges: GraphEdge[] = [];
  let unresolved = 0;
  for (const reference of references) {
    const source = byPath.get(reference.sourcePath);
    let target: GraphNode | undefined;
    let declaredPackage: DeclaredPackage | undefined;
    if (reference.specifier.startsWith(".")) {
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
      target = candidates.map((path) => byPath.get(path)).find(Boolean);
    } else {
      // A package edge means only that the observed manifest declares this package;
      // it does not resolve the imported subpath or prove runtime loading.
      const packageName = reference.specifier.startsWith("@")
        ? reference.specifier.split("/").slice(0, 2).join("/")
        : reference.specifier.split("/", 1)[0];
      declaredPackage = packageByName.get(packageName!);
    }
    if (!source || !target) {
      if (source && declaredPackage) {
        edges.push({
          id: sha256(
            JSON.stringify([source.id, reference.specifier, reference.line]),
          ),
          from: source.id,
          to: declaredPackage.manifestNodeId,
          kind: "depends",
          confidence: "derived",
          evidenceIds: [
            evidenceAt(reference.sourcePath, reference.line),
            declaredPackage.evidenceId,
          ],
        });
        continue;
      }
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
