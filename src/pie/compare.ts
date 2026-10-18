import { snapshotFiles } from "./snapshotFiles.js";
import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { impactedNodes, page, pageSchema } from "./graph.js";
import {
  compareDeclarationFacts,
  compareDeclarations,
  declarationChangesSchema,
} from "./declarationChanges.js";

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
  changed: z.boolean(),
  evidenceIds: z.array(z.string().uuid()).min(1),
  relationEvidenceIds: z.array(z.string().uuid()),
});
const moveCandidateSchema = z.strictObject({
  beforePath: z.string(),
  afterPath: z.string(),
  basis: z.literal("unique_identical_sha256"),
  beforeEvidenceIds: z.array(z.string().uuid()).min(1),
  afterEvidenceIds: z.array(z.string().uuid()).min(1),
});
const declarationMoveCandidateSchema = z.strictObject({
  beforePath: z.string(),
  afterPath: z.string(),
  adapter: z.string(),
  kind: z.string(),
  name: z.string(),
  parent: z.string().nullable(),
  basis: z.literal("unique_identical_source_sha256_and_line"),
  beforeEvidenceIds: z.array(z.string().uuid()).min(1),
  afterEvidenceIds: z.array(z.string().uuid()).min(1),
});
export const comparisonOutput = z.strictObject({
  schemaVersion: z.literal(4),
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
  moveCandidates: z.array(moveCandidateSchema),
  declarationMoveCandidates: z.array(declarationMoveCandidateSchema),
  counts: z.strictObject({
    added: z.number().int(),
    removed: z.number().int(),
    modified: z.number().int(),
    unknown: z.number().int(),
    unchanged: z.number().int(),
  }),
  runtimeVerified: z.literal(false),
  declarationChanges: declarationChangesSchema,
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
  const sides = (snapshot: Snapshot) =>
    new Map(
      snapshotFiles(snapshot).map(({ node, source }) => [
        node.path,
        {
          nodeId: node.id,
          sha256: source.source.sha256,
          evidenceIds: node.evidenceIds,
        },
      ]),
    );
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
  const removedByDigest = new Map<string, typeof changes>();
  const addedByDigest = new Map<string, typeof changes>();
  for (const change of changes) {
    if (change.state === "removed" && change.before) {
      const group = removedByDigest.get(change.before.sha256) ?? [];
      group.push(change);
      removedByDigest.set(change.before.sha256, group);
    }
    if (change.state === "added" && change.after) {
      const group = addedByDigest.get(change.after.sha256) ?? [];
      group.push(change);
      addedByDigest.set(change.after.sha256, group);
    }
  }
  const moveCandidates = [...removedByDigest]
    .flatMap(([digest, removed]) => {
      const added = addedByDigest.get(digest) ?? [];
      if (removed.length !== 1 || added.length !== 1) return [];
      const beforeSide = removed[0]!.before!;
      const afterSide = added[0]!.after!;
      return [
        {
          beforePath: removed[0]!.path,
          afterPath: added[0]!.path,
          basis: "unique_identical_sha256" as const,
          beforeEvidenceIds: beforeSide.evidenceIds,
          afterEvidenceIds: afterSide.evidenceIds,
        },
      ];
    })
    .sort((left, right) =>
      left.beforePath < right.beforePath
        ? -1
        : left.beforePath > right.beforePath
          ? 1
          : left.afterPath < right.afterPath
            ? -1
            : left.afterPath > right.afterPath
              ? 1
              : 0,
    );
  const impact = new Map<string, z.infer<typeof impactSchema>>();
  for (const [version, snapshot] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const seeds = changes.flatMap((change) =>
      change[version] ? [change[version]!.nodeId] : [],
    );
    const changedIds = new Set(seeds);
    const reverse = new Map<
      string,
      Array<{ from: string; evidenceIds: string[] }>
    >();
    for (const edge of snapshot.edges) {
      if (!["depends", "calls", "covers"].includes(edge.kind)) continue;
      const sources = reverse.get(edge.to) ?? [];
      sources.push({ from: edge.from, evidenceIds: edge.evidenceIds });
      reverse.set(edge.to, sources);
    }
    const reached = impactedNodes(snapshot.nodes, snapshot.edges, seeds);
    const reachedIds = new Set(reached.map((node) => node.id));
    const relationEvidence = new Map<string, Set<string>>();
    for (const [targetId, dependents] of reverse)
      if (reachedIds.has(targetId))
        for (const edge of dependents)
          if (reachedIds.has(edge.from)) {
            const found = relationEvidence.get(edge.from) ?? new Set<string>();
            for (const id of edge.evidenceIds) found.add(id);
            relationEvidence.set(edge.from, found);
          }
    for (const node of reached) {
      const changed = changedIds.has(node.id);
      const relationEvidenceIds = changed
        ? []
        : [...(relationEvidence.get(node.id) ?? [])];
      const existing = impact.get(node.path);
      if (existing) {
        existing.versions.push(version);
        existing.evidenceIds = [
          ...new Set([...existing.evidenceIds, ...node.evidenceIds]),
        ];
        existing.changed ||= changed;
        existing.relationEvidenceIds = [
          ...new Set([...existing.relationEvidenceIds, ...relationEvidenceIds]),
        ];
      } else
        impact.set(node.path, {
          path: node.path,
          nodeId: node.id,
          versions: [version],
          changed,
          evidenceIds: [...node.evidenceIds],
          relationEvidenceIds,
        });
    }
  }
  const partial =
    before.coverage.status !== "complete" ||
    after.coverage.status !== "complete";
  const declarationChanges = compareDeclarations(before, after, paging);
  const declarationFacts = compareDeclarationFacts(before, after);
  const declarationSignature = (fact: Snapshot["declarations"][number]) =>
    JSON.stringify([
      fact.adapter,
      fact.kind,
      fact.name,
      fact.parent,
      fact.source.sha256,
      fact.source.line,
    ]);
  const declarationsBefore = new Map<string, typeof declarationFacts>();
  const declarationsAfter = new Map<string, typeof declarationFacts>();
  for (const change of declarationFacts) {
    if (
      change.state === "observed_only_before" &&
      change.interpretation === "observed_change"
    )
      for (const fact of change.before) {
        const signature = declarationSignature(fact);
        declarationsBefore.set(signature, [
          ...(declarationsBefore.get(signature) ?? []),
          change,
        ]);
      }
    if (
      change.state === "observed_only_after" &&
      change.interpretation === "observed_change"
    )
      for (const fact of change.after) {
        const signature = declarationSignature(fact);
        declarationsAfter.set(signature, [
          ...(declarationsAfter.get(signature) ?? []),
          change,
        ]);
      }
  }
  const declarationMoveCandidates = [...declarationsBefore]
    .flatMap(([signature, oldChanges]) => {
      const newChanges = declarationsAfter.get(signature) ?? [];
      if (oldChanges.length !== 1 || newChanges.length !== 1) return [];
      const oldChange = oldChanges[0]!;
      const newChange = newChanges[0]!;
      if (oldChange.before.length !== 1 || newChange.after.length !== 1)
        return [];
      const oldFact = oldChange.before[0]!;
      const newFact = newChange.after[0]!;
      return [
        {
          beforePath: oldFact.source.path,
          afterPath: newFact.source.path,
          adapter: oldFact.adapter,
          kind: oldFact.kind,
          name: oldFact.name,
          parent: oldFact.parent,
          basis: "unique_identical_source_sha256_and_line" as const,
          beforeEvidenceIds: [oldFact.evidenceId],
          afterEvidenceIds: [newFact.evidenceId],
        },
      ];
    })
    .sort(
      (left, right) =>
        left.beforePath.localeCompare(right.beforePath) ||
        left.afterPath.localeCompare(right.afterPath) ||
        left.name.localeCompare(right.name),
    );
  const observedDeclarationChanges = declarationFacts.some(
    (change) => change.interpretation === "observed_change",
  );
  const unresolvedDeclarationChanges = declarationFacts.some(
    (change) =>
      change.interpretation === "unknown_before" ||
      change.interpretation === "unknown_after" ||
      change.interpretation === "ambiguous",
  );
  const observedFileChanges =
    counts.added + counts.removed + counts.modified > 0;
  const status =
    observedFileChanges || observedDeclarationChanges
      ? "changed"
      : partial || counts.unknown > 0 || unresolvedDeclarationChanges
        ? "inconclusive"
        : "unchanged";
  return comparisonOutput.parse({
    schemaVersion: 4,
    projectId: before.projectId,
    beforeId: before.id,
    afterId: after.id,
    status,
    changes: page(changes, paging),
    impact: page(
      [...impact.values()].sort((a, b) => a.path.localeCompare(b.path)),
      paging,
    ),
    moveCandidates,
    declarationMoveCandidates,
    counts,
    runtimeVerified: false,
    declarationChanges,
    limitations: [
      "Comparação dos bytes observados em snapshots; não comprova regressão nem funcionamento em runtime.",
      "Candidatos a movimento exigem remoção/adição observadas, hash SHA-256 idêntico e unicidade em cada lado; conteúdo idêntico não prova continuidade semântica nem histórico Git de rename.",
      "Candidatos a movimento de declaração exigem inventários completos, declaração única e identidade declarada com hash e linha idênticos em caminhos distintos; são correspondências observacionais, não renames semânticos comprovados.",
      "Impacto considera ambos os grafos e somente relações registradas; dependências dinâmicas e não resolvidas permanecem desconhecidas.",
      "Declarações somente observadas de um lado não comprovam adição/remoção de comportamento: versões de parser, limites e cobertura podem divergir. source_changed indica bytes do arquivo alterados, não alteração comprovada do handler. Ocorrências repetidas não são alinhadas por suposição.",
      ...(partial
        ? [
            "Uma ou ambas as descobertas são parciais; ausência de observação não significa arquivo adicionado ou removido.",
          ]
        : []),
    ],
  });
}
