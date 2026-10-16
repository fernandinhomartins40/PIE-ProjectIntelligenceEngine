import { z } from "zod";
import type { GraphEdge, GraphNode } from "./contracts.js";

export const pageSchema = z.strictObject({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});
export function page<T>(items: readonly T[], input: unknown = {}) {
  const { offset, limit } = pageSchema.parse(input);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}

/** Reverse reachability follows only recorded dependencies, never guessed relations. */
export function impactedNodes(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  changedIds: readonly string[],
): GraphNode[] {
  const reached = new Set(changedIds);
  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    if (
      edge.kind !== "depends" &&
      edge.kind !== "calls" &&
      edge.kind !== "covers"
    )
      continue;
    const incoming = reverse.get(edge.to) ?? [];
    incoming.push(edge.from);
    reverse.set(edge.to, incoming);
  }
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++) {
    for (const incoming of reverse.get(queue[i]!) ?? []) {
      if (!reached.has(incoming)) {
        reached.add(incoming);
        queue.push(incoming);
      }
    }
  }
  return nodes.filter((node) => reached.has(node.id));
}
