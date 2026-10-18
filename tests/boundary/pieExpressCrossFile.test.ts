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

it("compõe mounts Express CommonJS literais e module.exports com Evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-express-commonjs-"));
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "main.cjs"),
      'const express = require("express");\nconst app = express();\nconst api = require("./routes/api.cjs");\napp.use("/api", api);\n',
    );
    await writeFile(
      join(root, "routes", "api.cjs"),
      'const express = require("express");\nconst router = express.Router();\nrouter.get("/health", handler);\nmodule.exports = router;\n',
    );
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverFixture(root);
    const sourceId = snapshot.nodes.find(
      (node) => node.path === "main.cjs",
    )!.id;
    const targetId = snapshot.nodes.find(
      (node) => node.path === "routes/api.cjs",
    )!.id;
    expect(snapshot.declarations).toContainEqual(
      expect.objectContaining({
        name: "GET /api/health",
        source: expect.objectContaining({ path: "routes/api.cjs" }),
        derivations: expect.arrayContaining([
          expect.objectContaining({ sourcePath: "main.cjs", prefix: "/api" }),
        ]),
      }),
    );
    const mount = snapshot.edges.find(
      (edge) => edge.kind === "calls" && edge.from === sourceId,
    )!;
    expect(mount.to).toBe(targetId);
    const proofs = mount.evidenceIds.map((id) =>
      snapshot.evidence.find((item) => item.id === id)!,
    );
    expect(proofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ path: "main.cjs", line: 3 }),
          observation: expect.stringContaining("syntax=commonjs"),
        }),
        expect.objectContaining({
          source: expect.objectContaining({ path: "main.cjs", line: 4 }),
          observation: expect.stringContaining("require CommonJS"),
        }),
        expect.objectContaining({
          source: expect.objectContaining({ path: "routes/api.cjs", line: 4 }),
          observation: expect.stringContaining("module.exports estático"),
        }),
      ]),
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const trace = traceSnapshot(snapshot, {
      snapshotId: snapshot.id,
      nodeId: sourceId,
      direction: "both",
    });
    expect(
      trace.nodes.items.some(
        (node) =>
          node.path === "routes/api.cjs" && node.label === "GET /api/health",
      ),
    ).toBe(true);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});

it("não compõe Express entre import ESM e export CommonJS", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-express-mixed-modules-"));
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport api from './routes/api.cjs';\nconst app = express();\napp.use('/api', api);\n",
    );
    await writeFile(
      join(root, "routes", "api.cjs"),
      'const express = require("express");\nconst router = express.Router();\nrouter.get("/health", handler);\nmodule.exports = router;\n',
    );
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverFixture(root);
    expect(snapshot.edges.filter((edge) => edge.kind === "calls")).toEqual([]);
    expect(
      snapshot.declarations.some((fact) => fact.name === "GET /api/health"),
    ).toBe(false);
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "mounts Express importados não foram resolvidos",
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});

async function createCrossFileFixture() {
  const root = await mkdtemp(join(tmpdir(), "pie-express-cross-file-"));
  const stateRoot = await mkdtemp(
    join(tmpdir(), "pie-express-cross-file-state-"),
  );
  await exec("git", ["init", root]);
  await mkdir(join(root, "src", "routes"), { recursive: true });
  await writeFile(
    join(root, "src", "main.ts"),
    "import express from 'express';\nimport api from './routes/api.js';\nconst app = express();\napp.use('/api', api);\napp.use('/admin', api);\n",
  );
  await writeFile(
    join(root, "src", "routes", "api.ts"),
    "import {Router as createRouter} from 'express';\nconst router = createRouter();\nrouter.get('/health', handler);\nexport {router as default};\n",
  );
  await exec("git", ["-C", root, "add", "."]);
  return { root, stateRoot };
}

async function discoverFixture(root: string) {
  return discoverProject(
    policySchema.parse({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    }),
    "00000000-0000-4000-8000-000000000001",
  );
}

function expectComposedRoutes(
  snapshot: Awaited<ReturnType<typeof discoverFixture>>,
) {
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        adapter: "express-ast",
        name: "GET /api/health",
        provenanceVersion: 3,
        source: expect.objectContaining({ path: "src/routes/api.ts" }),
        derivations: expect.arrayContaining([
          expect.objectContaining({
            sourcePath: "src/main.ts",
            line: 4,
            prefix: "/api",
          }),
        ]),
      }),
      expect.objectContaining({
        adapter: "express-ast",
        name: "GET /admin/health",
        provenanceVersion: 3,
        source: expect.objectContaining({ path: "src/routes/api.ts" }),
        derivations: expect.arrayContaining([
          expect.objectContaining({
            sourcePath: "src/main.ts",
            line: 5,
            prefix: "/admin",
          }),
        ]),
      }),
    ]),
  );
}

