import type { Snapshot } from "../contracts.js";
import type { NodeTestGrant } from "./contracts.js";

/** Referential integrity only: a declared association never proves test coverage. */
export function hasValidTestBindings(
  grant: NodeTestGrant,
  snapshot: Snapshot,
): boolean {
  if (grant.schemaVersion === 1) return true;
  const declarations = new Set(snapshot.declarations.map((item) => item.id));
  const seen = new Set<string>();
  for (const binding of grant.testBindings) {
    const identity = JSON.stringify([binding.testFile, binding.declarationId]);
    if (
      !grant.testFiles.includes(binding.testFile) ||
      !declarations.has(binding.declarationId) ||
      seen.has(identity)
    )
      return false;
    seen.add(identity);
  }
  return true;
}
