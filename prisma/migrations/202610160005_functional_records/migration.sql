CREATE TABLE pie_functional_records (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES pie_snapshots(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX pie_functional_snapshot ON pie_functional_records(snapshot_id,created_at,id);
CREATE TRIGGER pie_functional_immutable BEFORE UPDATE OR DELETE ON pie_functional_records FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
