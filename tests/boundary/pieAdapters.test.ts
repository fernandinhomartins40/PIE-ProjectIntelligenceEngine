import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { discoverProject } from "../../src/pie/discovery.js";
import {
  parseComposeServiceSettingName,
  parseDockerfileInstructionName,
} from "../../src/pie/adapters/contracts.js";
import {
  readDeclarations,
  readDeclarationsResult,
} from "../../src/pie/adapters/declarations.js";
import { validateSnapshot } from "../../src/pie/snapshotIntegrity.js";
import { declarationIdentity } from "../../src/pie/adapters/identity.js";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";
import { DatabaseSync } from "node:sqlite";
import { readCodeFacts, readCodeFactsResult } from "../../src/pie/codeFacts.js";
import { nginxDirectives } from "../../src/pie/adapters/nginxSyntax.js";
import { renderSnapshot } from "../../src/pie/reports.js";
import type { Snapshot } from "../../src/pie/contracts.js";
import {
  assessFunctional,
  assessFunctionalResult,
} from "../../src/pie/functional.js";

function functionalResultFailures(snapshot: Snapshot) {
  const policy = {
    profile: "OBSERVE" as const,
    environment: "local" as const,
    repositoryRoot: snapshot.root,
  };
  expect(
    assessFunctionalResult(snapshot, { snapshotId: randomUUID() }, policy),
  ).toEqual({
    ok: false,
    error: { kind: "policy_denied", reason: "snapshot_mismatch" },
  });
  expect(
    assessFunctionalResult(
      snapshot,
      { snapshotId: snapshot.id, modulePath: "../outside" },
      policy,
    ),
  ).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  expect(
    assessFunctionalResult(
      { ...snapshot, id: "invalid" },
      { snapshotId: snapshot.id },
      policy,
    ),
  ).toEqual({ ok: false, error: { kind: "invalid_snapshot" } });
  expect(
    assessFunctionalResult(
      { ...snapshot, treeDigest: "0".repeat(64) },
      { snapshotId: snapshot.id },
      policy,
    ),
  ).toEqual({ ok: false, error: { kind: "invalid_snapshot" } });
}

function expectNextDeclarations(snapshot: Snapshot) {
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
      expect.objectContaining({
        adapter: "next-pages-convention",
        kind: "page",
        name: "/home",
        source: expect.objectContaining({ path: "pages/home.tsx" }),
      }),
      expect.objectContaining({
        adapter: "next-pages-convention",
        kind: "endpoint",
        name: "API handler /api/orders",
        source: expect.objectContaining({ path: "pages/api/orders.ts" }),
      }),
      expect.objectContaining({
        adapter: "next-pages-convention",
        kind: "page",
        name: "/products/[id]",
        source: expect.objectContaining({
          path: "pages/products/[id]/index.tsx",
        }),
      }),
    ]),
  );
  expect(snapshot.declarations).toHaveLength(6);
  expect(
    snapshot.declarations.some(
      (item) =>
        item.source.path === "pages/_app.tsx" ||
        item.source.path === "pages/api/missing.ts",
    ),
  ).toBe(false);
}

function expectProductEvidenceGaps(
  product: Awaited<ReturnType<PieService["product"]>>,
) {
  expect(product).toMatchObject({
    engine: "product",
    state: "insufficient_evidence",
    scope: { declaredTargets: 2, examinedTargets: 1 },
    opportunities: {
      total: 2,
      nextOffset: 1,
      items: [
        {
          journey: "unobserved",
          state: "insufficient_evidence",
          movements: {
            eliminate: "not_assessed",
            combine: "not_assessed",
            automate: "not_assessed",
            anticipate: "not_assessed",
            create: "not_assessed",
          },
          evidenceIds: expect.arrayContaining([expect.any(String)]),
          missingEvidence: expect.arrayContaining([
            expect.stringContaining("Jornada observada"),
          ]),
        },
      ],
    },
    coverage: { observedJourneys: false, runtime: false },
  });
}

it("associa lacunas de produto à declaração/evidência sem criar uma jornada", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-product-next-"));
  const external = await mkdtemp(join(tmpdir(), "pie-product-history-"));
  const store = await openStore(join(external, "pie.sqlite"), root);
  const service = new PieService(store);
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "app", "page.tsx"),
      "export default function Page(){return null}",
    );
    await writeFile(
      join(root, "app", "route.ts"),
      "export function GET(){return null}",
    );
    await exec("git", ["-C", root, "add", "."]);
    const discovered = await service.discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(discovered.snapshot.id);
    expect(snapshot.declarations).toHaveLength(2);
    expectProductEvidenceGaps(
      await service.product({
        snapshotId: snapshot.id,
        limit: 1,
      }),
    );
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

