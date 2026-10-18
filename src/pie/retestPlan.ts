import { z } from "zod";
import { type Snapshot, PieError } from "./contracts.js";
import { snapshotFiles } from "./snapshotFiles.js";
import { impactedNodes, page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import canonicalize from "canonicalize";
import { sha256 } from "./evidence.js";
import { err, ok, type Result } from "../domain/result.js";

export const retestInput = pageSchema.extend({
  beforeId: z.string().uuid(),
  afterId: z.string().uuid(),
  mode: z.enum(["affected", "full"]).default("affected"),
});
const candidateSchema = z.strictObject({
  path: z.string(),
  nodeId: z.string(),
  evidenceIds: z.array(z.string().uuid()).min(1),
  reason: z.enum([
    "recorded_dependency_impact",
    "full_observed_test_inventory",
  ]),
  runnerCompatibility: z.literal("not_probed"),
});
export const retestOutput = z.strictObject({
  schemaVersion: z.literal(2),
  beforeId: z.string().uuid(),
  afterId: z.string().uuid(),
  mode: z.enum(["affected", "full"]),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.literal("unverified"),
  executionAuthorized: z.literal(false),
  runtimeVerified: z.literal(false),
  candidates: pagedOutput(candidateSchema),
  coverage: z.strictObject({
    before: z.enum(["complete", "partial"]),
    after: z.enum(["complete", "partial"]),
    observedCurrentTests: z.number().int().nonnegative(),
    selectedTests: z.number().int().nonnegative(),
    impactedFiles: z.number().int().nonnegative(),
    removedOrUnobservedPreviousTests: z.number().int().nonnegative(),
    limitations: z.array(z.string()),
  }),
});

function selectValidatedRetestCandidates(
  before: Snapshot,
  after: Snapshot,
  mode: "affected" | "full",
) {
  const previous = new Map(
    snapshotFiles(before).map((item) => [
      item.node.path,
      item.source.source.sha256,
    ]),
  );
  const current = new Map(
    snapshotFiles(after).map((item) => [
      item.node.path,
      item.source.source.sha256,
    ]),
  );
  const changed = new Set(
    [...new Set([...previous.keys(), ...current.keys()])].filter(
      (path) => previous.get(path) !== current.get(path),
    ),
  );
  const reached = new Set<string>();
  for (const snapshot of [before, after]) {
    const seeds = snapshot.nodes
      .filter((node) => changed.has(node.path))
      .map((node) => node.id);
    for (const node of impactedNodes(snapshot.nodes, snapshot.edges, seeds))
      reached.add(node.path);
  }
  const tests = after.nodes.filter((node) => node.kind === "test");
  const selected = tests
    .filter((node) => mode === "full" || reached.has(node.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((node) => ({
      path: node.path,
      nodeId: node.id,
      evidenceIds: node.evidenceIds,
      reason:
        mode === "full"
          ? ("full_observed_test_inventory" as const)
          : ("recorded_dependency_impact" as const),
      runnerCompatibility: "not_probed" as const,
    }));
  const planDigest = sha256(
    canonicalize({
      schemaVersion: 2,
      beforeId: before.id,
      beforeTreeDigest: before.treeDigest,
      afterId: after.id,
      afterTreeDigest: after.treeDigest,
      mode,
      candidates: selected,
    })!,
  );
  return { before, after, tests, selected, reached, current, planDigest };
}

/** Stable identity for the complete selection, independent of response pagination. */
export function selectRetestCandidates(
  beforeInput: Snapshot,
  afterInput: Snapshot,
  mode: "affected" | "full",
) {
  const before = validateSnapshot(beforeInput);
  const after = validateSnapshot(afterInput);
  if (before.projectId !== after.projectId || before.root !== after.root)
    throw new PieError(
      "INVALID_INPUT",
      "Reteste exige snapshots correspondentes do mesmo projeto e raiz.",
    );
  return selectValidatedRetestCandidates(before, after, mode);
}

/** Selects current test files from recorded import impact; selection never grants execution. */
function renderRetestPlan(
  before: Snapshot,
  after: Snapshot,
  input: z.infer<typeof retestInput>,
) {
  const plan = selectValidatedRetestCandidates(before, after, input.mode);
  const { tests, selected, reached, current } = plan;
  return retestOutput.parse({
    schemaVersion: 2,
    beforeId: before.id,
    afterId: after.id,
    mode: input.mode,
    planDigest: plan.planDigest,
    state: "unverified",
    executionAuthorized: false,
    runtimeVerified: false,
    candidates: page(selected, { offset: input.offset, limit: input.limit }),
    coverage: {
      before: before.coverage.status,
      after: after.coverage.status,
      observedCurrentTests: tests.length,
      selectedTests: selected.length,
      impactedFiles: reached.size,
      removedOrUnobservedPreviousTests: before.nodes.filter(
        (node) => node.kind === "test" && !current.has(node.path),
      ).length,
      limitations: [
        "Classificação de teste por caminho/nome é inferência. Imports registrados selecionam candidatos, não comprovam cobertura, compatibilidade com runner nem detecção de regressão.",
        "Modo affected usa os dois grafos; imports dinâmicos, aliases e dependências não resolvidas podem omitir testes relevantes. Nenhum candidato não significa nenhuma regressão.",
        "Modo full inclui todos os arquivos de teste observados no snapshot posterior, não garante inventário completo. Testes removidos ou não observados não são executáveis nessa versão.",
        "Execução exige grant VERIFY separado, imagem/limites/arquivos escolhidos pelo operador e admissão atual do snapshot; este plano não autoriza nem inicia código.",
        ...before.coverage.limitations,
        ...after.coverage.limitations,
      ],
    },
  });
}

export type RetestPlanFailure =
  | { kind: "invalid_input" }
  | { kind: "invalid_snapshot"; side: "before" | "after" }
  | {
      kind: "policy_denied";
      reason: "snapshot_mismatch" | "project_scope";
    };

/** Expected request, snapshot, and scope rejections are tagged; internal faults escape. */
export function planRetestsResult(
  beforeInput: unknown,
  afterInput: unknown,
  raw: unknown,
): Result<ReturnType<typeof retestOutput.parse>, RetestPlanFailure> {
  const input = retestInput.safeParse(raw);
  if (!input.success) return err({ kind: "invalid_input" });

  let before: Snapshot;
  try {
    before = validateSnapshot(beforeInput);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_snapshot", side: "before" });
    throw cause;
  }
  let after: Snapshot;
  try {
    after = validateSnapshot(afterInput);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_snapshot", side: "after" });
    throw cause;
  }
  if (input.data.beforeId !== before.id || input.data.afterId !== after.id)
    return err({ kind: "policy_denied", reason: "snapshot_mismatch" });
  if (before.projectId !== after.projectId || before.root !== after.root)
    return err({ kind: "policy_denied", reason: "project_scope" });
  return ok(renderRetestPlan(before, after, input.data));
}

export function planRetests(
  beforeInput: Snapshot,
  afterInput: Snapshot,
  raw: unknown,
) {
  const result = planRetestsResult(beforeInput, afterInput, raw);
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError("INTEGRITY_ERROR", "Snapshot de reteste inválido.");
  if (result.error.kind === "policy_denied")
    throw new PieError(
      "INVALID_INPUT",
      "Reteste exige snapshots correspondentes do mesmo projeto e raiz.",
    );
  throw new PieError("INVALID_INPUT", "Entrada de plano de reteste inválida.");
}
