import { realpathSync, statSync } from "node:fs";
import { jobInput } from "./contracts.js";
import { PieError } from "../contracts.js";

/** Resolve filesystem identity once so DOS aliases and long Windows paths share a scope. */
export function admitJob(input: unknown) {
  const parsed = jobInput.parse(input);
  try {
    const root = realpathSync.native(parsed.payload.repositoryRoot);
    if (!statSync(root).isDirectory()) throw new Error("Not a directory");
    // VERIFY authorization is evidence: preserve the caller's exact source root.
    // Require canonical input rather than silently rewriting the signed choices.
    if (parsed.kind === "verification") {
      if (root !== parsed.payload.repositoryRoot)
        throw new PieError(
          "POLICY_DENIED",
          "Grant da fila exige raiz canônica.",
        );
      return parsed;
    }
    return { ...parsed, payload: { ...parsed.payload, repositoryRoot: root } };
  } catch (cause) {
    if (cause instanceof PieError) throw cause;
    throw new PieError("IO_ERROR", "Raiz do job indisponível.");
  }
}
