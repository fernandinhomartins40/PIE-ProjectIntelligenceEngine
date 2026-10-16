import {
  PieError,
  snapshotSchema,
  type Snapshot,
  type Evidence,
} from "./contracts.js";
import { verifyEvidence, sha256 } from "./evidence.js";
import { declarationIdentity } from "./adapters/identity.js";
import { snapshotFiles } from "./snapshotFiles.js";

function validateDeclarations(
  snapshot: Snapshot,
  evidenceById: ReadonlyMap<string, Evidence>,
): void {
  const ids = new Set<string>();
  for (const declaration of snapshot.declarations) {
    const proof = evidenceById.get(declaration.evidenceId);
    if (
      declarationIdentity(declaration) !== declaration.id ||
      ids.has(declaration.id) ||
      !proof ||
      proof.method !== "static" ||
      proof.confidence !== "derived" ||
      proof.source.path !== declaration.source.path ||
      proof.source.line !== declaration.source.line ||
      proof.source.sha256 !== declaration.source.sha256
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Declaração sem proveniência consistente.",
      );
    ids.add(declaration.id);
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
