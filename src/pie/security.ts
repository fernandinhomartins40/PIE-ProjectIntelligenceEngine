import { createHash } from "node:crypto";
import { PieError, type Snapshot } from "./contracts.js";
import { page, pageSchema } from "./graph.js";
import { inventoryPath } from "./inventoryPath.js";
import { readInventoryFile } from "./readFile.js";
import { sha256 } from "./evidence.js";
import { validateSnapshot } from "./snapshotIntegrity.js";
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
]);

const findingSchema = z.strictObject({
  id: z.string(),
  category: z.literal("credential_like_material"),
  state: z.literal("suspected"),
  severity: z.enum(["high", "critical"]),
  kind: secretKind,
  source: z.strictObject({
    path: z.string(),
    line: z.number().int().positive(),
  }),
  evidenceIds: z.array(z.string().uuid()).min(1),
  observation: z.string(),
  uncertainty: z.array(z.string()),
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
  coverage: z.strictObject({
    discovery: z.enum(["complete", "partial"]),
    credentialPatterns: z.literal("partial"),
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

function identity(path: string, line: number, kind: string, digest: string) {
  return createHash("sha256")
    .update(`${path}\0${line}\0${kind}\0${digest}`)
    .digest("hex");
}

function analyzeFile(
  path: string,
  contents: Buffer,
  digest: string,
  evidenceId: string,
): { findings: z.infer<typeof findingSchema>[]; truncated: boolean } {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  const findings: z.infer<typeof findingSchema>[] = [];
  const lines = text.split(/\r?\n/u);
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
        source: { path, line: index + 1 },
        evidenceIds: [evidenceId],
        observation: `Foi observado material compatível com o formato ${pattern.kind}; o valor foi omitido do relatório.`,
        uncertainty: [
          "A análise é estática e não valida se o valor é autêntico, ativo, autorizado ou já revogado.",
          "Formatos diferentes, valores codificados, montados em runtime ou fornecidos por secret managers não são cobertos por esta regra.",
        ],
      });
      if (findings.length >= MAX_FINDINGS) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  return { findings, truncated };
}

/** Scans only current files whose bytes still match static Evidence in the snapshot. */
export async function reviewSecurity(
  snapshotInput: unknown,
  rawInput: unknown,
) {
  const input = securityInput.parse(rawInput);
  const snapshot: Snapshot = validateSnapshot(snapshotInput);
  if (input.snapshotId !== snapshot.id)
    throw new PieError("INVALID_INPUT", "Snapshot de segurança diverge.");

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
  for (const [path, evidence] of byPath) {
    if (findingsTruncated) {
      filesSkipped += 1;
      continue;
    }
    if (
      filesExamined + filesSkipped >= MAX_FILES ||
      bytesExamined >= MAX_TOTAL_BYTES
    ) {
      filesSkipped += 1;
      continue;
    }
    const expected = evidence[0]!.source.sha256;
    if (evidence.some((item) => item.source.sha256 !== expected)) {
      filesSkipped += 1;
      limitations.push(
        `Hashes de Evidence divergentes; arquivo não analisado: ${path}.`,
      );
      continue;
    }
    let contents: Buffer | null;
    try {
      const target = await inventoryPath(snapshot.root, path);
      contents = await readInventoryFile(target, MAX_FILE_BYTES, () => 1);
    } catch (cause) {
      if (cause instanceof PieError && cause.code === "POLICY_DENIED") {
        filesSkipped += 1;
        limitations.push(
          `Arquivo fora da política de leitura ou link não analisado: ${path}.`,
        );
        continue;
      }
      const code =
        cause instanceof Error
          ? (cause as NodeJS.ErrnoException).code
          : undefined;
      if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code ?? "")) {
        filesSkipped += 1;
        limitations.push(
          `Arquivo indisponível na revisão; Evidence histórica preservada: ${path}.`,
        );
        continue;
      }
      throw cause;
    }
    if (!contents || contents.length > MAX_TOTAL_BYTES - bytesExamined) {
      filesSkipped += 1;
      limitations.push(
        `Arquivo excedeu o limite local da análise estática: ${path}.`,
      );
      continue;
    }
    if (sha256(contents) !== expected) {
      filesSkipped += 1;
      limitations.push(
        `Arquivo mudou desde o snapshot e não foi reportado como atual: ${path}.`,
      );
      continue;
    }
    try {
      const result = analyzeFile(path, contents, expected, evidence[0]!.id);
      findings.push(...result.findings);
      if (result.truncated) {
        findingsTruncated = true;
        limitations.push(
          `Limite de ${MAX_FINDINGS} suspeitas atingido; arquivos restantes não foram analisados.`,
        );
      }
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
      filesSkipped += 1;
      limitations.push(
        `Arquivo não é UTF-8 válido e não foi analisado: ${path}.`,
      );
      continue;
    }
    filesExamined += 1;
    bytesExamined += contents.length;
  }

  const selected = page(findings, {
    offset: input.offset,
    limit: input.limit,
  });
  return securityOutput.parse({
    schemaVersion: 1,
    engine: "security",
    snapshotId: snapshot.id,
    state:
      filesSkipped > 0 ||
      findingsTruncated ||
      snapshot.coverage.status === "partial"
        ? "incomplete"
        : findings.length > 0
          ? "suspected_findings"
          : "no_patterns_observed",
    findings: selected,
    coverage: {
      discovery: snapshot.coverage.status,
      credentialPatterns: "partial",
      filesExamined,
      filesSkipped,
      bytesExamined,
      findingsTruncated,
      runtime: false,
      limitations: [
        ...limitations,
        "Cobertura limitada a formatos de credencial de alta identificabilidade; ausência de padrões não comprova ausência de segredos.",
        "Nenhum valor detectado é incluído na resposta; Findings são suspeitas estáticas, não validação de credenciais nem pentest.",
        `Limites desta revisão: ${MAX_FILES} arquivos, ${MAX_FILE_BYTES} bytes por arquivo, ${MAX_TOTAL_BYTES} bytes no total e ${MAX_FINDINGS} suspeitas.`,
      ],
    },
  });
}
