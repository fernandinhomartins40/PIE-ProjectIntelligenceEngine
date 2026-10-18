import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { expect, it, vi } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { runPie } from "../../src/pie/cli.js";
import { createPieMcp } from "../../src/pie/mcp.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { reviewInfrastructureResult } from "../../src/pie/infrastructure.js";

const exec = promisify(execFile);

function expectInfrastructureInputFailures(
  snapshot: unknown,
  snapshotId: string,
) {
  expect(
    reviewInfrastructureResult(snapshot, { snapshotId, limit: -1 }),
  ).toEqual({ ok: false, error: { kind: "invalid_input" } });
  expect(
    reviewInfrastructureResult(snapshot, {
      snapshotId: "00000000-0000-4000-8000-000000000000",
    }),
  ).toEqual({
    ok: false,
    error: { kind: "policy_denied", reason: "snapshot_mismatch" },
  });
  expect(reviewInfrastructureResult({}, { snapshotId })).toEqual({
    ok: false,
    error: { kind: "invalid_snapshot" },
  });
}

function expectInfrastructureNginxFacts(
  result: Awaited<ReturnType<PieService["infrastructure"]>>,
) {
  const names = result.components.items
    .filter((item) => item.kind === "nginx_directive")
    .map((item) => item.name);
  expect(names).toEqual(
    expect.arrayContaining([
      '["client_max_body_size","10m"]',
      '["ssl_certificate","/etc/nginx/cert.pem"]',
    ]),
  );
}

function expectComposeRuntimeSettings(
  result: Awaited<ReturnType<PieService["infrastructure"]>>,
  evidenceIds: Set<string>,
) {
  const api = result.components.items.find(
    (item) => item.kind === "compose_service" && item.name === "api",
  );
  expect(api?.settings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "image", value: "node:24-alpine" }),
      expect.objectContaining({ key: "port", value: "127.0.0.1:8080:3000" }),
      expect.objectContaining({ key: "restart", value: "unless-stopped" }),
      expect.objectContaining({ key: "healthcheck", value: "declared" }),
      expect.objectContaining({ key: "replicas", value: "2" }),
      expect.objectContaining({ key: "cpus_limit", value: "0.50" }),
      expect.objectContaining({ key: "memory_limit", value: "512M" }),
      expect.objectContaining({ key: "pids_limit", value: "128" }),
      expect.objectContaining({ key: "cpus_reservation", value: "0.25" }),
      expect.objectContaining({ key: "memory_reservation", value: "256M" }),
      expect.objectContaining({ key: "pids_reservation", value: "64" }),
    ]),
  );
  expect(api?.builds).toEqual([
    expect.objectContaining({
      context: "app",
      dockerfile: "Dockerfile.api",
      candidatePath: "app/Dockerfile.api",
      dockerfileObservation: "observed_in_snapshot",
      dockerfileAnalysis: "static_facts_observed",
      instructions: expect.arrayContaining([
        expect.objectContaining({
          instruction: "FROM",
          value: "node:24-alpine",
          stage: 0,
        }),
        expect.objectContaining({ instruction: "RUN", value: null }),
        expect.objectContaining({ instruction: "VOLUME", value: "/data" }),
      ]),
      evidenceIds: expect.arrayContaining([expect.any(String)]),
    }),
  ]);
  expect(
    api?.builds[0]?.instructions.every((item) =>
      evidenceIds.has(item.evidenceId),
    ),
  ).toBe(true);
  expect(
    api?.settings.every((setting) => evidenceIds.has(setting.evidenceId)),
  ).toBe(true);
  expect(api?.settings).toContainEqual(
    expect.objectContaining({
      key: "volume_mount",
      value: "data:/var/lib/app:ro",
    }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({
      key: "extends_reference",
      value: '{"service":"base-api","file":"./shared/services.yaml"}',
    }),
  );
  expect(result.components.items).toContainEqual(
    expect.objectContaining({
      kind: "compose_configuration",
      name: "include",
      settings: [
        expect.objectContaining({
          key: "include_path",
          value: "./shared/base.compose.yaml",
        }),
      ],
    }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({
      key: "environment_key",
      value: "API_KEY",
      evidenceId: expect.any(String),
    }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({ key: "env_file", value: ".env.production" }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({ key: "secret_mount", value: "api_key" }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({ key: "config_mount", value: "app_config" }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({ key: "profile", value: "production" }),
  );
  expect(api?.settings).toContainEqual(
    expect.objectContaining({
      key: "depends_on_options",
      value:
        '{"dependency":"database","condition":"service_healthy","restart":true,"required":false}',
    }),
  );
  expect(result.components.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "compose_resource",
        name: "api_key",
        settings: [
          expect.objectContaining({
            key: "secret_definition",
            value: '{"file":"./secrets/api_key.txt"}',
          }),
        ],
      }),
      expect.objectContaining({
        kind: "compose_resource",
        name: "app_config",
        settings: [
          expect.objectContaining({
            key: "config_definition",
            value: '{"file":"./config/app.yml"}',
          }),
        ],
      }),
    ]),
  );
  expect(result.components.items).toContainEqual(
    expect.objectContaining({
      kind: "compose_volume",
      name: "data",
      settings: [
        expect.objectContaining({
          key: "volume_definition",
          value: '{"external":true}',
        }),
      ],
    }),
  );
}

function expectComposeNetworkSettings(
  result: Awaited<ReturnType<PieService["infrastructure"]>>,
) {
  const api = result.components.items.find(
    (item) => item.kind === "compose_service" && item.name === "api",
  );
  expect(api?.settings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "network_mode", value: "bridge" }),
      expect.objectContaining({
        key: "network_attachment",
        value: '{"network":"backend","aliases":["api-gateway"]}',
      }),
    ]),
  );
  expect(result.components.items).toContainEqual(
    expect.objectContaining({
      kind: "compose_resource",
      name: "backend",
      settings: [
        expect.objectContaining({
          key: "network_definition",
          value: '{"driver":"bridge","internal":true}',
        }),
      ],
    }),
  );
}

