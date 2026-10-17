import { z } from "zod";
import { sourceSchema } from "../source.js";

export const adapterFactSchema = z.strictObject({
  id: z.string(),
  adapter: z.enum([
    "node-manifest",
    "composer-manifest",
    "compose",
    "openapi",
    "prisma-schema",
    "next-app-convention",
  ]),
  kind: z.enum([
    "dependency",
    "script",
    "service",
    "service_dependency",
    "endpoint",
    "model",
    "field",
    "page",
  ]),
  name: z.string().min(1).max(1000),
  parent: z.string().max(1000).nullable(),
  source: sourceSchema,
  evidenceId: z.string().uuid(),
  method: z.literal("static"),
  state: z.literal("unverified"),
});
export type AdapterFact = z.infer<typeof adapterFactSchema>;
export type Declaration = Pick<
  AdapterFact,
  "adapter" | "kind" | "name" | "parent"
> & { line: number };
export interface AdapterRead {
  declarations: Declaration[];
  limitations: string[];
}
