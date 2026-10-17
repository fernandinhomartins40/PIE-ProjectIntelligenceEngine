import { z } from "zod";
import { adapterFactSchema, type AdapterFact } from "./adapters/contracts.js";
import type { Snapshot } from "./contracts.js";
import { page } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";

export const declarationChangeSchema = z.strictObject({
  key: z.string(),
  state: z.enum([
    "observed_only_before",
    "observed_only_after",
    "source_changed",
    "relocated",
    "ambiguous",
  ]),
  before: z.array(adapterFactSchema),
  after: z.array(adapterFactSchema),
  interpretation: z.enum([
    "observed_change",
    "unknown_before",
    "unknown_after",
    "ambiguous",
  ]),
});
export const declarationChangesSchema = pagedOutput(declarationChangeSchema);

function index(snapshot: Snapshot) {
  const groups = new Map<string, AdapterFact[]>();
  for (const fact of snapshot.declarations) {
    // Source line and content digest are observations, not stable logical identity.
    const key = JSON.stringify([
      fact.source.path,
      fact.adapter,
      fact.kind,
      fact.name,
      fact.parent,
    ]);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return groups;
}

/** Missing declarations never establish deletion: parser/version/coverage may differ. */
export function compareDeclarations(
  before: Snapshot,
  after: Snapshot,
  paging: unknown,
) {
  const left = index(before);
  const right = index(after);
  const changes: z.infer<typeof declarationChangeSchema>[] = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const old = left.get(key) ?? [];
    const current = right.get(key) ?? [];
    if (old.length === 0)
      changes.push({
        key,
        state: "observed_only_after",
        before: old,
        after: current,
        interpretation:
          before.coverage.status === "complete"
            ? "observed_change"
            : "unknown_before",
      });
    else if (current.length === 0)
      changes.push({
        key,
        state: "observed_only_before",
        before: old,
        after: current,
        interpretation:
          after.coverage.status === "complete"
            ? "observed_change"
            : "unknown_after",
      });
    else if (old.length > 1 || current.length > 1) {
      const signature = (facts: AdapterFact[]) =>
        JSON.stringify(
          facts.map((fact) => [fact.source.line, fact.source.sha256]).sort(),
        );
      if (signature(old) !== signature(current))
        changes.push({
          key,
          state: "ambiguous",
          before: old,
          after: current,
          interpretation: "ambiguous",
        });
    } else if (old[0]!.source.sha256 !== current[0]!.source.sha256)
      changes.push({
        key,
        state: "source_changed",
        before: old,
        after: current,
        interpretation: "observed_change",
      });
    else if (old[0]!.source.line !== current[0]!.source.line)
      changes.push({
        key,
        state: "relocated",
        before: old,
        after: current,
        interpretation: "observed_change",
      });
  }
  return declarationChangesSchema.parse(page(changes, paging));
}
