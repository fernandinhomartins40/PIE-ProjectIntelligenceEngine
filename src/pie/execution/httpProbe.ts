import { z } from "zod";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import canonicalize from "canonicalize";
import { err, ok } from "../../domain/result.js";
import { evidenceSchema, PieError } from "../contracts.js";
import { sealEvidence, sha256, verifyEvidence } from "../evidence.js";
import { validateSnapshot } from "../snapshotIntegrity.js";
import { captureLocalHttp, localHttpRequestSchema } from "./httpTransport.js";

export const httpGrantSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profile: z.literal("VERIFY"),
  allowLocalHttpRequests: z.literal(true),
  environment: z.literal("local"),
  repositoryRoot: z.string().min(1),
  snapshotId: z.string().uuid(),
  treeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  evidenceTtlMs: z.number().int().min(1).max(60000),
  request: localHttpRequestSchema,
  expectedStatus: z.number().int().min(100).max(599),
  expectedBodySha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
const captureSchema = z.strictObject({
  statusCode: z.number().int().nullable(),
  bodyBytes: z.number().int().nonnegative(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  complete: z.boolean(),
  elapsedMs: z.number().nonnegative(),
  redirectsFollowed: z.literal(0),
});
const payloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  authorizedRoot: z.string().min(1),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  authorization: httpGrantSchema,
  state: z.enum(["passed", "failed", "blocked", "inconclusive"]),
  capture: captureSchema,
  failure: z
    .enum([
      "invalid_request",
      "cancelled",
      "timeout",
      "response_limit",
      "transport",
    ])
    .nullable(),
});
export const httpProbeSchema = payloadSchema.extend({
  evidence: evidenceSchema,
});
export const httpProbeSummarySchema = z.strictObject({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  createdAt: z.iso.datetime({ precision: 3 }),
  state: payloadSchema.shape.state,
  evidenceId: evidenceSchema.shape.id,
  proofSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
});

export function httpProbeSummary(record: z.infer<typeof httpProbeSchema>) {
  return {
    id: record.id,
    snapshotId: record.snapshotId,
    createdAt: record.createdAt,
    state: record.state,
    evidenceId: record.evidence.id,
    proofSha256: record.evidence.source.sha256,
    expiresAt: record.evidence.expiresAt,
  };
}
function matchesAssertion(
  grant: z.infer<typeof httpGrantSchema>,
  capture: z.infer<typeof captureSchema>,
) {
  return (
    capture.statusCode === grant.expectedStatus &&
    (grant.expectedBodySha256 === null ||
      grant.expectedBodySha256 === capture.bodySha256)
  );
}

/** Internal workflow; server registration requires separate operator opt-in and persistent publication. */
export async function probeLocalHttp(
  input: unknown,
  observation: unknown,
  authorizedRoot: string,
  signal?: AbortSignal,
) {
  const parsed = httpGrantSchema.safeParse(input);
  if (!parsed.success) return err({ tag: "invalid_grant" as const });
  let snapshot;
  try {
    snapshot = validateSnapshot(observation);
  } catch {
    return err({ tag: "invalid_snapshot" as const });
  }
  const grant = parsed.data;
  if (
    grant.snapshotId !== snapshot.id ||
    grant.treeDigest !== snapshot.treeDigest ||
    Date.parse(grant.expiresAt) <= Date.now() ||
    snapshot.coverage.status !== "complete"
  )
    return err({ tag: "scope_denied" as const });
  try {
    const roots = await Promise.all([
      realpath(grant.repositoryRoot),
      realpath(snapshot.root),
      realpath(authorizedRoot),
    ]);
    if (roots[0] !== roots[1] || roots[1] !== roots[2])
      return err({ tag: "scope_denied" as const });
  } catch {
    return err({ tag: "scope_unavailable" as const });
  }
  if (Date.parse(grant.expiresAt) <= Date.now())
    return err({ tag: "scope_denied" as const });
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const result = await captureLocalHttp(grant.request, signal);
  const capture = result.ok ? result.value : result.error.partial;
  const state = result.ok
    ? matchesAssertion(grant, capture)
      ? "passed"
      : "failed"
    : capture.statusCode === null
      ? "blocked"
      : "inconclusive";
  const payload = payloadSchema.parse({
    schemaVersion: 1,
    id,
    snapshotId: snapshot.id,
    createdAt,
    completedAt: new Date().toISOString(),
    authorizedRoot: snapshot.root,
    authorization: grant,
    state,
    capture,
    failure: result.ok ? null : result.error.tag,
  });
  const digest = sha256(canonicalize(payload)!);
  const evidence = sealEvidence({
    schemaVersion: 1,
    id: randomUUID(),
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    auditRunId: id,
    revision: snapshot.revision,
    environment: "local",
    method: "test",
    confidence: "observed",
    state:
      state === "passed"
        ? "verified"
        : state === "failed"
          ? "failing"
          : state === "blocked"
            ? "blocked"
            : "partial",
    createdAt: payload.completedAt,
    source: { path: `pie-http:${id}`, line: null, sha256: digest },
    sensitivity: "internal",
    redactionStatus: "not_collected",
    expiresAt: new Date(
      Date.parse(payload.completedAt) + grant.evidenceTtlMs,
    ).toISOString(),
    limitations: [
      "Verifica somente status e digest opcional da resposta da requisição explicitamente autorizada; não comprova jornada, autorização de usuário ou persistência.",
      "Endereço local foi escolhido pelo operador; não foi comprovado que o processo que responde executa os bytes do snapshot. Nenhum processo do alvo foi iniciado ou isolado por este workflow.",
      "Sem redirects, DNS, proxy, cookies ou autenticação. Corpos e headers não retidos; digest parcial nunca satisfaz uma asserção.",
      "Evidência representa o instante observado e expira pelo TTL escolhido; não é estado vivo em cache.",
    ],
    observation: `HTTP local ${state}; status ${capture.statusCode ?? "desconhecido"}; registro SHA-256 ${digest}.`,
  });
  return ok(httpProbeSchema.parse({ ...payload, evidence }));
}

export function verifyHttpProbe(input: unknown) {
  const record = httpProbeSchema.parse(input);
  const { evidence, ...payload } = record;
  const proof = verifyEvidence(evidence);
  const expected =
    record.state === "passed"
      ? "verified"
      : record.state === "failed"
        ? "failing"
        : record.state === "blocked"
          ? "blocked"
          : "partial";
  if (
    proof.source.sha256 !== sha256(canonicalize(payload)!) ||
    proof.source.path !== `pie-http:${record.id}` ||
    proof.snapshotId !== record.snapshotId ||
    record.authorization.snapshotId !== record.snapshotId ||
    proof.auditRunId !== record.id ||
    proof.environment !== "local" ||
    proof.method !== "test" ||
    proof.confidence !== "observed" ||
    proof.state !== expected
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Prova HTTP sem integridade ou vínculo consistente.",
    );
  if (
    record.state === "passed" &&
    (!record.capture.complete ||
      record.failure !== null ||
      !matchesAssertion(record.authorization, record.capture))
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Aprovação HTTP sem prova de asserção completa.",
    );
  return record;
}
