import { sha256 } from "../evidence.js";

export type ExpressRouterMountEvidence = {
  specifier: string;
  importedName: string;
  localName: string;
  importLine: number;
  prefix: string;
  targetPath: string;
  syntax?: "commonjs";
};

export const expressRouterMountObservation = (
  fact: ExpressRouterMountEvidence,
) =>
  `Express AST cross-file router mount ${JSON.stringify([
    fact.specifier,
    fact.importedName,
    fact.localName,
    fact.importLine,
    fact.prefix,
    fact.targetPath,
  ])}; ${fact.syntax === "commonjs" ? "require CommonJS" : "importação estática"} não comprova registro em runtime.`;

export const expressRouterExportObservation = (
  exportName: string,
  localName: string,
  syntax?: "commonjs",
) =>
  `Express AST router export ${JSON.stringify([exportName, localName])}; ${syntax === "commonjs" ? "module.exports estático não comprova retorno" : "tipo de retorno não inspecionado"} em runtime.`;

export const expressRouterReExportObservation = (
  exportName: string,
  importedName: string,
  specifier: string,
) =>
  `Express AST router re-export ${JSON.stringify([exportName, importedName, specifier])}; a cadeia estática não comprova retorno em runtime.`;

export const expressRouterMountEdgeId = (
  from: string,
  to: string,
  fact: ExpressRouterMountEvidence,
  mountLine: number,
  exportLine: number,
  syntax?: "commonjs",
) =>
  sha256(
    JSON.stringify([
      from,
      to,
      "calls",
      fact.specifier,
      fact.importedName,
      fact.localName,
      fact.importLine,
      fact.prefix,
      fact.targetPath,
      mountLine,
      exportLine,
      ...(syntax === "commonjs" ? [syntax] : []),
    ]),
  );
