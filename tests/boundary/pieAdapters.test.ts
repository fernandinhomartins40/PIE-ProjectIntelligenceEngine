import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { discoverProject } from "../../src/pie/discovery.js";
import { readDeclarations } from "../../src/pie/adapters/declarations.js";
import { validateSnapshot } from "../../src/pie/snapshotIntegrity.js";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";
import { DatabaseSync } from "node:sqlite";
import { readCodeFacts } from "../../src/pie/codeFacts.js";

it("Next App Router usa exports AST, uma árvore e prova rastreável sem executar código", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-next-"));
  const external = await mkdtemp(join(tmpdir(), "pie-next-history-"));
  const store = await openStore(join(external, "pie.sqlite"), root);
  const service = new PieService(store);
  try {
    await exec("git", ["init", root]);
    const directory = join(root, "src", "app", "(shop)", "orders", "[id]");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "route.ts"),
      "import {handler} from './handler';\n// export function DELETE() {}\nexport { handler as POST };\nexport async function GET() { throw new Error('não executar'); }\n",
    );
    await writeFile(
      join(directory, "handler.ts"),
      "export const handler = () => null;",
    );
    await writeFile(
      join(root, "src", "app", "page.tsx"),
      "export default function Page(){return <main>Real source fixture</main>}",
    );
    await exec("git", ["-C", root, "add", "."]);
    const observed = await service.discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    expect(snapshot.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "next-app-convention",
          kind: "endpoint",
          name: "POST /orders/[id]",
          source: expect.objectContaining({ line: 3 }),
        }),
        expect.objectContaining({
          kind: "endpoint",
          name: "GET /orders/[id]",
          source: expect.objectContaining({ line: 4 }),
        }),
        expect.objectContaining({ kind: "page", name: "/" }),
      ]),
    );
    expect(snapshot.declarations).toHaveLength(3);
    expect(snapshot.edges).toHaveLength(1);
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const endpoint = snapshot.declarations.find((item) =>
      item.name.startsWith("GET"),
    )!;
    const proof = await service.evidence(endpoint.evidenceId);
    expect(proof).toMatchObject({
      method: "static",
      state: "unverified",
      source: { path: "src/app/(shop)/orders/[id]/route.ts", line: 4 },
    });
    const trace = await service.trace({
      snapshotId: snapshot.id,
      nodeId: endpoint.id,
    });
    expect(trace.edges.items.some((item) => item.kind === "declared_in")).toBe(
      true,
    );
    expect(trace.coverage.runtime).toBe(false);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

it("Next não confunde comentários, strings, tipos e nomes parecidos com rotas", () => {
  const source =
    "const example = 'export function DELETE() {}';\nexport type { GET } from './types';\nexport const POST = () => null;\nexport function HEAD() {}";
  expect(
    readCodeFacts("app/api/route.ts", source, 10, 1).declarations,
  ).toMatchObject({
    declarations: [{ name: "POST /api" }],
    limitations: expect.arrayContaining([expect.stringContaining("omitidas")]),
  });
  expect(
    readCodeFacts("notapp/api/route.ts", source, 10, 10).declarations
      .declarations,
  ).toEqual([]);
  expect(
    readCodeFacts("app/api/notroute.ts", source, 10, 10).declarations
      .declarations,
  ).toEqual([]);
  expect(
    readCodeFacts("app/api/route.tsx", source, 10, 10).declarations
      .declarations,
  ).toEqual([]);
  expect(
    readCodeFacts("app/page.tsx", "export default interface Example {}", 10, 10)
      .declarations.declarations,
  ).toEqual([]);
  for (const path of [
    "app/_private/route.ts",
    "app/@slot/page.tsx",
    "app/(.)modal/page.tsx",
  ])
    expect(
      readCodeFacts(path, source, 10, 10).declarations.declarations,
    ).toEqual([]);
  expect(() =>
    readCodeFacts("app/api/route.ts", "export const GET = {", 10, 10),
  ).toThrow();
});

const exec = promisify(execFile);

