import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { PieError } from "../contracts.js";
/** No permissions are inferred from a manifest or executable found in the target tree. */
export async function privateState(
  path?: string,
  auditedRoot?: string,
): Promise<string> {
  if (process.platform !== "linux")
    throw new PieError(
      "POLICY_DENIED",
      "Execução e recuperação VERIFY disponíveis somente no Linux comprovado.",
    );
  if (!path || !isAbsolute(path))
    throw new PieError(
      "INVALID_INPUT",
      "Informe --state-dir absoluto e privado (modo 0700).",
    );
  const actual = await realpath(path);
  const stat = await lstat(actual);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new PieError(
      "POLICY_DENIED",
      "Diretório de estado deve pertencer ao usuário e ter modo 0700.",
    );
  if (auditedRoot) {
    const root = await realpath(auditedRoot);
    const delta = relative(root, actual);
    if (
      delta === "" ||
      (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`))
    )
      throw new PieError(
        "POLICY_DENIED",
        "Estado VERIFY deve ficar fora do projeto auditado.",
      );
  }
  return actual;
}
