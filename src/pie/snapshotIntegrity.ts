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
import { snapshotFiles } from "./snapshotFiles.js";

function validateDeclarations(
  snapshot: Snapshot,
  evidenceById: ReadonlyMap<string, Evidence>,
): void {
  const ids = new Set<string>();
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
      (declaration.provenanceVersion === 2 &&
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
      if (
        declaration.provenanceVersion !== 2 ||
        derivationIds.has(derivation.evidenceId) ||
        derivation.evidenceId === declaration.evidenceId ||
        !derivationProof ||
        derivationProof.method !== "static" ||
        derivationProof.confidence !== "derived" ||
        derivationProof.source.path !== declaration.source.path ||
        derivationProof.source.line !== derivation.line ||
        derivationProof.source.sha256 !== declaration.source.sha256 ||
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
      /^Import AST (.+); não comprova carregamento em runtime\.$/.exec(
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
