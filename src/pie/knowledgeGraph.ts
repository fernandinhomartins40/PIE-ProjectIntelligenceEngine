import { z } from "zod";
import { PieError, graphNodeSchema, type Snapshot } from "./contracts.js";
import { sha256 } from "./evidence.js";
import { page, pageSchema } from "./graph.js";
import { adapterFactSchema, type AdapterFact } from "./adapters/contracts.js";

export const knowledgeNodeSchema = z.strictObject({
  id: z.string(),
  kind: z.union([graphNodeSchema.shape.kind, adapterFactSchema.shape.kind]),
  label: z.string(),
  path: z.string(),
  line: z.number().int().positive().nullable(),
  evidenceIds: z.array(z.string().uuid()).min(1),
  confidence: z.enum(["observed", "derived", "inferred"]),
  state: z.literal("unverified"),
});
export const knowledgeEdgeSchema = z.strictObject({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum([
    "depends",
    "covers",
    "calls",
    "reads",
    "writes",
    "authorizes",
    "declared_in",
    "field_of",
  ]),
  evidenceIds: z.array(z.string().uuid()).min(1),
  confidence: z.enum(["observed", "derived", "inferred"]),
});
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;
export type KnowledgeEdge = z.infer<typeof knowledgeEdgeSchema>;
export const traceInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
  nodeId: z.string().min(1).max(200),
  direction: z
    .enum(["dependencies", "dependents", "both"])
    .default("dependencies"),
  maxDepth: z.number().int().min(0).max(32).default(4),
  maxNodes: z.number().int().min(1).max(1000).default(200),
  maxEdges: z.number().int().min(1).max(5000).default(1000),
});
const pageOutput = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  });
export const traceOutput = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  revision: z.string().nullable(),
  seedId: z.string(),
  direction: z.enum(["dependencies", "dependents", "both"]),
  nodes: pageOutput(knowledgeNodeSchema),
  edges: pageOutput(knowledgeEdgeSchema),
  coverage: z.strictObject({
    scope: z.literal("recorded-relationships"),
    discoveryStatus: z.enum(["complete", "partial"]),
    truncated: z.boolean(),
    maxDepth: z.number().int(),
    maxNodes: z.number().int(),
    maxEdges: z.number().int(),
    unresolvedRelations: z.number().int(),
    runtime: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

/** Composes recorded facts, without re-reading or reinterpreting source text. */
export function buildKnowledgeGraph(snapshot: Snapshot) {
  const nodes: KnowledgeNode[] = snapshot.nodes.map((node) => ({
    ...node,
    label: node.path,
    line: null,
    confidence: node.kind === "file" ? "observed" : "inferred",
    state: "unverified",
  }));
  const edges: KnowledgeEdge[] = [...snapshot.edges];
  const files = new Map(snapshot.nodes.map((node) => [node.path, node]));
  const declared = new Map<string, AdapterFact[]>();
  for (const fact of snapshot.declarations) {
    const key = JSON.stringify([
      fact.adapter,
      fact.source.path,
      fact.kind,
      fact.name,
    ]);
    const group = declared.get(key) ?? [];
    group.push(fact);
    declared.set(key, group);
  }
  const unique = (fact: AdapterFact, kind: string, name: string | null) => {
    const group = declared.get(
      JSON.stringify([fact.adapter, fact.source.path, kind, name]),
    );
    return group?.length === 1 ? group[0] : undefined;
  };
  let unresolvedRelations = 0;
  const link = (
    from: string,
    to: string,
    kind: KnowledgeEdge["kind"],
    evidenceIds: string[],
  ) => {
    edges.push({
      id: sha256(JSON.stringify([from, to, kind])),
      from,
      to,
      kind,
      evidenceIds: [...new Set(evidenceIds)],
      confidence: "derived",
    });
  };
  for (const fact of snapshot.declarations) {
    nodes.push({
      id: fact.id,
      kind: fact.kind,
      label: fact.name,
      path: fact.source.path,
      line: fact.source.line,
      evidenceIds: [fact.evidenceId],
      confidence: "derived",
      state: "unverified",
    });
    const file = files.get(fact.source.path);
    if (file) link(fact.id, file.id, "declared_in", [fact.evidenceId]);
    else unresolvedRelations++;
    if (fact.kind === "field") {
      const model = unique(fact, "model", fact.parent);
      if (model)
        link(fact.id, model.id, "field_of", [
          fact.evidenceId,
          model.evidenceId,
        ]);
      else unresolvedRelations++;
    }
    if (fact.kind === "service_dependency") {
      const service = unique(fact, "service", fact.parent);
      const dependency = unique(fact, "service", fact.name);
      if (service && dependency)
        link(service.id, dependency.id, "depends", [
          fact.evidenceId,
          service.evidenceId,
          dependency.evidenceId,
        ]);
      else unresolvedRelations++;
    }
  }
  return { nodes, edges, unresolvedRelations };
}

/** Bounded deterministic reachability. Depth/resource cutoffs remain explicit. */
export function traceSnapshot(snapshot: Snapshot, raw: unknown) {
  const input = traceInput.parse(raw);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Snapshot de trace incompatível.");
  const graph = buildKnowledgeGraph(snapshot);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(input.nodeId))
    throw new PieError("NOT_FOUND", "Nó inicial não encontrado no snapshot.");
  const adjacency = new Map<
    string,
    Array<{ neighbor: string; edge: KnowledgeEdge }>
  >();
  const add = (from: string, neighbor: string, edge: KnowledgeEdge) => {
    const items = adjacency.get(from) ?? [];
    items.push({ neighbor, edge });
    adjacency.set(from, items);
  };
  for (const edge of [...graph.edges].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (input.direction !== "dependents") add(edge.from, edge.to, edge);
    if (input.direction !== "dependencies") add(edge.to, edge.from, edge);
  }
  const reached = new Map([[input.nodeId, 0]]);
  const queue = [input.nodeId];
  const traversed = new Map<string, KnowledgeEdge>();
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const depth = reached.get(id)!;
    for (const { neighbor, edge } of adjacency.get(id) ?? []) {
      if (!traversed.has(edge.id) && traversed.size >= input.maxEdges) {
        truncated = true;
        continue;
      }
      if (!reached.has(neighbor)) {
        if (depth >= input.maxDepth || reached.size >= input.maxNodes) {
          truncated = true;
          continue;
        }
        reached.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
      traversed.set(edge.id, edge);
    }
  }
  return traceOutput.parse({
    schemaVersion: 1,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    seedId: input.nodeId,
    direction: input.direction,
    nodes: page(
      queue.map((id) => nodes.get(id)!),
      inputPaging(input),
    ),
    edges: page([...traversed.values()], inputPaging(input)),
    coverage: {
      scope: "recorded-relationships",
      discoveryStatus: snapshot.coverage.status,
      truncated,
      maxDepth: input.maxDepth,
      maxNodes: input.maxNodes,
      maxEdges: input.maxEdges,
      unresolvedRelations: graph.unresolvedRelations,
      runtime: false,
      limitations: [
        ...snapshot.coverage.limitations,
        "Trace deriva somente de imports e declarações registradas; não comprova execução, autorização ou persistência.",
        "Relações Compose são limitadas ao mesmo arquivo; não há resolução de includes/overrides. Campos Prisma são declarações, não constraints verificadas.",
        "unresolvedRelations cobre relações declarativas não resolvidas no snapshot inteiro; dependências dinâmicas e relações não coletadas permanecem desconhecidas.",
        ...(truncated
          ? [
              "Busca interrompida por profundidade, número de nós ou de arestas; ausência no resultado não prova ausência de relação.",
            ]
          : []),
      ],
    },
  });
}

const inputPaging = (input: z.infer<typeof traceInput>) => ({
  offset: input.offset,
  limit: input.limit,
});
