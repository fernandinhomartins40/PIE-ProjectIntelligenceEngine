import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { captureLocalHttp } from "../../src/pie/execution/httpTransport.js";
import {
  probeLocalHttp,
  verifyHttpProbe,
} from "../../src/pie/execution/httpProbe.js";
import { discoverProject } from "../../src/pie/discovery.js";

it("probe HTTP exige grant/snapshot/raiz, sela asserção observada sem afirmar identidade do servidor", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-http-probe-"));
  const exec = promisify(execFile);
  await exec("git", ["init", root]);
  await writeFile(
    join(root, "server.ts"),
    "throw new Error('workflow não executa alvo');",
  );
  await exec("git", ["-C", root, "add", "."]);
  const snapshot = await discoverProject(
    { repositoryRoot: root, profile: "OBSERVE", environment: "local" },
    randomUUID(),
  );
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end("fixture response");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowLocalHttpRequests: true,
    environment: "local",
    repositoryRoot: root,
    snapshotId: snapshot.id,
    treeDigest: snapshot.treeDigest,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    evidenceTtlMs: 1000,
    request: {
      address: "127.0.0.1",
      port: address.port,
      method: "GET",
      path: "/check?choice=1",
      timeoutMs: 1000,
      maxResponseBytes: 1000,
    },
    expectedStatus: 200,
    expectedBodySha256: createHash("sha256")
      .update("fixture response")
      .digest("hex"),
  };
  try {
    expect(
      await probeLocalHttp(
        { ...grant, expiresAt: new Date(0).toISOString() },
        snapshot,
        root,
      ),
    ).toMatchObject({ ok: false, error: { tag: "scope_denied" } });
    expect(
      await probeLocalHttp(
        { ...grant, treeDigest: "0".repeat(64) },
        snapshot,
        root,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await probeLocalHttp(
        { ...grant, allowLocalHttpRequests: false },
        snapshot,
        root,
      ),
    ).toMatchObject({ ok: false, error: { tag: "invalid_grant" } });
    expect(hits).toBe(0);
    const result = await probeLocalHttp(grant, snapshot, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("No probe result");
    const record = verifyHttpProbe(result.value);
    expect(record).toMatchObject({
      state: "passed",
      capture: { statusCode: 200, complete: true },
      evidence: {
        snapshotId: snapshot.id,
        state: "verified",
        method: "test",
        limitations: expect.arrayContaining([
          expect.stringContaining("não foi comprovado"),
        ]),
      },
    });
    expect(
      Date.parse(record.evidence.expiresAt!) - Date.parse(record.completedAt),
    ).toBe(1000);
    expect(() =>
      verifyHttpProbe({
        ...record,
        capture: { ...record.capture, bodyBytes: 999 },
      }),
    ).toThrow("integridade");
    expect(JSON.stringify(record)).not.toContain("fixture response");
    expect(
      await probeLocalHttp({ ...grant, expectedStatus: 201 }, snapshot, root),
    ).toMatchObject({
      ok: true,
      value: { state: "failed", evidence: { state: "failing" } },
    });
    expect(
      await probeLocalHttp(
        { ...grant, expectedBodySha256: "0".repeat(64) },
        snapshot,
        root,
      ),
    ).toMatchObject({ ok: true, value: { state: "failed" } });
    expect(
      await probeLocalHttp(
        { ...grant, request: { ...grant.request, maxResponseBytes: 2 } },
        snapshot,
        root,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        state: "inconclusive",
        capture: { complete: false },
        evidence: { state: "partial" },
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});

it("HTTP local real preserva caminho, não segue redirect e não retém corpo/cookies", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://outside.invalid/" });
      res.end();
      return;
    }
    res.writeHead(200, { "Set-Cookie": "session=fixture-sensitive" });
    res.end("real response body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server port");
  const selected = {
    address: "127.0.0.1",
    port: address.port,
    path: "/a%2Fb?choice=1",
    method: "GET",
    timeoutMs: 1000,
    maxResponseBytes: 1000,
  };
  try {
    const result = await captureLocalHttp(selected);
    expect(result).toMatchObject({
      ok: true,
      value: {
        statusCode: 200,
        complete: true,
        bodyBytes: 18,
        redirectsFollowed: 0,
        bodySha256: createHash("sha256")
          .update("real response body")
          .digest("hex"),
      },
    });
    expect(JSON.stringify(result)).not.toContain("real response body");
    expect(JSON.stringify(result)).not.toContain("fixture-sensitive");
    const redirect = await captureLocalHttp({ ...selected, path: "/redirect" });
    expect(redirect).toMatchObject({
      ok: true,
      value: { statusCode: 302, redirectsFollowed: 0 },
    });
    expect(paths).toEqual([selected.path, "/redirect"]);
    expect(
      await captureLocalHttp({ ...selected, method: "HEAD" }),
    ).toMatchObject({
      ok: true,
      value: { statusCode: 200, bodyBytes: 0, complete: true },
    });
    const invalid = await captureLocalHttp({
      ...selected,
      address: "example.com",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { tag: "invalid_request" },
    });
    expect(
      await captureLocalHttp({ ...selected, path: "/não-codificado" }),
    ).toMatchObject({ ok: false, error: { tag: "invalid_request" } });
    expect(paths).toHaveLength(3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("HTTP limita bytes, prazo e cancelamento, drena sockets e preserva fatos parciais", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/large") {
      res.end("1234567890");
      return;
    }
    if (req.url === "/broken") {
      res.writeHead(200, { "Content-Length": "100" });
      res.write("partial");
      setImmediate(() => res.destroy());
      return;
    }
    res.writeHead(200);
    res.write("start");
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server port");
  const selected = {
    address: "127.0.0.1",
    port: address.port,
    path: "/large",
    method: "GET",
    timeoutMs: 1000,
    maxResponseBytes: 4,
  };
  try {
    expect(await captureLocalHttp(selected)).toMatchObject({
      ok: false,
      error: {
        tag: "response_limit",
        partial: { bodyBytes: 4, complete: false },
      },
    });
    expect(
      await captureLocalHttp({
        ...selected,
        path: "/hang",
        maxResponseBytes: 100,
        timeoutMs: 50,
      }),
    ).toMatchObject({
      ok: false,
      error: { tag: "timeout", partial: { statusCode: 200, complete: false } },
    });
    expect(
      await captureLocalHttp({
        ...selected,
        path: "/broken",
        maxResponseBytes: 100,
      }),
    ).toMatchObject({
      ok: false,
      error: { tag: "transport", partial: { complete: false } },
    });
    const controller = new AbortController();
    const ongoing = captureLocalHttp(
      { ...selected, path: "/hang", maxResponseBytes: 100 },
      controller.signal,
    );
    await expect.poll(() => sockets.size).toBeGreaterThan(0);
    controller.abort();
    expect(await ongoing).toMatchObject({
      ok: false,
      error: { tag: "cancelled", partial: { complete: false } },
    });
    await expect.poll(() => sockets.size).toBe(0);
    expect(await captureLocalHttp(selected, AbortSignal.abort())).toMatchObject(
      { ok: false, error: { tag: "cancelled" } },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
