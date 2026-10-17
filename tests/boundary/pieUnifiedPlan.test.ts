import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import canonicalize from "canonicalize";
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
import { sha256 } from "../../src/pie/evidence.js";
import { validatePlanTriageEvent } from "../../src/pie/planTriage.js";

const exec = promisify(execFile);

it("preserva leitura e hash de eventos de triagem v1", () => {
  const body = {
    schemaVersion: 1 as const,
    id: randomUUID(),
    snapshotId: randomUUID(),
    planDigest: "a".repeat(64),
    itemId: "plan:functional:legacy",
    revision: 1,
    previousOwner: null,
    owner: "team-legacy",
    previousStatus: "open" as const,
    status: "accepted" as const,
    justification: "Registro preservado antes da revisão dois.",
    actor: null,
    createdAt: "2026-10-17T00:00:00.000Z",
  };
  const event = validatePlanTriageEvent({
    ...body,
    eventHash: sha256(canonicalize(body)!),
  });
  expect(event).toMatchObject({
    schemaVersion: 1,
    owner: "team-legacy",
    status: "accepted",
  });
});

async function verifyPlanAdapters(input: {
  expected: unknown;
  snapshotId: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
  mcp: ReturnType<typeof createPieMcp>;
}) {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie([
      "plan",
      input.snapshotId,
      "--limit",
      "20",
      "--db",
      input.database,
    ]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(
      input.expected,
    );
  } finally {
    output.mockRestore();
  }
  const response = await fetch(`${input.apiUrl}/v1/plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snapshotId: input.snapshotId, limit: 20 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input.expected);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    input.client.connect(clientTransport),
    input.mcp.connect(serverTransport),
  ]);
  const tool = (await input.client.listTools()).tools.find(
    (item) => item.name === "pie_plan_generate",
  );
  expect(tool).toBeDefined();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
  const result = await input.client.callTool({
    name: "pie_plan_generate",
    arguments: { snapshotId: input.snapshotId, limit: 20 },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(input.expected);
}

async function verifyPlanExportAdapters(input: {
  service: PieService;
  snapshotId: string;
  expected: Awaited<ReturnType<PieService["plan"]>>;
  apiUrl: string;
  token: string;
  database: string;
  root: string;
}) {
  const exported = await input.service.exportPlan({
    snapshotId: input.snapshotId,
    format: "json",
    offset: 0,
    limitBytes: 257,
  });
  expect(exported.planDigest).toBe(input.expected.planDigest);
  expect(exported.executionAuthorized).toBe(false);
  const pages = [exported.content];
  for (let offset = exported.nextOffset; offset !== null;) {
    const next = await input.service.exportPlan({
      snapshotId: input.snapshotId,
      format: "json",
      offset,
      limitBytes: 257,
    });
    expect(next.sha256).toBe(exported.sha256);
    pages.push(next.content);
    offset = next.nextOffset;
  }
  const document = JSON.parse(pages.join("")) as typeof input.expected;
  expect(document.items.items.map((item) => item.id)).toEqual(
    input.expected.items.items.map((item) => item.id),
  );
  expect(document.items.items[0]?.priorityAssessment).toEqual(
    input.expected.items.items[0]?.priorityAssessment,
  );
  const apiExport = await fetch(
    `${input.apiUrl}/v1/plan/export?snapshotId=${input.snapshotId}&format=json&limitBytes=257`,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );
  expect(apiExport.status).toBe(200);
  expect(await apiExport.json()).toEqual(exported);
  const missingAuth = await fetch(
    `${input.apiUrl}/v1/plan/export?snapshotId=${input.snapshotId}`,
  );
  expect(missingAuth.status).toBe(401);

  const mcp = createPieMcp(input.service, input.root);
  const client = new Client({ name: "pie-plan-export-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcp.connect(serverTransport),
  ]);
  try {
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "pie_plan_export",
    );
    expect(tool).toBeDefined();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
    const mcpExport = await client.callTool({
      name: "pie_plan_export",
      arguments: {
        snapshotId: input.snapshotId,
        format: "json",
        limitBytes: 257,
      },
    });
    expect(mcpExport.structuredContent).toEqual(exported);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await runPie(["plan-export", input.snapshotId, "--db", input.database]);
      const cliPlan = JSON.parse(
        String(output.mock.calls.map((call) => call[0]).join("")),
      ) as typeof input.expected;
      expect(cliPlan.items.items.map((item) => item.id)).toEqual(
        input.expected.items.items.map((item) => item.id),
      );
      expect(cliPlan.items.items[0]?.priorityAssessment).toEqual(
        input.expected.items.items[0]?.priorityAssessment,
      );
    } finally {
      output.mockRestore();
    }
  } finally {
    await client.close();
    await mcp.close();
  }
}

async function verifyRankedPlanAdapters(input: {
  expected: Awaited<ReturnType<PieService["plan"]>>;
  snapshotId: string;
  database: string;
  apiUrl: string;
  token: string;
  service: PieService;
  root: string;
}) {
  const mcp = createPieMcp(input.service, input.root);
  const client = new Client({ name: "pie-ranked-plan-test", version: "1" });
  try {
    await verifyPlanAdapters({ ...input, client, mcp });
  } finally {
    await client.close();
    await mcp.close();
  }
}

async function verifyPlanItemHistoryExportAdapters(input: {
  service: PieService;
  snapshotId: string;
  planDigest: string;
  itemId: string;
  apiUrl: string;
  token: string;
  database: string;
  root: string;
}) {
  const exported = await input.service.exportPlanItemHistory({
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    format: "json",
    offset: 0,
    limitBytes: 241,
  });
  expect(exported.triageEvents).toBeGreaterThan(0);
  expect(exported.contestations).toBeGreaterThan(0);
  const markdown = await input.service.exportPlanItemHistory({
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    format: "md",
  });
  expect(markdown.content).toContain("# Histórico do item");
  const html = await input.service.exportPlanItemHistory({
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    format: "html",
  });
  expect(html.content).toContain('<html lang="pt-BR">');
  const chunks = [exported.content];
  for (let offset = exported.nextOffset; offset !== null;) {
    const next = await input.service.exportPlanItemHistory({
      snapshotId: input.snapshotId,
      planDigest: input.planDigest,
      itemId: input.itemId,
      format: "json",
      offset,
      limitBytes: 241,
    });
    expect(next.sha256).toBe(exported.sha256);
    chunks.push(next.content);
    offset = next.nextOffset;
  }
  const fullHistory = JSON.parse(chunks.join("")) as {
    triage: unknown[];
    contestations: unknown[];
  };
  expect(fullHistory.triage).toHaveLength(exported.triageEvents);
  expect(fullHistory.contestations).toHaveLength(exported.contestations);
  const apiUrl = new URL("/v1/plan/item-history/export", input.apiUrl);
  apiUrl.search = new URLSearchParams({
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    format: "json",
    limitBytes: "241",
  }).toString();
  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${input.token}` },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(exported);

  const mcp = createPieMcp(input.service, input.root);
  const client = new Client({
    name: "pie-item-history-export-test",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcp.connect(serverTransport),
  ]);
  try {
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "pie_plan_item_history_export",
    );
    expect(tool).toBeDefined();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool!.inputSchema)).toBe(true);
    expect(ajv.validateSchema(tool!.outputSchema as AnySchema)).toBe(true);
    const result = await client.callTool({
      name: "pie_plan_item_history_export",
      arguments: {
        snapshotId: input.snapshotId,
        planDigest: input.planDigest,
        itemId: input.itemId,
        format: "json",
        limitBytes: 241,
      },
    });
    expect(result.structuredContent).toEqual(exported);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await runPie([
        "plan-item-history-export",
        input.snapshotId,
        input.planDigest,
        input.itemId,
        "--db",
        input.database,
      ]);
      const cliRecord = JSON.parse(
        String(output.mock.calls.map((call) => call[0]).join("")),
      ) as { triage: unknown[]; contestations: unknown[] };
      expect(cliRecord.triage).toHaveLength(exported.triageEvents);
      expect(cliRecord.contestations).toHaveLength(exported.contestations);
    } finally {
      output.mockRestore();
    }
  } finally {
    await client.close();
    await mcp.close();
  }
}