function expectMountEvidence(
  snapshot: Awaited<ReturnType<typeof discoverFixture>>,
  sourceId: string,
  targetId: string,
) {
  const mountEdge = snapshot.edges.find(
    (edge) => edge.kind === "calls" && edge.from === sourceId,
  )!;
  expect(mountEdge).toMatchObject({
    to: targetId,
    confidence: "derived",
    evidenceIds: expect.any(Array),
  });
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
        source: expect.objectContaining({ path: "src/routes/api.ts", line: 4 }),
        observation: expect.stringContaining("router export"),
      }),
    ]),
  );
  return mountEdge;
}

async function expectTamperingRejected(
  snapshot: Awaited<ReturnType<typeof discoverFixture>>,
) {
  const tampered = structuredClone(snapshot);
  const mountProof = tampered.evidence.find((item) =>
    item.observation.startsWith("Express AST cross-file router mount "),
  )!;
  mountProof.observation = mountProof.observation.replace('"/api"', '"/admin"');
  const { sealEvidence } = await import("../../src/pie/evidence.js");
  const { sha256: _previousDigest, ...payload } = mountProof;
  Object.assign(mountProof, sealEvidence(payload));
  expect(() => validateSnapshot(tampered)).toThrow(
    "mount Express cross-file sem Evidence consistente",
  );
}

async function expectSnapshotPersisted(
  snapshot: Awaited<ReturnType<typeof discoverFixture>>,
  root: string,
  stateRoot: string,
) {
  const edge = snapshot.edges.find((item) => item.kind === "calls")!;
  const store = await openStore(join(stateRoot, "pie.sqlite"), root);
  try {
    store.addProject(snapshot.projectId, root, "express-cross-file-fixture");
    expect(store.saveSnapshot(snapshot).id).toBe(snapshot.id);
    const restored = store.snapshot(snapshot.id);
    expect(restored.edges).toContainEqual(edge);
    expect(validateSnapshot(restored).id).toBe(snapshot.id);
  } finally {
    store.close();
  }
}

it("relaciona mount Express cross-file a import e export estáticos com Evidence", async () => {
  clearAnalysisCache();
  const { root, stateRoot } = await createCrossFileFixture();
  try {
    const snapshot = await discoverFixture(root);
    const source = snapshot.nodes.find((node) => node.path === "src/main.ts")!;
    const target = snapshot.nodes.find(
      (node) => node.path === "src/routes/api.ts",
    )!;
    expectComposedRoutes(snapshot);
    const mountEdge = expectMountEvidence(snapshot, source.id, target.id);
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const importEdge = snapshot.edges.find(
      (edge) => edge.kind === "depends" && edge.from === source.id,
    )!;
    const importProofId = importEdge.evidenceIds[0]!;
    expect(() =>
      validateSnapshot({
        ...snapshot,
        edges: snapshot.edges.map((edge) =>
          edge.id === importEdge.id
            ? { ...edge, evidenceIds: [importProofId, importProofId] }
            : edge,
        ),
      }),
    ).toThrow("Evidence de imports");
    const traced = traceSnapshot(snapshot, {
      snapshotId: snapshot.id,
      nodeId: source.id,
      direction: "both",
    });
    expect(
      traced.nodes.items.some(
        (node) =>
          node.path === "src/routes/api.ts" && node.label === "GET /api/health",
      ),
    ).toBe(true);
    const endpoint = snapshot.declarations.find(
      (fact) => fact.name === "GET /api/health",
    )!;
    const routeDerivation = snapshot.evidence.find(
      (item) =>
        endpoint.derivations.some(
          (derivation) => derivation.evidenceId === item.id,
        ) && item.source.path === "src/main.ts",
    )!;
    expect(routeDerivation).toMatchObject({
      source: { path: "src/main.ts", line: 4 },
      observation: expect.stringContaining('"src/main.ts"'),
    });
    await expectTamperingRejected(snapshot);
    await expectSnapshotPersisted(snapshot, root, stateRoot);
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

it("does not resolve a cyclic static router re-export chain", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(join(tmpdir(), "pie-express-reexport-cycle-"));
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport api from './a.js';\nconst app = express();\napp.use('/api', api);\n",
    );
    await writeFile(join(root, "a.ts"), "export {default} from './b.js';\n");
    await writeFile(join(root, "b.ts"), "export {default} from './a.js';\n");
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverFixture(root);
    expect(snapshot.edges.some((edge) => edge.kind === "calls")).toBe(false);
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "mounts Express importados não foram resolvidos para um export de router único",
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});

it("composes local router mounts before the exported router prefix", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(join(tmpdir(), "pie-express-nested-cross-file-"));
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport api from './routes/api.js';\nconst app = express();\napp.use('/api', api);\n",
    );
    await writeFile(
      join(root, "routes", "api.ts"),
      "import {Router as createRouter} from 'express';\nconst router = createRouter();\nconst nested = createRouter();\nnested.get('/health', handler);\nrouter.use('/v2', nested);\nexport {router as default};\n",
    );
    await exec("git", ["-C", root, "add", "."]);

    const snapshot = await discoverProject(
      policySchema.parse({
        repositoryRoot: root,
        profile: "OBSERVE",
        environment: "local",
      }),
      "00000000-0000-4000-8000-000000000003",
    );
    const endpoint = snapshot.declarations.find(
      (fact) => fact.name === "GET /api/v2/health",
    );
    expect(endpoint).toMatchObject({
      parent: "nested",
      derivations: expect.arrayContaining([
        expect.objectContaining({ line: 5, prefix: "/v2" }),
        expect.objectContaining({
          line: 4,
          sourcePath: "main.ts",
          prefix: "/api",
        }),
      ]),
    });
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps cyclic router mounts uncomposed across files", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(join(tmpdir(), "pie-express-cycle-cross-file-"));
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport api from './api.js';\nconst app = express();\napp.use('/api', api);\n",
    );
    await writeFile(
      join(root, "api.ts"),
      "import {Router as createRouter} from 'express';\nconst router = createRouter();\nconst nested = createRouter();\nrouter.get('/health', handler);\nrouter.use('/nested', nested);\nnested.use('/root', router);\nexport default router;\n",
    );
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverFixture(root);
    expect(snapshot.declarations.map((fact) => fact.name)).toContain(
      "GET /health",
    );
    expect(snapshot.declarations.map((fact) => fact.name)).not.toContain(
      "GET /api/health",
    );
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "mounts cíclicos não foram compostos cross-file",
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});

