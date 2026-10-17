import {
  PieError,
  snapshotSchema,
  type Snapshot,
  type Evidence,
} from "./contracts.js";
import { verifyEvidence, sha256 } from "./evidence.js";
import {
  declarationEvidenceObservation,
  derivationEvidenceObservation,
} from "./adapters/contracts.js";
import { declarationIdentity } from "./adapters/identity.js";
import {
  expressRouterExportObservation,
  expressRouterReExportObservation,
  expressRouterMountEdgeId,
  expressRouterMountObservation,
} from "./adapters/expressEvidence.js";
import { snapshotFiles } from "./snapshotFiles.js";

function validateDeclarations(
  snapshot: Snapshot,
  evidenceById: ReadonlyMap<string, Evidence>,
): void {
  const ids = new Set<string>();
  const fileEvidence = new Map(
    snapshot.evidence
      .filter((item) => item.source.line === null)
      .map((item) => [item.source.path, item]),
  );
  for (const declaration of snapshot.declarations) {
    const proof = evidenceById.get(declaration.evidenceId);
    const derivationIds = new Set<string>();
    if (
      declarationIdentity(declaration) !== declaration.id ||
      ids.has(declaration.id) ||
      !proof ||
      proof.method !== "static" ||
      proof.confidence !== "derived" ||
      proof.source.path !== declaration.source.path ||
      proof.source.line !== declaration.source.line ||
      proof.source.sha256 !== declaration.source.sha256 ||
      (declaration.provenanceVersion >= 2 &&
        proof.observation !== declarationEvidenceObservation(declaration)) ||
      (declaration.provenanceVersion === 1 &&
        declaration.derivations.length > 0)
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Declaração sem proveniência consistente.",
      );
    ids.add(declaration.id);
    for (const derivation of declaration.derivations) {
      const derivationProof = evidenceById.get(derivation.evidenceId);
      const sourcePath = derivation.sourcePath ?? declaration.source.path;
      const sourceFile = fileEvidence.get(sourcePath);
      if (
        declaration.provenanceVersion < 2 ||
        (declaration.provenanceVersion < 3 &&
          derivation.sourcePath !== undefined) ||
        derivationIds.has(derivation.evidenceId) ||
        derivation.evidenceId === declaration.evidenceId ||
        !sourceFile ||
        !derivationProof ||
        derivationProof.method !== "static" ||
        derivationProof.confidence !== "derived" ||
        derivationProof.source.path !== sourcePath ||
        derivationProof.source.line !== derivation.line ||
        derivationProof.source.sha256 !== sourceFile.source.sha256 ||
        derivationProof.observation !==
          derivationEvidenceObservation(derivation)
      )
        throw new PieError(
          "INTEGRITY_ERROR",
          "Derivação declarativa sem Evidence da origem correspondente.",
        );
      derivationIds.add(derivation.evidenceId);
    }
  }
}

function validateImportEdges(snapshot: Snapshot) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  for (const edge of snapshot.edges) {
    if (edge.kind !== "depends") continue;
    const sourceNode = nodes.get(edge.from)!;
    const targetNode = nodes.get(edge.to)!;
    const importProof = edge.evidenceIds
      .map((id) => evidence.get(id))
      .find((item) => item?.observation.startsWith("Import AST "));
    if (!importProof) {
      const packageProof = snapshot.declarations.find(
        (fact) =>
          fact.adapter === "node-manifest" &&
          fact.kind === "dependency" &&
          edge.evidenceIds.includes(fact.evidenceId),
      );
      const legacyImport = edge.evidenceIds
        .map((id) => evidence.get(id))
        .find(
          (item) =>
            item?.source.path === sourceNode.path &&
            item.source.line !== null &&
            item.observation ===
              "Declaração AST de importação ou reexportação com destino relativo resolvido convencionalmente; não comprova carregamento em runtime.",
        );
      if (packageProof || !legacyImport)
        throw new PieError(
          "INTEGRITY_ERROR",
          "Aresta depende sem Evidence do import de origem.",
        );
      continue;
    }
    const match =
      /^Import AST (.+?)(?:; syntax=(?:static|dynamic|commonjs))?; não comprova carregamento em runtime\.$/.exec(
        importProof.observation,
      );
    let tuple: unknown;
    try {
      tuple = JSON.parse(match?.[1] ?? "null");
    } catch {
      tuple = null;
    }
    if (
      !match ||
      !Array.isArray(tuple) ||
      tuple.length !== 3 ||
      typeof tuple[0] !== "string" ||
      importProof.source.path !== sourceNode.path ||
      importProof.source.line === null
    )
      throw new PieError("INTEGRITY_ERROR", "Evidence de import inválida.");
    if (tuple[1] === "relative-file") {
      if (
        tuple[2] !== targetNode.path ||
        edge.evidenceIds.length !== 1 ||
        importProof.source.line === null
      )
        throw new PieError(
          "INTEGRITY_ERROR",
          "Destino relativo diverge da Evidence do import.",
        );
      continue;
    }
    if (tuple[1] !== "declared-package" || tuple[2] !== targetNode.path)
      throw new PieError(
        "INTEGRITY_ERROR",
        "Manifest de pacote diverge da Evidence do import.",
      );
    const specifier = tuple[0];
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/", 1)[0];
    const declaration = snapshot.declarations.find(
      (fact) =>
        fact.adapter === "node-manifest" &&
        fact.kind === "dependency" &&
        fact.name === packageName &&
        fact.source.path === targetNode.path &&
        edge.evidenceIds.includes(fact.evidenceId),
    );
    if (!declaration)
      throw new PieError(
        "INTEGRITY_ERROR",
        "Import sem declaração de pacote correspondente no manifest.",
      );
  }
}

