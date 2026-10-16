import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { impactedNodes, page, pageSchema } from "./graph.js";

export const comparisonInput = pageSchema.extend({
  beforeId: z.string().uuid(),
  afterId: z.string().uuid(),
});
const sideSchema = z.strictObject({
  nodeId: z.string(),
  sha256: z.string(),
  evidenceIds: z.array(z.string().uuid()),
});
export const changeSchema = z.strictObject({
  path: z.string(),
  state: z.enum([
    "added",
    "removed",
    "modified",
    "unobserved_before",
    "unobserved_after",
  ]),
  before: sideSchema.nullable(),
  after: sideSchema.nullable(),
});
export const impactSchema = z.strictObject({
  path: z.string(),
  nodeId: z.string(),
  versions: z.array(z.enum(["before", "after"])),
  evidenceIds: z.array(z.string().uuid()),
});
export const comparisonOutput = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  beforeId: z.string().uuid(),
  afterId: z.string().uuid(),
  status: z.enum(["unchanged", "changed", "inconclusive"]),
  changes: z.strictObject({
    items: z.array(changeSchema),
    total: z.number().int(),
    offset: z.number().int(),
    nextOffset: z.number().int().nullable(),
  }),
  impact: z.strictObject({
    items: z.array(impactSchema),
    total: z.number().int(),
    offset: z.number().int(),
    nextOffset: z.number().int().nullable(),
  }),
  counts: z.strictObject({
    added: z.number().int(),
    removed: z.number().int(),
    modified: z.number().int(),
    unknown: z.number().int(),
    unchanged: z.number().int(),
  }),
  runtimeVerified: z.literal(false),
  limitations: z.array(z.string()),
});

/** Missing observations in partial snapshots never establish addition or deletion. */
export function compareSnapshots(
  before: Snapshot,
  after: Snapshot,
  paging: unknown = {},
) {
  if (before.projectId !== after.projectId || before.root !== after.root)
    throw new PieError(
      "INVALID_INPUT",
      "Compare snapshots do mesmo projeto e raiz.",
    );
  const sides = (snapshot: Snapshot) => {
    const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
    return new Map(
      snapshot.nodes.map((node) => {
        const proof = node.evidenceIds
          .map((id) => evidence.get(id))
          .find(
            (item) =>
              item?.source.path === node.path && item.source.line === null,
          );
        if (!proof)
          throw new PieError(
            "INTEGRITY_ERROR",
            "Nó sem evidência de identidade do arquivo.",
          );
        return [
          node.path,
          {
            nodeId: node.id,
            sha256: proof.source.sha256,
            evidenceIds: node.evidenceIds,
          },
        ];
      }),
    );
  };
  const old = sides(before);
  const current = sides(after);
  const changes: z.infer<typeof changeSchema>[] = [];
  const counts = {
    added: 0,
    removed: 0,
    modified: 0,
    unknown: 0,
    unchanged: 0,
  };
  for (const path of [...new Set([...old.keys(), ...current.keys()])].sort()) {
    const left = old.get(path) ?? null;
    const right = current.get(path) ?? null;
    let state: z.infer<typeof changeSchema>["state"];
    if (left && right) {
      if (left.sha256 === right.sha256) {
        counts.unchanged++;
        continue;
      }
      state = "modified";
      counts.modified++;
    } else if (!left) {
      state =
        before.coverage.status === "complete" ? "added" : "unobserved_before";
      if (state === "added") counts.added++;
      else counts.unknown++;
    } else {
      state =
        after.coverage.status === "complete" ? "removed" : "unobserved_after";
      if (state === "removed") counts.removed++;
      else counts.unknown++;
    }
    changes.push({ path, state, before: left, after: right });
  }
  const impact = new Map<string, z.infer<typeof impactSchema>>();
  for (const [version, snapshot] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const seeds = changes.flatMap((change) =>
      change[version] ? [change[version]!.nodeId] : [],
    );
    for (const node of impactedNodes(snapshot.nodes, snapshot.edges, seeds)) {
      const existing = impact.get(node.path);
      if (existing) {
        existing.versions.push(version);
        existing.evidenceIds = [
          ...new Set([...existing.evidenceIds, ...node.evidenceIds]),
        ];
      } else
        impact.set(node.path, {
          path: node.path,
          nodeId: node.id,
          versions: [version],
          evidenceIds: [...node.evidenceIds],
        });
    }
  }
  const partial =
    before.coverage.status !== "complete" ||
    after.coverage.status !== "complete";
  return comparisonOutput.parse({
    schemaVersion: 1,
    projectId: before.projectId,
    beforeId: before.id,
    afterId: after.id,
    status:
      counts.added + counts.removed + counts.modified > 0
        ? "changed"
        : partial || counts.unknown > 0
          ? "inconclusive"
          : "unchanged",
    changes: page(changes, paging),
    impact: page(
      [...impact.values()].sort((a, b) => a.path.localeCompare(b.path)),
      paging,
    ),
    counts,
    runtimeVerified: false,
    limitations: [
      "Comparação dos bytes observados em snapshots; não comprova regressão nem funcionamento em runtime.",
      "Impacto considera ambos os grafos e somente relações registradas; dependências dinâmicas e não resolvidas permanecem desconhecidas.",
      ...(partial
        ? [
            "Uma ou ambas as descobertas são parciais; ausência de observação não significa arquivo adicionado ou removido.",
          ]
        : []),
    ],
  });
}
