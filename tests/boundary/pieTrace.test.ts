import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { traceSnapshot } from "../../src/pie/knowledgeGraph.js";

const exec = promisify(execFile);

it("rastreia imports cíclicos, serviços Compose e campos Prisma com provas do snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-trace-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  const store = await openStore(join(root, "pie.sqlite"), repo);
  const service = new PieService(store);
  try {
    await exec("git", ["init", repo]);
    await writeFile(
      join(repo, "page.ts"),
      "import './service.js'; export const page = true;",
    );
    await writeFile(
      join(repo, "service.ts"),
      "import './page.js'; export const service = true;",
    );
    await writeFile(
      join(repo, "compose.yaml"),
      "services:\n  web:\n    depends_on: [db, db]\n  db:\n    depends_on: [missing]\n",
    );
    await writeFile(
      join(repo, "schema.prisma"),
      "model Order {\n  id String @id\n  total Int\n}\n",
    );
    await exec("git", ["-C", repo, "add", "."]);
    const run = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(run.snapshot.id);
    expect(
      snapshot.coverage.limitations.some((value) =>
        value.includes("consolidadas"),
      ),
    ).toBe(true);
    const page = snapshot.nodes.find((node) => node.path === "page.ts")!;
    const input = { snapshotId: snapshot.id, nodeId: page.id };
    const trace = await service.trace(input);
    expect(trace.nodes.items.map((node) => node.label)).toEqual([
      "page.ts",
      "service.ts",
    ]);
    expect(trace.edges.total).toBe(2);
    expect(trace.coverage.truncated).toBe(false);
    expect(trace.coverage.runtime).toBe(false);
    expect(
      (await service.trace({ ...input, direction: "both" })).nodes.total,
    ).toBe(2);
    const partial = traceSnapshot(
      { ...snapshot, coverage: { ...snapshot.coverage, status: "partial" } },
      input,
    );
    expect(partial.coverage.discoveryStatus).toBe("partial");
    expect(partial.coverage.scope).toBe("recorded-relationships");
    const knownEvidence = new Set(snapshot.evidence.map((item) => item.id));
    expect(
      trace.edges.items.every((edge) =>
        edge.evidenceIds.every((id) => knownEvidence.has(id)),
      ),
    ).toBe(true);
    const web = snapshot.declarations.find(
      (fact) => fact.kind === "service" && fact.name === "web",
    )!;
    const compose = await service.trace({ ...input, nodeId: web.id });
    expect(compose.nodes.items.map((node) => node.label)).toContain("db");
    expect(compose.nodes.items.map((node) => node.label)).not.toContain(
      "missing",
    );
    expect(compose.coverage.unresolvedRelations).toBe(1);
    const order = snapshot.declarations.find((fact) => fact.kind === "model")!;
    const fields = await service.trace({
      ...input,
      nodeId: order.id,
      direction: "dependents",
      maxDepth: 1,
    });
    expect(fields.nodes.items.map((node) => node.label)).toEqual(
      expect.arrayContaining(["Order", "id", "total"]),
    );
    expect(fields.edges.items.every((edge) => edge.kind === "field_of")).toBe(
      true,
    );
    expect((await service.trace({ ...input, maxDepth: 0 })).nodes.total).toBe(
      1,
    );
    expect(
      (await service.trace({ ...input, maxDepth: 0 })).coverage.truncated,
    ).toBe(true);
    const edgeLimited = await service.trace({ ...input, maxEdges: 1 });
    expect(edgeLimited.edges.total).toBe(1);
    expect(edgeLimited.coverage.truncated).toBe(true);
    const nodeLimited = await service.trace({ ...input, maxNodes: 1 });
    expect(nodeLimited.nodes.total).toBe(1);
    expect(nodeLimited.coverage.truncated).toBe(true);
    const paginated = await service.trace({ ...input, limit: 1 });
    expect(paginated.nodes.nextOffset).toBe(1);
    expect(
      (await service.trace({ ...input, offset: 1, limit: 1 })).nodes.items[0]!
        .label,
    ).toBe("service.ts");
    await expect(service.trace({ ...input, nodeId: "absent" })).rejects.toThrow(
      "não encontrado",
    );
    await expect(service.trace({ ...input, maxNodes: 0 })).rejects.toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
