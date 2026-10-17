ALTER TABLE pie_jobs DROP CONSTRAINT pie_jobs_kind_check;
ALTER TABLE pie_jobs ADD CONSTRAINT pie_jobs_kind_check CHECK (kind IN ('discovery','verification'));
ALTER TABLE pie_jobs ADD CONSTRAINT pie_jobs_verification_attempts_check CHECK (kind <> 'verification' OR max_attempts=1);
