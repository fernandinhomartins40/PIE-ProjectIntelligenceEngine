import { realpathSync, statSync } from "node:fs";
import { jobInput } from "./contracts.js";
import { PieError } from "../contracts.js";

/** Resolve filesystem identity once so DOS aliases and long Windows paths share a scope. */
export function admitJob(input: unknown) {
  const parsed = jobInput.parse(input);
  try {
    const root = realpathSync.native(parsed.payload.repositoryRoot);
    if (!statSync(root).isDirectory()) throw new Error("Not a directory");
    return { ...parsed, payload: { ...parsed.payload, repositoryRoot: root } };
  } catch {
    throw new PieError("IO_ERROR", "Raiz do job indisponível.");
  }
}
