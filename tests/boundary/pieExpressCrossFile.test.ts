import { execFile } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { clearAnalysisCache } from "../../src/pie/analysisCache.js";
import { policySchema } from "../../src/pie/contracts.js";
import { discoverProject } from "../../src/pie/discovery.js";
import { traceSnapshot } from "../../src/pie/knowledgeGraph.js";
import { readCodeFacts } from "../../src/pie/codeFacts.js";
import { openStore } from "../../src/pie/store.js";
import { validateSnapshot } from "../../src/pie/snapshotIntegrity.js";

const exec = promisify(execFile);

it("imports relativos comuns não anunciam cobertura Express", () => {
  clearAnalysisCache();
  const parsed = readCodeFacts(
    "src/module.ts",
    "import { value } from './value.js';\nexport const result = value;\n",
    20,
    20,
  );
  expect(parsed.express.crossFileMounts).toEqual([]);
  expect(parsed.express.routerExports).toEqual([]);
  expect(parsed.declarations.limitations).toEqual([]);
});

it("relaciona mount Express cross-file a import e export estáticos com Evidence", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(join(tmpdir(), "pie-express-cross-file-"));
  const stateRoot = await mkdtemp(
    join(tmpdir(), "pie-express-cross-file-state-"),
  );
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "src", "routes"), { recursive: true });
    await writeFile(
      join(root, "src", "main.ts"),
      "import express from 'express';\nimport api from './routes/api.js';\nconst app = express();\napp.use('/api', api);\n",
    );
    await writeFile(
      join(root, "src", "routes", "api.ts"),
      "import {Router as createRouter} from 'express';\nconst router = createRouter();\nrouter.get('/health', handler);\nexport {router as default};\n",
    );
    await exec("git", ["-C", root, "add", "."]);

    const snapshot = await discoverProject(
      policySchema.parse({
        repositoryRoot: root,
        profile: "OBSERVE",
        environment: "local",
      }),
      "00000000-0000-4000-8000-000000000001",
    );
    const source = snapshot.nodes.find((node) => node.path === "src/main.ts")!;
    const target = snapshot.nodes.find(
      (node) => node.path === "src/routes/api.ts",
    )!;
    expect(snapshot.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "express-ast",
          name: "GET /health",
          source: expect.objectContaining({ path: "src/routes/api.ts" }),
        }),
      ]),
    );
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: source.id,
          to: target.id,
          kind: "calls",
          confidence: "derived",
          evidenceIds: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
            expect.any(String),
          ]),
        }),
      ]),
    );
    const mountEdge = snapshot.edges.find(
      (edge) => edge.kind === "calls" && edge.from === source.id,
    )!;
    expect(mountEdge.evidenceIds).toHaveLength(3);
    const proofs = mountEdge.evidenceIds.map((id) =>
      snapshot.evidence.find((item) => item.id === id)!,
    );
    expect(proofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ path: "src/main.ts", line: 4 }),
          observation: expect.stringContaining('"/api"'),
        }),
        expect.objectContaining({
          source: expect.objectContaining({ path: "src/main.ts", line: 2 }),
          observation: expect.stringContaining("Import AST"),
        }),
        expect.objectContaining({
          source: expect.objectContaining({
            path: "src/routes/api.ts",
            line: 4,
          }),
          observation: expect.stringContaining("router export"),
        }),
      ]),
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const traced = traceSnapshot(snapshot, {
      snapshotId: snapshot.id,
      nodeId: source.id,
      direction: "both",
    });
    expect(
      traced.nodes.items.some(
        (node) =>
          node.path === "src/routes/api.ts" && node.label === "GET /health",
      ),
    ).toBe(true);

    const tampered = structuredClone(snapshot);
    const mountProof = tampered.evidence.find((item) =>
      item.observation.startsWith("Express AST cross-file router mount "),
    )!;
    mountProof.observation = mountProof.observation.replace(
      '"/api"',
      '"/admin"',
    );
    const { sealEvidence } = await import("../../src/pie/evidence.js");
    const { sha256: _previousDigest, ...payload } = mountProof;
    Object.assign(mountProof, sealEvidence(payload));
    expect(() => validateSnapshot(tampered)).toThrow(
      "mount Express cross-file sem Evidence consistente",
    );
    const store = await openStore(join(stateRoot, "pie.sqlite"), root);
    try {
      store.addProject(snapshot.projectId, root, "express-cross-file-fixture");
      expect(store.saveSnapshot(snapshot).id).toBe(snapshot.id);
      const restored = store.snapshot(snapshot.id);
      expect(restored.edges).toContainEqual(mountEdge);
      expect(validateSnapshot(restored).id).toBe(snapshot.id);
    } finally {
      store.close();
    }
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

it("não cria relação quando o import relativo não exporta um router literal", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(
    join(tmpdir(), "pie-express-cross-file-negative-"),
  );
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport handler from './handler.js';\nconst app = express();\napp.use('/api', handler);\n",
    );
    await writeFile(join(root, "handler.ts"), "export default () => null;\n");
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverProject(
      policySchema.parse({
        repositoryRoot: root,
        profile: "OBSERVE",
        environment: "local",
      }),
      "00000000-0000-4000-8000-000000000002",
    );
    expect(snapshot.edges.some((edge) => edge.kind === "calls")).toBe(false);
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "não foram resolvidos para um export de router único",
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});
