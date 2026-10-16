import { z } from "zod";
import { adapterFactSchema } from "./adapters/contracts.js";
import {
  evidenceSchema,
  graphNodeSchema,
  graphEdgeSchema,
  snapshotSchema,
} from "./contracts.js";

const count = z.number().int().nonnegative();
export const errorOutput = z.strictObject({
  schemaVersion: z.literal(1),
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
export const pagedOutput = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: count,
    offset: count,
    nextOffset: count.nullable(),
  });
export const projectOutput = z.strictObject({
  id: z.string().uuid(),
  root: z.string(),
  name: z.string(),
});
export const discoveryOutput = z.strictObject({
  project: projectOutput,
  snapshot: snapshotSchema.pick({
    id: true,
    revision: true,
    dirty: true,
    createdAt: true,
    treeDigest: true,
  }),
  coverage: snapshotSchema.shape.coverage,
  nodeCount: count,
  evidenceCount: count,
  declarationCount: count,
});
export const graphOutput = z.strictObject({
  snapshotId: z.string().uuid(),
  nodes: pagedOutput(graphNodeSchema),
  edges: pagedOutput(graphEdgeSchema),
  coverage: snapshotSchema.shape.coverage,
});
export const projectsOutput = pagedOutput(
  projectOutput.extend({ created_at: z.iso.datetime() }),
);
export const historyOutput = pagedOutput(
  z.strictObject({ id: z.string().uuid(), created_at: z.iso.datetime() }),
);
export const evidenceOutput = evidenceSchema;
export const declarationsOutput = z.strictObject({
  snapshotId: z.string().uuid(),
  declarations: pagedOutput(adapterFactSchema),
  coverage: snapshotSchema.shape.coverage,
});
export const withError = <T extends z.ZodType>(success: T) =>
  z.union([success, errorOutput]);
