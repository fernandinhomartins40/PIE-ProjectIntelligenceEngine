import canonicalize from "canonicalize";
import { z } from "zod";
import { reviewData } from "./dataReview.js";
import { type Snapshot, PieError } from "./contracts.js";
import { assessFunctional, assessProduct } from "./functional.js";
import { page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { reviewSecurity } from "./security.js";
import { sha256 } from "./evidence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";

export const planningInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
});

const engine = z.enum([
  "functional",
  "product",
  "security",
  "data",
  "infrastructure",
  "regression",
]);

export const planItemSchema = z.strictObject({
  id: z.string(),
  engine,
  sourceId: z.string(),
  sourceState: z.string(),
  status: z.literal("open"),
  priority: z.literal("unassessed"),
  owner: z.null(),
  title: z.string(),
  evidenceIds: z.array(z.string().uuid()).min(1),
  acceptance: z.array(z.string()).min(1),
  uncertainty: z.array(z.string()),
});

const engineCoverageSchema = z.strictObject({
  engine,
  status: z.enum(["partial_static", "not_implemented"]),
  sourceCount: z.number().int().nonnegative(),
  includedCount: z.number().int().nonnegative(),
  unexaminedCount: z.number().int().nonnegative(),
  runtimeVerified: z.literal(false),
  limitations: z.array(z.string()),
});

