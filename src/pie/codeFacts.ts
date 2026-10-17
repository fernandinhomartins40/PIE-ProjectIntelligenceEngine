import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";
import type { ImportReference } from "./imports.js";
import { readNextDeclarations } from "./adapters/next.js";
import type { AdapterRead } from "./adapters/contracts.js";
import {
  readExpressDeclarations,
  type ExpressCrossFileMount,
  type ExpressLocalRouterMount,
  type ExpressRouterExport,
} from "./adapters/express.js";
import { cachedAnalysis } from "./analysisCache.js";
import { sha256 } from "./evidence.js";
import { err, ok, type Result } from "../domain/result.js";

export type CodeFactsFailure = {
  kind: "invalid_syntax";
  path: string;
};
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
  express: {
    crossFileMounts: ExpressCrossFileMount[];
    routerMounts: ExpressLocalRouterMount[];
    routerExports: ExpressRouterExport[];
    omittedCrossFileFacts: number;
  };
} {
  return cachedAnalysis(
    ["pie-code-facts-v4", path, sha256(source), maxReferences, maxDeclarations],
    () => {
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
      const next = readNextDeclarations(path, tree, maxDeclarations);
      const express = readExpressDeclarations(
        tree,
        Math.max(0, maxDeclarations - next.declarations.length),
      );
      return {
        references,
        omitted,
        express: {
          crossFileMounts: express.crossFileMounts,
          routerMounts: express.routerMounts,
          routerExports: express.routerExports,
          omittedCrossFileFacts: express.omittedCrossFileFacts,
        },
        declarations: {
          declarations: [...next.declarations, ...express.declarations],
          limitations: [...next.limitations, ...express.limitations],
        },
      };
    },
  );
}

/** Converts only Babel's known source-syntax rejection into a typed outcome. */
export function readCodeFactsResult(
  path: string,
  source: string,
  maxReferences: number,
  maxDeclarations: number,
): Result<ReturnType<typeof readCodeFacts>, CodeFactsFailure> {
  try {
    return ok(readCodeFacts(path, source, maxReferences, maxDeclarations));
  } catch (cause) {
    if (
      cause instanceof SyntaxError &&
      (cause as SyntaxError & { code?: unknown }).code ===
        "BABEL_PARSER_SYNTAX_ERROR"
    )
      return err({ kind: "invalid_syntax", path });
    throw cause;
  }
}
