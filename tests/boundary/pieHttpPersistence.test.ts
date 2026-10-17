import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";
import { startPieApi } from "../../src/pie/api.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function verifyHttpApi(details: {
  api: Awaited<ReturnType<typeof startPieApi>>;
  service: PieService;
  grant: unknown;
  snapshotId: string;
  record: { id: string };
}) {
  const token = "local-http-probe-test-token-with-more-than-32-chars";
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(
    `${details.api.url}/v1/http-probes/${details.record.id}`,
    { headers },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(details.record);

  const run = await fetch(`${details.api.url}/v1/http-probes`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(details.grant),
  });
  expect(run.status).toBe(201);
  const outcome = (await run.json()) as {
    ok: boolean;
    value: { id: string; state: string };
  };
  expect(outcome).toMatchObject({ ok: true, value: { state: "passed" } });
  expect(await details.service.httpProbe(outcome.value.id)).toEqual(
    outcome.value,
  );

  const listing = await fetch(
    `${details.api.url}/v1/http-probes?snapshotId=${details.snapshotId}&limit=1`,
    { headers },
  );
  expect(listing.status).toBe(200);
  expect(await listing.json()).toMatchObject({
    total: 2,
    offset: 0,
    nextOffset: 1,
    items: [{ id: details.record.id, state: "passed" }],
  });
}

