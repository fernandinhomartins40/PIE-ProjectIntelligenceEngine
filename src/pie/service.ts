import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PieError,
  policySchema,
  type Policy,
  type Snapshot,
} from "./contracts.js";
import { discoverProjectResult, projectName } from "./discovery.js";
import { page } from "./graph.js";
import type { PiePersistence } from "./persistence.js";
import { compareSnapshots, comparisonInput } from "./compare.js";
import { traceInput, traceSnapshot } from "./knowledgeGraph.js";
import {
  assessFunctionalResult,
  assessProduct,
  functionalInput,
} from "./functional.js";
import { dataReviewInput, reviewData } from "./dataReview.js";
import { reviewSecurity, securityInput } from "./security.js";
import {
  exportSnapshot as renderSnapshotExport,
  exportSnapshotInput,
} from "./exportSnapshot.js";
import {
  exportFunctionalRecord as renderFunctionalRecordExport,
  functionalRecordExportInput,
  sealFunctional,
} from "./functionalRecord.js";
import { planRetests, retestInput } from "./retestPlan.js";
import {
  generateUnifiedPlan,
  generateUnifiedPlanData,
  planningInput,
  unifiedPlanOutput,
} from "./planning.js";
import {
  planContestationInput,
  planContestHistoryInput,
  sealPlanContestation,
} from "./planContestation.js";
import {
  applyLatestPlanTriage,
  planTriageHistoryInput,
  planTriageInput,
  validatePlanTriageHistory,
  type PlanTriageEvent,
} from "./planTriage.js";
import { comparePlanPriority } from "./planPriority.js";
import { httpGrantSchema, probeLocalHttp } from "./execution/httpProbe.js";
import {
  compareVerificationRuns,
  verificationComparisonInput,
} from "./regressionResults.js";
import { exportVerification as renderVerificationExport } from "./execution/runExport.js";
import { verificationExportInput } from "./execution/runContracts.js";
import { exportPlan as renderPlanExport } from "./planExport.js";

function functionalValue(result: ReturnType<typeof assessFunctionalResult>) {
  if (result.ok) return result.value;
  if (result.error.kind === "invalid_snapshot")
    throw new PieError("INTEGRITY_ERROR", "Snapshot funcional inválido.");
  if (result.error.kind === "policy_denied")
    throw new PieError(
      "POLICY_DENIED",
      result.error.reason === "snapshot_mismatch"
        ? "Análise funcional pertence a outro snapshot."
        : "Análise funcional estática exige escopo OBSERVE correspondente.",
    );
  throw new PieError(
    "INVALID_INPUT",
    result.error.reason === "module_path"
      ? "Módulo deve ser caminho relativo canônico, sem segmentos vazios ou traversal."
      : "Entrada funcional inválida.",
  );
}

function discoveryValue(
  result: Awaited<ReturnType<typeof discoverProjectResult>>,
  signal: AbortSignal,
) {
  if (result.ok) return result.value;
  if (result.error.kind === "cancelled") signal.throwIfAborted();
  const failures = {
    invalid_input: ["INVALID_INPUT", "Política de descoberta inválida."],
    policy_denied: ["POLICY_DENIED", "Descoberta não permitida pela política."],
    limit_exceeded: ["LIMIT_EXCEEDED", "Limite da descoberta excedido."],
    io_error: ["IO_ERROR", "Falha de I/O durante a descoberta."],
    integrity_error: ["INTEGRITY_ERROR", "Integridade da descoberta inválida."],
    cancelled: ["POLICY_DENIED", "Descoberta cancelada."],
  } as const;
  const [code, message] = failures[result.error.kind];
  throw new PieError(code, message);
}

function validatePriorityEvidence(
  evidenceIds: ReadonlySet<string>,
  event: PlanTriageEvent,
) {
  if (
    event.schemaVersion === 2 &&
    event.priority?.evidenceIds.some((id) => !evidenceIds.has(id))
  )
    throw new PieError(
      "INTEGRITY_ERROR",
      "Evidence da prioridade não pertence ao snapshot preservado.",
    );
}

function policyValue(input: unknown): Policy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success)
    throw new PieError("INVALID_INPUT", "Política de descoberta inválida.");
  return parsed.data;
}

