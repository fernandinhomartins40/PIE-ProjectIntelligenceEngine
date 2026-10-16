import type { z } from "zod";
import type { Snapshot, Evidence } from "./contracts.js";
import type { historyOutput, projectsOutput } from "./outputContracts.js";
import type {
  VerificationRun,
  verificationHistorySchema,
} from "./execution/runContracts.js";

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
  saveSnapshot(input: unknown): Awaitable<Snapshot>;
  snapshot(id: string): Awaitable<Snapshot>;
  evidence(id: string): Awaitable<Evidence>;
  saveVerification(input: unknown): Awaitable<VerificationRun>;
  verification(id: string): Awaitable<VerificationRun>;
  verifications(
    snapshotId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof verificationHistorySchema>>;
  history(
    projectId: string,
    input?: unknown,
  ): Awaitable<z.infer<typeof historyOutput>>;
}
