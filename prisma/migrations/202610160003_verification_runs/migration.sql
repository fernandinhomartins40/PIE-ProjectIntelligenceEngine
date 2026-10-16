CREATE TABLE pie_verification_runs (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES pie_snapshots(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  evidence_id UUID NOT NULL UNIQUE REFERENCES pie_evidence(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMP(3) NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX pie_verification_runs_snapshot_id_created_at_id_idx ON pie_verification_runs(snapshot_id,created_at,id);
CREATE TRIGGER pie_verification_immutable BEFORE UPDATE OR DELETE ON pie_verification_runs
FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
