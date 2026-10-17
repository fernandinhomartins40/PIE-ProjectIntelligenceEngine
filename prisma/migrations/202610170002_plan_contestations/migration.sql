CREATE TABLE "pie_plan_contestations" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "plan_digest" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "pie_plan_contestations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pie_plan_contestations_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pie_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "pie_plan_contestation_snapshot" ON "pie_plan_contestations"("snapshot_id", "plan_digest", "created_at", "id");
CREATE TRIGGER pie_plan_contestation_immutable BEFORE UPDATE OR DELETE ON "pie_plan_contestations" FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
