-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "pie_projects" (
    "id" UUID NOT NULL,
    "root" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pie_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pie_snapshots" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "pie_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pie_evidence" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "pie_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pie_graph_nodes" (
    "snapshot_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "pie_graph_nodes_pkey" PRIMARY KEY ("snapshot_id","id")
);

-- CreateTable
CREATE TABLE "pie_graph_edges" (
    "snapshot_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "pie_graph_edges_pkey" PRIMARY KEY ("snapshot_id","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pie_projects_root_key" ON "pie_projects"("root");

-- CreateIndex
CREATE INDEX "pie_snapshots_project_id_created_at_id_idx" ON "pie_snapshots"("project_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "pie_evidence_snapshot_id_idx" ON "pie_evidence"("snapshot_id");

-- CreateIndex
CREATE INDEX "pie_graph_nodes_snapshot_id_path_idx" ON "pie_graph_nodes"("snapshot_id", "path");

-- CreateIndex
CREATE INDEX "pie_graph_edges_snapshot_id_source_id_idx" ON "pie_graph_edges"("snapshot_id", "source_id");

-- CreateIndex
CREATE INDEX "pie_graph_edges_snapshot_id_target_id_idx" ON "pie_graph_edges"("snapshot_id", "target_id");

-- AddForeignKey
ALTER TABLE "pie_snapshots" ADD CONSTRAINT "pie_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pie_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pie_evidence" ADD CONSTRAINT "pie_evidence_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pie_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pie_graph_nodes" ADD CONSTRAINT "pie_graph_nodes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pie_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pie_graph_edges" ADD CONSTRAINT "pie_graph_edges_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pie_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published evidence and graph observations are append-only, including direct SQL.
CREATE FUNCTION pie_reject_observation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PIE observation is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER pie_snapshots_immutable BEFORE UPDATE OR DELETE ON pie_snapshots
FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
CREATE TRIGGER pie_evidence_immutable BEFORE UPDATE OR DELETE ON pie_evidence
FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
CREATE TRIGGER pie_nodes_immutable BEFORE UPDATE OR DELETE ON pie_graph_nodes
FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();
CREATE TRIGGER pie_edges_immutable BEFORE UPDATE OR DELETE ON pie_graph_edges
FOR EACH ROW EXECUTE FUNCTION pie_reject_observation_mutation();

-- Graph endpoints cannot reference another snapshot or absent nodes.
ALTER TABLE pie_graph_edges ADD CONSTRAINT pie_edges_source_fk
FOREIGN KEY (snapshot_id, source_id) REFERENCES pie_graph_nodes(snapshot_id, id);
ALTER TABLE pie_graph_edges ADD CONSTRAINT pie_edges_target_fk
FOREIGN KEY (snapshot_id, target_id) REFERENCES pie_graph_nodes(snapshot_id, id);