async function writeDockerComposeFixture(repository: string) {
  await mkdir(join(repository, "app"));
  await writeFile(
    join(repository, "app", "Dockerfile.api"),
    'FROM node:24-alpine\nARG BUILD_SECRET=NEVER_RETAIN\nENV APP_MODE=production\nWORKDIR /app\nCOPY . .\nRUN echo NEVER_RETAIN_SHELL\nEXPOSE 3000\nVOLUME /data\nCMD ["node", "server.js"]\n',
  );
}

it("integra inventÃ¡rio Compose/Nginx com Evidence e mÃ©tricas NOT_MEASURED", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-infrastructure-"));
  const repository = join(temporary, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "compose.yaml"),
    'include:\n  - ./shared/base.compose.yaml\nservices:\n  api:\n    image: node:24-alpine\n    network_mode: bridge\n    networks:\n      backend:\n        aliases: [api-gateway]\n    build:\n      context: app\n      dockerfile: Dockerfile.api\n      args:\n        TOKEN: NEVER_RETAIN\n    ports:\n      - "127.0.0.1:8080:3000"\n    environment:\n      API_KEY: NEVER_RETAIN_ENV_VALUE\n    env_file:\n      - .env.production\n    volumes:\n      - "data:/var/lib/app:ro"\n    secrets:\n      - api_key\n    configs:\n      - app_config\n    restart: unless-stopped\n    profiles: [production]\n    extends:\n      file: ./shared/services.yaml\n      service: base-api\n    healthcheck:\n      test: ["CMD", "echo", "DO_NOT_RETAIN"]\n    deploy:\n      replicas: 2\n      resources:\n        limits:\n          cpus: "0.50"\n          memory: 512M\n          pids: 128\n        reservations:\n          cpus: "0.25"\n          memory: 256M\n          pids: 64\n    depends_on:\n      database:\n        condition: service_healthy\n        restart: true\n        required: false\n  database:\n    image: postgres\nvolumes:\n  data:\n    external: true\nnetworks:\n  backend:\n    driver: bridge\n    internal: true\nsecrets:\n  api_key:\n    file: ./secrets/api_key.txt\nconfigs:\n  app_config:\n    file: ./config/app.yml\n',
  );
  await writeDockerComposeFixture(repository);
  await writeFile(
    join(repository, "nginx.conf"),
    "events { worker_connections 1024; }\nhttp { server { listen 8080; client_max_body_size 10m; ssl_certificate /etc/nginx/cert.pem; location /api { proxy_pass http://api:3000; } } }\n",
  );
  await exec("git", ["init", repository]);
  await exec("git", ["-C", repository, "add", "."]);
  const store = await openStore(join(temporary, "pie.sqlite"), repository);
  const service = new PieService(store);
  const token = "pie-infrastructure-test-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repository, token });
  const mcp = createPieMcp(service, repository);
  const client = new Client({ name: "pie-infrastructure-test", version: "1" });
  try {
    const discovered = await service.discover({
      repositoryRoot: repository,
      profile: "OBSERVE",
      environment: "local",
    });
    const input = { snapshotId: discovered.snapshot.id, limit: 50, offset: 0 };
    const snapshot = await store.snapshot(discovered.snapshot.id);
    expectInfrastructureInputFailures(snapshot, discovered.snapshot.id);
    const result = await service.infrastructure(input);
    expect(result).toMatchObject({
      engine: "infrastructure",
      state: "unverified",
      measurements: {
        cpu: "NOT_MEASURED",
        memory: "NOT_MEASURED",
        disk: "NOT_MEASURED",
        io: "NOT_MEASURED",
        network: "NOT_MEASURED",
        latencyP95: "NOT_MEASURED",
        latencyP99: "NOT_MEASURED",
        restarts: "NOT_MEASURED",
      },
      coverage: { runtimeMeasured: false },
    });
    expect(result.components.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "compose_service",
          name: "api",
          dependencies: expect.arrayContaining([
            expect.objectContaining({
              name: "database",
              evidenceId: expect.any(String),
            }),
          ]),
        }),
        expect.objectContaining({ kind: "compose_service", name: "database" }),
        expect.objectContaining({ kind: "nginx_directive" }),
      ]),
    );
    expectInfrastructureNginxFacts(result);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RETAIN");
    expect(JSON.stringify(result)).not.toContain("NEVER_RETAIN");
    expect(result.coverage.sourceFacts).toBeGreaterThan(
      result.components.total,
    );
    const evidence = new Set(
      (
        await service.declarations(discovered.snapshot.id, { limit: 200 })
      ).declarations.items.map((fact) => fact.evidenceId),
    );
    for (const component of result.components.items)
      expect(evidence.has(component.evidenceId)).toBe(true);
    expectComposeRuntimeSettings(result, evidence);
    expectComposeNetworkSettings(result);
    const page = await service.infrastructure({
      snapshotId: discovered.snapshot.id,
      offset: 2,
      limit: 2,
    });
    expect(page.components.items).toEqual(result.components.items.slice(2, 4));
    expect(page.components.total).toBe(result.components.total);

    const plan = await service.plan({ ...input, limit: 200 });
    expect(plan.engines).toContainEqual(
      expect.objectContaining({
        engine: "infrastructure",
        status: "partial_static",
        sourceCount: result.components.total,
        runtimeVerified: false,
      }),
    );
    expect(
      plan.items.items.some((item) => item.engine === "infrastructure"),
    ).toBe(true);

    const response = await fetch(`${api.url}/v1/infrastructure-review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    const unauthenticated = await fetch(`${api.url}/v1/infrastructure-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(unauthenticated.status).toBe(401);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      mcp.connect(serverTransport),
    ]);
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "pie_infrastructure_review",
    );
    expect(tool).toBeDefined();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
    const mcpResult = await client.callTool({
      name: "pie_infrastructure_review",
      arguments: input,
    });
    expect(mcpResult.structuredContent).toEqual(result);

    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runPie([
        "infrastructure-review",
        discovered.snapshot.id,
        "--db",
        join(temporary, "pie.sqlite"),
      ]);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(result);
    } finally {
      output.mockRestore();
    }
  } finally {
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
