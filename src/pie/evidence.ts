import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { evidenceSchema, PieError, type Evidence } from "./contracts.js";

export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export function sealEvidence(input: Omit<Evidence, "sha256">): Evidence {
  const parsed = evidenceSchema.omit({ sha256: true }).parse(input);
  return evidenceSchema.parse({
    ...parsed,
    sha256: sha256(canonicalize(parsed)!),
  });
}

export function verifyEvidence(input: unknown): Evidence {
  const parsed = evidenceSchema.parse(input);
  const { sha256: expected, ...payload } = parsed;
  if (sha256(canonicalize(payload)!) !== expected)
    throw new PieError(
      "INTEGRITY_ERROR",
      "Evidência alterada: hash incompatível.",
    );
  return parsed;
}
