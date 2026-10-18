import { z } from "zod";
import { adapterFactSchema } from "./adapters/contracts.js";
import {
  type Snapshot,
  engineName,
  policySchema,
  PieError,
} from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { err, ok, type Result } from "../domain/result.js";

export const functionalInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
  modulePath: z.string().max(1000).default(""),
});
export type FunctionalFailure =
  | {
      kind: "invalid_input";
      reason: "schema" | "module_path";
    }
  | { kind: "policy_denied"; reason: "snapshot_mismatch" | "scope" }
  | { kind: "invalid_snapshot" };
export type ProductFailure =
  | { kind: "invalid_input"; reason: "schema" | "module_path" }
  | { kind: "policy_denied"; reason: "snapshot_mismatch" }
  | { kind: "invalid_snapshot" };
const target = z.strictObject({
  id: z.string(),
  state: z.literal("unverified"),
  severity: z.literal("info"),
  category: z.literal("runtime_verification_gap"),
  declaration: adapterFactSchema,
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
  reproduction: z.array(z.string()),
  proposal: z.string(),
  acceptance: z.array(z.string()),
  owner: z.null(),
});
export const functionalOutput = z.strictObject({
  schemaVersion: z.literal(1),
  engine: engineName.extract(["functional"]),
  snapshotId: z.string().uuid(),
  profile: z.literal("OBSERVE"),
  state: z.literal("unverified"),
  scope: z.strictObject({
    modulePath: z.string(),
    declaredTargets: z.number().int().nonnegative(),
    examinedTargets: z.number().int().nonnegative(),
  }),
  findings: pagedOutput(target),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    runtime: z.literal(false),
    journeyVerification: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

/** Product review is evidence-led: static declarations alone never imply UX friction. */
const productFinding = z.strictObject({
  id: z.string(),
  journey: z.literal("unobserved"),
  state: z.literal("insufficient_evidence"),
  declaration: adapterFactSchema,
  evidenceIds: z.array(z.string().uuid()).min(1),
  movements: z.strictObject({
    eliminate: z.literal("not_assessed"),
    combine: z.literal("not_assessed"),
    automate: z.literal("not_assessed"),
    anticipate: z.literal("not_assessed"),
    create: z.literal("not_assessed"),
  }),
  missingEvidence: z.array(z.string()),
});
export const productOutput = z.strictObject({
  schemaVersion: z.literal(1),
  engine: engineName.extract(["product"]),
  snapshotId: z.string().uuid(),
  profile: z.literal("OBSERVE"),
  state: z.literal("insufficient_evidence"),
  scope: functionalOutput.shape.scope,
  opportunities: pagedOutput(productFinding),
  coverage: z.strictObject({
    staticDeclarations: z.enum(["complete", "partial"]),
    observedJourneys: z.literal(false),
    runtime: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

function assessValidatedProduct(
  snapshot: Snapshot,
  request: z.infer<typeof functionalInput>,
) {
  const { targets, selected } = selectFunctionalTargets(snapshot, request);
  const opportunities = selected.items.map((declaration) => ({
    id: `product:evidence-gap:${declaration.id}`,
    journey: "unobserved" as const,
    state: "insufficient_evidence" as const,
    declaration,
    evidenceIds: [
      declaration.evidenceId,
      ...declaration.derivations.map((item) => item.evidenceId),
    ],
    movements: {
      eliminate: "not_assessed" as const,
      combine: "not_assessed" as const,
      automate: "not_assessed" as const,
      anticipate: "not_assessed" as const,
      create: "not_assessed" as const,
    },
    missingEvidence: [
      "Jornada observada com objetivo do usuário, início, passos e resultado esperado.",
      "Evidência de interface/acessibilidade e fluxos mobile/desktop, quando aplicável.",
      "Medição da fricção atual, dependências, impacto, custo e risco da hipótese.",
    ],
  }));
  return productOutput.parse({
    schemaVersion: 1,
    engine: "product",
    snapshotId: snapshot.id,
    profile: "OBSERVE",
    state: "insufficient_evidence",
    scope: {
      modulePath: request.modulePath,
      declaredTargets: targets.length,
      examinedTargets: selected.items.length,
    },
    opportunities: { ...selected, items: opportunities },
    coverage: {
      staticDeclarations: snapshot.coverage.status,
      observedJourneys: false,
      runtime: false,
      limitations: [
        ...snapshot.coverage.limitations,
        "Declarações estáticas não demonstram jornada, fricção, clareza, acessibilidade ou oportunidade de produto.",
        "Nenhuma oportunidade foi confirmada; os cinco movimentos aguardam evidência de jornadas observadas.",
      ],
    },
  });
}

/** Expected caller and snapshot rejections use tags; internal faults escape. */
export function assessProductResult(
  snapshotInput: unknown,
  input: unknown,
): Result<ReturnType<typeof assessValidatedProduct>, ProductFailure> {
  const request = functionalInput.safeParse(input);
  if (!request.success) return err({ kind: "invalid_input", reason: "schema" });
  if (!canonicalModulePath(request.data.modulePath))
    return err({ kind: "invalid_input", reason: "module_path" });

  let snapshot: Snapshot;
  try {
    snapshot = validateSnapshot(snapshotInput);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_snapshot" });
    throw cause;
  }
  if (request.data.snapshotId !== snapshot.id)
    return err({ kind: "policy_denied", reason: "snapshot_mismatch" });

  return ok(assessValidatedProduct(snapshot, request.data));
}

export function assessProduct(snapshotInput: Snapshot, input: unknown) {
  const result = assessProductResult(snapshotInput, input);
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError("INTEGRITY_ERROR", "Snapshot de produto inválido.");
  if (result.error.kind === "policy_denied")
    throw new PieError(
      "POLICY_DENIED",
      "Análise de produto pertence a outro snapshot.",
    );
  throw new PieError(
    "INVALID_INPUT",
    result.error.reason === "module_path"
      ? "Módulo deve ser caminho relativo canônico, sem segmentos vazios ou traversal."
      : "Entrada de produto inválida.",
  );
}

function canonicalModulePath(modulePath: string): boolean {
  return (
    !modulePath ||
    (!modulePath.startsWith("/") &&
      !modulePath.includes("\\") &&
      !modulePath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..") &&
      !modulePath.includes(":"))
  );
}

export function selectFunctionalTargets(
  snapshot: Snapshot,
  request: z.infer<typeof functionalInput>,
) {
  const modulePath = request.modulePath;
  if (!canonicalModulePath(modulePath))
    throw new PieError(
      "INVALID_INPUT",
      "Módulo deve ser caminho relativo canônico, sem segmentos vazios ou traversal.",
    );
  const targets = snapshot.declarations.filter(
    (fact) =>
      (fact.kind === "endpoint" || fact.kind === "page") &&
      (!modulePath ||
        fact.source.path === modulePath ||
        fact.source.path.startsWith(`${modulePath}/`)),
  );
  const selected = page(targets, {
    offset: request.offset,
    limit: request.limit,
  });
  return { targets, selected };
}

/** Reports missing verification, never a missing implementation or a proven defect. */
export function assessFunctional(
  snapshotInput: Snapshot,
  input: unknown,
  policyInput: unknown,
) {
  const request = functionalInput.parse(input);
  const policy = policySchema.parse(policyInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (
    request.snapshotId !== snapshot.id ||
    policy.repositoryRoot !== snapshot.root ||
    policy.profile !== "OBSERVE" ||
    policy.allowTargetExecution ||
    policy.allowTargetMutation
  )
    throw new PieError(
      "POLICY_DENIED",
      "Análise funcional estática exige snapshot e escopo OBSERVE correspondentes.",
    );
  const modulePath = request.modulePath;
  const { targets, selected } = selectFunctionalTargets(snapshot, request);
  const findings = selected.items.map((declaration) => ({
    id: `functional:runtime-gap:${declaration.id}`,
    state: "unverified" as const,
    severity: "info" as const,
    category: "runtime_verification_gap" as const,
    declaration,
    evidenceIds: [
      declaration.evidenceId,
      ...declaration.derivations.map((item) => item.evidenceId),
    ],
    owner: null,
    observation:
      "Declaração estática encontrada; comportamento funcional não examinado nesta análise.",
    uncertainty: [
      "Declaração não comprova rota acessível, handler válido, montagem, autenticação, persistência ou fluxo após reload.",
      "Nenhum resultado de teste foi vinculado a esta declaração; teste aprovado sem vínculo explícito não aprova a funcionalidade.",
    ],
    reproduction: [
      `Consultar a evidência ${declaration.evidenceId} e a fonte ${declaration.source.path} na linha ${declaration.source.line ?? "não informada"}.`,
      "Preparar ambiente isolado e autorização VERIFY com identidade do snapshot; não testar sistema externo por inferência de URL.",
      "Executar o fluxo com entradas, identidade de usuário e resultado esperado explicitamente definidos.",
    ],
    proposal:
      "Definir cenário verificável e vincular evidências de execução à declaração antes de atribuir funcionamento comprovado.",
    acceptance: [
      "Registrar entrada, resposta e erro esperado com prova de execução no ambiente autorizado.",
      "Verificar permissões positivas/negativas e, quando aplicável, gravação real, leitura independente e reload.",
      "Registrar indisponibilidade, skips ou observação parcial sem declarar aprovação.",
    ],
  }));
  return functionalOutput.parse({
    schemaVersion: 1,
    engine: "functional",
    snapshotId: snapshot.id,
    profile: "OBSERVE",
    state: "unverified",
    scope: {
      modulePath,
      declaredTargets: targets.length,
      examinedTargets: selected.items.length,
    },
    findings: { ...selected, items: findings },
    coverage: {
      discovery: snapshot.coverage.status,
      runtime: false,
      journeyVerification: false,
      limitations: [
        ...snapshot.coverage.limitations,
        "Análise de lacunas de verificação das páginas/endpoints declarados; não executa cenários nem detecta por si só defeitos funcionais.",
        "Nenhuma declaração encontrada não prova ausência de funcionalidades. Eventos, persistência, jobs, permissões e jornadas completas ainda exigem evidência própria.",
      ],
    },
  });
}

/** Expected caller and snapshot rejections use a tagged result; internal faults escape. */
export function assessFunctionalResult(
  snapshotInput: unknown,
  input: unknown,
  policyInput: unknown,
): Result<ReturnType<typeof assessFunctional>, FunctionalFailure> {
  const request = functionalInput.safeParse(input);
  if (!request.success)
    return err({
      kind: "invalid_input",
      reason: "schema",
    });
  if (!canonicalModulePath(request.data.modulePath))
    return err({ kind: "invalid_input", reason: "module_path" });
  const policy = policySchema.safeParse(policyInput);
  if (!policy.success)
    return err({
      kind: "invalid_input",
      reason: "schema",
    });
  let snapshot: Snapshot;
  try {
    snapshot = validateSnapshot(snapshotInput);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_snapshot" });
    throw cause;
  }
  if (request.data.snapshotId !== snapshot.id)
    return err({ kind: "policy_denied", reason: "snapshot_mismatch" });
  if (
    policy.data.repositoryRoot !== snapshot.root ||
    policy.data.profile !== "OBSERVE" ||
    policy.data.allowTargetExecution ||
    policy.data.allowTargetMutation
  )
    return err({ kind: "policy_denied", reason: "scope" });
  return ok(assessFunctional(snapshot, request.data, policy.data));
}
