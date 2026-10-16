import { PieError, snapshotSchema, type Snapshot } from "./contracts.js";
import { verifyEvidence, sha256 } from "./evidence.js";

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
  const files = snapshot.nodes.map((node) => {
    const source = node.evidenceIds
      .map((id) => evidenceById.get(id)!)
      .find(
        (evidence) =>
          evidence.source.path === node.path && evidence.source.line === null,
      );
    if (!source)
      throw new PieError("INTEGRITY_ERROR", "Nó sem evidência de arquivo.");
    return [node.path, source.source.sha256];
  });
  if (sha256(JSON.stringify(files)) !== snapshot.treeDigest)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Digest do snapshot incompatível com os arquivos observados.",
    );
  return snapshot;
}
