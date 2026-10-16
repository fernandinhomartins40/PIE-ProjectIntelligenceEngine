import { z } from "zod";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceSchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().positive().nullable(),
  sha256: digestSchema,
});