it("descobre stacks declaradas com fontes reais sem reter comandos, URLs ou secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-adapters-"));
  const dbRoot = await mkdtemp(join(tmpdir(), "pie-adapter-db-"));
  const store = await openStore(join(dbRoot, "pie.sqlite"), root);
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify(
        {
          dependencies: { react: "19.0.0" },
          scripts: { test: "TOKEN=DO_NOT_RETAIN run-tests" },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(root, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^12" } }),
    );
    await writeFile(
      join(root, "compose.yml"),
      "services:\n  web:\n    image: private-image\n    environment:\n      PASSWORD: DO_NOT_RETAIN\n    depends_on:\n      - db\n  db:\n    image: postgres\n",
    );
    await writeFile(
      join(root, "openapi.yaml"),
      "openapi: 3.1.0\nservers:\n  - url: https://DO_NOT_RETAIN.invalid\npaths:\n  /orders:\n    get:\n      responses: {}\n  /external:\n    $ref: https://DO_NOT_RETAIN.invalid/ref\n",
    );
    await writeFile(
      join(root, "schema.prisma"),
      '// model Ghost {\n// secret String\n// }\nmodel Order {\n  id String @id\n  note String @default("model Fake { wrong String }")\n}\n',
    );
    await exec("git", ["-C", root, "add", "."]);
    const run = await new PieService(store).discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(run.snapshot.id);
    expect(snapshot.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "node-manifest",
          kind: "dependency",
          name: "react",
        }),
        expect.objectContaining({
          adapter: "composer-manifest",
          name: "laravel/framework",
        }),
        expect.objectContaining({
          adapter: "compose",
          kind: "service_dependency",
          name: "db",
          parent: "web",
        }),
        expect.objectContaining({
          adapter: "openapi",
          kind: "endpoint",
          name: "GET /orders",
          source: expect.objectContaining({ line: 6 }),
        }),
        expect.objectContaining({
          adapter: "prisma-schema",
          kind: "field",
          name: "id",
          parent: "Order",
          source: expect.objectContaining({ line: 5 }),
        }),
      ]),
    );
    expect(
      snapshot.declarations.some((item) =>
        ["Ghost", "Fake"].includes(item.name),
      ),
    ).toBe(false);
    expect(
      snapshot.declarations.every((item) => item.state === "unverified"),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("DO_NOT_RETAIN");
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    expect(() =>
      validateSnapshot({
        ...snapshot,
        declarations: [
          { ...snapshot.declarations[0], evidenceId: randomUUID() },
        ],
      }),
    ).toThrow("proveniência");
    const service = new PieService(store);
    const page = await service.declarations(snapshot.id, { limit: 2 });
    expect(page.declarations.nextOffset).toBe(2);
    expect(page.declarations.total).toBe(snapshot.declarations.length);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
    await rm(dbRoot, { recursive: true, force: true });
  }
});

it("mantém falhas, limites e sintaxes não suportadas explícitas sem declarações inventadas", async () => {
  expect(() =>
    readDeclarations("compose.yml", "services: [broken", 10),
  ).toThrow();
  expect(() =>
    readDeclarations("openapi.yaml", "openapi: 2.0\npaths: {}", 10),
  ).toThrow();
  expect(() =>
    readDeclarations(
      "schema.prisma",
      "/* unterminated model Fake {\n field String\n}",
      10,
    ),
  ).toThrow();
  const limited = readDeclarations(
    "package.json",
    '{"dependencies":{"a":"1","b":"2"}}',
    1,
  )!;
  expect(limited.declarations).toHaveLength(1);
  const invalidName = readDeclarations(
    "package.json",
    '{"scripts":{"":"ignored"}}',
    10,
  )!;
  expect(invalidName.declarations).toHaveLength(0);
  expect(
    invalidName.limitations.some((value) => value.includes("identificadores")),
  ).toBe(true);
  expect(limited.limitations.some((value) => value.includes("omitidas"))).toBe(
    true,
  );
  const root = await mkdtemp(join(tmpdir(), "pie-invalid-adapter-"));
  try {
    await exec("git", ["init", root]);
    await writeFile(join(root, "package.json"), "{broken");
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverProject(
      { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
      randomUUID(),
    );
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.declarations).toHaveLength(0);
    expect(
      snapshot.coverage.limitations.some((value) =>
        value.includes("não analisado"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserva leitura e idempotência de snapshots históricos sem o campo declarações", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-legacy-"));
  const dbRoot = await mkdtemp(join(tmpdir(), "pie-legacy-db-"));
  const path = join(dbRoot, "state.sqlite");
  const store = await openStore(path, root);
  try {
    await exec("git", ["init", root]);
    await writeFile(join(root, "index.ts"), "export const value = 1;");
    await exec("git", ["-C", root, "add", "."]);
    const project = store.addProject(randomUUID(), root, "legacy-fixture");
    const snapshot = await discoverProject(
      { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
      project.id,
    );
    const { declarations, ...legacy } = snapshot;
    expect(declarations).toHaveLength(0);
    const writer = new DatabaseSync(path);
    try {
      writer
        .prepare(
          "INSERT INTO pie_snapshots(id,project_id,created_at,payload) VALUES(?,?,?,?)",
        )
        .run(
          snapshot.id,
          project.id,
          snapshot.createdAt,
          JSON.stringify(legacy),
        );
      for (const proof of snapshot.evidence)
        writer
          .prepare(
            "INSERT INTO pie_evidence(id,snapshot_id,payload) VALUES(?,?,?)",
          )
          .run(proof.id, snapshot.id, JSON.stringify(proof));
    } finally {
      writer.close();
    }
    const restored = store.snapshot(snapshot.id);
    expect(restored.declarations).toEqual([]);
    expect(store.saveSnapshot(restored).id).toBe(snapshot.id);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
    await rm(dbRoot, { recursive: true, force: true });
  }
});