export const unifiedPlanOutput = z.strictObject({
  schemaVersion: z.literal(1),
  engine: z.literal("planning"),
  snapshotId: z.string().uuid(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.literal("unverified"),
  executionAuthorized: z.literal(false),
  items: pagedOutput(planItemSchema),
  engines: z.array(engineCoverageSchema).length(6),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    itemsExamined: z.number().int().nonnegative(),
    runtimeVerified: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

type PlanItem = z.infer<typeof planItemSchema>;

function makeItem(
  input: Omit<PlanItem, "id" | "status" | "priority" | "owner">,
): PlanItem {
  return planItemSchema.parse({
    ...input,
    id: `plan:${input.engine}:${input.sourceId}`,
    status: "open",
    priority: "unassessed",
    owner: null,
  });
}

/** Build one evidence-linked triage plan from existing engine outputs only. */
export async function generateUnifiedPlan(
  snapshotInput: Snapshot,
  rawInput: unknown,
) {
  const input = planningInput.parse(rawInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Plano pertence a outro snapshot.");
  const request = {
    snapshotId: snapshot.id,
    modulePath: "",
    limit: 200,
    offset: 0,
  };
  const pageRequest = { snapshotId: snapshot.id, limit: 200, offset: 0 };
  const policy = {
    profile: "OBSERVE" as const,
    environment: "local" as const,
    repositoryRoot: snapshot.root,
  };
  const functional = assessFunctional(snapshot, request, policy);
  const product = assessProduct(snapshot, request);
  const security = await reviewSecurity(snapshot, pageRequest);
  const data = reviewData(snapshot, pageRequest);
  const items: PlanItem[] = [
    ...functional.findings.items.map((finding) =>
      makeItem({
        engine: "functional",
        sourceId: finding.id,
        sourceState: finding.state,
        title: `Verificar a funcionalidade declarada ${finding.declaration.name}`,
        evidenceIds: finding.evidenceIds,
        acceptance: finding.acceptance,
        uncertainty: finding.uncertainty,
      }),
    ),
    ...product.opportunities.items.map((opportunity) =>
      makeItem({
        engine: "product",
        sourceId: opportunity.id,
        sourceState: opportunity.state,
        title: `Observar a jornada relacionada a ${opportunity.declaration.name}`,
        evidenceIds: opportunity.evidenceIds,
        acceptance: [
          "Registrar uma jornada real autorizada, incluindo objetivo, início, passos e resultado esperado.",
          "Avaliar os cinco movimentos de produto somente com evidências da jornada observada.",
        ],
        uncertainty: opportunity.missingEvidence,
      }),
    ),
    ...security.findings.items.map((finding) =>
      makeItem({
        engine: "security",
        sourceId: finding.id,
        sourceState: finding.state,
        title: `Triar suspeita estática ${finding.kind}`,
        evidenceIds: finding.evidenceIds,
        acceptance: [
          ...finding.reproduction,
          ...finding.regression,
          `Registrar verificação executada e estado resultante; atualmente ${finding.verificationStatus}.`,
        ],
        uncertainty: finding.uncertainty,
      }),
    ),
    ...data.models.items.map((finding) =>
      makeItem({
        engine: "data",
        sourceId: finding.id,
        sourceState: finding.state,
        title: `Revisar seletor único do modelo ${finding.model.name}`,
        evidenceIds: finding.evidenceIds,
        acceptance: [
          "Comparar schema Prisma e migration no ambiente de banco isolado autorizado.",
          "Registrar resultado e constraints efetivamente observadas sem alterar dados reais.",
        ],
        uncertainty: finding.uncertainty,
      }),
    ),
    ...data.migrations.items.map((finding) =>
      makeItem({
        engine: "data",
        sourceId: finding.id,
        sourceState: finding.state,
        title: `Validar migration do modelo ${finding.model.name}`,
        evidenceIds: finding.evidenceIds,
        acceptance: [
          "Aplicar ou validar migrations somente em banco descartável autorizado.",
          "Comparar schema resultante com Prisma e registrar rollback/recovery verificados.",
        ],
        uncertainty: finding.uncertainty,
      }),
    ),
    ...data.relations.items.map((finding) =>
      makeItem({
        engine: "data",
        sourceId: finding.id,
        sourceState: finding.state,
        title: `Validar relação ${finding.relation.parent ?? "?"} → ${finding.relation.name}`,
        evidenceIds: finding.evidenceIds,
        acceptance: [
          "Comparar campos Prisma e foreign key aplicada em ambiente isolado autorizado.",
          "Manter resultado inconclusivo quando mappings, schemas ou migrations estiverem incompletos.",
        ],
        uncertainty: finding.uncertainty,
      }),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = [
    {
      engine: "functional" as const,
      total: functional.findings.total,
      included: functional.findings.items.length,
      limitations: functional.coverage.limitations,
    },
    {
      engine: "product" as const,
      total: product.opportunities.total,
      included: product.opportunities.items.length,
      limitations: product.coverage.limitations,
    },
    {
      engine: "security" as const,
      total: security.findings.total,
      included: security.findings.items.length,
      limitations: security.coverage.limitations,
    },
    {
      engine: "data" as const,
      total: data.models.total + data.migrations.total + data.relations.total,
      included:
        data.models.items.length +
        data.migrations.items.length +
        data.relations.items.length,
      limitations: data.coverage.limitations,
    },
  ];
  const engines = [
    ...rows.map((row) => ({
      engine: row.engine,
      status: "partial_static" as const,
      sourceCount: row.total,
      includedCount: row.included,
      unexaminedCount: row.total - row.included,
      runtimeVerified: false as const,
      limitations: row.limitations,
    })),
    ...(["infrastructure", "regression"] as const).map((name) => ({
      engine: name,
      status: "not_implemented" as const,
      sourceCount: 0,
      includedCount: 0,
      unexaminedCount: 0,
      runtimeVerified: false as const,
      limitations: [
        "Este motor ainda não fornece itens a este plano unificado.",
      ],
    })),
  ];
  const planDigest = sha256(
    canonicalize({
      schemaVersion: 1,
      snapshotId: snapshot.id,
      items,
      engines,
    })!,
  );
  return unifiedPlanOutput.parse({
    schemaVersion: 1,
    engine: "planning",
    snapshotId: snapshot.id,
    planDigest,
    state: "unverified",
    executionAuthorized: false,
    items: page(items, { offset: input.offset, limit: input.limit }),
    engines,
    coverage: {
      discovery: snapshot.coverage.status,
      itemsExamined: items.length,
      runtimeVerified: false,
      limitations: [
        "O plano agrega somente páginas dos motores existentes, limitadas a 200 itens por origem; contagens não examinadas permanecem explícitas.",
        "Responsável e prioridade não são inferidos; owner permanece null e priority unassessed até triagem humana.",
        "Nenhuma recomendação foi aceita, contestada, executada ou validada; este endpoint não persiste decisões nem autoriza execução.",
        ...snapshot.coverage.limitations,
      ],
    },
  });
}
