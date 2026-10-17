import { DatabaseSync } from "node:sqlite";
import canonicalize from "canonicalize";
import { PieError, type Evidence, type Snapshot } from "./contracts.js";
import { httpProbeHistorySchema as historyOutput } from "./outputContracts.js";
import { pageSchema } from "./graph.js";
import { httpProbeSchema, httpProbeSummary } from "./execution/httpProbe.js";
import {
  validateHttpProbe,
  validateStoredHttpProbe,
} from "./execution/httpIntegrity.js";

interface HttpSqlitePersistenceOptions {
  db: DatabaseSync;
  snapshot(id: string): Snapshot;
  evidence(id: string): Evidence;
}

function readHttpProbe(
  options: HttpSqlitePersistenceOptions,
  id: string,
  knownSnapshot?: Snapshot,
) {
  const row = options.db
    .prepare(
      "SELECT snapshot_id,evidence_id,created_at,payload FROM pie_http_probes WHERE id=?",
    )
    .get(id);
  if (!row) throw new PieError("NOT_FOUND", "Registro HTTP não encontrado.");
  return validateStoredHttpProbe(
    {
      id,
      snapshotId: String(row.snapshot_id),
      evidenceId: String(row.evidence_id),
      createdAt: String(row.created_at),
      payload: JSON.parse(String(row.payload)),
      evidence: options.evidence(String(row.evidence_id)),
    },
    knownSnapshot ?? options.snapshot(String(row.snapshot_id)),
  );
}

export function createHttpSqlitePersistence(
  options: HttpSqlitePersistenceOptions,
) {
  const { db } = options;

  return {
    saveHttpProbe(input: unknown) {
      const parsed = httpProbeSchema.parse(input);
      const snapshot = options.snapshot(parsed.snapshotId);
      const record = validateHttpProbe(parsed, snapshot);
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = db
          .prepare("SELECT id FROM pie_http_probes WHERE id=?")
          .get(record.id);
        if (previous) {
          if (
            canonicalize(readHttpProbe(options, record.id, snapshot)) !==
            canonicalize(record)
          )
            throw new PieError(
              "INTEGRITY_ERROR",
              "Registro HTTP histórico não pode ser substituído.",
            );
        } else {
          db.prepare(
            "INSERT INTO pie_evidence(id,snapshot_id,payload) VALUES(?,?,?)",
          ).run(
            record.evidence.id,
            record.snapshotId,
            JSON.stringify(record.evidence),
          );
          db.prepare(
            "INSERT INTO pie_http_probes(id,snapshot_id,evidence_id,created_at,payload) VALUES(?,?,?,?,?)",
          ).run(
            record.id,
            record.snapshotId,
            record.evidence.id,
            record.createdAt,
            JSON.stringify(record),
          );
        }
        db.exec("COMMIT");
        return record;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
    httpProbe(id: string) {
      return readHttpProbe(options, id);
    },
    httpProbes(snapshotId: string, input: unknown = {}) {
      const snapshot = options.snapshot(snapshotId);
      const { offset, limit } = pageSchema.parse(input);
      db.exec("BEGIN");
      try {
        const total = Number(
          db
            .prepare(
              "SELECT count(*) AS total FROM pie_http_probes WHERE snapshot_id=?",
            )
            .get(snapshotId)!.total,
        );
        const rows = db
          .prepare(
            "SELECT id FROM pie_http_probes WHERE snapshot_id=? ORDER BY created_at,id LIMIT ? OFFSET ?",
          )
          .all(snapshotId, limit, offset);
        const result = historyOutput.parse({
          items: rows.map((row) =>
            httpProbeSummary(readHttpProbe(options, String(row.id), snapshot)),
          ),
          total,
          offset,
          nextOffset: offset + limit < total ? offset + limit : null,
        });
        db.exec("COMMIT");
        return result;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
  };
}
