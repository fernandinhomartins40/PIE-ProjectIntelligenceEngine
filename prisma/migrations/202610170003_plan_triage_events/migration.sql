CREATE TABLE "pie_plan_triage_events" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "plan_digest" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "pie_plan_triage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pie_plan_triage_events_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pie_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pie_plan_triage_events_snapshot_id_plan_digest_item_id_revision_key" UNIQUE ("snapshot_id", "plan_digest", "item_id", "revision")
);
CREATE TRIGGER pie_plan_triage_immutable BEFORE UPDATE OR DELETE ON "pie_plan_triage_events" FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
