import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PieError } from "./contracts.js";
import { readInventoryFile } from "./readFile.js";

export async function loadWebAssets(directory: string) {
  const root = await realpath(directory);
  const assets = new Map<string, { bytes: Buffer; type: string }>();
  for (const [route, file, type] of [
    ["/", "index.html", "text/html; charset=utf-8"],
    ["/assets/pie.js", "assets/pie.js", "text/javascript; charset=utf-8"],
    ["/assets/pie.css", "assets/pie.css", "text/css; charset=utf-8"],
  ]) {
    const path = await realpath(resolve(root, file!));
    const delta = relative(root, path);
    if (isAbsolute(delta) || delta === ".." || delta.startsWith(`..${sep}`))
      throw new PieError(
        "POLICY_DENIED",
        "Asset do painel fora da pasta autorizada.",
      );
    const bytes = await readInventoryFile(path, 5_000_000, () => 1);
    if (!bytes)
      throw new PieError("LIMIT_EXCEEDED", "Asset do painel excede o limite.");
    assets.set(route!, { bytes, type: type! });
  }
  return assets;
}

export const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
