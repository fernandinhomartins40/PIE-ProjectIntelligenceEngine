CREATE TABLE pie_http_probes (
 id UUID PRIMARY KEY,
 snapshot_id UUID NOT NULL REFERENCES pie_snapshots(id) ON DELETE RESTRICT,
 evidence_id UUID NOT NULL UNIQUE REFERENCES pie_evidence(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ(3) NOT NULL,
 payload JSONB NOT NULL
);
CREATE INDEX pie_http_probe_snapshot ON pie_http_probes(snapshot_id,created_at,id);
CREATE TRIGGER pie_http_immutable BEFORE UPDATE OR DELETE ON pie_http_probes FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
