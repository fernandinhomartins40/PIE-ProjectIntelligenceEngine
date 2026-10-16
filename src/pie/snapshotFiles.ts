import { PieError, type Snapshot } from "./contracts.js";

/** Owns file identities for integrity, comparison and execution preparation. */
export function snapshotFiles(snapshot: Pick<Snapshot, "nodes" | "evidence">) {
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const paths = new Set<string>();
  return snapshot.nodes.map((node) => {
    if (paths.has(node.path))
      throw new PieError("INTEGRITY_ERROR", "Caminho de arquivo duplicado.");
    paths.add(node.path);
    const proofs = node.evidenceIds
      .map((id) => evidence.get(id))
      .filter(
        (item) => item?.source.path === node.path && item.source.line === null,
      );
    const source = proofs[0];
    if (
      !source ||
      new Set(proofs.map((proof) => proof!.source.sha256)).size !== 1
    )
      throw new PieError(
        "INTEGRITY_ERROR",
        "Nó sem identidade de arquivo inequívoca.",
      );
    return { node, source };
  });
}
