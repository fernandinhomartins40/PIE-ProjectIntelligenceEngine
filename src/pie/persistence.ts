import type { z } from "zod";
import type { Snapshot, Evidence } from "./contracts.js";
import type { httpProbeSchema } from "./execution/httpProbe.js";
import type {
  FunctionalRecord,
  functionalHistorySchema,
} from "./functionalRecord.js";
import type {
  historyOutput,
  httpProbeHistorySchema,
  projectsOutput,
} from "./outputContracts.js";
import type {
  VerificationRun,
  verificationHistorySchema,
} from "./execution/runContracts.js";
import type { PlanContestation } from "./planContestation.js";
import type { planContestHistorySchema } from "./planContestation.js";
import type { PlanTriageEvent } from "./planTriage.js";

type Awaitable<T> = T | Promise<T>;
export interface ProjectRecord {
  id: string;
  root: string;
  name: string;
}

/** Persistence port: local SQLite and PostgreSQL share the same semantic contract. */
export interface PiePersistence {
  close(): Awaitable<void>;
  assertOutside(root: string): Promise<void>;
  addProject(id: string, root: string, name: string): Awaitable<ProjectRecord>;
  projects(input?: unknown): Awaitable<z.infer<typeof projectsOutput>>;
  projectsForRoot(
    root: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof projectsOutput>>;
  project(id: string): Awaitable<ProjectRecord>;
  saveSnapshot(input: unknown): Awaitable<Snapshot>;
  snapshot(id: string): Awaitable<Snapshot>;
  evidence(id: string): Awaitable<Evidence>;
  evidenceSnapshotId(id: string): Awaitable<string>;
  saveHttpProbe(input: unknown): Awaitable<z.infer<typeof httpProbeSchema>>;
  httpProbe(id: string): Awaitable<z.infer<typeof httpProbeSchema>>;
  httpProbes(
    snapshotId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof httpProbeHistorySchema>>;
  saveFunctional(input: unknown): Awaitable<FunctionalRecord>;
  functionalRecord(id: string): Awaitable<FunctionalRecord>;
  functionalRecords(
    snapshotId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof functionalHistorySchema>>;
  saveVerification(input: unknown): Awaitable<VerificationRun>;
  verification(id: string): Awaitable<VerificationRun>;
  verifications(
    snapshotId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof verificationHistorySchema>>;
  projectVerifications(
    projectId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof verificationHistorySchema>>;
  savePlanContestation(input: unknown): Awaitable<PlanContestation>;
  planContestation(id: string): Awaitable<PlanContestation>;
  planContestations(
    snapshotId: string,
    input: unknown,
  ): Awaitable<z.infer<typeof planContestHistorySchema>>;
  savePlanTriage(input: unknown): Awaitable<PlanTriageEvent>;
  planTriageEvents(
    snapshotId: string,
    planDigest: string,
    itemId: string,
  ): Awaitable<PlanTriageEvent[]>;
  latestPlanTriageEvents(
    snapshotId: string,
    planDigest: string,
    itemIds: string[],
  ): Awaitable<PlanTriageEvent[]>;
  history(
    projectId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof historyOutput>>;
}
