import { createHash } from "node:crypto";
import { PieError, type Snapshot } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { inventoryPath } from "./inventoryPath.js";
import { readInventoryFile } from "./readFile.js";
import { sha256 } from "./evidence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
import { adapterFactSchema } from "./adapters/contracts.js";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { Node } from "@babel/types";
import { z } from "zod";

export const securityInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
});

const secretKind = z.enum([
  "aws_access_key_id",
  "github_token",
  "slack_token",
  "stripe_live_secret",
  "google_api_key",
  "private_key_material",
  "global_eval",
  "function_constructor",
]);

const findingSchema = z.strictObject({
  id: z.string(),
  category: z.enum(["credential_like_material", "dynamic_code_evaluation"]),
  state: z.literal("suspected"),
  severity: z.enum(["high", "critical"]),
  kind: secretKind,
  condition: z.string(),
  impact: z.string(),
  probability: z.literal("unassessed"),
  source: z.strictObject({
    path: z.string(),
    line: z.number().int().positive(),
  }),
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
  reproduction: z.array(z.string()),
  remediation: z.string(),
  regression: z.array(z.string()),
  verificationStatus: z.literal("not_run"),
  owner: z.null(),
});
const authorizationSurfaceSchema = z.strictObject({
  declaration: adapterFactSchema,
  state: z.literal("unverified"),
  evidenceIds: z.array(z.string().uuid()).min(1),
  requiredChecks: z.array(z.string()),
});

