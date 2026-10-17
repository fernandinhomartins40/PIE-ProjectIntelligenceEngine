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
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new PieError("INVALID_INPUT", "Grant HTTP não contém UTF-8 válido.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new PieError("INVALID_INPUT", "Grant HTTP não contém JSON válido.");
  }
  const parsed = httpGrantSchema.safeParse(value);
  if (!parsed.success)
    throw new PieError("INVALID_INPUT", "Grant HTTP não segue o contrato.");
  return parsed.data;
}
