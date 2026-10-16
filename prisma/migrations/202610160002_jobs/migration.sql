CREATE TABLE pie_jobs (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind='discovery'),
  state TEXT NOT NULL CHECK (state IN ('queued','running','cancelling','succeeded','failed','cancelled')),
  payload JSONB NOT NULL,
  result JSONB,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 10 AND 300000),
  owner TEXT,
  lease_token UUID,
  lease_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX pie_jobs_state_created_at_id_idx ON pie_jobs(state,created_at,id);
