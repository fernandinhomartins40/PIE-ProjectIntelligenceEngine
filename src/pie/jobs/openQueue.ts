import { SqliteJobQueue } from "./sqliteQueue.js";
import type { JobQueue } from "./contracts.js";

export async function openQueue(localPath: string): Promise<JobQueue> {
  if (!process.env.PIE_DATABASE_URL) return new SqliteJobQueue(localPath);
  const { PostgresJobQueue } = await import("./postgresQueue.js");
  return new PostgresJobQueue(process.env.PIE_DATABASE_URL);
}
