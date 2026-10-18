export const expectedPostgresMigrations = [
  {
    name: "202610160001_initial",
    checksum:
      "708bef33a3ea03c1bf6dc18343f95a5811151b4a49682d5fe3749500964b2abe",
  },
  {
    name: "202610160002_jobs",
    checksum:
      "bd91894b002195154f24dda890015b0bd49bb58ff6a26b0827309ee7175d9ef5",
  },
  {
    name: "202610160003_verification_runs",
    checksum:
      "ba5f46de89c1643d74cbc7c53e558af385cbcf498bc205303e1fb691bf00cc34",
  },
  {
    name: "202610160004_verification_jobs",
    checksum:
      "e16ec19a238e1a366e5d148b1d3ead664433b37d57f3282ad4442b4ff9720df1",
  },
  {
    name: "202610160005_functional_records",
    checksum:
      "a76947282c818b51a9dbe77fb35d6faa2636582ee6ec014db619edd47a498416",
  },
  {
    name: "202610170001_http_probes",
    checksum:
      "160dd97c1b9a2bdd19f251dd89bf1d9d538b173a0d519fb24a9e869381a32e33",
  },
  {
    name: "202610170002_plan_contestations",
    checksum:
      "24ed0541a09f2b5565349ec66174d68794f5f1c4ffd6ccb03a122188ed0a53be",
  },
  {
    name: "202610170003_plan_triage_events",
    checksum:
      "78e8fbd45a9e7cbb1f22807def3185b5f8eb8983e0b0e222240b23e04b813abd",
  },
] as const;

export type AppliedMigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};

export type MigrationHistoryInspection = {
  status:
    | "current"
    | "missing_history"
    | "unfinished"
    | "missing"
    | "unknown"
    | "drifted";
  missing: number;
  unfinished: number;
  unknown: number;
  drifted: number;
};

export function inspectAppliedMigrations(
  rows: readonly AppliedMigrationRow[],
): MigrationHistoryInspection {
  const expected = new Map<string, string>(
    expectedPostgresMigrations.map((migration) => [
      migration.name,
      migration.checksum,
    ]),
  );
  const applied = new Set<string>();
  let unfinished = 0;
  let drifted = 0;
  for (const row of rows) {
    if (row.rolled_back_at !== null) continue;
    if (row.finished_at === null) {
      unfinished++;
      continue;
    }
    applied.add(row.migration_name);
    const checksum = expected.get(row.migration_name);
    if (checksum !== undefined && checksum !== row.checksum) drifted++;
  }
  const missing = [...expected.keys()].filter(
    (name) => !applied.has(name),
  ).length;
  const unknown = [...applied].filter((name) => !expected.has(name)).length;
  const status = unfinished
    ? "unfinished"
    : drifted
      ? "drifted"
      : unknown
        ? "unknown"
        : missing
          ? "missing"
          : "current";
  return { status, missing, unfinished, unknown, drifted };
}

export function missingMigrationHistory(): MigrationHistoryInspection {
  return {
    status: "missing_history",
    missing: expectedPostgresMigrations.length,
    unfinished: 0,
    unknown: 0,
    drifted: 0,
  };
}
