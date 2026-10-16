import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { PieError } from "./contracts.js";

/** Bounded complete regular-file read; handles short reads and detects ordinary races. */
export async function readInventoryFile(
  path: string,
  maxBytes: number,
  checkpoint: () => number,
): Promise<Buffer | null> {
  const flags =
    constants.O_RDONLY |
    (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  const handle = await open(path, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) return null;
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
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}
