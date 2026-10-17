import { z } from "zod";
import { type Snapshot, PieError } from "./contracts.js";
import { snapshotFiles } from "./snapshotFiles.js";
import { impactedNodes, page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import { validateSnapshot } from "./snapshotIntegrity.js";

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
  schemaVersion: z.literal(1),
  beforeId: z.string().uuid(),
  afterId: z.string().uuid(),
  mode: z.enum(["affected", "full"]),
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

/** Selects current test files from recorded import impact; selection never grants execution. */
export function planRetests(
  beforeInput: Snapshot,
  afterInput: Snapshot,
  raw: unknown,
) {
  const input = retestInput.parse(raw);
  const before = validateSnapshot(beforeInput);
  const after = validateSnapshot(afterInput);
  if (
    input.beforeId !== before.id ||
    input.afterId !== after.id ||
    before.projectId !== after.projectId ||
    before.root !== after.root
  )
    throw new PieError(
      "INVALID_INPUT",
      "Reteste exige snapshots correspondentes do mesmo projeto e raiz.",
    );
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
    .filter((node) => input.mode === "full" || reached.has(node.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const candidates = selected.map((node) => ({
    path: node.path,
    nodeId: node.id,
    evidenceIds: node.evidenceIds,
    reason:
      input.mode === "full"
        ? "full_observed_test_inventory"
        : "recorded_dependency_impact",
    runnerCompatibility: "not_probed",
  }));
  return retestOutput.parse({
    schemaVersion: 1,
    beforeId: before.id,
    afterId: after.id,
    mode: input.mode,
    state: "unverified",
    executionAuthorized: false,
    runtimeVerified: false,
    candidates: page(candidates, { offset: input.offset, limit: input.limit }),
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