export const securityOutput = z.strictObject({
  schemaVersion: z.literal(1),
  engine: z.literal("security"),
  snapshotId: z.string().uuid(),
  state: z.enum(["suspected_findings", "no_patterns_observed", "incomplete"]),
  findings: z.strictObject({
    items: z.array(findingSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  authorizationSurfaces: z.strictObject({
    items: z.array(authorizationSurfaceSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    credentialPatterns: z.literal("partial"),
    dynamicCodePatterns: z.literal("partial"),
    astFilesExamined: z.number().int().nonnegative(),
    astFilesSkipped: z.number().int().nonnegative(),
    authorization: z.literal("unverified"),
    authorizationTargets: z.number().int().nonnegative(),
    filesExamined: z.number().int().nonnegative(),
    filesSkipped: z.number().int().nonnegative(),
    bytesExamined: z.number().int().nonnegative(),
    findingsTruncated: z.boolean(),
    runtime: z.literal(false),
    limitations: z.array(z.string()),
  }),
});

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_FINDINGS = 10_000;
const patterns: ReadonlyArray<{
  kind: z.infer<typeof secretKind>;
  severity: "high" | "critical";
  expression: RegExp;
}> = [
  {
    kind: "aws_access_key_id",
    severity: "high",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "github_token",
    severity: "high",
    expression: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    kind: "slack_token",
    severity: "high",
    expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    kind: "stripe_live_secret",
    severity: "critical",
    expression: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
  },
  {
    kind: "google_api_key",
    severity: "high",
    expression: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: "private_key_material",
    severity: "critical",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
];

function supportsDynamicCodeAst(path: string): boolean {
  return /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/iu.test(path);
}

function analyzeDynamicCode(
  path: string,
  source: string,
  digest: string,
  evidenceId: string,
  maxFindings: number,
): { findings: z.infer<typeof findingSchema>[]; truncated: boolean } {
  const tree = parse(source, {
    sourceType: "unambiguous",
    plugins:
      path.endsWith(".tsx") || path.endsWith(".jsx")
        ? ["typescript", "jsx"]
        : ["typescript"],
  });
  const findings: z.infer<typeof findingSchema>[] = [];
  let truncated = maxFindings === 0;
  const record = (
    line: number,
    kind: "global_eval" | "function_constructor",
  ) => {
    findings.push({
      id: `security:dynamic-code:${identity(path, line, kind, digest)}`,
      category: "dynamic_code_evaluation",
      state: "suspected",
      severity: "high",
      kind,
      condition: `Uma chamada global direta ${kind} foi encontrada em AST.`,
      impact:
        "Se o valor for influenciado por entrada não confiável e o trecho for alcançável, pode ocorrer execução de código arbitrário.",
      probability: "unassessed",
      source: { path, line },
      evidenceIds: [evidenceId],
      observation: `Foi observada chamada compatível com ${kind}; fluxo de dados e alcançabilidade não foram analisados.`,
      uncertainty: [
        "A presença da chamada não prova que dados controlados por usuário cheguem ao argumento nem que o trecho seja alcançável.",
        "Aliases, propriedades globais, outras linguagens e sinks não reconhecidos não são cobertos.",
      ],
      reproduction: [
        "Inspecionar a linha e os chamadores na revisão do mesmo snapshot, sem executar o projeto.",
        "Em fixture isolada e com dados inertes, testar se entrada não confiável pode alcançar o argumento antes de qualquer conclusão.",
      ],
      remediation:
        "Preferir parser de formato e operações permitidas explícitas; remover execução dinâmica quando não for requisito funcional.",
      regression: [
        "Adicionar teste estático para impedir retorno acidental da chamada dinâmica após a correção.",
        "Se a funcionalidade exigir expressão dinâmica, testar lista permitida e entradas inválidas sem executar código externo.",
      ],
      verificationStatus: "not_run",
      owner: null,
    });
  };
  traverse(tree as unknown as Node, {
    CallExpression(astPath) {
      if (truncated) return astPath.stop();
      const { callee } = astPath.node;
      if (
        callee.type === "Identifier" &&
        callee.name === "eval" &&
        !astPath.scope.getBinding("eval")
      )
        record(astPath.node.loc?.start.line ?? 1, "global_eval");
      if (
        callee.type === "Identifier" &&
        callee.name === "Function" &&
        !astPath.scope.getBinding("Function")
      )
        record(astPath.node.loc?.start.line ?? 1, "function_constructor");
      if (findings.length >= maxFindings) {
        truncated = true;
        astPath.stop();
      }
    },
    NewExpression(astPath) {
      if (truncated) return astPath.stop();
      const { callee } = astPath.node;
      if (
        callee.type === "Identifier" &&
        callee.name === "Function" &&
        !astPath.scope.getBinding("Function")
      )
        record(astPath.node.loc?.start.line ?? 1, "function_constructor");
      if (findings.length >= maxFindings) {
        truncated = true;
        astPath.stop();
      }
    },
  });
  return { findings, truncated };
}

function identity(path: string, line: number, kind: string, digest: string) {
  return createHash("sha256")
    .update(`${path}\0${line}\0${kind}\0${digest}`)
    .digest("hex");
}

function analyzeFile(
  path: string,
  source: string,
  digest: string,
  evidenceId: string,
  maxFindings: number,
): { findings: z.infer<typeof findingSchema>[]; truncated: boolean } {
  const findings: z.infer<typeof findingSchema>[] = [];
  const lines = source.split(/\r?\n/u);
  let truncated = false;
  for (let index = 0; index < lines.length; index++) {
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      if (!pattern.expression.test(lines[index]!)) continue;
      findings.push({
        id: `security:credential:${identity(path, index + 1, pattern.kind, digest)}`,
        category: "credential_like_material",
        state: "suspected",
        severity: pattern.severity,
        kind: pattern.kind,
        condition: `A linha contém material compatível com o formato ${pattern.kind}.`,
        impact:
          "Se for um segredo ativo, sua exposição no repositório pode permitir uso não autorizado do serviço ou recurso associado.",
        probability: "unassessed",
        source: { path, line: index + 1 },
        evidenceIds: [evidenceId],
        observation: `Foi observado material compatível com o formato ${pattern.kind}; o valor foi omitido do relatório.`,
        uncertainty: [
          "A análise é estática e não valida se o valor é autêntico, ativo, autorizado ou já revogado.",
          "Formatos diferentes, valores codificados, montados em runtime ou fornecidos por secret managers não são cobertos por esta regra.",
        ],
        reproduction: [
          "Inspecionar a linha na revisão e verificar pelo canal autorizado se o valor é credencial ativa, sem copiá-lo para logs ou relatórios.",
          "Revisar o histórico e os locais de distribuição do segredo com o responsável pelo sistema.",
        ],
        remediation:
          "Se confirmado ativo, revogar/rotacionar conforme o provedor, remover do código e usar o mecanismo de segredos aprovado pelo projeto.",
        regression: [
          "Adicionar fixture redigida que confirma a detecção sem persistir o valor.",
          "Validar que a aplicação continua obtendo configuração pelo mecanismo de segredos após a remoção.",
        ],
        verificationStatus: "not_run",
        owner: null,
      });
      if (findings.length >= maxFindings) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  return { findings, truncated };
}

type FileScan =
  | { status: "skipped"; limitation: string }
  | {
      status: "scanned";
      findings: z.infer<typeof findingSchema>[];
      bytes: number;
      astExamined: number;
      astSkipped: number;
      truncated: boolean;
      limitations: string[];
    };

function fileReadLimitation(cause: unknown, path: string): string | null {
  if (cause instanceof PieError && cause.code === "POLICY_DENIED")
    return `Arquivo fora da política de leitura ou link não analisado: ${path}.`;
  const code =
    cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;
  if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code ?? ""))
    return `Arquivo indisponível na revisão; Evidence histórica preservada: ${path}.`;
  return null;
}

async function scanCurrentFile(
  snapshot: Snapshot,
  path: string,
  evidence: typeof snapshot.evidence,
  remainingBytes: number,
  remainingFindings: number,
): Promise<FileScan> {
  const expected = evidence[0]!.source.sha256;
  if (evidence.some((item) => item.source.sha256 !== expected))
    return {
      status: "skipped",
      limitation: `Hashes de Evidence divergentes; arquivo não analisado: ${path}.`,
    };

  let contents: Buffer | null;
  try {
    const target = await inventoryPath(snapshot.root, path);
    contents = await readInventoryFile(target, MAX_FILE_BYTES, () => 1);
  } catch (cause) {
    const limitation = fileReadLimitation(cause, path);
    if (limitation) return { status: "skipped", limitation };
    throw cause;
  }
  if (!contents || contents.length > remainingBytes)
    return {
      status: "skipped",
      limitation: `Arquivo excedeu o limite local da análise estática: ${path}.`,
    };
  if (sha256(contents) !== expected)
    return {
      status: "skipped",
      limitation: `Arquivo mudou desde o snapshot e não foi reportado como atual: ${path}.`,
    };

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    return {
      status: "skipped",
      limitation: `Arquivo não é UTF-8 válido e não foi analisado: ${path}.`,
    };
  }

  const credential = analyzeFile(
    path,
    source,
    expected,
    evidence[0]!.id,
    remainingFindings,
  );
  const findings = [...credential.findings];
  const limitations: string[] = [];
  let astExamined = 0;
  let astSkipped = 0;
  let truncated = credential.truncated;
  if (supportsDynamicCodeAst(path)) {
    if (findings.length >= remainingFindings) {
      astSkipped += 1;
      truncated = true;
    } else {
      try {
        const dynamicCode = analyzeDynamicCode(
          path,
          source,
          expected,
          evidence[0]!.id,
          remainingFindings - findings.length,
        );
        findings.push(...dynamicCode.findings);
        truncated ||= dynamicCode.truncated;
        astExamined += 1;
      } catch (cause) {
        if (!(cause instanceof SyntaxError)) throw cause;
        astSkipped += 1;
        limitations.push(
          `AST indisponível para fonte JavaScript/TypeScript com sintaxe não suportada: ${path}.`,
        );
      }
    }
  }
  if (truncated)
    limitations.push(
      `Limite de findings atingido; arquivos restantes não foram analisados.`,
    );
  return {
    status: "scanned",
    findings,
    bytes: contents.length,
    astExamined,
    astSkipped,
    truncated,
    limitations,
  };
}

type SnapshotScan = {
  findings: z.infer<typeof findingSchema>[];
  limitations: string[];
  filesExamined: number;
  filesSkipped: number;
  bytesExamined: number;
  findingsTruncated: boolean;
  astFilesExamined: number;
  astFilesSkipped: number;
};

async function scanSnapshot(snapshot: Snapshot): Promise<SnapshotScan> {
  const byPath = new Map<string, typeof snapshot.evidence>();
  for (const evidence of snapshot.evidence) {
    if (evidence.method !== "static") continue;
    const items = byPath.get(evidence.source.path) ?? [];
    items.push(evidence);
    byPath.set(evidence.source.path, items);
  }
  const findings: z.infer<typeof findingSchema>[] = [];
  const limitations = [...snapshot.coverage.limitations];
  let filesExamined = 0;
  let filesSkipped = 0;
  let bytesExamined = 0;
  let findingsTruncated = false;
  let astFilesExamined = 0;
  let astFilesSkipped = 0;
  let resourceLimitReported = false;
  for (const [path, evidence] of byPath) {
    if (findingsTruncated) {
      filesSkipped += 1;
      continue;
    }
    if (filesExamined + filesSkipped >= MAX_FILES) {
      filesSkipped += 1;
      if (!resourceLimitReported) {
        limitations.push(`Limite de ${MAX_FILES} arquivos atingido.`);
        resourceLimitReported = true;
      }
      continue;
    }
    if (bytesExamined >= MAX_TOTAL_BYTES) {
      filesSkipped += 1;
      if (!resourceLimitReported) {
        limitations.push(`Limite total de ${MAX_TOTAL_BYTES} bytes atingido.`);
        resourceLimitReported = true;
      }
      continue;
    }
    const result = await scanCurrentFile(
      snapshot,
      path,
      evidence,
      MAX_TOTAL_BYTES - bytesExamined,
      MAX_FINDINGS - findings.length,
    );
    if (result.status === "skipped") {
      filesSkipped += 1;
      limitations.push(result.limitation);
      continue;
    }
    findings.push(...result.findings);
    filesExamined += 1;
    bytesExamined += result.bytes;
    astFilesExamined += result.astExamined;
    astFilesSkipped += result.astSkipped;
    findingsTruncated ||= result.truncated;
    limitations.push(...result.limitations);
  }
  return {
    findings,
    limitations,
    filesExamined,
    filesSkipped,
    bytesExamined,
    findingsTruncated,
    astFilesExamined,
    astFilesSkipped,
  };
}

function authorizationReviewPage(
  snapshot: Snapshot,
  input: z.infer<typeof securityInput>,
) {
  const targets = snapshot.declarations.filter(
    (declaration) => declaration.kind === "endpoint",
  );
  return {
    targets,
    page: page(
      targets.map((declaration) => ({
        declaration,
        state: "unverified" as const,
        evidenceIds: [
          declaration.evidenceId,
          ...declaration.derivations.map((item) => item.evidenceId),
        ],
        requiredChecks: [
          "Verificar resposta sem identidade e com sessão expirada.",
          "Verificar acesso horizontal com identificador de outro usuário ou tenant quando esse modelo existir.",
          "Verificar privilégios menores e acesso direto por API, jobs e exports quando aplicável.",
        ],
      })),
      { offset: input.offset, limit: input.limit },
    ),
  };
}

function securityReport(
  snapshot: Snapshot,
  input: z.infer<typeof securityInput>,
  scan: SnapshotScan,
) {
  const authorization = authorizationReviewPage(snapshot, input);
  return securityOutput.parse({
    schemaVersion: 1,
    engine: "security",
    snapshotId: snapshot.id,
    state: reportState(snapshot, scan),
    findings: page(scan.findings, {
      offset: input.offset,
      limit: input.limit,
    }),
    authorizationSurfaces: authorization.page,
    coverage: {
      discovery: snapshot.coverage.status,
      credentialPatterns: "partial",
      dynamicCodePatterns: "partial",
      astFilesExamined: scan.astFilesExamined,
      astFilesSkipped: scan.astFilesSkipped,
      authorization: "unverified",
      authorizationTargets: authorization.targets.length,
      filesExamined: scan.filesExamined,
      filesSkipped: scan.filesSkipped,
      bytesExamined: scan.bytesExamined,
      findingsTruncated: scan.findingsTruncated,
      runtime: false,
      limitations: [
        ...scan.limitations,
        "Cobertura limitada a formatos de credencial de alta identificabilidade; ausência de padrões não comprova ausência de segredos.",
        "Nenhum valor detectado é incluído na resposta; Findings são suspeitas estáticas, não validação de credenciais nem pentest.",
        "Rotas declaradas são inventário de escopo; não determinam se existe ou falta autorização e permanecem unverified sem testes negativos de runtime.",
        "AST JavaScript/TypeScript cobre somente chamadas diretas globais eval/Function; não realiza análise de fluxo, alcançabilidade ou outros sinks.",
        `Limites desta revisão: ${MAX_FILES} arquivos, ${MAX_FILE_BYTES} bytes por arquivo, ${MAX_TOTAL_BYTES} bytes no total e ${MAX_FINDINGS} suspeitas.`,
      ],
    },
  });
}

function reportState(snapshot: Snapshot, scan: SnapshotScan) {
  if (
    scan.filesSkipped > 0 ||
    scan.astFilesSkipped > 0 ||
    scan.findingsTruncated ||
    snapshot.coverage.status === "partial"
  )
    return "incomplete" as const;
  return scan.findings.length > 0
    ? ("suspected_findings" as const)
    : ("no_patterns_observed" as const);
}

/** Scans only current files whose bytes still match static Evidence in the snapshot. */
export async function reviewSecurity(
  snapshotInput: unknown,
  rawInput: unknown,
) {
  const input = securityInput.parse(rawInput);
  const snapshot = validateSnapshot(snapshotInput);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Snapshot de segurança diverge.");
  return securityReport(snapshot, input, await scanSnapshot(snapshot));
}
