export const expectedPostgresMigrations = [
  "202610160001_initial",
  "202610160002_jobs",
  "202610160003_verification_runs",
  "202610160004_verification_jobs",
  "202610160005_functional_records",
  "202610170001_http_probes",
  "202610170002_plan_contestations",
  "202610170003_plan_triage_events",
] as const;

export type AppliedMigrationRow = {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};

export type MigrationHistoryInspection = {
  status: "current" | "missing_history" | "unfinished" | "missing" | "unknown";
  missing: number;
  unfinished: number;
  unknown: number;
};

export function inspectAppliedMigrations(
  rows: readonly AppliedMigrationRow[],
): MigrationHistoryInspection {
  const expected = new Set<string>(expectedPostgresMigrations);
  const applied = new Set<string>();
  let unfinished = 0;
  for (const row of rows) {
    if (row.rolled_back_at !== null) continue;
    if (row.finished_at === null) {
      unfinished++;
      continue;
    }
    applied.add(row.migration_name);
  }
  const missing = [...expected].filter((name) => !applied.has(name)).length;
  const unknown = [...applied].filter((name) => !expected.has(name)).length;
  const status = unfinished
    ? "unfinished"
    : unknown
      ? "unknown"
      : missing
        ? "missing"
        : "current";
  return { status, missing, unfinished, unknown };
}

export function missingMigrationHistory(): MigrationHistoryInspection {
  return {
    status: "missing_history",
    missing: expectedPostgresMigrations.length,
    unfinished: 0,
    unknown: 0,
  };
}