async function verifyPlanExportWorkflows(input: {
  service: PieService;
  snapshotId: string;
  planDigest: string;
  itemId: string;
  expected: Awaited<ReturnType<PieService["plan"]>>;
  apiUrl: string;
  token: string;
  database: string;
  root: string;
}) {
  await verifyPlanExportAdapters(input);
  await verifyPlanItemHistoryExportAdapters(input);
}

async function verifyContestAdapters(input: {
  request: Record<string, unknown>;
  expected: unknown;
  history: unknown;
  snapshotId: string;
  planDigest: string;
  file: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
}) {
  await writeFile(input.file, JSON.stringify(input.request));
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie(["plan-contest", input.file, "--db", input.database]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(
      input.expected,
    );
  } finally {
    output.mockRestore();
  }
  const response = await fetch(`${input.apiUrl}/v1/plan/contest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.request),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(input.expected);
  const history = await fetch(
    `${input.apiUrl}/v1/plan/contestations?snapshotId=${input.snapshotId}&planDigest=${input.planDigest}`,
    {
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );
  expect(history.status).toBe(200);
  expect(
    ((await history.json()) as { items: { items: unknown[] } }).items.items,
  ).toEqual([input.expected]);
  const tool = await input.client.callTool({
    name: "pie_plan_contest",
    arguments: input.request,
  });
  expect(tool.isError).not.toBe(true);
  expect(tool.structuredContent).toEqual(input.expected);
  const definition = (await input.client.listTools()).tools.find(
    (entry) => entry.name === "pie_plan_contest",
  );
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(definition!.outputSchema as AnySchema)).toBe(true);
  const list = await input.client.callTool({
    name: "pie_plan_contestations_list",
    arguments: {
      snapshotId: input.snapshotId,
      planDigest: input.planDigest,
      limit: 10,
    },
  });
  expect(list.isError).not.toBe(true);
  expect(list.structuredContent).toEqual(input.history);
}

async function verifyContestPersistence(input: {
  service: PieService;
  snapshotId: string;
  planDigest: string;
  item: { id: string; evidenceIds: string[] };
  root: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
}) {
  const request = {
    id: randomUUID(),
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.item.id,
    justification:
      "A Evidence disponível não sustenta esta recomendação como ação prioritária.",
    evidenceIds: [input.item.evidenceIds[0]!],
  };
  const contest = await input.service.contestPlanItem(request);
  expect(contest.item).toEqual(input.item);
  expect(contest.eventHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(await input.service.planContestation(contest.id)).toEqual(contest);
  expect(await input.service.contestPlanItem(request)).toEqual(contest);
  const database = new DatabaseSync(input.database);
  try {
    expect(() =>
      database
        .prepare("UPDATE pie_plan_contestations SET payload=payload WHERE id=?")
        .run(contest.id),
    ).toThrow(/immutable/u);
    expect(() =>
      database
        .prepare("DELETE FROM pie_plan_contestations WHERE id=?")
        .run(contest.id),
    ).toThrow(/immutable/u);
  } finally {
    database.close();
  }
  const history = await input.service.planContestations(input.snapshotId, {
    planDigest: input.planDigest,
    limit: 10,
  });
  await verifyContestAdapters({
    request,
    expected: contest,
    history,
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    file: join(input.root, "contest.json"),
    database: input.database,
    apiUrl: input.apiUrl,
    token: input.token,
    client: input.client,
  });
  expect(history.items.items).toEqual([contest]);
  const second = await input.service.contestPlanItem({
    ...request,
    id: randomUUID(),
    justification:
      "Uma segunda análise humana mantém sua própria trilha histórica.",
  });
  const nextPage = await input.service.planContestations(input.snapshotId, {
    planDigest: input.planDigest,
    limit: 1,
    offset: 1,
  });
  expect(nextPage.items.items).toEqual([second]);
  await expect(
    input.service.contestPlanItem({
      ...request,
      justification:
        "Esta justificativa alternativa não deve substituir o evento.",
    }),
  ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  await expect(
    input.service.contestPlanItem({
      ...request,
      id: randomUUID(),
      planDigest: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  await expect(
    input.service.contestPlanItem({
      ...request,
      id: randomUUID(),
      evidenceIds: [randomUUID()],
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
}

async function verifyTriageHistoryAdapters(input: {
  snapshotId: string;
  planDigest: string;
  itemId: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
}) {
  const query = `snapshotId=${input.snapshotId}&planDigest=${input.planDigest}&itemId=${encodeURIComponent(input.itemId)}`;
  const response = await fetch(
    `${input.apiUrl}/v1/plan/triage-history?${query}`,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );
  expect(response.status).toBe(200);
  const expected = await response.json();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie([
      "plan-triage-history",
      input.snapshotId,
      input.planDigest,
      input.itemId,
      "--db",
      input.database,
    ]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(expected);
  } finally {
    output.mockRestore();
  }
  const tool = await input.client.callTool({
    name: "pie_plan_triage_history",
    arguments: {
      snapshotId: input.snapshotId,
      planDigest: input.planDigest,
      itemId: input.itemId,
      limit: 10,
    },
  });
  expect(tool.isError).not.toBe(true);
  expect(tool.structuredContent).toEqual(expected);
  const definition = (await input.client.listTools()).tools.find(
    (candidate) => candidate.name === "pie_plan_triage_history",
  );
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(definition!.outputSchema as AnySchema)).toBe(true);
}

async function verifyTriageAdapters(input: {
  service: PieService;
  itemId: string;
  snapshotId: string;
  planDigest: string;
  root: string;
  database: string;
  apiUrl: string;
  token: string;
  client: Client;
}) {
  const request = {
    id: randomUUID(),
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    expectedRevision: 0,
    owner: "team-core",
    status: "accepted",
    justification: "A equipe assumiu a triagem; isso não valida o achado.",
  };
  const event = await input.service.updatePlanTriage(request);
  expect(event.revision).toBe(1);
  expect(await input.service.updatePlanTriage(request)).toEqual(event);
  await expect(
    input.service.updatePlanTriage({ ...request, owner: "other-team" }),
  ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  const file = join(input.root, "triage.json");
  await writeFile(file, JSON.stringify(request));
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runPie(["plan-triage", file, "--db", input.database]);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(event);
  } finally {
    output.mockRestore();
  }
  const response = await fetch(`${input.apiUrl}/v1/plan/triage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(event);
  const tool = await input.client.callTool({
    name: "pie_plan_triage_set",
    arguments: request,
  });
  expect(tool.isError).not.toBe(true);
  expect(tool.structuredContent).toEqual(event);
  const definition = (await input.client.listTools()).tools.find(
    (candidate) => candidate.name === "pie_plan_triage_set",
  );
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition!.inputSchema)).toBe(true);
  expect(ajv.validateSchema(definition!.outputSchema as AnySchema)).toBe(true);
  const plan = await input.service.plan({
    snapshotId: input.snapshotId,
    limit: 20,
  });
  const item = plan.items.items.find(
    (candidate) => candidate.id === input.itemId,
  )!;
  expect(item).toMatchObject({
    owner: "team-core",
    status: "accepted",
    triageRevision: 1,
  });
  expect(plan.planDigest).toBe(input.planDigest);
  expect(plan.state).toBe("unverified");
  expect(plan.executionAuthorized).toBe(false);
  await expect(
    input.service.updatePlanTriage({
      ...request,
      id: randomUUID(),
      status: "completed",
    }),
  ).rejects.toMatchObject({ code: "BUSY" });
  await verifyTriageHistoryAdapters(input);
  const database = new DatabaseSync(input.database);
  try {
    expect(() =>
      database
        .prepare("DELETE FROM pie_plan_triage_events WHERE id=?")
        .run(event.id),
    ).toThrow(/immutable/u);
  } finally {
    database.close();
  }
  const reassignment = await input.service.updatePlanTriage({
    id: randomUUID(),
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    expectedRevision: 1,
    owner: null,
    justification:
      "A atribuição foi removida após revisão da equipe responsável.",
  });
  expect(reassignment).toMatchObject({
    revision: 2,
    owner: null,
    status: "accepted",
  });
  const nextPage = await input.service.planTriageHistory(input.snapshotId, {
    planDigest: input.planDigest,
    itemId: input.itemId,
    limit: 1,
    offset: 1,
  });
  expect(nextPage.items.items).toEqual([reassignment]);
  const completed = await input.service.updatePlanTriage({
    id: randomUUID(),
    snapshotId: input.snapshotId,
    planDigest: input.planDigest,
    itemId: input.itemId,
    expectedRevision: 2,
    status: "completed",
    justification:
      "A pessoa responsável marcou a triagem como concluída, sem teste técnico.",
  });
  const completedPlan = await input.service.plan({
    snapshotId: input.snapshotId,
    limit: 20,
  });
  expect(
    completedPlan.items.items.find((item) => item.id === input.itemId),
  ).toMatchObject({ status: "completed", triageRevision: 3 });
  expect(completedPlan.state).toBe("unverified");
  expect(completedPlan.executionAuthorized).toBe(false);
  expect(completed.revision).toBe(3);
}

