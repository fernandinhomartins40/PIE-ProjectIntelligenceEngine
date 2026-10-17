import { readBoundedJsonFile } from "../readFile.js";
import { PieError } from "../contracts.js";
import { nodeTestGrantSchema } from "./contracts.js";

export async function readNodeTestGrant(path: string) {
  const value = await readBoundedJsonFile(
    path,
    1_000_000,
    "Arquivo de autorização",
  );
  const parsed = nodeTestGrantSchema.safeParse(value);
  if (!parsed.success)
    throw new PieError("INVALID_INPUT", "Autorização VERIFY inválida.");
  return parsed.data;
}