function validateExpressMountEdges(snapshot: Snapshot) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const fileEvidence = new Map(
    snapshot.evidence
      .filter((item) => item.source.line === null)
      .map((item) => [item.source.path, item]),
  );
  for (const edge of snapshot.edges) {
    if (edge.kind !== "calls") continue;
    const sourceNode = nodes.get(edge.from);
    const targetNode = nodes.get(edge.to);
    const proofs = edge.evidenceIds.map((id) => evidence.get(id));
    const mountProof = proofs.find((item) =>
      item?.observation.startsWith("Express AST cross-file router mount "),
    );
    const importProof = proofs.find((item) =>
      item?.observation.startsWith("Import AST "),
    );
    const exportProof = proofs.find(
      (item) =>
        item?.observation.startsWith("Express AST router export ") ||
        item?.observation.startsWith("Express AST router re-export "),
    );
    const mountMatch = mountProof
      ? /^Express AST cross-file router mount (.+); importação estática não comprova registro em runtime\.$/.exec(
          mountProof.observation,
        )
      : null;
    const importMatch = importProof
      ? /^Import AST (.+?)(?:; syntax=(?:static|dynamic|commonjs))?; não comprova carregamento em runtime\.$/.exec(
          importProof.observation,
        )
      : null;
    const exportMatch = exportProof
      ? /^Express AST router export (.+); tipo de retorno não inspecionado em runtime\.$/.exec(
          exportProof.observation,
        )
      : null;
    const reExportMatch = exportProof
      ? /^Express AST router re-export (.+); a cadeia estática não comprova retorno em runtime\.$/.exec(
          exportProof.observation,
        )
      : null;
    let mountTuple: unknown;
    let importTuple: unknown;
    let exportTuple: unknown;
    try {
      mountTuple = JSON.parse(mountMatch?.[1] ?? "null");
      importTuple = JSON.parse(importMatch?.[1] ?? "null");
      exportTuple = JSON.parse(exportMatch?.[1] ?? "null");
      if (reExportMatch) exportTuple = JSON.parse(reExportMatch[1]!);
    } catch {
      mountTuple = null;
      importTuple = null;
      exportTuple = null;
    }
    const [specifier, importedName, localName, importLine, prefix, targetPath] =
      Array.isArray(mountTuple) ? mountTuple : [];
    const [importSpecifier, importKind, importTarget] = Array.isArray(
      importTuple,
    )
      ? importTuple
      : [];
    const [exportName, exportLocalName, reExportSpecifier] = Array.isArray(
      exportTuple,
    )
      ? exportTuple
      : [];
    const sourceFile = sourceNode
      ? fileEvidence.get(sourceNode.path)
      : undefined;
    const targetFile = targetNode
      ? fileEvidence.get(targetNode.path)
      : undefined;
    if (
      edge.confidence !== "derived" ||
      edge.evidenceIds.length !== 3 ||
      new Set(edge.evidenceIds).size !== 3 ||
      !sourceNode ||
      !targetNode ||
      !mountProof ||
      !importProof ||
      !exportProof ||
      !sourceFile ||
      !targetFile ||
      !Array.isArray(mountTuple) ||
      mountTuple.length !== 6 ||
      !Array.isArray(importTuple) ||
      importTuple.length !== 3 ||
      typeof specifier !== "string" ||
      !specifier.startsWith(".") ||
      typeof importedName !== "string" ||
      typeof localName !== "string" ||
      typeof importLine !== "number" ||
      !Number.isInteger(importLine) ||
      typeof prefix !== "string" ||
      typeof targetPath !== "string" ||
      targetPath !== targetNode.path ||
      importSpecifier !== specifier ||
      importKind !== "relative-file" ||
      importTarget !== targetPath ||
      !Array.isArray(exportTuple) ||
      (exportMatch && exportTuple.length !== 2) ||
      (reExportMatch && exportTuple.length !== 3) ||
      (!exportMatch && !reExportMatch) ||
      exportName !== importedName ||
      typeof exportLocalName !== "string" ||
      mountProof.source.path !== sourceNode.path ||
      mountProof.source.line === null ||
      mountProof.source.sha256 !== sourceFile.source.sha256 ||
      mountProof.method !== "static" ||
      mountProof.confidence !== "derived" ||
      importProof.source.path !== sourceNode.path ||
      importProof.source.line === null ||
      importProof.source.sha256 !== sourceFile.source.sha256 ||
      importProof.source.line !== importLine ||
      importProof.method !== "static" ||
      importProof.confidence !== "derived" ||
      exportProof.source.path !== targetNode.path ||
      exportProof.source.line === null ||
      exportProof.source.sha256 !== targetFile.source.sha256 ||
      exportProof.method !== "static" ||
      exportProof.confidence !== "derived" ||
      mountProof.observation !==
        expressRouterMountObservation({
          specifier,
          importedName,
          localName,
          importLine,
          prefix,
          targetPath,
        }) ||
      (exportMatch &&
        exportProof.observation !==
          expressRouterExportObservation(exportName, exportLocalName)) ||
      (reExportMatch &&
        (typeof reExportSpecifier !== "string" ||
          !reExportSpecifier.startsWith(".") ||
          exportProof.observation !==
            expressRouterReExportObservation(
              exportName,
              exportLocalName,
              reExportSpecifier,
            ) ||
          !snapshot.edges.some(
            (dependency) =>
              dependency.kind === "depends" &&
              dependency.from === targetNode.id &&
              dependency.evidenceIds.some((id) => {
                const proof = evidence.get(id);
                if (
                  !proof?.observation.startsWith("Import AST ") ||
                  proof.source.path !== targetNode.path ||
                  proof.source.line !== exportProof.source.line
                )
                  return false;
                try {
                  const match =
                    /^Import AST (.+?)(?:; syntax=(?:static|dynamic|commonjs))?; não comprova carregamento em runtime\.$/.exec(
                      proof.observation,
                    );
                  const tuple: unknown = JSON.parse(match?.[1] ?? "null");
                  return (
                    Array.isArray(tuple) &&
                    tuple[0] === reExportSpecifier &&
                    tuple[1] === "relative-file"
                  );
                } catch {
                  return false;
                }
              }),
          ))) ||
      edge.id !==
        expressRouterMountEdgeId(
          sourceNode.id,
          targetNode.id,
          {
            specifier,
            importedName,
            localName,
            importLine,
            prefix,
            targetPath,
          },
          mountProof.source.line,
          exportProof.source.line,
        )
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Relação de mount Express cross-file sem Evidence consistente.",
      );
  }
}

