import { z } from "zod";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import { testState } from "../contracts.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const nodeCountsSchema = z.strictObject({
  cancelled: count,
  failed: count,
  passed: count,
  skipped: count,
  suites: count,
  tests: count,
  todo: count,
  topLevel: count,
});
export const nodeCaseSchema = z.strictObject({
  protocolVersion: z.literal(1),
  kind: z.literal("case"),
  name: z.string(),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  nesting: count,
  category: z.enum(["suite", "test"]),
  outcome: z.enum(["passed", "failed", "skipped", "todo"]),
});
export const nodeSummarySchema = z.strictObject({
  protocolVersion: z.literal(1),
  kind: z.literal("summary"),
  counts: nodeCountsSchema,
  durationMs: z.number().finite().nonnegative(),
  success: z.boolean(),
});
export const runtimeLocationSchema = z.strictObject({
  sourcePath: z.string().min(1),
  line: z.number().int().positive(),
});
const runtimeLocationRecordSchema = z.strictObject({
  protocolVersion: z.literal(1),
  kind: z.literal("runtime-locations"),
  complete: z.boolean(),
  locations: z.array(runtimeLocationSchema).max(5000),
});
const recordSchema = z.discriminatedUnion("kind", [
  nodeCaseSchema,
  nodeSummarySchema,
  runtimeLocationRecordSchema,
]);
export type NodeReport = {
  cases: Array<z.infer<typeof nodeCaseSchema>>;
  summary: z.infer<typeof nodeSummarySchema> | null;
  runtimeLocations: z.infer<typeof runtimeLocationRecordSchema> | null;
};
type ReportFailure = { cause: AnalysisOutputError; partial: NodeReport };

function consistentOutcomes(
  cases: NodeReport["cases"],
  counts: z.infer<typeof nodeCountsSchema>,
): boolean {
  const tests = cases.filter((item) => item.category === "test");
  const outcomes = (state: z.infer<typeof nodeCaseSchema>["outcome"]) =>
    tests.filter((item) => item.outcome === state).length;
  return (
    outcomes("passed") === counts.passed &&
    outcomes("skipped") === counts.skipped &&
    outcomes("todo") === counts.todo &&
    outcomes("failed") === counts.failed + counts.cancelled
  );
}

/** Strict, bounded protocol parser. Logs and diagnostic strings are never interpreted as results. */
export function parseNodeReport(
  bytes: Uint8Array,
  limits: { bytes: number; records: number },
): Result<NodeReport, ReportFailure> {
  const partial: NodeReport = {
    cases: [],
    summary: null,
    runtimeLocations: null,
  };
  const fail = (reason: string): Result<never, ReportFailure> =>
    err({
      cause: new AnalysisOutputError("pie.node-results", reason),
      partial,
    });
  if (
    !Number.isSafeInteger(limits.bytes) ||
    !Number.isSafeInteger(limits.records) ||
    limits.bytes < 1 ||
    limits.records < 1 ||
    bytes.byteLength > limits.bytes
  )
    return fail("Relatório excede limites de retenção.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Relatório não é UTF-8 válido.");
  }
  if (!text.endsWith("\n"))
    return fail("Relatório não terminou com um registro completo.");
  let records = 0;
  let summarySeen = false;
  for (const line of text.slice(0, -1).split("\n")) {
    if (++records > limits.records)
      return fail("Limite de registros atingido.");
    let input: unknown;
    try {
      input = JSON.parse(line);
    } catch {
      return fail("Registro JSON inválido.");
    }
    const parsed = recordSchema.safeParse(input);
    if (!parsed.success)
      return fail("Registro incompatível com protocolo Node PIE v1.");
    if (summarySeen && parsed.data.kind !== "runtime-locations")
      return fail("Registros encontrados após o resumo final.");
    if (parsed.data.kind === "case") partial.cases.push(parsed.data);
    else if (parsed.data.kind === "summary") {
      summarySeen = true;
      partial.summary = parsed.data;
    } else {
      if (partial.runtimeLocations)
        return fail("Registro de localizaÃ§Ãµes de runtime duplicado.");
      partial.runtimeLocations = parsed.data;
    }
  }
  if (!partial.summary) return fail("Resumo final ausente.");
  const { counts } = partial.summary;
  if (
    counts.passed +
      counts.failed +
      counts.cancelled +
      counts.skipped +
      counts.todo !==
    counts.tests
  )
    return fail("Contagens inconsistentes no resumo.");
  if (
    partial.cases.filter((item) => item.category === "test").length !==
      counts.tests ||
    partial.cases.filter((item) => item.category === "suite").length !==
      counts.suites
  )
    return fail("Resumo não corresponde aos casos recebidos.");
  if (!consistentOutcomes(partial.cases, counts))
    return fail("Estados dos casos divergem das contagens finais.");
  return ok(partial);
}

