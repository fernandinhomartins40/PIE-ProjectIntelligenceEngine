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
import { err, ok, type Result } from "../domain/result.js";

export const securityInput = pageSchema.extend({
  snapshotId: z.string().uuid(),
});

export type SecurityFailure =
  | { kind: "invalid_input" }
  | { kind: "invalid_snapshot" }
  | { kind: "policy_denied"; reason: "snapshot_mismatch" };

const secretKind = z.enum([
  "aws_access_key_id",
  "github_token",
  "slack_token",
  "stripe_live_secret",
  "google_api_key",
  "private_key_material",
  "global_eval",
  "function_constructor",
  "tls_verification_disabled",
  "workflow_write_all_permissions",
  "mutable_git_dependency_reference",
]);

const findingSchema = z.strictObject({
  id: z.string(),
  category: z.enum([
    "credential_like_material",
    "dynamic_code_evaluation",
    "insecure_tls_configuration",
    "workflow_privilege",
    "supply_chain_configuration",
  ]),
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
  schemaVersion: z.literal(2),
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
    workflowPermissionPatterns: z.literal("partial"),
    supplyChainPatterns: z.literal("partial"),
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

function staticMemberPath(node: Node): string[] | null {
  if (node.type === "Identifier") return [node.name];
  if (node.type !== "MemberExpression") return null;
  const base = staticMemberPath(node.object);
  if (!base) return null;
  if (node.property.type === "Identifier") return [...base, node.property.name];
  if (node.property.type === "StringLiteral")
    return [...base, node.property.value];
  return null;
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
    kind: "global_eval" | "function_constructor" | "tls_verification_disabled",
  ) => {
    const tls = kind === "tls_verification_disabled";
    findings.push({
      id: `security:${tls ? "tls" : "dynamic-code"}:${identity(path, line, kind, digest)}`,
      category: tls ? "insecure_tls_configuration" : "dynamic_code_evaluation",
      state: "suspected",
      severity: "high",
      kind,
      condition: tls
        ? "Uma configuração estática desativa a validação de certificados TLS."
        : `Uma chamada global direta ${kind} foi encontrada em AST.`,
      impact: tls
        ? "Se aplicada a conexões de rede, a ausência de validação pode permitir interceptação de tráfego por um intermediário."
        : "Se o valor for influenciado por entrada não confiável e o trecho for alcançável, pode ocorrer execução de código arbitrário.",
      probability: "unassessed",
      source: { path, line },
      evidenceIds: [evidenceId],
      observation: tls
        ? "Foi observada uma configuração explícita de TLS desativado; seu uso efetivo não foi verificado."
        : `Foi observada chamada compatível com ${kind}; fluxo de dados e alcançabilidade não foram analisados.`,
      uncertainty: tls
        ? [
            "A análise não determina se a opção é usada por uma conexão, se o código é alcançável ou se há compensações em outra camada.",
            "Outras formas de configurar TLS, aliases e linguagens não são cobertos.",
          ]
        : [
            "A presença da chamada não prova que dados controlados por usuário cheguem ao argumento nem que o trecho seja alcançável.",
            "Aliases, propriedades globais, outras linguagens e sinks não reconhecidos não são cobertos.",
          ],
      reproduction: tls
        ? [
            "Inspecionar os chamadores e confirmar se a opção alcança um cliente TLS na configuração efetiva.",
            "Em ambiente local isolado, verificar a rejeição de certificado inválido antes e depois da correção.",
          ]
        : [
            "Inspecionar a linha e os chamadores na revisão do mesmo snapshot, sem executar o projeto.",
            "Em fixture isolada e com dados inertes, testar se entrada não confiável pode alcançar o argumento antes de qualquer conclusão.",
          ],
      remediation: tls
        ? "Remover a desativação da validação TLS e manter a verificação de certificado habilitada; configurar autoridades confiáveis explicitamente quando necessário."
        : "Preferir parser de formato e operações permitidas explícitas; remover execução dinâmica quando não for requisito funcional.",
      regression: tls
        ? [
            "Adicionar teste de configuração que falhe se rejectUnauthorized=false ou NODE_TLS_REJECT_UNAUTHORIZED=0 voltar a ser aplicado.",
            "Verificar em teste local que certificados inválidos continuam sendo rejeitados.",
          ]
        : [
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
    ObjectProperty(astPath) {
      if (truncated) return astPath.stop();
      const { key, value, computed } = astPath.node;
      const name =
        key.type === "Identifier"
          ? key.name
          : key.type === "StringLiteral"
            ? key.value
            : null;
      if (
        !computed &&
        name === "rejectUnauthorized" &&
        value.type === "BooleanLiteral" &&
        !value.value
      )
        record(astPath.node.loc?.start.line ?? 1, "tls_verification_disabled");
      if (findings.length >= maxFindings) {
        truncated = true;
        astPath.stop();
      }
    },
    AssignmentExpression(astPath) {
      if (truncated) return astPath.stop();
      const target = staticMemberPath(astPath.node.left);
      const { right } = astPath.node;
      if (
        astPath.node.operator === "=" &&
        target?.join(".") === "process.env.NODE_TLS_REJECT_UNAUTHORIZED" &&
        ((right.type === "StringLiteral" && right.value === "0") ||
          (right.type === "NumericLiteral" && right.value === 0))
      )
        record(astPath.node.loc?.start.line ?? 1, "tls_verification_disabled");
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
  currentFiles: ReadonlySet<string>;
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
  const currentFiles = new Set<string>();
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
    currentFiles.add(path);
    filesExamined += 1;
    bytesExamined += result.bytes;
    astFilesExamined += result.astExamined;
    astFilesSkipped += result.astSkipped;
    findingsTruncated ||= result.truncated;
    limitations.push(...result.limitations);
  }
  const workflowPermissions = workflowPermissionFindings(
    snapshot,
    currentFiles,
    MAX_FINDINGS - findings.length,
  );
  findings.push(...workflowPermissions.findings);
  findingsTruncated ||= workflowPermissions.truncated;
  if (workflowPermissions.truncated)
    limitations.push(
      "Limite de findings atingido; configurações de permissão de workflows restantes não foram analisadas.",
    );
  const mutableGitDependencies = mutableGitDependencyFindings(
    snapshot,
    currentFiles,
    MAX_FINDINGS - findings.length,
  );
  findings.push(...mutableGitDependencies.findings);
  findingsTruncated ||= mutableGitDependencies.truncated;
  if (mutableGitDependencies.truncated)
    limitations.push(
      "Limite de findings atingido; referências mutáveis de dependências restantes não foram analisadas.",
    );
  return {
    findings,
    limitations,
    filesExamined,
    filesSkipped,
    bytesExamined,
    findingsTruncated,
    astFilesExamined,
    astFilesSkipped,
    currentFiles,
  };
}

function mutableGitDependencyFindings(
  snapshot: Snapshot,
  currentFiles: ReadonlySet<string>,
  remaining: number,
) {
  const evidenceById = new Map(
    snapshot.evidence.map((item) => [item.id, item]),
  );
  const facts = snapshot.declarations.filter(
    (fact) =>
      fact.adapter === "node-manifest" &&
      fact.kind === "config_directive" &&
      fact.name === "dependency.git_reference_unpinned" &&
      currentFiles.has(fact.source.path),
  );
  const findings = facts.slice(0, remaining).flatMap((fact) => {
    const evidence = evidenceById.get(fact.evidenceId);
    if (!evidence) return [];
    return [
      findingSchema.parse({
        id: `security:mutable-git-dependency:${identity(
          fact.source.path,
          fact.source.line ?? 1,
          fact.parent ?? fact.name,
          evidence.source.sha256,
        )}`,
        category: "supply_chain_configuration",
        state: "suspected",
        severity: "high",
        kind: "mutable_git_dependency_reference",
        condition: `A dependência ${JSON.stringify(fact.parent)} usa uma referência Git sem hash completo de commit imutável.`,
        impact:
          "A resolução pode mudar entre instalações e permitir que conteúdo de terceiros seja alterado sem mudança no manifesto.",
        probability: "unassessed",
        source: { path: fact.source.path, line: fact.source.line },
        evidenceIds: [fact.evidenceId],
        observation:
          "O parser do manifesto classificou a especificação Git como não fixada; o destino remoto não foi consultado.",
        uncertainty: [
          "A análise não resolve tags/branches, não verifica o lockfile nem prova que a dependência será instalada ou executada.",
          "Uma referência pode ser imutável por política externa; isso não é verificável localmente.",
        ],
        reproduction: [
          "Conferir a especificação observada e o lockfile do gerenciador sem buscar nem executar conteúdo remoto.",
        ],
        remediation:
          "Preferir versão publicada com lockfile íntegro ou fixar a dependência Git em um hash completo de commit revisado.",
        regression: [
          "Adicionar teste de contrato que confirme a resolução somente a partir do lockfile e do hash revisado.",
        ],
        verificationStatus: "not_run",
        owner: null,
      }),
    ];
  });
  return { findings, truncated: facts.length > findings.length };
}

function workflowPermissionFindings(
  snapshot: Snapshot,
  currentFiles: ReadonlySet<string>,
  remaining: number,
) {
  const evidenceById = new Map(
    snapshot.evidence.map((item) => [item.id, item]),
  );
  const facts = snapshot.declarations.filter(
    (fact) =>
      fact.adapter === "github-actions" &&
      fact.kind === "config_directive" &&
      ["workflow.permissions.write-all", "job.permissions.write-all"].includes(
        fact.name,
      ) &&
      currentFiles.has(fact.source.path),
  );
  const findings = facts.slice(0, remaining).flatMap((fact) => {
    const evidence = evidenceById.get(fact.evidenceId);
    if (!evidence) return [];
    return [
      findingSchema.parse({
        id: `security:workflow-permissions:${identity(
          fact.source.path,
          fact.source.line ?? 1,
          `${fact.name}:${fact.parent ?? "workflow"}`,
          evidence.source.sha256,
        )}`,
        category: "workflow_privilege",
        state: "suspected",
        severity: "high",
        kind: "workflow_write_all_permissions",
        condition: fact.parent
          ? `O job ${JSON.stringify(fact.parent)} declara permissions: write-all.`
          : "O workflow declara permissions: write-all.",
        impact:
          "Um token GITHUB_TOKEN concedido a esse escopo pode receber permissões de escrita amplas, aumentando o impacto de código de workflow comprometido ou acionado por conteúdo não confiável.",
        probability: "unassessed",
        source: { path: fact.source.path, line: fact.source.line },
        evidenceIds: [fact.evidenceId],
        observation:
          "O parser YAML observou a declaração literal write-all; nenhum workflow ou token foi executado.",
        uncertainty: [
          "A análise não determina se o workflow é ativo, quais eventos o acionam, se o token é disponibilizado ou quais controles adicionais limitam seu uso.",
          "Somente write-all literal em workflow/job é detectado; permissões granulares, expressões e políticas fora do repositório não são avaliadas.",
        ],
        reproduction: [
          "Revisar a permissão na linha indicada e conferir os eventos e jobs do mesmo arquivo sem executar o workflow.",
          "Em uma cópia de teste do repositório, confirmar por inspeção de configuração qual conjunto mínimo de permissões permite a tarefa pretendida.",
        ],
        remediation:
          "Remover write-all e declarar apenas permissões mínimas no escopo que precisa delas; usar permissions: {} quando o workflow não precisa de token.",
        regression: [
          "Adicionar verificação de configuração que rejeite write-all e permita somente a lista mínima aprovada por workflow/job.",
          "Validar o conjunto efetivo de permissões em execução de teste autorizada antes de concluir a correção.",
        ],
        verificationStatus: "not_run",
        owner: null,
      }),
    ];
  });
  return { findings, truncated: facts.length > findings.length };
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
    schemaVersion: 2,
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
      workflowPermissionPatterns: "partial",
      supplyChainPatterns: "partial",
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
        "Permissões GitHub Actions: somente write-all literal em arquivo atual que passou pelo hash da Evidence; configuração efetiva, eventos e permissões granulares permanecem fora da análise.",
        "Supply chain: somente referências Git diretas reconhecidas no package.json sem SHA completo; lockfiles, resolução, conteúdo remoto e CVEs não são analisados.",
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
export async function reviewSecurityResult(
  snapshotInput: unknown,
  rawInput: unknown,
): Promise<Result<ReturnType<typeof securityOutput.parse>, SecurityFailure>> {
  const input = securityInput.safeParse(rawInput);
  if (!input.success) return err({ kind: "invalid_input" });
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
  if (input.data.snapshotId !== snapshot.id)
    return err({ kind: "policy_denied", reason: "snapshot_mismatch" });
  return ok(securityReport(snapshot, input.data, await scanSnapshot(snapshot)));
}

export async function reviewSecurity(
  snapshotInput: unknown,
  rawInput: unknown,
) {
  const result = await reviewSecurityResult(snapshotInput, rawInput);
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError("INTEGRITY_ERROR", "Snapshot de seguran?a inv?lido.");
  if (result.error.kind === "policy_denied")
    throw new PieError("INVALID_INPUT", "Snapshot de seguran?a diverge.");
  throw new PieError("INVALID_INPUT", "Entrada de seguran?a inv?lida.");
}
