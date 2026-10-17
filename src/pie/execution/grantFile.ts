import { readInventoryFile } from "../readFile.js";
import { PieError } from "../contracts.js";
import { nodeTestGrantSchema } from "./contracts.js";

export async function readNodeTestGrant(path: string) {
  const bytes = await readInventoryFile(path, 1_000_000, () => 1);
  if (!bytes)
    throw new PieError(
      "INVALID_INPUT",
      "Arquivo de autorização excede limite de 1 MB ou não é regular.",
    );
  return nodeTestGrantSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown,
  );
}
