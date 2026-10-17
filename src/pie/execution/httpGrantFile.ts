import { PieError } from "../contracts.js";
import { readInventoryFile } from "../readFile.js";
import { httpGrantSchema } from "./httpProbe.js";

const MAX_HTTP_GRANT_BYTES = 1_000_000;

/** Reads a bounded regular grant file before parsing or opening persistence. */
export async function readHttpProbeGrant(path: string) {
  const bytes = await readInventoryFile(path, MAX_HTTP_GRANT_BYTES, () => 1);
  if (!bytes)
    throw new PieError(
      "INVALID_INPUT",
      "Arquivo de autorização HTTP excede 1 MB ou não é regular.",
    );
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return httpGrantSchema.parse(JSON.parse(source) as unknown);
}
