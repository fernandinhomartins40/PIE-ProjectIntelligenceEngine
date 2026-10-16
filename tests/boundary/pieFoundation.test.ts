import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { policySchema } from "../../src/pie/contracts.js";
import { discoverProject } from "../../src/pie/discovery.js";
import { sealEvidence, verifyEvidence } from "../../src/pie/evidence.js";
import { impactedNodes, page } from "../../src/pie/graph.js";
import { admitOperation, containedPath } from "../../src/pie/policy.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";

const exec = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-test-"));
  temporary.push(root);
  const repo = join(root, "repository");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      name: "fixture-only",
      scripts: { test: "node malicious.js" },
    }),
  );
  await writeFile(
    join(repo, "malicious.js"),
    "throw new Error('Não executar conteúdo auditado');",
  );
  await writeFile(join(repo, ".env"), "TOKEN=fixture-secret-never-retain");
  await writeFile(join(repo, "feature.test.ts"), "// fixture de teste isolada");
  await exec("git", ["-C", repo, "add", "."]);
  return {
    root,
    repo,
    policy: policySchema.parse({
      profile: "OBSERVE",
      environment: "local",
      repositoryRoot: repo,
    }),
  };
}

describe("PIE: fundação integrada com Git e SQLite reais", () => {
  it("descobre, persiste, reabre e verifica evidência sem executar scripts ou modificar o alvo", async () => {
    const { root, repo, policy } = await fixture();
    const before = await readFile(join(repo, "package.json"));
    const db = join(root, "state", "pie.sqlite");
    const store = await openStore(db, repo);
    let snapshotId: string;
    let evidenceId: string;
    try {
      const output = await new PieService(store).discover(policy);
      snapshotId = output.snapshot.id;
      expect(output.coverage.status).toBe("partial");
      expect(output.coverage.runtime).toBe(false);
      const snapshot = store.snapshot(snapshotId);
      expect(snapshot.revision).toBeNull();
      expect(snapshot.nodes.some((n) => n.kind === "test")).toBe(true);
      expect(snapshot.nodes.some((n) => n.kind === "manifest")).toBe(true);
      expect(snapshot.nodes.some((n) => n.path === ".env")).toBe(false);
      expect(JSON.stringify(snapshot)).not.toContain(
        "fixture-secret-never-retain",
      );
      expect(snapshot.evidence.every((e) => e.state === "unverified")).toBe(
        true,
      );
      evidenceId = snapshot.evidence[0]!.id;
      expect(store.saveSnapshot(snapshot).id).toBe(snapshotId);
      expect(() =>
        store.saveSnapshot({ ...snapshot, treeDigest: "0".repeat(64) }),
      ).toThrow("Digest");
      expect(() => store.saveSnapshot({ ...snapshot, dirty: false })).toThrow();
      const evidence = snapshot.evidence[0]!;
      expect(() =>
        verifyEvidence({ ...evidence, observation: "alterado" }),
      ).toThrow();
      const { sha256: originalHash, ...unsealed } = evidence;
      expect(originalHash).toHaveLength(64);
      const tampered = sealEvidence({ ...unsealed, projectId: randomUUID() });
      expect(() =>
        store.saveSnapshot({
          ...snapshot,
          id: randomUUID(),
          evidence: [tampered],
        }),
      ).toThrow();
    } finally {
      store.close();
    }
    const reopened = await openStore(db);
    try {
      expect(reopened.snapshot(snapshotId!).id).toBe(snapshotId!);
      expect(reopened.evidence(evidenceId!).id).toBe(evidenceId!);
      expect(reopened.projects().total).toBe(1);
    } finally {
      reopened.close();
    }
    expect(await readFile(join(repo, "package.json"))).toEqual(before);
  });

  it("registra omissão por limite sem declarar cobertura completa", async () => {
    const { policy } = await fixture();
    const snapshot = await discoverProject(
      { ...policy, maxFiles: 1 },
      randomUUID(),
    );
    expect(snapshot.coverage.status).toBe("partial");
    expect(snapshot.coverage.examinedFiles).toBeLessThanOrEqual(1);
    expect(snapshot.coverage.enumeratedFiles).toBe(4);
    await expect(
      discoverProject(policy, randomUUID(), AbortSignal.abort()),
    ).rejects.toThrow();
  });

  it("encerra aguardando descoberta cancelada e bloqueia nova admissão", async () => {
    const { root, repo, policy } = await fixture();
    const store = await openStore(join(root, "lifecycle.sqlite"), repo);
    const service = new PieService(store);
    const active = service.discover(policy);
    const outcome = active.then(
      () => "completed",
      () => "cancelled",
    );
    const second = service.discover(policy).then(
      () => "completed",
      () => "cancelled",
    );
    await expect(service.discover(policy)).rejects.toThrow("duas descobertas");
    const closing = service.close();
    expect(service.close()).toBe(closing);
    await expect(service.discover(policy)).rejects.toThrow("encerramento");
    await closing;
    expect(await outcome).toBe("cancelled");
    expect(await second).toBe("cancelled");
    const reopened = await openStore(join(root, "lifecycle.sqlite"));
    try {
      const projects = reopened.projects();
      for (const project of projects.items)
        expect(reopened.history(String(project.id)).total).toBe(0);
    } finally {
      reopened.close();
    }
  });

  it("rastreia imports AST reais com linha, preserva diff de conteúdo e declara resolução incompleta", async () => {
    const { repo, policy } = await fixture();
    await writeFile(join(repo, "service.ts"), "export const result = 1;\n");
    await writeFile(
      join(repo, "page.ts"),
      "import { result } from './service.js';\nimport outside from 'not-installed';\nexport { result };\n",
    );
    await exec("git", ["-C", repo, "add", "service.ts", "page.ts"]);
    const first = await discoverProject(policy, randomUUID());
    expect(first.edges).toHaveLength(1);
    const edge = first.edges[0]!;
    const source = first.nodes.find((n) => n.id === edge.from);
    const target = first.nodes.find((n) => n.id === edge.to);
    expect(source?.path).toBe("page.ts");
    expect(target?.path).toBe("service.ts");
    expect(
      first.evidence.find((e) => e.id === edge.evidenceIds[0])?.source.line,
    ).toBe(1);
    expect(
      first.coverage.limitations.some((l) => l.includes("não resolvidas")),
    ).toBe(true);
    expect(
      impactedNodes(first.nodes, first.edges, [target!.id]).map((n) => n.path),
    ).toContain("page.ts");
    await writeFile(join(repo, "service.ts"), "export const result = 2;\n");
    const second = await discoverProject(policy, first.projectId);
    expect(second.treeDigest).not.toBe(first.treeDigest);
    expect(second.nodes.find((n) => n.path === "service.ts")?.id).toBe(
      target?.id,
    );
  });

  it("nega persistência dentro do alvo, traversal, shell e mutação por OBSERVE", async () => {
    const { policy, repo } = await fixture();
    await expect(
      openStore(join(repo, "state", "pie.sqlite"), repo),
    ).rejects.toThrow("fora");
    expect(() => containedPath(repo, "../outside")).toThrow();
    expect(() => admitOperation(policy, "execute")).toThrow();
    expect(() => admitOperation(policy, "mutate")).toThrow();
    const verify = policySchema.parse({
      ...policy,
      profile: "VERIFY",
      allowTargetExecution: true,
    });
    expect(() => admitOperation(verify, "execute")).not.toThrow();
    expect(() => admitOperation(verify, "mutate")).toThrow();
    expect(() =>
      admitOperation({ ...verify, environment: "production" }, "execute"),
    ).toThrow();
  });
});

describe("PIE: consultas de grafo", () => {
  it("pagina sem promover ausência de relação para ausência de impacto", () => {
    expect(page([1, 2, 3], { limit: 2 }).nextOffset).toBe(2);
    expect(() => page([], { limit: 0 })).toThrow();
    const nodes = ["page", "service", "db"].map((id) => ({
      id,
      path: id,
      kind: "file" as const,
      evidenceIds: [randomUUID()],
    }));
    const edges = [
      {
        id: "1",
        from: "page",
        to: "service",
        kind: "calls" as const,
        evidenceIds: [randomUUID()],
        confidence: "observed" as const,
      },
      {
        id: "2",
        from: "service",
        to: "db",
        kind: "depends" as const,
        evidenceIds: [randomUUID()],
        confidence: "observed" as const,
      },
    ];
    expect(impactedNodes(nodes, edges, ["db"]).map((n) => n.id)).toEqual([
      "page",
      "service",
      "db",
    ]);
  });
});