it("resolves a static router re-export through its import chain", async () => {
  clearAnalysisCache();
  const root = await mkdtemp(join(tmpdir(), "pie-express-reexport-"));
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "main.ts"),
      "import express from 'express';\nimport {api as routeApi} from './routes/index.js';\nconst app = express();\napp.use('/api', routeApi);\n",
    );
    await writeFile(
      join(root, "routes", "index.ts"),
      "export {api} from './router.js';\n",
    );
    await writeFile(
      join(root, "routes", "router.ts"),
      "export {default as api} from './health.js';\n",
    );
    await writeFile(
      join(root, "routes", "health.ts"),
      "import {Router as createRouter} from 'express';\nconst router = createRouter();\nrouter.get('/health', handler);\nexport default router;\n",
    );
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverFixture(root);
    expect(snapshot.declarations).toContainEqual(
      expect.objectContaining({
        name: "GET /api/health",
        source: expect.objectContaining({ path: "routes/health.ts" }),
        derivations: expect.arrayContaining([
          expect.objectContaining({ sourcePath: "main.ts", prefix: "/api" }),
        ]),
      }),
    );
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calls",
          from: snapshot.nodes.find((node) => node.path === "main.ts")?.id,
          to: snapshot.nodes.find((node) => node.path === "routes/index.ts")
            ?.id,
        }),
        expect.objectContaining({
          kind: "depends",
          from: snapshot.nodes.find((node) => node.path === "routes/index.ts")
            ?.id,
          to: snapshot.nodes.find((node) => node.path === "routes/router.ts")
            ?.id,
        }),
        expect.objectContaining({
          kind: "depends",
          from: snapshot.nodes.find((node) => node.path === "routes/router.ts")
            ?.id,
          to: snapshot.nodes.find((node) => node.path === "routes/health.ts")
            ?.id,
        }),
      ]),
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const traced = traceSnapshot(snapshot, {
      snapshotId: snapshot.id,
      nodeId: snapshot.nodes.find((node) => node.path === "main.ts")!.id,
      direction: "both",
    });
    expect(
      traced.nodes.items.some(
        (node) =>
          node.path === "routes/health.ts" && node.label === "GET /api/health",
      ),
    ).toBe(true);
  } finally {
    clearAnalysisCache();
    await rm(root, { recursive: true, force: true });
  }
});