const nodeResultShape = {
  schemaVersion: z.literal(1),
  state: testState,
  counts: nodeCountsSchema.nullable(),
  cases: z.array(nodeCaseSchema),
  durationMs: z.number().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  coverage: z.strictObject({
    reportComplete: z.boolean(),
    processCompleted: z.boolean(),
    truncated: z.boolean(),
    limitations: z.array(z.string()),
  }),
};
const nodeResultV1Schema = z
  .strictObject(nodeResultShape)
  .refine(
    (value) =>
      value.state !== "passed" ||
      (value.coverage.reportComplete &&
        value.coverage.processCompleted &&
        !value.coverage.truncated &&
        value.exitCode === 0 &&
        value.signal === null &&
        value.counts !== null &&
        value.counts.tests > 0 &&
        value.counts.passed === value.counts.tests &&
        value.counts.failed +
          value.counts.cancelled +
          value.counts.skipped +
          value.counts.todo ===
          0 &&
        value.cases.filter((item) => item.category === "test").length ===
          value.counts.tests &&
        value.cases.every((item) => item.outcome === "passed")),
    {
      message:
        "Aprovação exige cobertura completa e casos aprovados consistentes.",
    },
  );
const nodeResultV2Schema = z
  .strictObject({
    ...nodeResultShape,
    schemaVersion: z.literal(2),
    runtimeLocations: z.strictObject({
      reportComplete: z.boolean(),
      locations: z.array(runtimeLocationSchema).max(5000),
      limitations: z.array(z.string()),
    }),
  })
  .refine(
    (value) =>
      value.state !== "passed" ||
      (value.coverage.reportComplete &&
        value.coverage.processCompleted &&
        !value.coverage.truncated &&
        value.exitCode === 0 &&
        value.signal === null &&
        value.counts !== null &&
        value.counts.tests > 0 &&
        value.counts.passed === value.counts.tests &&
        value.counts.failed +
          value.counts.cancelled +
          value.counts.skipped +
          value.counts.todo ===
          0 &&
        value.cases.filter((item) => item.category === "test").length ===
          value.counts.tests &&
        value.cases.every((item) => item.outcome === "passed")),
    {
      message:
        "AprovaÃ§Ã£o exige cobertura completa e casos aprovados consistentes.",
    },
  );
export const nodeResultSchema = z.discriminatedUnion("schemaVersion", [
  nodeResultV1Schema,
  nodeResultV2Schema,
]);
export type NodeCapture = {
  started: boolean;
  completed: boolean;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
};

function completedState(
  summary: z.infer<typeof nodeSummarySchema>,
  exitCode: number | null,
  limitations: string[],
): z.infer<typeof testState> {
  const c = summary.counts;
  if (exitCode === null || c.cancelled > 0) {
    limitations.push("Estado de saída desconhecido ou testes cancelados.");
    return "inconclusive";
  }
  if (c.failed > 0 || !summary.success || exitCode !== 0) return "failed";
  if (c.tests === 0) {
    limitations.push("Nenhum teste executado.");
    return "inconclusive";
  }
  if (c.skipped + c.todo === c.tests) return "skipped";
  if (c.skipped + c.todo > 0) {
    limitations.push("Parte dos testes foi ignorada ou está pendente.");
    return "inconclusive";
  }
  return "passed";
}

/** Exit zero is insufficient: skipped, TODO, cancellation and missing reports never pass. */
export function normalizeNodeResult(
  bytes: Uint8Array,
  capture: NodeCapture,
  limits: { bytes: number; records: number },
): z.infer<typeof nodeResultSchema> {
  const parsed = parseNodeReport(bytes, limits);
  const report = parsed.ok ? parsed.value : parsed.error.partial;
  const summary = report.summary;
  const limitations: string[] = [];
  if (!parsed.ok) limitations.push(parsed.error.cause.reason);
  if (capture.truncated)
    limitations.push("Saída truncada; cobertura do relatório incompleta.");
  if (!capture.completed || capture.signal !== null)
    limitations.push("Processo não concluiu normalmente.");
  const complete =
    parsed.ok &&
    capture.completed &&
    capture.signal === null &&
    !capture.truncated;
  let state: z.infer<typeof testState> = "inconclusive";
  if (!capture.started) {
    state = "blocked";
    limitations.push("Executor não iniciou os testes.");
  } else if (complete && summary) {
    state = completedState(summary, capture.exitCode, limitations);
    if (
      state === "passed" &&
      report.cases.every(
        (item) =>
          item.category === "suite" ||
          (item.nesting === 0 && item.name === item.file),
      )
    ) {
      state = "inconclusive";
      limitations.push(
        "Somente resultados de carregamento de arquivo ou nomes indistinguíveis foram recebidos; testes declarados não comprovados.",
      );
    }
  }
  const runtimeRecord = report.runtimeLocations;
  return nodeResultSchema.parse({
    schemaVersion: 2,
    state,
    counts: summary?.counts ?? null,
    cases: report.cases,
    durationMs: summary?.durationMs ?? null,
    exitCode: capture.exitCode,
    signal: capture.signal,
    coverage: {
      reportComplete: parsed.ok,
      processCompleted: capture.completed,
      truncated: capture.truncated,
      limitations,
    },
    runtimeLocations: {
      reportComplete: runtimeRecord?.complete ?? false,
      locations: runtimeRecord?.locations ?? [],
      limitations: !runtimeRecord?.complete
        ? [
            "Relatório runtime ausente ou incompleto; locais não foram atribuídos.",
          ]
        : runtimeRecord
          ? runtimeRecord.locations.length === 0
            ? [
                "Nenhum caminho do runtime correspondeu exatamente ao foco autorizado.",
              ]
            : []
          : ["LocalizaÃ§Ãµes de runtime nÃ£o foram reportadas pelo runner."],
    },
  });
}