it("preserva a sondagem HTTP autorizada com prova atômica, consulta validada e histórico imutável", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-http-history-"));
  const repository = join(temporary, "repo");
  await mkdir(repository);
  await promisify(execFile)("git", ["init", repository]);
  await writeFile(join(repository, "server.ts"), "export const local = true;");
  await promisify(execFile)("git", ["-C", repository, "add", "."]);

  const responseBody = "operator authorized response";
  const responseDigest = createHash("sha256")
    .update(responseBody)
    .digest("hex");
  const server = createServer((_request, response) => {
    response.end(responseBody);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");

  const dbPath = join(temporary, "pie.sqlite");
  const store = await openStore(dbPath, repository);
  const service = new PieService(store);
  try {
    const discovery = await service.discover({
      repositoryRoot: repository,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = await store.snapshot(discovery.snapshot.id);
    const grant = {
      schemaVersion: 1 as const,
      profile: "VERIFY" as const,
      allowLocalHttpRequests: true as const,
      environment: "local" as const,
      repositoryRoot: repository,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      evidenceTtlMs: 30_000,
      request: {
        address: "127.0.0.1" as const,
        port: address.port,
        method: "GET" as const,
        path: "/health?source=explicit-grant",
        timeoutMs: 2_000,
        maxResponseBytes: 1_024,
      },
      expectedStatus: 200,
      expectedBodySha256: responseDigest,
    };
    const probed = await service.probeHttp(grant, repository);
    expect(probed.ok).toBe(true);
    if (!probed.ok) throw new Error("Authorized probe failed");
    const record = probed.value;
    expect(await service.httpProbe(record.id)).toEqual(record);
    expect(await service.store.saveHttpProbe(record)).toEqual(record);
    expect(await service.httpProbes(snapshot.id, { limit: 1 })).toMatchObject({
      total: 1,
      offset: 0,
      nextOffset: null,
      items: [
        {
          id: record.id,
          snapshotId: snapshot.id,
          state: "passed",
          evidenceId: record.evidence.id,
          proofSha256: record.evidence.source.sha256,
        },
      ],
    });

    const changed = {
      ...record,
      capture: { ...record.capture, statusCode: 201 },
    };
    expect(() => service.store.saveHttpProbe(changed)).toThrow();
    expect(await service.httpProbe(record.id)).toEqual(record);

    const database = new DatabaseSync(dbPath);
    try {
      expect(() =>
        database
          .prepare("UPDATE pie_http_probes SET created_at='changed' WHERE id=?")
          .run(record.id),
      ).toThrow("immutable");
      expect(() =>
        database
          .prepare("DELETE FROM pie_http_probes WHERE id=?")
          .run(record.id),
      ).toThrow("immutable");

      expect(() =>
        database
          .prepare("UPDATE pie_evidence SET payload='{}' WHERE id=?")
          .run(record.evidence.id),
      ).toThrow("imutável");
      expect(await service.httpProbe(record.id)).toEqual(record);
    } finally {
      database.close();
    }

    const api = await startPieApi(service, {
      root: repository,
      token: "local-http-probe-test-token-with-more-than-32-chars",
    });
    try {
      await verifyHttpApi({
        api,
        service,
        grant,
        snapshotId: snapshot.id,
        record,
      });
    } finally {
      await api.close();
    }
    await service.close();
    const reopened = await openStore(dbPath, repository);
    try {
      expect(reopened.httpProbe(record.id)).toEqual(record);
    } finally {
      reopened.close();
    }
  } finally {
    await service.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary, { recursive: true, force: true });
  }
});

it("rolls back evidence if publishing the probe fails inside the transaction", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-http-atomic-"));
  const repository = join(temporary, "repo");
  await mkdir(repository);
  await promisify(execFile)("git", ["init", repository]);
  await writeFile(join(repository, "index.ts"), "export const ready = true;");
  await promisify(execFile)("git", ["-C", repository, "add", "."]);
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");

  const store = await openStore(join(temporary, "pie.sqlite"), repository);
  const service = new PieService(store);
  try {
    const discovery = await service.discover({
      repositoryRoot: repository,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = await store.snapshot(discovery.snapshot.id);
    const database = new DatabaseSync(store.path);
    const previousEvidence = database
      .prepare("SELECT count(*) AS count FROM pie_evidence")
      .get()!.count as number;
    const grant = {
      schemaVersion: 1,
      profile: "VERIFY",
      allowLocalHttpRequests: true,
      environment: "local",
      repositoryRoot: repository,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      evidenceTtlMs: 30_000,
      request: {
        address: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: "/",
        timeoutMs: 2_000,
        maxResponseBytes: 1_024,
      },
      expectedStatus: 200,
      expectedBodySha256: null,
    };
    try {
      database.exec(`CREATE TRIGGER pie_test_fail_http_insert
        BEFORE INSERT ON pie_http_probes BEGIN
          SELECT RAISE(ABORT, 'injected publication failure');
        END;`);
      await expect(service.probeHttp(grant, repository)).rejects.toThrow(
        "injected publication failure",
      );
      expect(
        database.prepare("SELECT count(*) AS count FROM pie_evidence").get()!
          .count,
      ).toBe(previousEvidence);
    } finally {
      database.exec("DROP TRIGGER IF EXISTS pie_test_fail_http_insert");
      database.close();
    }
  } finally {
    await service.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary, { recursive: true, force: true });
  }
});

it("retains the atomic HTTP publication receipt when cancellation arrives during commit", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-http-cancel-commit-"));
  const repository = join(temporary, "repo");
  await mkdir(repository);
  await promisify(execFile)("git", ["init", repository]);
  await writeFile(join(repository, "index.ts"), "export const ready = true;");
  await promisify(execFile)("git", ["-C", repository, "add", "."]);
  const responseBody = "commit-cutoff";
  const digest = createHash("sha256").update(responseBody).digest("hex");
  const server = createServer((_request, response) =>
    response.end(responseBody),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const store = await openStore(join(temporary, "pie.sqlite"), repository);
  const baseService = new PieService(store);
  const enteredCommit = deferred<void>();
  const finishCommit = deferred<void>();
  try {
    const discovered = await baseService.discover({
      repositoryRoot: repository,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = await store.snapshot(discovered.snapshot.id);
    const grant = {
      schemaVersion: 1,
      profile: "VERIFY",
      allowLocalHttpRequests: true,
      environment: "local",
      repositoryRoot: repository,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      evidenceTtlMs: 30_000,
      request: {
        address: "127.0.0.1",
        port: address.port,
        path: "/health",
        method: "GET",
        timeoutMs: 2_000,
        maxResponseBytes: 1024,
      },
      expectedStatus: 200,
      expectedBodySha256: digest,
    };
    const persistence = new Proxy(store, {
      get(target, property) {
        if (property === "saveHttpProbe")
          return async (record: unknown) => {
            enteredCommit.resolve();
            await finishCommit.promise;
            return target.saveHttpProbe(record);
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = new PieService(persistence);
    const caller = new AbortController();
    const operation = service.probeHttp(grant, repository, caller.signal);
    await enteredCommit.promise;
    caller.abort(new Error("caller cancelled during commit"));
    finishCommit.resolve();
    const result = await operation;
    expect(result).toMatchObject({ ok: true, value: { state: "passed" } });
    if (!result.ok) throw new Error("Committed result was not returned");
    expect(await store.httpProbe(result.value.id)).toEqual(result.value);
  } finally {
    await baseService.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary, { recursive: true, force: true });
  }
});
