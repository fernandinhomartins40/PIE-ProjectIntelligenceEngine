import canonicalize from "canonicalize";
import { z } from "zod";
import { PieError, type Snapshot } from "./contracts.js";
import { sha256 } from "./evidence.js";
import { page, pageSchema } from "./graph.js";
import { pagedOutput } from "./outputContracts.js";
import type { VerificationRun } from "./execution/runContracts.js";
import { validateVerificationRun } from "./execution/runIntegrity.js";
import { err, ok, type Result } from "../domain/result.js";

export const verificationComparisonInput = pageSchema.extend({
  beforeRunId: z.string().uuid(),
  afterRunId: z.string().uuid(),
});

const comparedCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.string(),
  name: z.string(),
  nesting: z.number().int().nonnegative(),
  before: z.enum(["passed", "failed", "skipped", "todo"]),
  after: z.enum(["passed", "failed", "skipped", "todo"]),
  outcomeChanged: z.boolean(),
  classification: z.enum([
    "regression_observed",
    "recovery_observed",
    "unchanged",
    "different_outcome",
    "environment_changed",
  ]),
});
const declaredBindingSchema = z.strictObject({
  testFile: z.string(),
  declarationId: z.string(),
  declaration: z.strictObject({
    adapter: z.string(),
    kind: z.string(),
    name: z.string(),
    parent: z.string().nullable(),
    sourcePath: z.string(),
    line: z.number().int().positive().nullable(),
    evidenceId: z.string().uuid(),
  }),
  interpretation: z.literal("declared_unverified"),
  runtimeObservation: z.strictObject({
    state: z.enum([
      "unknown",
      "not_instrumented",
      "line_observed",
      "line_not_observed",
    ]),
    evidenceId: z.string().uuid().nullable(),
  }),
});
const declaredBindingSetSchema = z.strictObject({
  state: z.enum(["unknown", "declared_unverified"]),
  bindings: pagedOutput(declaredBindingSchema),
});

export const verificationComparisonOutput = z.strictObject({
  schemaVersion: z.literal(3),
  engine: z.literal("regression"),
  state: z.enum([
    "regression_observed",
    "no_regression_observed",
    "inconclusive",
  ]),
  before: z.strictObject({
    runId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    completedAt: z.iso.datetime({ precision: 3 }),
  }),
  after: z.strictObject({
    runId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    completedAt: z.iso.datetime({ precision: 3 }),
  }),
  cases: pagedOutput(comparedCaseSchema),
  declaredBindings: z.strictObject({
    before: declaredBindingSetSchema,
    after: declaredBindingSetSchema,
    limitations: z.array(z.string()),
  }),
  coverage: z.strictObject({
    beforeFiles: z.number().int().nonnegative(),
    afterFiles: z.number().int().nonnegative(),
    sharedFiles: z.number().int().nonnegative(),
    sameImage: z.boolean(),
    sameSelection: z.boolean(),
    reportsComplete: z.boolean(),
    cleanupComplete: z.boolean(),
    matchedCases: z.number().int().nonnegative(),
    ambiguousCases: z.number().int().nonnegative(),
    onlyBefore: z.number().int().nonnegative(),
    onlyAfter: z.number().int().nonnegative(),
    outsideSharedSelection: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
    recoveries: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    differentOutcomes: z.number().int().nonnegative(),
    limitations: z.array(z.string()),
  }),
});

type TestCase = Extract<
  VerificationRun["result"]["cases"][number],
  { kind: "case" }
>;
type CaseMap = Map<string, TestCase[]>;

function authorizedFiles(run: VerificationRun): Set<string> | null {
  return run.schemaVersion === 2 ? new Set(run.authorization.testFiles) : null;
}

function declaredBindings(
  run: VerificationRun,
  snapshot: Snapshot,
  input: { offset: number; limit: number },
) {
  const paging = { offset: input.offset, limit: input.limit };
  if (run.schemaVersion !== 2 || run.authorization.schemaVersion !== 2)
    return { state: "unknown" as const, bindings: page([], paging) };
  const facts = new Map(snapshot.declarations.map((fact) => [fact.id, fact]));
  const bindings = run.authorization.testBindings.map((binding) => {
    const fact = facts.get(binding.declarationId)!;
    const runtimeObservation = bindingRuntimeObservation(run, fact.source);
    return {
      ...binding,
      declaration: {
        adapter: fact.adapter,
        kind: fact.kind,
        name: fact.name,
        parent: fact.parent,
        sourcePath: fact.source.path,
        line: fact.source.line,
        evidenceId: fact.evidenceId,
      },
      interpretation: "declared_unverified" as const,
      runtimeObservation,
    };
  });
  return {
    state: "declared_unverified" as const,
    bindings: page(bindings, paging),
  };
}

