import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";
import type { ImportReference } from "./imports.js";
import { readNextDeclarations } from "./adapters/next.js";
import type { AdapterRead } from "./adapters/contracts.js";
/** Parse syntax only. No module resolution through project code, plugins or execution. */
export function readCodeFacts(
  path: string,
  source: string,
  maxReferences: number,
  maxDeclarations: number,
): {
  references: ImportReference[];
  omitted: number;
  declarations: AdapterRead;
} {
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
  return {
    references,
    omitted,
    declarations: readNextDeclarations(path, tree, maxDeclarations),
  };
}
