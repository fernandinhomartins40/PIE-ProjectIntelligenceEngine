import { z } from "zod";
import { adapterFactSchema } from "./adapters/contracts.js";
import { type Snapshot, policySchema, PieError } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";

export const functionalInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
  modulePath: z.string().max(1000).default(""),
});
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
  engine: z.literal("functional"),
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

export function selectFunctionalTargets(
  snapshot: Snapshot,
  request: z.infer<typeof functionalInput>,
) {
  const modulePath = request.modulePath;
  if (
    modulePath &&
    (modulePath.startsWith("/") ||
      modulePath.includes("\\") ||
      modulePath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..") ||
      modulePath.includes(":"))
  )
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
    evidenceIds: [declaration.evidenceId],
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
      examinedTargets: targets.length,
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
