import { PieError } from "./contracts.js";
import { sha256 } from "./evidence.js";

/** Return stable byte-bounded pages without splitting UTF-8 code points. */
export function pageUtf8Artifact(
  content: string,
  offset: number,
  limitBytes: number,
) {
  const bytes = Buffer.from(content, "utf8");
  if (offset > bytes.length)
    throw new PieError("INVALID_INPUT", "Offset excede a exporta??o.");
  if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)
    throw new PieError("INVALID_INPUT", "Offset n?o inicia caractere UTF-8.");
  let end = Math.min(bytes.length, offset + limitBytes);
  if (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    while (end > offset && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === offset)
      throw new PieError(
        "INVALID_INPUT",
        "Limite n?o comporta caractere UTF-8.",
      );
  }
  return {
    totalBytes: bytes.length,
    nextOffset: end < bytes.length ? end : null,
    sha256: sha256(bytes),
    content: bytes.subarray(offset, end).toString("utf8"),
  };
}