async function verifyPriorityOrdering(
  service: PieService,
  snapshotId: string,
  planDigest: string,
  items: Awaited<ReturnType<PieService["plan"]>>["items"]["items"],
) {
  const rankedItems = items.slice(0, 4);
  expect(rankedItems).toHaveLength(4);
  const scores = [
    { impact: 1, risk: 1, effort: 5 },
    { impact: 5, risk: 4, effort: 3 },
    { impact: 5, risk: 5, effort: 5 },
    { impact: 5, risk: 5, effort: 1 },
  ];
  for (const [index, item] of rankedItems.entries())
    await service.updatePlanTriage({
      id: randomUUID(),
      snapshotId,
      planDigest,
      itemId: item.id,
      expectedRevision: index === 0 ? 3 : 0,
      priority: { ...scores[index]!, evidenceIds: [item.evidenceIds[0]!] },
      justification: "Notas humanas registradas com Evidence do snapshot.",
    });
  const ranked = await service.plan({ snapshotId, limit: 20 });
  expect(ranked.planDigest).toBe(planDigest);
  expect(ranked.items.items.slice(0, 4).map((item) => item.id)).toEqual([
    rankedItems[3]!.id,
    rankedItems[2]!.id,
    rankedItems[1]!.id,
    rankedItems[0]!.id,
  ]);
  const cleared = await service.updatePlanTriage({
    id: randomUUID(),
    snapshotId,
    planDigest,
    itemId: rankedItems[3]!.id,
    expectedRevision: 1,
    priority: null,
    justification: "Prioridade removida até obter nova avaliação sustentada.",
  });
  expect(cleared).toMatchObject({ schemaVersion: 2, priority: null });
  const afterClear = await service.plan({ snapshotId, limit: 20 });
  expect(afterClear.items.items[0]?.id).toBe(rankedItems[2]!.id);
  expect(afterClear.planDigest).toBe(planDigest);
  const rankedPage = await service.plan({
    snapshotId,
    limit: 2,
    offset: 1,
  });
  expect(rankedPage.items.items).toEqual(afterClear.items.items.slice(1, 3));
  expect(rankedPage.items.total).toBe(afterClear.items.total);
  await expect(
    service.updatePlanTriage({
      id: randomUUID(),
      snapshotId,
      planDigest,
      itemId: rankedItems[0]!.id,
      expectedRevision: 4,
      priority: {
        impact: 5,
        risk: 5,
        effort: 1,
        evidenceIds: [randomUUID()],
      },
      justification: "Evidence pertence a outro snapshot para este teste.",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  return afterClear;
}

it("agrega propostas de motores com Evidence e sem promover verificação", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-unified-plan-"));
  const repo = join(root, "repo");
  const storePath = join(root, "pie.sqlite");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "prisma", "migrations", "001"), {
    recursive: true,
  });
  await exec("git", ["init", repo]);
  await writeFile(
    join(repo, "src", "routes.js"),
    "import express from 'express';\nconst app = express();\napp.get('/accounts', handler);\n",
  );
  await writeFile(
    join(repo, "secrets.ts"),
    'export const token = "ghp_123456789012345678901234567890123456";\n',
  );
  await writeFile(
    join(repo, "prisma", "schema.prisma"),
    "model Account {\n  id String @id\n}\n",
  );
  await writeFile(
    join(repo, "prisma", "migrations", "001", "migration.sql"),
    'CREATE TABLE "Account" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));\n',
  );
  await exec("git", ["-C", repo, "add", "."]);

  const store = await openStore(storePath, repo);
  const service = new PieService(store);
  const token = "fixture-unified-plan-token-with-at-least-32-characters";
  const api = await startPieApi(service, { root: repo, token });
  const mcp = createPieMcp(service, repo);
  const client = new Client({ name: "pie-unified-plan-test", version: "1" });
  try {
    const discovered = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const result = await service.plan({
      snapshotId: discovered.snapshot.id,
      limit: 20,
    });
    expect(result).toMatchObject({
      schemaVersion: 1,
      engine: "planning",
      state: "unverified",
      executionAuthorized: false,
      engines: expect.arrayContaining([
        expect.objectContaining({
          engine: "infrastructure",
          status: "not_implemented",
        }),
        expect.objectContaining({
          engine: "regression",
          status: "not_implemented",
        }),
      ]),
    });
    expect(result.items.items.map((item) => item.engine)).toEqual(
      expect.arrayContaining(["functional", "product", "security", "data"]),
    );
    for (const item of result.items.items) {
      expect(item.evidenceIds.length).toBeGreaterThan(0);
      expect(item.status).toBe("open");
      expect(item.priority).toBe("unassessed");
      expect(item.owner).toBeNull();
      expect(item.acceptance.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(result)).not.toContain(
      "ghp_123456789012345678901234567890123456",
    );
    await verifyPlanAdapters({
      expected: result,
      snapshotId: discovered.snapshot.id,
      database: storePath,
      apiUrl: api.url,
      token,
      client,
      mcp,
    });

    const page = await service.plan({
      snapshotId: discovered.snapshot.id,
      limit: 2,
      offset: 1,
    });
    expect(page.planDigest).toBe(result.planDigest);
    expect(page.items.items).toHaveLength(2);
    expect(page.items.offset).toBe(1);
    await verifyContestPersistence({
      service,
      snapshotId: discovered.snapshot.id,
      planDigest: result.planDigest,
      item: result.items.items[0]!,
      root,
      database: storePath,
      apiUrl: api.url,
      token,
      client,
    });
    await verifyTriageAdapters({
      service,
      itemId: result.items.items[0]!.id,
      snapshotId: discovered.snapshot.id,
      planDigest: result.planDigest,
      root,
      database: storePath,
      apiUrl: api.url,
      token,
      client,
    });
    const prioritized = await verifyPriorityOrdering(
      service,
      discovered.snapshot.id,
      result.planDigest,
      result.items.items,
    );
    await verifyPlanExportWorkflows({
      service,
      snapshotId: discovered.snapshot.id,
      planDigest: result.planDigest,
      itemId: result.items.items[0]!.id,
      expected: prioritized,
      apiUrl: api.url,
      token,
      database: storePath,
      root: repo,
    });
    await verifyRankedPlanAdapters({
      expected: prioritized,
      snapshotId: discovered.snapshot.id,
      database: storePath,
      apiUrl: api.url,
      token,
      service,
      root: repo,
    });
  } finally {
    await client.close();
    await mcp.close();
    await api.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
