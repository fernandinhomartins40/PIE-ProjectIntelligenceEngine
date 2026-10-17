import { sha256 } from "../evidence.js";

export type ExpressRouterMountEvidence = {
  specifier: string;
  importedName: string;
  localName: string;
  importLine: number;
  prefix: string;
  targetPath: string;
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
  ])}; importação estática não comprova registro em runtime.`;

export const expressRouterExportObservation = (
  exportName: string,
  localName: string,
) =>
  `Express AST router export ${JSON.stringify([exportName, localName])}; tipo de retorno não inspecionado em runtime.`;

export const expressRouterMountEdgeId = (
  from: string,
  to: string,
  fact: ExpressRouterMountEvidence,
  mountLine: number,
  exportLine: number,
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
    ]),
  );