it("Next App Router usa exports AST, uma árvore e prova rastreável sem executar código", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-next-"));
  const external = await mkdtemp(join(tmpdir(), "pie-next-history-"));
  const store = await openStore(join(external, "pie.sqlite"), root);
  const service = new PieService(store);
  try {
    await exec("git", ["init", root]);
    const directory = join(root, "src", "app", "(shop)", "orders", "[id]");
    await mkdir(directory, { recursive: true });
    await mkdir(join(root, "pages", "api"), { recursive: true });
    await mkdir(join(root, "pages", "products", "[id]"), {
      recursive: true,
    });
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
    await writeFile(
      join(root, "pages", "home.tsx"),
      "export default function Home(){return null}",
    );
    await writeFile(
      join(root, "pages", "api", "orders.ts"),
      "export default function handler() { return null; }",
    );
    await writeFile(
      join(root, "pages", "products", "[id]", "index.tsx"),
      "export default function Product(){return null}",
    );
    await writeFile(
      join(root, "pages", "_app.tsx"),
      "export default function App(){return null}",
    );
    await writeFile(join(root, "pages", "api", "missing.ts"), "export {};");
    await exec("git", ["-C", root, "add", "."]);
    const observed = await service.discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    expectNextDeclarations(snapshot);
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
    const review = await service.functional({
      snapshotId: snapshot.id,
      modulePath: "src/app",
      limit: 1,
    });
    expect(review).toMatchObject({
      engine: "functional",
      state: "unverified",
      scope: { declaredTargets: 3, examinedTargets: 1 },
      findings: {
        total: 3,
        nextOffset: 1,
        items: [{ state: "unverified", severity: "info", owner: null }],
      },
      coverage: { runtime: false, journeyVerification: false },
    });
    const next = await service.functional({
      snapshotId: snapshot.id,
      modulePath: "src/app",
      limit: 1,
      offset: 1,
    });
    expect(next.findings.items[0]!.id).not.toBe(review.findings.items[0]!.id);
    expect(next.scope).toEqual({
      modulePath: "src/app",
      declaredTargets: 3,
      examinedTargets: 1,
    });
    expect(
      (
        await service.functional({
          snapshotId: snapshot.id,
          modulePath: "missing",
        })
      ).findings.total,
    ).toBe(0);
    await expect(
      service.functional({ snapshotId: snapshot.id, modulePath: "../src" }),
    ).rejects.toThrow("canônico");
    expect(() =>
      assessFunctional(
        snapshot,
        { snapshotId: randomUUID() },
        {
          profile: "OBSERVE",
          environment: "local",
          repositoryRoot: snapshot.root,
        },
      ),
    ).toThrow("correspondentes");
    functionalResultFailures(snapshot);
    expect(() =>
      assessFunctional(
        snapshot,
        { snapshotId: snapshot.id },
        {
          profile: "VERIFY",
          allowTargetExecution: true,
          environment: "local",
          repositoryRoot: snapshot.root,
        },
      ),
    ).toThrow("OBSERVE");
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
  expect(
    readCodeFacts(
      "pages/api/limited.ts",
      "export default function handler() {}",
      10,
      0,
    ).declarations,
  ).toMatchObject({
    declarations: [],
    limitations: expect.arrayContaining([expect.stringContaining("omitida")]),
  });
  expect(
    readCodeFacts(
      "packages/web/pages/api/[...slug].mts",
      "export default function handler() {}",
      10,
      10,
    ).declarations.declarations,
  ).toMatchObject([
    {
      adapter: "next-pages-convention",
      kind: "endpoint",
      name: "API handler /api/[...slug]",
    },
  ]);
  expect(
    readCodeFacts(
      "pages/types.d.cts",
      "export default function handler() {}",
      10,
      10,
    ).declarations.declarations,
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
  expect(
    readCodeFactsResult("app/api/route.ts", "export const GET = {", 10, 10),
  ).toEqual({
    ok: false,
    error: { kind: "invalid_syntax", path: "app/api/route.ts" },
  });
});

const exec = promisify(execFile);

it("Nginx mantém limites de tokens, aspas, comentários, variáveis e blocos", () => {
  const source =
    '# listen 9999;\nhttp { server {\n listen 443 ssl;\n location ~ "^/a{2}#b$" { proxy_pass http://${backend}/path; }\n include "conf with space/*.conf";\n server_name example.test;\n} }';
  const parsed = readDeclarations("deploy/nginx/site.conf", source, 20)!;
  expect(
    parsed.declarations.map((item) => [item.kind, JSON.parse(item.name)]),
  ).toEqual([
    ["config_directive", ["listen", "443", "ssl"]],
    ["location", ["location", "~", "^/a{2}#b$"]],
    ["config_directive", ["proxy_pass", "http://${backend}/path"]],
    ["config_directive", ["include", "conf with space/*.conf"]],
    ["config_directive", ["server_name", "example.test"]],
  ]);
  expect(parsed.declarations[2]).toMatchObject({
    line: 4,
    parent: JSON.stringify([
      { directive: "http", line: 2 },
      { directive: "server", line: 2 },
      { directive: "location", line: 4 },
    ]),
  });
  expect(parsed.limitations.join(" ")).toContain("include não expandidas");
  expect(readDeclarations("nginx.conf", source, 1)).toMatchObject({
    declarations: [expect.objectContaining({ name: '["listen","443","ssl"]' })],
    limitations: expect.arrayContaining([expect.stringContaining("omitidas")]),
  });
  expect(
    [
      ...nginxDirectives('server { location / { proxy_pass "http://a;#b"; } }'),
    ].at(-1)?.words,
  ).toEqual(["proxy_pass", "http://a;#b"]);
  for (const malformed of [
    "server { listen 80;",
    'server { listen "80; }',
    "listen 80",
    "}",
    "server { ; }",
    "proxy_pass http://${unfinished;",
  ])
    expect(() => readDeclarations("nginx.conf", malformed, 10)).toThrow();
  expect(() =>
    readDeclarations("nginx.conf", "a {".repeat(129) + "}".repeat(129), 10),
  ).toThrow();
  expect(readDeclarations("unrelated.conf", source, 10)).toBeNull();
  expect(
    [...nginxDirectives("proxy_pass http://backend/path};")][0]?.words,
  ).toEqual(["proxy_pass", "http://backend/path}"]);
  expect(
    [...nginxDirectives('if ($uri = "/a") { proxy_pass http://backend; }')][0]
      ?.words,
  ).toEqual(["if", "($uri", "=", "/a", ")"]);
  expect(
    readDeclarations(
      "nginx.conf",
      "proxy_pass http://user:password@backend:3000/path?choice=1;",
      10,
    )?.declarations[0]?.name,
  ).toBe('["proxy_pass","http://[REDACTED]@backend:3000/path?choice=1"]');
  expect(
    [
      ...nginxDirectives(
        String.raw`proxy_pass http://backend/path#fragment; location ~ "\.php$" { fastcgi_pass unix:/run/php.sock; }`,
      ),
    ].map((item) => item.words),
  ).toEqual([
    ["proxy_pass", "http://backend/path#fragment"],
    ["location", "~", String.raw`\.php$`],
    ["fastcgi_pass", "unix:/run/php.sock"],
  ]);
  expect(() => [...nginxDirectives('server_name "example"suffix;')]).toThrow(
    "separator",
  );
});

it("Nginx preserva fatos estáticos adicionais de recursos, TLS e logs", () => {
  const source = [
    "worker_processes auto;",
    "events { worker_connections 1024; }",
    "http {",
    "  client_max_body_size 8m;",
    "  keepalive_timeout 30s;",
    "  server {",
    "    root /srv/www;",
    "    ssl_protocols TLSv1.2 TLSv1.3;",
    "    ssl_certificate /etc/nginx/cert.pem;",
    "    ssl_certificate_key /etc/nginx/key.pem;",
    "    access_log /var/log/nginx/access.log;",
    "    error_log /var/log/nginx/error.log;",
    "  }",
    "}",
  ].join("\n");
  const parsed = readDeclarations("nginx.conf", source, 50)!;
  const directives = parsed.declarations.map((item) => JSON.parse(item.name));
  expect(directives).toEqual([
    ["worker_processes", "auto"],
    ["worker_connections", "1024"],
    ["client_max_body_size", "8m"],
    ["keepalive_timeout", "30s"],
    ["root", "/srv/www"],
    ["ssl_protocols", "TLSv1.2", "TLSv1.3"],
    ["ssl_certificate", "/etc/nginx/cert.pem"],
    ["ssl_certificate_key", "/etc/nginx/key.pem"],
    ["access_log", "/var/log/nginx/access.log"],
    ["error_log", "/var/log/nginx/error.log"],
  ]);
  expect(parsed.declarations.map((item) => item.line)).toEqual([
    1, 2, 4, 5, 7, 8, 9, 10, 11, 12,
  ]);
});

it("Compose retém imagem/portas/restart e apenas presença do healthcheck", () => {
  const source = [
    "services:",
    "  api:",
    "    image: node:24-alpine",
    "    ports:",
    '      - "127.0.0.1:8080:3000"',
    "    restart: unless-stopped",
    "    healthcheck:",
    '      test: ["CMD", "echo", "DO_NOT_RETAIN"]',
    "    build:",
    "      context: backend",
    "      dockerfile: Dockerfile.prod",
    "      args:",
    "        TOKEN: DO_NOT_RETAIN_BUILD_ARG",
    "    volumes:",
    '      - "data:/var/lib/app:ro"',
    "      - type: bind",
    "        source: ./config",
    "        target: /etc/app",
    "    deploy:",
    "      replicas: 2",
    "      resources:",
    "        limits:",
    '          cpus: "0.50"',
    "          memory: 512M",
    "          pids: 128",
    "        reservations:",
    '          cpus: "0.25"',
    "          memory: 256M",
    "          pids: 64",
    "volumes:",
    "  data:",
    "    external: true",
  ].join("\n");
  const parsed = readDeclarations("compose.yaml", source, 20)!;
  const settings = parsed.declarations.flatMap((declaration) => {
    const value = parseComposeServiceSettingName(declaration.name);
    return value
      ? [{ ...value, parent: declaration.parent, line: declaration.line }]
      : [];
  });
  expect(settings).toEqual(
    expect.arrayContaining([
      { key: "image", value: "node:24-alpine", parent: "api", line: 3 },
      {
        key: "port",
        value: "127.0.0.1:8080:3000",
        parent: "api",
        line: 4,
      },
      { key: "restart", value: "unless-stopped", parent: "api", line: 6 },
      { key: "healthcheck", value: "declared", parent: "api", line: 7 },
      {
        key: "volume_mount",
        value: "data:/var/lib/app:ro",
        parent: "api",
        line: 15,
      },
      {
        key: "volume_mount",
        value: JSON.stringify({
          type: "bind",
          source: "./config",
          target: "/etc/app",
        }),
        parent: "api",
        line: 16,
      },
      {
        key: "volume_definition",
        value: JSON.stringify({ external: true }),
        parent: "data",
        line: 31,
      },
      { key: "build_context", value: "backend", parent: "api", line: 10 },
      {
        key: "build_dockerfile",
        value: "Dockerfile.prod",
        parent: "api",
        line: 11,
      },
      { key: "replicas", value: "2", parent: "api", line: 20 },
      { key: "cpus_limit", value: "0.50", parent: "api", line: 23 },
      { key: "memory_limit", value: "512M", parent: "api", line: 24 },
      { key: "pids_limit", value: "128", parent: "api", line: 25 },
      { key: "cpus_reservation", value: "0.25", parent: "api", line: 27 },
      { key: "memory_reservation", value: "256M", parent: "api", line: 28 },
      { key: "pids_reservation", value: "64", parent: "api", line: 29 },
    ]),
  );
  expect(JSON.stringify(settings)).not.toContain("DO_NOT_RETAIN");
  expect(JSON.stringify(settings)).not.toContain("DO_NOT_RETAIN_BUILD_ARG");
});

it("Compose redige autenticação em contexto remoto e não retém Dockerfile inline", () => {
  const parsed = readDeclarations(
    "compose.yaml",
    [
      "services:",
      "  remote:",
      "    build: https://user:secret@example.test/repo.git",
      "  inline:",
      "    build:",
      "      context: .",
      '      dockerfile_inline: "FROM alpine\\nRUN echo NEVER_RETAIN_INLINE"',
    ].join("\n"),
    20,
  )!;
  const settings = parsed.declarations.flatMap((declaration) => {
    const value = parseComposeServiceSettingName(declaration.name);
    return value ? [value] : [];
  });
  expect(settings).toContainEqual({
    key: "build_context",
    value: "https://[REDACTED]@example.test/repo.git",
  });
  expect(settings).toContainEqual({ key: "build_inline", value: "declared" });
  expect(JSON.stringify(parsed)).not.toContain("user:secret@");
  expect(JSON.stringify(parsed)).not.toContain("NEVER_RETAIN_INLINE");
  expect(JSON.stringify(parsed)).not.toContain("FROM alpine");
});

it("Compose expõe nomes de ambiente e caminhos env_file sem reter valores", () => {
  const parsed = readDeclarations(
    "compose.yaml",
    [
      "services:",
      "  api:",
      "    environment:",
      "      API_KEY: DO_NOT_RETAIN_SECRET_VALUE",
      '      PORT: "3000"',
      "    env_file:",
      "      - .env.local",
      "      - path: secrets/runtime.env",
      "        required: false",
    ].join("\n"),
    20,
  )!;
  const settings = parsed.declarations.flatMap((fact) => {
    const setting = parseComposeServiceSettingName(fact.name);
    return setting ? [{ ...setting, line: fact.line }] : [];
  });
  expect(settings).toEqual(
    expect.arrayContaining([
      { key: "environment_key", value: "API_KEY", line: 4 },
      { key: "environment_key", value: "PORT", line: 5 },
      { key: "env_file", value: ".env.local", line: 7 },
      { key: "env_file", value: "secrets/runtime.env", line: 8 },
    ]),
  );
  expect(JSON.stringify(parsed)).not.toContain("DO_NOT_RETAIN_SECRET_VALUE");
});

it("Dockerfile registra instruções estáticas sem reter valores de ARG/ENV ou comandos", () => {
  const parsed = readDeclarations(
    "app/Dockerfile.api",
    [
      "# escape=`",
      "FROM --platform=$BUILDPLATFORM node:24-alpine AS base",
      "ARG TOKEN=DO_NOT_RETAIN_ARG",
      "ENV PASSWORD=DO_NOT_RETAIN_ENV FEATURE=enabled",
      "WORKDIR /app",
      "RUN echo first `",
      "    && echo DO_NOT_RETAIN_CONTINUED",
      "COPY <<EOF /app/notes",
      "FROM fake:tag",
      "EOF",
      "RUN <<EOF",
      "ENV INNER_SECRET=DO_NOT_RETAIN_HEREDOC",
      "EOF",
      "EXPOSE 3000 8080/tcp",
      "USER node",
      "FROM alpine AS runtime",
      'VOLUME ["/data", "/cache"]',
      'CMD ["node", "DO_NOT_RETAIN_COMMAND"]',
    ].join("\n"),
    100,
  )!;
  const facts = parsed.declarations.map((declaration) => ({
    instruction: parseDockerfileInstructionName(declaration.name),
    line: declaration.line,
    parent: declaration.parent,
  }));
  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        instruction: { instruction: "FROM", stage: 0, value: "node:24-alpine" },
        line: 2,
        parent: "stage:0",
      }),
      expect.objectContaining({
        instruction: { instruction: "ARG", stage: 0, value: "TOKEN" },
      }),
      expect.objectContaining({
        instruction: { instruction: "ENV", stage: 0, value: "PASSWORD" },
      }),
      expect.objectContaining({
        instruction: { instruction: "WORKDIR", stage: 0, value: "/app" },
      }),
      expect.objectContaining({
        instruction: {
          instruction: "EXPOSE",
          stage: 0,
          value: "3000,8080/tcp",
        },
      }),
      expect.objectContaining({
        instruction: { instruction: "FROM", stage: 1, value: "alpine" },
        parent: "stage:1",
      }),
      expect.objectContaining({
        instruction: { instruction: "VOLUME", stage: 1, value: "/data" },
      }),
      expect.objectContaining({
        instruction: { instruction: "CMD", stage: 1, value: null },
      }),
    ]),
  );
  expect(JSON.stringify(parsed)).not.toContain("DO_NOT_RETAIN");
  expect(JSON.stringify(parsed)).not.toContain("FROM fake:tag");
  const limited = readDeclarations(
    "Dockerfile.limited",
    "FROM alpine\nARG TOKEN=secret\nRUN echo secret\nVOLUME /data",
    2,
  )!;
  expect(limited.declarations).toHaveLength(2);
  expect(limited.limitations).toContain(
    "Fatos Dockerfile adicionais foram omitidos pelo limite de recursos; a quantidade total não foi calculada.",
  );
  expect(
    readDeclarationsResult("Dockerfile", "FROM alpine\rARG TOKEN=secret", 10),
  ).toEqual({
    ok: false,
    error: { kind: "unsupported_format", path: "Dockerfile" },
  });
});

