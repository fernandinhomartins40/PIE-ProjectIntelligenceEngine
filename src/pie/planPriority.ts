import { z } from "zod";

export const priorityAssessmentSchema = z.strictObject({
  impact: z.number().int().min(1).max(5),
  risk: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  evidenceIds: z
    .array(z.string().uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
});

export type PriorityAssessment = z.infer<typeof priorityAssessmentSchema>;

type PrioritizedItem = {
  id: string;
  priorityAssessment?: PriorityAssessment | null | undefined;
};

/** Human ratings sort impact/risk descending, effort ascending, then stable ID. */
export function comparePlanPriority(
  left: PrioritizedItem,
  right: PrioritizedItem,
) {
  const a = left.priorityAssessment;
  const b = right.priorityAssessment;
  if (a && !b) return -1;
  if (!a && b) return 1;
  if (a && b) {
    const difference =
      b.impact - a.impact || b.risk - a.risk || a.effort - b.effort;
    if (difference) return difference;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
