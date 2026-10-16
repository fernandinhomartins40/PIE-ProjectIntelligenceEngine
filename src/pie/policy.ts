import { isAbsolute, relative, resolve, sep } from "node:path";
import { PieError, type Policy } from "./contracts.js";

/** Pure admission rule; execution adapters must also establish OS containment. */
export function admitOperation(
  policy: Policy,
  operation: "observe" | "execute" | "mutate",
  productionApproval = false,
): void {
  if (operation === "observe") return;
  if (policy.environment === "production" && !productionApproval)
    throw new PieError(
      "POLICY_DENIED",
      "Produção exige aprovação específica para execução ou alteração.",
    );
  if (policy.profile === "OBSERVE" || !policy.allowTargetExecution)
    throw new PieError(
      "POLICY_DENIED",
      "Execução do projeto não autorizada pela política.",
    );
  if (
    operation === "mutate" &&
    (policy.profile !== "CHANGE" || !policy.allowTargetMutation)
  )
    throw new PieError(
      "POLICY_DENIED",
      "Alteração do projeto não autorizada pela política.",
    );
}

/** Lexical check is necessary but not sufficient: filesystem adapters reject links. */
export function containedPath(root: string, path: string): string {
  if (isAbsolute(path) || path.includes("\0"))
    throw new PieError("INVALID_INPUT", "Caminho relativo inválido.");
  const candidate = resolve(root, path);
  const delta = relative(root, candidate);
  if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta))
    throw new PieError(
      "POLICY_DENIED",
      "Caminho fora do repositório autorizado.",
    );
  return candidate;
}