it("Nginx integra inventário Git, evidência e trace sem ler include externo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-nginx-"));
  const external = await mkdtemp(join(tmpdir(), "pie-nginx-history-"));
  const store = await openStore(join(external, "pie.sqlite"), root);
  const service = new PieService(store);
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "nginx.conf"),
      "http { server {\nlisten 8080;\nlocation /api { proxy_pass http://backend:3000; }\ninclude /outside/not-available.conf;\nlocation /private { proxy_pass http://fixture-user:fixture-password@backend:3000/path?choice=1; }\n} }",
    );
    await exec("git", ["-C", root, "add", "."]);
    const observed = await service.discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    const redacted = snapshot.declarations.find((item) =>
      item.name.includes("[REDACTED]"),
    )!;
    expect(redacted.name).toBe(
      '["proxy_pass","http://[REDACTED]@backend:3000/path?choice=1"]',
    );
    const redactedProof = await service.evidence(redacted.evidenceId);
    expect(redactedProof).toMatchObject({
      redactionStatus: "redacted",
      source: { path: "nginx.conf", line: 5 },
      limitations: expect.arrayContaining([
        expect.stringContaining("Userinfo de autenticação"),
      ]),
    });
    expect(JSON.stringify(snapshot)).not.toContain("fixture-user");
    expect(JSON.stringify(snapshot)).not.toContain("fixture-password");
    expect(
      snapshot.evidence.find((item) => item.source.line === null)
        ?.redactionStatus,
    ).toBe("not_collected");
    const proxy = snapshot.declarations.find((item) =>
      item.name.includes("proxy_pass"),
    )!;
    expect(proxy).toMatchObject({
      adapter: "nginx-config",
      kind: "config_directive",
      name: '["proxy_pass","http://backend:3000"]',
      source: { path: "nginx.conf", line: 3 },
    });
    expect(await service.evidence(proxy.evidenceId)).toMatchObject({
      method: "static",
      state: "unverified",
    });
    const trace = await service.trace({
      snapshotId: snapshot.id,
      nodeId: proxy.id,
    });
    expect(trace.edges.items.some((item) => item.kind === "declared_in")).toBe(
      true,
    );
    expect(trace.coverage.runtime).toBe(false);
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "include não expandidas",
    );
    for (const format of ["md", "html"] as const) {
      const report = renderSnapshot(snapshot, format);
      expect(report).toContain("nginx-config");
      expect(report).toContain(proxy.id);
      expect(report).toContain(proxy.evidenceId);
      expect(report).toContain(
        snapshot.evidence.find((item) => item.id === proxy.evidenceId)!.sha256,
      );
      expect(report).toContain("declared_in");
      expect(report).toContain(snapshot.nodes[0]!.id);
      expect(report).toContain("não incorpora resultados VERIFY");
    }
    expect(() =>
      renderSnapshot(
        {
          ...snapshot,
          evidence: snapshot.evidence.map((proof, index) =>
            index === 0 ? { ...proof, observation: "adulterado" } : proof,
          ),
        },
        "html",
      ),
    ).toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

