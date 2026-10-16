import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { PieError } from "./contracts.js";
import { containedPath } from "./policy.js";

/** Shared admission for discovery and verification; never follows a known link. */
export async function inventoryPath(
  root: string,
  path: string,
): Promise<string> {
  const candidate = containedPath(root, path);
  let cursor = candidate;
  while (cursor !== root) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw new PieError("POLICY_DENIED", "Link simbólico não inspecionado.");
    const parent = dirname(cursor);
    if (parent === cursor)
      throw new PieError("POLICY_DENIED", "Caminho não contido.");
    cursor = parent;
  }
  const actual = await realpath(candidate);
  const delta = relative(root, actual);
  if (delta === ".." || delta.startsWith(`..${sep}`))
    throw new PieError("POLICY_DENIED", "Destino fora do escopo.");
  return candidate;
}
