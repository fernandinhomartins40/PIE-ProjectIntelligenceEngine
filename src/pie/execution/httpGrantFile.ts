import { PieError } from "../contracts.js";
import { readBoundedJsonFile } from "../readFile.js";
import { httpGrantSchema } from "./httpProbe.js";

const MAX_HTTP_GRANT_BYTES = 1_000_000;

/** Reads a bounded regular grant file before parsing or opening persistence. */
export async function readHttpProbeGrant(path: string) {
  const value = await readBoundedJsonFile(
    path,
    MAX_HTTP_GRANT_BYTES,
    "Grant HTTP",
  );
  const parsed = httpGrantSchema.safeParse(value);
  if (!parsed.success)
    throw new PieError("INVALID_INPUT", "Grant HTTP não segue o contrato.");
  return parsed.data;
}