function bindingRuntimeObservation(
  run: VerificationRun,
  source: Snapshot["declarations"][number]["source"],
) {
  if (
    run.schemaVersion !== 2 ||
    run.authorization.schemaVersion !== 2 ||
    run.authorization.testFiles.length !== 1 ||
    source.line === null ||
    run.result.schemaVersion !== 2
  )
    return { state: "not_instrumented" as const, evidenceId: null };
  if (!run.result.runtimeLocations.reportComplete)
    return { state: "unknown" as const, evidenceId: run.evidence.id };
  const observed = run.result.runtimeLocations.locations.some(
    (location) =>
      location.sourcePath === source.path && location.line === source.line,
  );
  return {
    state: observed
      ? ("line_observed" as const)
      : ("line_not_observed" as const),
    evidenceId: run.evidence.id,
  };
}

function sourcePath(file: string | null): string | null {
  if (!file) return null;
  let value = file;
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:") return null;
      value = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  const prefix = "/source/";
  if (!value.startsWith(prefix)) return null;
  const relative = value.slice(prefix.length);
  if (
    !relative ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return relative;
}

function casesByIdentity(
  run: VerificationRun,
  files: Set<string>,
): {
  cases: CaseMap;
  outsideSelection: number;
} {
  const cases: CaseMap = new Map();
  let outsideSelection = 0;
  for (const item of run.result.cases) {
    if (item.kind !== "case" || item.category !== "test") continue;
    const file = sourcePath(item.file);
    if (!file || !files.has(file)) {
      outsideSelection++;
      continue;
    }
    const key = canonicalize([file, item.name, item.nesting])!;
    const matches = cases.get(key) ?? [];
    matches.push(item);
    cases.set(key, matches);
  }
  return { cases, outsideSelection };
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

/** Compares only uniquely matched Node cases from immutable, same-project runs. */
function compareVerifiedRuns(
  before: VerificationRun,
  beforeSnapshot: Snapshot,
  after: VerificationRun,
  afterSnapshot: Snapshot,
  input: z.infer<typeof verificationComparisonInput>,
) {
  const beforeFiles = authorizedFiles(before);
  const afterFiles = authorizedFiles(after);
  const limitations = [
    "A comparação cobre somente testes explicitamente autorizados e registrados nos dois relatórios; não representa cobertura funcional completa.",
    "Identidade de caso usa caminho, nome e profundidade emitidos pelo Node. Casos duplicados nessa chave são ambíguos e excluídos.",
    "Resultado sem regressão observada não significa aprovação do produto nem ausência de defeitos.",
  ];
  if (!beforeFiles || !afterFiles)
    limitations.push(
      "Registro legado sem grant VERIFY completo; a seleção de arquivos não pode ser comprovada.",
    );
  limitations.push(
    "Bindings teste→declaração são intenção registrada no grant; não comprovam que um caso executado cobre a declaração.",
  );

  const sharedFiles =
    beforeFiles && afterFiles
      ? new Set([...beforeFiles].filter((file) => afterFiles.has(file)))
      : new Set<string>();
  const beforeCaptured = beforeFiles
    ? casesByIdentity(before, beforeFiles)
    : { cases: new Map<string, TestCase[]>(), outsideSelection: 0 };
  const afterCaptured = afterFiles
    ? casesByIdentity(after, afterFiles)
    : { cases: new Map<string, TestCase[]>(), outsideSelection: 0 };
  const beforeCases = new Map(
    [...beforeCaptured.cases].filter(([, entries]) =>
      sharedFiles.has(
        entries[0]!.file ? (sourcePath(entries[0]!.file) ?? "") : "",
      ),
    ),
  );
  const afterCases = new Map(
    [...afterCaptured.cases].filter(([, entries]) =>
      sharedFiles.has(
        entries[0]!.file ? (sourcePath(entries[0]!.file) ?? "") : "",
      ),
    ),
  );
  const outsideSharedSelection =
    beforeCaptured.outsideSelection +
    afterCaptured.outsideSelection +
    [...beforeCaptured.cases]
      .filter(
        ([, entries]) => !sharedFiles.has(sourcePath(entries[0]!.file) ?? ""),
      )
      .reduce((total, [, entries]) => total + entries.length, 0) +
    [...afterCaptured.cases]
      .filter(
        ([, entries]) => !sharedFiles.has(sourcePath(entries[0]!.file) ?? ""),
      )
      .reduce((total, [, entries]) => total + entries.length, 0);
  const keys = new Set([...beforeCases.keys(), ...afterCases.keys()]);
  const compared = [] as Array<z.infer<typeof comparedCaseSchema>>;
  let ambiguousCases = 0;
  let onlyBefore = 0;
  let onlyAfter = 0;
  let regressions = 0;
  let recoveries = 0;
  let unchanged = 0;
  let differentOutcomes = 0;
  const sameImage =
    before.schemaVersion === 2 &&
    after.schemaVersion === 2 &&
    before.authorization.image === after.authorization.image;
  const sameSelection =
    beforeFiles !== null &&
    afterFiles !== null &&
    sameSet(beforeFiles, afterFiles);

  for (const key of keys) {
    const oldCases = beforeCases.get(key) ?? [];
    const newCases = afterCases.get(key) ?? [];
    if (oldCases.length > 1 || newCases.length > 1) {
      ambiguousCases++;
      continue;
    }
    if (oldCases.length === 0) {
      onlyAfter++;
      continue;
    }
    if (newCases.length === 0) {
      onlyBefore++;
      continue;
    }
    const oldCase = oldCases[0]!;
    const newCase = newCases[0]!;
    const file = sourcePath(oldCase.file)!;
    const outcomeChanged = oldCase.outcome !== newCase.outcome;
    let classification: z.infer<typeof comparedCaseSchema>["classification"];
    if (!sameImage) classification = "environment_changed";
    else if (oldCase.outcome === "passed" && newCase.outcome === "failed") {
      classification = "regression_observed";
      regressions++;
    } else if (oldCase.outcome === "failed" && newCase.outcome === "passed") {
      classification = "recovery_observed";
      recoveries++;
    } else if (!outcomeChanged) {
      classification = "unchanged";
      unchanged++;
    } else {
      classification = "different_outcome";
      differentOutcomes++;
    }
    compared.push({
      id: sha256(key),
      file,
      name: oldCase.name,
      nesting: oldCase.nesting,
      before: oldCase.outcome,
      after: newCase.outcome,
      outcomeChanged,
      classification,
    });
  }

  const reportsComplete =
    before.result.coverage.reportComplete &&
    before.result.coverage.processCompleted &&
    !before.result.coverage.truncated &&
    after.result.coverage.reportComplete &&
    after.result.coverage.processCompleted &&
    !after.result.coverage.truncated;
  const cleanupComplete =
    before.cleanup === "complete" && after.cleanup === "complete";
  if (!sameImage)
    limitations.push(
      "Imagens de execução diferem; diferenças observadas não são atribuídas a regressão do projeto.",
    );
  if (!sameSelection)
    limitations.push(
      "Os grants selecionaram arquivos diferentes; a comparação cobre somente a interseção autorizada.",
    );
  if (!reportsComplete)
    limitations.push(
      "Um ou ambos os relatórios não têm captura completa; conclusão global inconclusiva.",
    );
  if (!cleanupComplete)
    limitations.push(
      "A limpeza de pelo menos uma execução ficou incompleta; conclusão global inconclusiva.",
    );
  if (ambiguousCases > 0)
    limitations.push(
      "Há identidades de teste duplicadas; elas não foram alinhadas por ordem ou linha.",
    );

  const beforeBindings = declaredBindings(before, beforeSnapshot, input);
  const afterBindings = declaredBindings(after, afterSnapshot, input);
  if (onlyBefore > 0 || onlyAfter > 0)
    limitations.push(
      "Casos sem contraparte exata podem ter sido adicionados, removidos ou renomeados; permanecem sem classificação.",
    );

  const state =
    sameImage && reportsComplete && cleanupComplete && regressions > 0
      ? "regression_observed"
      : sameImage &&
          sameSelection &&
          reportsComplete &&
          cleanupComplete &&
          ambiguousCases === 0 &&
          onlyBefore === 0 &&
          onlyAfter === 0 &&
          outsideSharedSelection === 0 &&
          compared.length > 0 &&
          compared.every(
            (item) => item.before === "passed" || item.before === "failed",
          ) &&
          compared.every(
            (item) => item.after === "passed" || item.after === "failed",
          )
        ? "no_regression_observed"
        : "inconclusive";

  return verificationComparisonOutput.parse({
    schemaVersion: 3,
    engine: "regression",
    state,
    before: {
      runId: before.id,
      snapshotId: before.snapshotId,
      evidenceId: before.evidence.id,
      completedAt: before.completedAt,
    },
    after: {
      runId: after.id,
      snapshotId: after.snapshotId,
      evidenceId: after.evidence.id,
      completedAt: after.completedAt,
    },
    cases: page(compared, { offset: input.offset, limit: input.limit }),
    declaredBindings: {
      before: beforeBindings,
      after: afterBindings,
      limitations: [
        "Binding é declaração do operador entre arquivo autorizado e fato estático do snapshot; não é uma aresta `covers` comprovada por execução.",
        "runtimeObservation registra somente linha do fato que foi observada no runner; `line_not_observed` não prova que o módulo ou comportamento não executou, e `line_observed` não prova que o teste validou a capacidade.",
        ...(beforeBindings.state === "unknown" ||
        afterBindings.state === "unknown"
          ? [
              "Execução legada ou grant v1 não preserva bindings; a relação correspondente permanece desconhecida.",
            ]
          : []),
      ],
    },
    coverage: {
      beforeFiles: beforeFiles?.size ?? 0,
      afterFiles: afterFiles?.size ?? 0,
      sharedFiles: sharedFiles.size,
      sameImage,
      sameSelection,
      reportsComplete,
      cleanupComplete,
      matchedCases: compared.length,
      ambiguousCases,
      onlyBefore,
      onlyAfter,
      outsideSharedSelection,
      regressions,
      recoveries,
      unchanged,
      differentOutcomes,
      limitations,
    },
  });
}

export type VerificationComparisonFailure =
  | { kind: "invalid_input" }
  | { kind: "invalid_run"; side: "before" | "after" }
  | { kind: "policy_denied"; reason: "comparison_scope" };

/** Expected request, history, and comparison-scope rejections are tagged. */
export function compareVerificationRunsResult(
  beforeInput: unknown,
  beforeSnapshot: Snapshot,
  afterInput: unknown,
  afterSnapshot: Snapshot,
  rawInput: unknown,
): Result<
  ReturnType<typeof verificationComparisonOutput.parse>,
  VerificationComparisonFailure
> {
  const input = verificationComparisonInput.safeParse(rawInput);
  if (!input.success) return err({ kind: "invalid_input" });

  let before: VerificationRun;
  try {
    before = validateVerificationRun(beforeInput, beforeSnapshot);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_run", side: "before" });
    throw cause;
  }
  let after: VerificationRun;
  try {
    after = validateVerificationRun(afterInput, afterSnapshot);
  } catch (cause) {
    if (
      cause instanceof z.ZodError ||
      (cause instanceof PieError && cause.code === "INTEGRITY_ERROR")
    )
      return err({ kind: "invalid_run", side: "after" });
    throw cause;
  }
  if (
    before.id === after.id ||
    before.id !== input.data.beforeRunId ||
    after.id !== input.data.afterRunId ||
    before.projectId !== after.projectId ||
    beforeSnapshot.root !== afterSnapshot.root ||
    Date.parse(before.completedAt) > Date.parse(after.completedAt) ||
    Date.parse(beforeSnapshot.createdAt) > Date.parse(afterSnapshot.createdAt)
  )
    return err({ kind: "policy_denied", reason: "comparison_scope" });

  return ok(
    compareVerifiedRuns(
      before,
      beforeSnapshot,
      after,
      afterSnapshot,
      input.data,
    ),
  );
}

export function compareVerificationRuns(
  beforeInput: unknown,
  beforeSnapshot: Snapshot,
  afterInput: unknown,
  afterSnapshot: Snapshot,
  rawInput: unknown,
) {
  const result = compareVerificationRunsResult(
    beforeInput,
    beforeSnapshot,
    afterInput,
    afterSnapshot,
    rawInput,
  );
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_run")
    throw new PieError("INTEGRITY_ERROR", "Registro de execucao invalido.");
  throw new PieError(
    "INVALID_INPUT",
    result.error.kind === "policy_denied"
      ? "Execucoes devem ser distintas, ordenadas e pertencer ao mesmo projeto e raiz."
      : "Entrada de comparacao de execucoes invalida.",
  );
}
