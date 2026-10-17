import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import type { Node } from "@babel/types";
import type { ImportReference } from "./imports.js";
import {
  readNextDeclarations,
  readNextPagesDeclarations,
} from "./adapters/next.js";
import type { AdapterRead } from "./adapters/contracts.js";
import {
  readExpressDeclarations,
  type ExpressCrossFileMount,
  type ExpressLocalRouterMount,
  type ExpressRouterReExport,
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
    routerReExports: ExpressRouterReExport[];
    omittedCrossFileFacts: number;
  };
} {
  return cachedAnalysis(
    ["pie-code-facts-v9", path, sha256(source), maxReferences, maxDeclarations],
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
      traverse(tree as unknown as Node, {
        enter(astPath: NodePath) {
          const node = astPath.node;
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
                syntax: "static",
              });
            else omitted++;
            return;
          }
          const dynamicSource =
            node.type === "ImportExpression"
              ? node.source
              : node.type === "CallExpression" && node.callee.type === "Import"
                ? node.arguments[0]
                : undefined;
          if (dynamicSource?.type === "StringLiteral") {
            if (references.length < maxReferences)
              references.push({
                sourcePath: path,
                specifier: dynamicSource.value,
                line: node.loc?.start.line ?? 1,
                syntax: "dynamic",
              });
            else omitted++;
            return;
          }
          if (
            node.type !== "CallExpression" ||
            node.callee.type !== "Identifier" ||
            node.callee.name !== "require" ||
            astPath.scope.getBinding("require") ||
            node.arguments.length !== 1 ||
            node.arguments[0]?.type !== "StringLiteral"
          )
            return;
          if (references.length < maxReferences)
            references.push({
              sourcePath: path,
              specifier: node.arguments[0].value,
              line: node.loc?.start.line ?? 1,
              syntax: "commonjs",
            });
          else omitted++;
        },
      });
      const next = readNextDeclarations(path, tree, maxDeclarations);
      const nextPages = readNextPagesDeclarations(
        path,
        tree,
        Math.max(0, maxDeclarations - next.declarations.length),
      );
      const express = readExpressDeclarations(
        tree,
        Math.max(
          0,
          maxDeclarations -
            next.declarations.length -
            nextPages.declarations.length,
        ),
      );
      return {
        references,
        omitted,
        express: {
          crossFileMounts: express.crossFileMounts,
          routerMounts: express.routerMounts,
          routerExports: express.routerExports,
          routerReExports: express.routerReExports,
          omittedCrossFileFacts: express.omittedCrossFileFacts,
        },
        declarations: {
          declarations: [
            ...next.declarations,
            ...nextPages.declarations,
            ...express.declarations,
          ],
          limitations: [
            ...next.limitations,
            ...nextPages.limitations,
            ...express.limitations,
          ],
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