it("Laravel deriva rotas PHP literais e prefixos de grupos por AST sem executar alvo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-laravel-routes-"));
  try {
    await exec("git", ["init", root]);
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "routes", "web.php"),
      `<?php
use Illuminate\\Support\\Facades\\Route as LaravelRoute;
// LaravelRoute::get('/commented-out', handler);
$example = "LaravelRoute::get('/inside-string', handler)";
LaravelRoute::get('/users', [UserController::class, 'index']);
LaravelRoute::prefix('api')->middleware('auth')->group(function () {
    LaravelRoute::get('/users/{id}', fn ($id) => $id);
    LaravelRoute::prefix('v2')->group(function () {
        LaravelRoute::post('/users', [UserController::class, 'store']);
    });
});
LaravelRoute::group(['prefix' => 'admin'], function () {
    LaravelRoute::delete('/users/{id}', [UserController::class, 'destroy']);
});
LaravelRoute::get(config('routes.health'), handler);
LaravelRoute::match(['get', 'post'], '/reports', handler);
LaravelRoute::match(['get', $method], '/dynamic-match', handler);
LaravelRoute::resource('posts', PostController::class);
function unusedRoutes() { LaravelRoute::get('/not-registered', handler); }
`,
    );
    await writeFile(
      join(root, "routes", "scoped.php"),
      `<?php
namespace Fixture;
use Illuminate\\Support\\Facades\\Route as ScopedRoute;
ScopedRoute::get('/scoped', handler);
namespace Untrusted;
use App\\Routing\\Route as ScopedRoute;
ScopedRoute::get('/not-a-laravel-route', handler);
`,
    );
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverProject(
      { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
      randomUUID(),
    );
    const names = snapshot.declarations
      .filter((fact) => fact.adapter === "laravel-php")
      .map((fact) => fact.name)
      .sort();
    expect(names).toEqual([
      "DELETE /admin/users/{id}",
      "GET /api/users/{id}",
      "GET /reports",
      "GET /scoped",
      "GET /users",
      "POST /api/v2/users",
      "POST /reports",
    ]);
    expect(snapshot.coverage.limitations.join(" ")).toContain(
      "Laravel estáticas ou recursos",
    );
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    expect(
      readDeclarationsResult(
        "routes/web.php",
        "<?php Route::get('/users';",
        10,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid_syntax" } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("Express AST compõe montagens literais e mantém prova da rota", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-express-"));
  const external = await mkdtemp(join(tmpdir(), "pie-express-history-"));
  const store = await openStore(join(external, "pie.sqlite"), root);
  const service = new PieService(store);
  try {
    await exec("git", ["init", root]);
    await writeFile(
      join(root, "api.ts"),
      "import express, {Router as makeRouter} from 'express';\nconst app = express();\nconst router = makeRouter();\nconst nested = makeRouter();\napp.get('/health', handler);\nrouter.post('/orders/:id', auth, handler);\nnested.get('/items', handler);\nrouter.use('/v2', nested);\napp.use('/api', router);\napp.use('/api', router);\nfunction shadow(app){app.delete('/fake', handler)}\nconst other = {get(){}};other.get('/fake', handler);\n",
    );
    await exec("git", ["-C", root, "add", "."]);
    const observed = await service.discover({
      repositoryRoot: root,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    expect(snapshot.declarations).toHaveLength(3);
    expect(snapshot.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "express-ast",
          kind: "endpoint",
          name: "GET /health",
          parent: "app",
          source: expect.objectContaining({ line: 5 }),
        }),
        expect.objectContaining({
          adapter: "express-ast",
          name: "POST /api/orders/:id",
          parent: "router",
          source: expect.objectContaining({ line: 6 }),
        }),
        expect.objectContaining({
          name: "GET /api/v2/items",
          parent: "nested",
          source: expect.objectContaining({ line: 7 }),
        }),
      ]),
    );
    const fact = snapshot.declarations[1]!;
    expect(fact).toMatchObject({
      provenanceVersion: 3,
      derivations: [
        {
          line: 9,
          operation: "express_router_mount",
          prefix: "/api",
        },
        {
          line: 10,
          operation: "express_router_mount",
          prefix: "/api",
        },
      ],
    });
    expect(await service.evidence(fact.evidenceId)).toMatchObject({
      method: "static",
      state: "unverified",
      source: { path: "api.ts", line: 6 },
      observation: expect.stringContaining('"POST /api/orders/:id"'),
    });
    const mountEvidenceId = fact.derivations[0]!.evidenceId;
    const repeatedMountEvidenceId = fact.derivations[1]!.evidenceId;
    expect(await service.evidence(mountEvidenceId)).toMatchObject({
      source: { path: "api.ts", line: 9 },
      observation: expect.stringContaining('"/api"'),
    });
    expect(await service.evidence(repeatedMountEvidenceId)).toMatchObject({
      source: { path: "api.ts", line: 10 },
      observation: expect.stringContaining('"/api"'),
    });
    const analysis = await service.functional({ snapshotId: snapshot.id });
    const finding = analysis.findings.items.find(
      (item) => item.declaration.id === fact.id,
    )!;
    expect(finding.evidenceIds).toEqual([
      fact.evidenceId,
      mountEvidenceId,
      repeatedMountEvidenceId,
    ]);
    const retained = await service.retainFunctional({
      snapshotId: snapshot.id,
    });
    expect(await service.functionalRecord(retained.id)).toEqual(retained);
    const traced = await service.trace({
      snapshotId: snapshot.id,
      nodeId: fact.id,
    });
    expect(traced.edges.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "declared_in",
          evidenceIds: expect.arrayContaining([
            fact.evidenceId,
            mountEvidenceId,
            repeatedMountEvidenceId,
          ]),
        }),
      ]),
    );
    expect(snapshot.coverage.limitations.join(" ")).toContain("prefixos");
    expect(validateSnapshot(snapshot).id).toBe(snapshot.id);
    const historicalV2 = structuredClone(snapshot);
    for (const declaration of historicalV2.declarations)
      declaration.provenanceVersion = 2;
    expect(validateSnapshot(historicalV2).id).toBe(snapshot.id);
    const alteredDerivation = structuredClone(snapshot);
    alteredDerivation.declarations[1]!.derivations[0]!.prefix = "/changed";
    expect(() => validateSnapshot(alteredDerivation)).toThrow(
      "Derivação declarativa sem Evidence",
    );
    const alteredFact = structuredClone(snapshot);
    alteredFact.declarations[1]!.name = "POST /tampered";
    alteredFact.declarations[1]!.id = declarationIdentity(
      alteredFact.declarations[1]!,
    );
    expect(() => validateSnapshot(alteredFact)).toThrow(
      "Declaração sem proveniência",
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

it("Express distingue bindings, CommonJS, escopos, mutação e limites sem executar alvo", () => {
  const facts = (source: string, limit = 20) =>
    readCodeFacts("api.ts", source, 20, limit).declarations;
  const source =
    "const express=require('express');const app=express();app.get('/a',h);app.post('/b',h);";
  expect(facts(source).declarations.map((item) => item.name)).toEqual([
    "GET /a",
    "POST /b",
  ]);
  expect(facts(source, 1)).toMatchObject({
    declarations: [{ name: "GET /a" }],
    limitations: expect.arrayContaining([expect.stringContaining("omitidas")]),
  });
  expect(
    facts(
      "const {Router: create}=require('express');const r=create();r.put('/x',h);",
    ).declarations,
  ).toMatchObject([{ name: "PUT /x", parent: "r" }]);
  expect(
    readCodeFacts(
      "api.ts",
      "const express=require('express');const app=express();const router=require('./router');router=other;app.use('/api',router);",
      20,
      20,
    ).express.crossFileMounts,
  ).toEqual([]);
  expect(
    facts(
      "import express from 'express';const r=express.Router();r.all('/x',h);",
    ).declarations,
  ).toMatchObject([{ name: "ALL /x", parent: "r" }]);
  expect(
    facts(
      "import express from 'express';const app=express();const a=express.Router();const b=express.Router();a.use('/v2',b);app.use('/api',a);b.get('/items',h);",
    ).declarations,
  ).toMatchObject([{ name: "GET /api/v2/items", parent: "b" }]);
  expect(
    facts(
      "import express from 'express';const a=express.Router();const b=express.Router();a.use('/b',b);b.use('/a',a);a.get('/local',h);",
    ),
  ).toMatchObject({
    declarations: [{ name: "GET /local", parent: "a" }],
    limitations: expect.arrayContaining([expect.stringContaining("ciclo")]),
  });
  expect(
    facts(
      "import express from 'express';const app=express();const r=express.Router();app.use('*',r);r.get('/health',h);",
    ),
  ).toMatchObject({
    declarations: [{ name: "GET /health", parent: "r" }],
    limitations: expect.arrayContaining([expect.stringContaining("wildcard")]),
  });
  for (const prefix of [
    "const require=fake;",
    "function require(x){return fake}",
    "const {require}=fake;",
    "import require from './fake';",
  ])
    expect(facts(prefix + source).declarations).toEqual([]);
  expect(
    facts(
      "import type {Router} from 'express';const r=Router();r.get('/fake',h);",
    ).declarations,
  ).toEqual([]);
  expect(
    facts(
      "import express from 'express';const app=express();app.get('/a',h);app.get=other;app.get('/fake',h);",
    ).declarations,
  ).toMatchObject([{ name: "GET /a" }]);
  expect(
    facts(
      "import express from 'express';const app=express();function shadow(app){app.get('/fake',h)};app.get(dynamic,h);app.get('env');",
    ).declarations,
  ).toEqual([]);
});

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
        expect.objectContaining({
          adapter: "prisma-schema",
          kind: "config_directive",
          name: "@id",
          parent: "Order.id",
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
  expect(
    readDeclarationsResult("compose.yml", "services: [broken", 10),
  ).toMatchObject({ ok: false, error: { kind: "invalid_syntax" } });
  expect(
    readDeclarationsResult("openapi.yaml", "openapi: 2.0\npaths: {}", 10),
  ).toMatchObject({ ok: false, error: { kind: "unsupported_format" } });
  expect(
    readDeclarationsResult("nginx.conf", 'server_name "example"suffix;', 10),
  ).toMatchObject({ ok: false, error: { kind: "invalid_syntax" } });
  expect(readDeclarationsResult("package.json", "[]", 10)).toMatchObject({
    ok: false,
    error: { kind: "invalid_structure" },
  });
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
    await writeFile(join(root, "removed.txt"), "indexed before removal");
    await exec("git", ["-C", root, "add", "."]);
    await rm(join(root, "removed.txt"));
    const snapshot = await discoverProject(
      { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
      randomUUID(),
    );
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.declarations).toHaveLength(0);
    expect(
      snapshot.coverage.limitations.some((value) =>
        value.includes("falha esperada de inventário (io_error)"),
      ),
    ).toBe(true);
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
