import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { err, ok, type Result } from "../domain/result.js";
import { PieError } from "./contracts.js";

export type InventoryReadFailure =
  | { readonly kind: "not_regular_file" }
  | { readonly kind: "limit_exceeded" };

/** Bounded complete regular-file read; handles short reads and detects ordinary races. */
export async function readInventoryFile(
  path: string,
  maxBytes: number,
  checkpoint: () => number,
): Promise<Result<Buffer, InventoryReadFailure>> {
  const flags =
    constants.O_RDONLY |
    (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  const handle = await open(path, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile()) return err({ kind: "not_regular_file" });
    if (before.size > maxBytes) return err({ kind: "limit_exceeded" });
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      checkpoint();
      const read = await handle.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      count !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new PieError(
        "IO_ERROR",
        "Arquivo alterado durante a leitura; não retido como evidência.",
      );
    return ok(buffer.subarray(0, count));
  } finally {
    await handle.close();
  }
}

/** Parses bounded caller-supplied JSON once at the file boundary. */
export async function readBoundedJsonFile(
  path: string,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const read = await readInventoryFile(path, maxBytes, () => 1);
  if (!read.ok)
    throw new PieError(
      "INVALID_INPUT",
      `${label} excede o limite permitido ou não é arquivo regular.`,
    );
  const bytes = read.value;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new PieError("INVALID_INPUT", `${label} não contém UTF-8 válido.`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new PieError("INVALID_INPUT", `${label} não contém JSON válido.`);
  }
}