/** One owner validates the same snapshot semantics for every persistence adapter. */
export function validateSnapshot(input: unknown): Snapshot {
  const snapshot = snapshotSchema.parse(input);
  const evidenceById = new Map(
    snapshot.evidence.map((evidence) => [evidence.id, evidence]),
  );
  if (evidenceById.size !== snapshot.evidence.length)
    throw new PieError("INTEGRITY_ERROR", "Evidências duplicadas.");
  for (const evidence of snapshot.evidence) {
    verifyEvidence(evidence);
    if (
      evidence.projectId !== snapshot.projectId ||
      evidence.snapshotId !== snapshot.id ||
      evidence.revision !== snapshot.revision
    )
      throw new PieError("INTEGRITY_ERROR", "Vínculo de evidência inválido.");
  }
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const edgeIds = new Set(snapshot.edges.map((edge) => edge.id));
  if (
    nodeIds.size !== snapshot.nodes.length ||
    edgeIds.size !== snapshot.edges.length
  )
    throw new PieError("INTEGRITY_ERROR", "Nós ou arestas duplicados.");
  for (const item of [...snapshot.nodes, ...snapshot.edges])
    if (
      item.evidenceIds.length === 0 ||
      item.evidenceIds.some((id) => !evidenceById.has(id))
    )
      throw new PieError("INTEGRITY_ERROR", "Referência de evidência ausente.");
  for (const edge of snapshot.edges)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      throw new PieError(
        "INTEGRITY_ERROR",
        "Aresta sem nó de origem ou destino.",
      );
  validateImportEdges(snapshot);
  validateExpressMountEdges(snapshot);
  validateDeclarations(snapshot, evidenceById);
  const files = snapshotFiles(snapshot).map(({ node, source }) => [
    node.path,
    source.source.sha256,
  ]);
  if (sha256(JSON.stringify(files)) !== snapshot.treeDigest)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Digest do snapshot incompatível com os arquivos observados.",
    );
  return snapshot;
}