async function repositoryRoot(policy: Policy): Promise<string> {
  try {
    return await realpath(resolve(policy.repositoryRoot));
  } catch (cause) {
    if (
      cause instanceof Error &&
      ["EACCES", "EIO", "ENOENT", "ENOTDIR", "EPERM"].includes(
        (cause as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw new PieError("IO_ERROR", "Raiz do repositório indisponível.");
    throw cause;
  }
}

/** Shared application workflow used by CLI and MCP; no target code execution. */
export class PieService {
  readonly #active = new Map<AbortController, Promise<unknown>>();
  readonly #reads = new Set<Promise<unknown>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  constructor(readonly store: PiePersistence) {}

  discover(input: unknown, signal?: AbortSignal) {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    if (this.#active.size >= 2)
      return Promise.reject(
        new PieError(
          "LIMIT_EXCEEDED",
          "Limite de duas descobertas simultâneas; aguarde a conclusão.",
        ),
      );
    const controller = new AbortController();
    const effective = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const operation = this.#discover(input, effective);
    this.#active.set(controller, operation);
    void operation.then(
      () => this.#active.delete(controller),
      () => this.#active.delete(controller),
    );
    return operation;
  }

  probeHttp(input: unknown, authorizedRoot: string, signal?: AbortSignal) {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    if (this.#active.size >= 2)
      return Promise.reject(
        new PieError("LIMIT_EXCEEDED", "Limite de operações ativas atingido."),
      );
    const controller = new AbortController();
    const effective = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const operation = (async () => {
      const grant = httpGrantSchema.parse(input);
      const snapshot = await this.store.snapshot(grant.snapshotId);
      const result = await probeLocalHttp(
        grant,
        snapshot,
        authorizedRoot,
        effective,
      );
      if (!result.ok) return result;
      // Publication is the cancellation cutoff: before it, cancellation prevents
      // a write; once the atomic store call begins, its receipt must be returned.
      effective.throwIfAborted();
      return {
        ok: true as const,
        value: await this.store.saveHttpProbe(result.value),
      };
    })();
    this.#active.set(controller, operation);
    void operation.then(
      () => this.#active.delete(controller),
      () => this.#active.delete(controller),
    );
    return operation;
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= (async () => {
      for (const controller of this.#active.keys()) controller.abort();
      await Promise.allSettled([...this.#active.values(), ...this.#reads]);
      await this.store.close();
    })().catch((cause) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return this.#closePromise;
  }

  async #discover(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const policy = policyValue(input);
    const root = await repositoryRoot(policy);
    await this.store.assertOutside(root);
    const project = await this.store.addProject(
      randomUUID(),
      root,
      projectName(root),
    );
    const snapshot = discoveryValue(
      await discoverProjectResult(
        { ...policy, repositoryRoot: root },
        project.id,
        signal,
      ),
      signal,
    );
    // Cancellation cutoff: synchronous transaction commits a complete publication.
    signal.throwIfAborted();
    await this.store.saveSnapshot(snapshot);
    return {
      project,
      snapshot: {
        id: snapshot.id,
        revision: snapshot.revision,
        dirty: snapshot.dirty,
        createdAt: snapshot.createdAt,
        treeDigest: snapshot.treeDigest,
      },
      coverage: snapshot.coverage,
      nodeCount: snapshot.nodes.length,
      evidenceCount: snapshot.evidence.length,
      declarationCount: snapshot.declarations.length,
    };
  }

  #read<T>(action: () => Promise<T>): Promise<T> {
    if (this.#closing)
      return Promise.reject(
        new PieError("POLICY_DENIED", "Serviço em encerramento."),
      );
    const operation = action();
    this.#reads.add(operation);
    void operation.then(
      () => this.#reads.delete(operation),
      () => this.#reads.delete(operation),
    );
    return operation;
  }

  projects(input: unknown = {}) {
    return this.#read(async () => this.store.projects(input));
  }
  projectsForRoot(root: string, input: unknown = {}) {
    return this.#read(async () => this.store.projectsForRoot(root, input));
  }
  project(id: string) {
    return this.#read(async () => this.store.project(id));
  }
  history(projectId: string, input: unknown = {}) {
    return this.#read(async () => this.store.history(projectId, input));
  }
  evidence(id: string) {
    return this.#read(async () => this.store.evidence(id));
  }
  verification(id: string) {
    return this.#read(async () => this.store.verification(id));
  }
  exportVerification(input: unknown) {
    return this.#read(async () => {
      const request = verificationExportInput.parse(input);
      const run = await this.store.verification(request.id);
      const snapshot = await this.store.snapshot(run.snapshotId);
      return renderVerificationExport(run, snapshot, request);
    });
  }
  httpProbe(id: string) {
    return this.#read(async () => this.store.httpProbe(id));
  }
  httpProbes(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => this.store.httpProbes(snapshotId, input));
  }
  verifications(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => this.store.verifications(snapshotId, input));
  }
  projectVerifications(projectId: string, input: unknown = {}) {
    return this.#read(async () =>
      this.store.projectVerifications(projectId, input),
    );
  }
  verificationComparison(input: unknown) {
    return this.#read(async () => {
      const request = verificationComparisonInput.parse(input);
      const before = await this.store.verification(request.beforeRunId);
      const after = await this.store.verification(request.afterRunId);
      const [beforeSnapshot, afterSnapshot] = await Promise.all([
        this.store.snapshot(before.snapshotId),
        this.store.snapshot(after.snapshotId),
      ]);
      return compareVerificationRuns(
        before,
        beforeSnapshot,
        after,
        afterSnapshot,
        request,
      );
    });
  }

  graph(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => {
      const snapshot = await this.store.snapshot(snapshotId);
      return {
        snapshotId,
        nodes: page(snapshot.nodes, input),
        edges: page(snapshot.edges, input),
        coverage: snapshot.coverage,
      };
    });
  }

  declarations(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => {
      const snapshot = await this.store.snapshot(snapshotId);
      return {
        snapshotId,
        declarations: page(snapshot.declarations, input),
        coverage: snapshot.coverage,
      };
    });
  }

  exportSnapshot(input: unknown) {
    return this.#read(async () => {
      const request = exportSnapshotInput.parse(input);
      return renderSnapshotExport(
        await this.store.snapshot(request.snapshotId),
        request,
      );
    });
  }

  trace(input: unknown) {
    return this.#read(async () => {
      const parsed = traceInput.parse(input);
      return traceSnapshot(
        await this.store.snapshot(parsed.snapshotId),
        parsed,
      );
    });
  }

  compare(input: unknown) {
    return this.#read(async () => {
      const { beforeId, afterId, ...paging } = comparisonInput.parse(input);
      const [before, after] = await Promise.all([
        this.store.snapshot(beforeId),
        this.store.snapshot(afterId),
      ]);
      return compareSnapshots(before, after, paging);
    });
  }
  retestPlan(input: unknown) {
    return this.#read(async () => {
      const request = retestInput.parse(input);
      const [before, after] = await Promise.all([
        this.store.snapshot(request.beforeId),
        this.store.snapshot(request.afterId),
      ]);
      return planRetests(before, after, request);
    });
  }
  async #findPlanItem(snapshot: Snapshot, planDigest: string, itemId: string) {
    for (let offset = 0; ; offset += 200) {
      const plan = await generateUnifiedPlan(snapshot, {
        snapshotId: snapshot.id,
        limit: 200,
        offset,
      });
      if (plan.planDigest !== planDigest)
        throw new PieError(
          "INTEGRITY_ERROR",
          "Digest informado não corresponde ao plano atual do snapshot.",
        );
      const item = plan.items.items.find(
        (candidate) => candidate.id === itemId,
      );
      if (item) {
        const events = await this.store.latestPlanTriageEvents(
          snapshot.id,
          planDigest,
          [item.id],
        );
        if (events[0])
          validatePriorityEvidence(
            new Set(snapshot.evidence.map((entry) => entry.id)),
            events[0],
          );
        return applyLatestPlanTriage(item, events[0]);
      }
      if (plan.items.nextOffset === null) break;
    }
    throw new PieError("NOT_FOUND", "Item não pertence ao plano informado.");
  }
  plan(input: unknown) {
    return this.#read(async () => {
      const request = planningInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      const { output: plan, allItems } = await generateUnifiedPlanData(
        snapshot,
        { snapshotId: snapshot.id, limit: 200, offset: 0 },
      );
      const events = await this.store.latestPlanTriageEvents(
        snapshot.id,
        plan.planDigest,
        allItems.map((item) => item.id),
      );
      const byItem = new Map(events.map((event) => [event.itemId, event]));
      const knownEvidence = new Set(snapshot.evidence.map((item) => item.id));
      for (const event of events)
        validatePriorityEvidence(knownEvidence, event);
      return unifiedPlanOutput.parse({
        ...plan,
        items: {
          ...page(
            allItems
              .map((item) => applyLatestPlanTriage(item, byItem.get(item.id)))
              .sort(comparePlanPriority),
            { offset: request.offset, limit: request.limit },
          ),
        },
      });
    });
  }
  exportPlan(input: unknown) {
    return renderPlanExport(this, input);
  }
  contestPlanItem(input: unknown) {
    return this.#read(async () => {
      const request = planContestationInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      const item = await this.#findPlanItem(
        snapshot,
        request.planDigest,
        request.itemId,
      );
      const known = new Set(snapshot.evidence.map((entry) => entry.id));
      if (request.evidenceIds.some((id) => !known.has(id)))
        throw new PieError(
          "INVALID_INPUT",
          "Evidence de apoio deve pertencer ao snapshot.",
        );
      return this.store.savePlanContestation(
        sealPlanContestation(request, item),
      );
    });
  }
  planContestation(id: string) {
    return this.#read(async () => this.store.planContestation(id));
  }
  planContestations(snapshotId: string, input: unknown = {}) {
    return this.#read(async () => {
      const request = planContestHistoryInput.parse({
        ...((input ?? {}) as object),
        snapshotId,
      });
      await this.store.snapshot(snapshotId);
      return this.store.planContestations(snapshotId, request);
    });
  }
  updatePlanTriage(input: unknown) {
    return this.#read(async () => {
      const request = planTriageInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      await this.#findPlanItem(snapshot, request.planDigest, request.itemId);
      const knownEvidence = new Set(snapshot.evidence.map((item) => item.id));
      if (
        request.priority &&
        request.priority.evidenceIds.some((id) => !knownEvidence.has(id))
      )
        throw new PieError(
          "INVALID_INPUT",
          "Evidence da avaliação de prioridade deve pertencer ao snapshot.",
        );
      return this.store.savePlanTriage(request);
    });
  }
  planTriageHistory(snapshotId: string, input: unknown) {
    return this.#read(async () => {
      const request = planTriageHistoryInput.parse({
        ...((input ?? {}) as object),
        snapshotId,
      });
      const snapshot = await this.store.snapshot(snapshotId);
      const events = await this.store.planTriageEvents(
        snapshotId,
        request.planDigest,
        request.itemId,
      );
      if (events.length === 0)
        throw new PieError("NOT_FOUND", "Histórico de triagem não encontrado.");
      return validatePlanTriageHistory(events, snapshot, request);
    });
  }
  functional(input: unknown) {
    return this.#read(async () => {
      const request = functionalInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      return functionalValue(
        assessFunctionalResult(snapshot, request, {
          profile: "OBSERVE",
          environment: "local",
          repositoryRoot: snapshot.root,
        }),
      );
    });
  }
  product(input: unknown) {
    return this.#read(async () => {
      const request = functionalInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      return assessProduct(snapshot, request);
    });
  }
  dataReview(input: unknown) {
    return this.#read(async () => {
      const request = dataReviewInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      return reviewData(snapshot, request);
    });
  }
  security(input: unknown) {
    return this.#read(async () => {
      const request = securityInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      return reviewSecurity(snapshot, request);
    });
  }
  retainFunctional(input: unknown) {
    return this.#read(async () => {
      const request = functionalInput.parse(input);
      const snapshot = await this.store.snapshot(request.snapshotId);
      const result = functionalValue(
        assessFunctionalResult(snapshot, request, {
          profile: "OBSERVE",
          environment: "local",
          repositoryRoot: snapshot.root,
        }),
      );
      return this.store.saveFunctional(sealFunctional(request, result));
    });
  }
  functionalRecord(id: string) {
    return this.#read(async () => this.store.functionalRecord(id));
  }
  exportFunctionalRecord(input: unknown) {
    return this.#read(async () => {
      const request = functionalRecordExportInput.parse(input);
      const record = await this.store.functionalRecord(request.id);
      const snapshot = await this.store.snapshot(record.snapshotId);
      return renderFunctionalRecordExport(record, snapshot, request);
    });
  }
  functionalRecords(snapshotId: string, input: unknown = {}) {
    return this.#read(async () =>
      this.store.functionalRecords(snapshotId, input),
    );
  }
}
