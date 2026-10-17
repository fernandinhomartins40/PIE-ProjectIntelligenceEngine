import { timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { PieError } from "./contracts.js";
import { PieService } from "./service.js";
import { pageSchema } from "./graph.js";
import type { JobQueue } from "./jobs/contracts.js";
import { BrowserSessions } from "./browserSessions.js";
import { loadWebAssets, WEB_CSP } from "./webAssets.js";
import type { VerificationCoordinator } from "./execution/coordinator.js";
import { enqueueVerification } from "./jobs/verification.js";
import { scopedJob } from "./jobs/access.js";
import { functionalInput } from "./functional.js";
import { dataReviewInput } from "./dataReview.js";
import { exportSnapshotInput } from "./exportSnapshot.js";
import { functionalRecordExportInput } from "./functionalRecord.js";
import { verificationExportInput } from "./execution/runContracts.js";
import { handleHttpProbeRoute } from "./httpProbeApiRoute.js";

function authenticate(request: IncomingMessage, token: string): boolean {
  const provided = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function respond(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json")
    throw new PieError("INVALID_INPUT", "Envie application/json.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += value.length;
    if (bytes > 16_384)
      throw new PieError("LIMIT_EXCEEDED", "Corpo excede 16 KiB.");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Local-only API. No remote bind, ambient credentials, arbitrary target root or CORS. */
export async function startPieApi(
  service: PieService,
  options: {
    root: string;
    token: string;
    port?: number;
    queue?: JobQueue;
    webDirectory?: string;
    verifier?: VerificationCoordinator;
  },
) {
  z.string().min(32).max(512).parse(options.token);
  await service.store.assertOutside(options.root);
  const authorizedRoot = await realpath(options.root);
  if (options.verifier && options.verifier.options.root !== authorizedRoot)
    throw new PieError(
      "POLICY_DENIED",
      "Verificador pertence a outra raiz autorizada.",
    );
  const assets = options.webDirectory
    ? await loadWebAssets(options.webDirectory)
    : null;
  const sessions = assets ? new BrowserSessions(options.token) : null;
  const server = createServer((request, response) => {
    const run = async () => {
      const expectedHost = `127.0.0.1:${request.socket.localPort}`;
      const origin = `http://${expectedHost}`;
      if (request.headers.host !== expectedHost) {
        respond(response, 403, { error: { code: "HOST_DENIED" } });
        return;
      }
      if (
        request.headers.origin &&
        (!sessions || request.headers.origin !== origin)
      ) {
        respond(response, 403, { error: { code: "ORIGIN_DENIED" } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const asset = assets?.get(url.pathname);
      if (asset && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": asset.type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": WEB_CSP,
          "Referrer-Policy": "no-referrer",
        });
        response.end(asset.bytes);
        return;
      }
      if (sessions && url.pathname === "/v1/session") {
        if (request.method === "GET") {
          respond(response, 200, sessions.info(request));
          return;
        }
        if (request.method === "POST") {
          if (request.headers.origin !== origin) {
            respond(response, 403, { error: { code: "ORIGIN_REQUIRED" } });
            return;
          }
          const input = z
            .strictObject({ token: z.string().min(1).max(512) })
            .parse(await body(request));
          const login = sessions.login(request, input.token);
          if (login.cookie) response.setHeader("Set-Cookie", login.cookie);
          respond(
            response,
            login.status,
            login.info ?? {
              error: {
                code:
                  login.status === 429 ? "LOGIN_RATE_LIMIT" : "UNAUTHORIZED",
              },
            },
          );
          return;
        }
        if (request.method === "DELETE") {
          if (!sessions.authorized(request, origin)) {
            respond(response, 403, {
              error: { code: "CSRF_OR_SESSION_INVALID" },
            });
            return;
          }
          response.setHeader("Set-Cookie", sessions.logout(request));
          respond(response, 200, { authenticated: false });
          return;
        }
      }
      if (
        !authenticate(request, options.token) &&
        !sessions?.authorized(request, origin)
      ) {
        respond(response, sessions?.info(request).authenticated ? 403 : 401, {
          error: {
            code: sessions?.info(request).authenticated
              ? "CSRF_INVALID"
              : "UNAUTHORIZED",
          },
        });
        return;
      }
      const paging = () =>
        pageSchema.parse({
          offset: Number(url.searchParams.get("offset") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
      const segments = url.pathname.split("/").filter(Boolean);
      const requireSnapshot = async (id: string) => {
        const snapshot = await service.store.snapshot(id);
        if (snapshot.root !== authorizedRoot)
          throw new PieError("NOT_FOUND", "Snapshot nÃ£o encontrado.");
        return snapshot;
      };
      const requireProject = async (id: string) => {
        const project = await service.project(id);
        if (project.root !== authorizedRoot)
          throw new PieError("NOT_FOUND", "Projeto nÃ£o encontrado.");
        return project;
      };
      const requireVerification = async (id: string) => {
        const run = await service.verification(id);
        await requireSnapshot(run.snapshotId);
        return run;
      };
      const requireFunctionalRecord = async (id: string) => {
        const record = await service.functionalRecord(id);
        await requireSnapshot(record.snapshotId);
        return record;
      };
      const requireHttpProbe = async (id: string) => {
        const probe = await service.httpProbe(id);
        await requireSnapshot(probe.snapshotId);
        return probe;
      };
      if (
        request.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "v1" &&
        segments[1] === "snapshots" &&
        segments[3] === "export"
      ) {
        await requireSnapshot(segments[2]!);
        respond(
          response,
          200,
          await service.exportSnapshot(
            exportSnapshotInput.parse({
              snapshotId: segments[2],
              format: url.searchParams.get("format") ?? "json",
              offset: Number(url.searchParams.get("offset") ?? 0),
              limitBytes: Number(url.searchParams.get("limitBytes") ?? 65_536),
            }),
          ),
        );
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "v1" &&
        segments[1] === "verifications" &&
        segments[3] === "export"
      ) {
        await requireVerification(segments[2]!);
        respond(
          response,
          200,
          await service.exportVerification(
            verificationExportInput.parse({
              id: segments[2],
              offset: Number(url.searchParams.get("offset") ?? 0),
              limitBytes: Number(url.searchParams.get("limitBytes") ?? 65_536),
            }),
          ),
        );
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "v1" &&
        segments[1] === "projects" &&
        segments[3] === "verifications"
      ) {
        const projectId = z.string().uuid().parse(segments[2]);
        await requireProject(projectId);
        respond(
          response,
          200,
          await service.projectVerifications(projectId, paging()),
        );
        return;
      }
      if (
        await handleHttpProbeRoute({
          request,
          response,
          service,
          authorizedRoot,
          requireSnapshot,
          requireHttpProbe,
          url,
          segments,
          readBody: body,
          respond,
        })
      )
        return;
      if (request.method === "POST" && url.pathname === "/v1/verify") {
        if (!options.verifier) {
          respond(response, 403, { error: { code: "VERIFICATION_DISABLED" } });
          return;
        }
        const controller = new AbortController();
        const cancel = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.once("close", cancel);
        try {
          respond(
            response,
            201,
            await options.verifier.run(await body(request), controller.signal),
          );
        } finally {
          response.off("close", cancel);
        }
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/jobs/verification"
      ) {
        if (!options.queue || !options.verifier) {
          respond(response, 403, { error: { code: "VERIFICATION_DISABLED" } });
          return;
        }
        respond(
          response,
          202,
          await enqueueVerification(
            options.queue,
            options.verifier,
            await body(request),
          ),
        );
        return;
      }
      if (
        options.queue &&
        request.method === "POST" &&
        url.pathname === "/v1/jobs"
      ) {
        const input = z
          .strictObject({
            idempotencyKey: z.string().min(1).max(200),
            maxFiles: z.number().int().positive().max(100_000).default(10_000),
          })
          .parse(await body(request));
        respond(
          response,
          202,
          await options.queue.enqueue({
            idempotencyKey: input.idempotencyKey,
            kind: "discovery",
            payload: {
              repositoryRoot: authorizedRoot,
              profile: "OBSERVE",
              environment: "local",
              maxFiles: input.maxFiles,
            },
          }),
        );
        return;
      }
      if (
        options.queue &&
        request.method === "GET" &&
        segments.length === 3 &&
        segments[1] === "jobs" &&
        segments[0] === "v1"
      ) {
        respond(
          response,
          200,
          await scopedJob(
            options.queue,
            authorizedRoot,
            z.string().uuid().parse(segments[2]),
          ),
        );
        return;
      }
      if (
        options.queue &&
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "v1" &&
        segments[1] === "jobs" &&
        segments[3] === "cancel"
      ) {
        await scopedJob(
          options.queue,
          authorizedRoot,
          z.string().uuid().parse(segments[2]),
        );
        respond(
          response,
          200,
          await options.queue.cancel(z.string().uuid().parse(segments[2])),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/retest-plan") {
        const input = await body(request);
        const ids = z
          .object({ beforeId: z.string().uuid(), afterId: z.string().uuid() })
          .parse(input);
        await Promise.all([
          requireSnapshot(ids.beforeId),
          requireSnapshot(ids.afterId),
        ]);
        respond(response, 200, await service.retestPlan(input));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/verification-comparison"
      ) {
        const input = await body(request);
        const ids = z
          .object({
            beforeRunId: z.string().uuid(),
            afterRunId: z.string().uuid(),
          })
          .parse(input);
        await Promise.all([
          requireVerification(ids.beforeRunId),
          requireVerification(ids.afterRunId),
        ]);
        respond(response, 200, await service.verificationComparison(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/functional") {
        const input = functionalInput.parse(await body(request));
        await requireSnapshot(input.snapshotId);
        respond(response, 200, await service.functional(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/product") {
        const input = functionalInput.parse(await body(request));
        await requireSnapshot(input.snapshotId);
        respond(response, 200, await service.product(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/data-review") {
        const input = dataReviewInput.parse(await body(request));
        await requireSnapshot(input.snapshotId);
        respond(response, 200, await service.dataReview(input));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/functional-records"
      ) {
        await requireSnapshot(
          z.string().uuid().parse(url.searchParams.get("snapshotId")),
        );
        respond(
          response,
          200,
          await service.functionalRecords(
            z.string().uuid().parse(url.searchParams.get("snapshotId")),
            paging(),
          ),
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/functional-records"
      ) {
        const input = await body(request);
        await requireSnapshot(functionalInput.parse(input).snapshotId);
        respond(response, 201, await service.retainFunctional(input));
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 3 &&
        segments[0] === "v1" &&
        segments[1] === "functional-records"
      ) {
        await requireFunctionalRecord(z.string().uuid().parse(segments[2]));
        respond(
          response,
          200,
          await service.functionalRecord(z.string().uuid().parse(segments[2])),
        );
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "v1" &&
        segments[1] === "functional-records" &&
        segments[3] === "export"
      ) {
        await requireFunctionalRecord(z.string().uuid().parse(segments[2]));
        respond(
          response,
          200,
          await service.exportFunctionalRecord(
            functionalRecordExportInput.parse({
              id: segments[2],
              offset: Number(url.searchParams.get("offset") ?? 0),
              limitBytes: Number(url.searchParams.get("limitBytes") ?? 65_536),
            }),
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/health") {
        respond(response, 200, {
          schemaVersion: 1,
          status: "ready",
          profile: "OBSERVE",
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/context") {
        respond(response, 200, {
          root: authorizedRoot,
          profile: "OBSERVE",
          verificationEnabled: options.verifier !== undefined,
          verificationQueueEnabled:
            options.verifier !== undefined && options.queue !== undefined,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/projects") {
        const { offset, limit } = paging();
        const selected: Awaited<ReturnType<PieService["projects"]>>["items"] =
          [];
        let projectOffset = 0;
        let scopedTotal = 0;
        for (;;) {
          const projects = await service.projects({
            offset: projectOffset,
            limit: 200,
          });
          for (const project of projects.items) {
            if (project.root !== authorizedRoot) continue;
            if (scopedTotal >= offset && selected.length < limit)
              selected.push(project);
            scopedTotal += 1;
          }
          if (projects.nextOffset === null) break;
          projectOffset = projects.nextOffset;
        }
        respond(response, 200, {
          items: selected,
          total: scopedTotal,
          offset,
          nextOffset:
            offset + selected.length < scopedTotal
              ? offset + selected.length
              : null,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/discover") {
        const input = z
          .strictObject({
            maxFiles: z.number().int().positive().max(100_000).default(10_000),
          })
          .parse(await body(request));
        const controller = new AbortController();
        const cancel = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.once("close", cancel);
        try {
          respond(
            response,
            201,
            await service.discover(
              {
                repositoryRoot: options.root,
                profile: "OBSERVE",
                environment: "local",
                ...input,
              },
              controller.signal,
            ),
          );
        } finally {
          response.off("close", cancel);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/compare") {
        const input = await body(request);
        const ids = z
          .object({ beforeId: z.string().uuid(), afterId: z.string().uuid() })
          .parse(input);
        await Promise.all([
          requireSnapshot(ids.beforeId),
          requireSnapshot(ids.afterId),
        ]);
        respond(response, 200, await service.compare(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/trace") {
        const input = await body(request);
        await requireSnapshot(
          z.object({ snapshotId: z.string().uuid() }).parse(input).snapshotId,
        );
        respond(response, 200, await service.trace(input));
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 3 &&
        segments[0] === "v1"
      ) {
        const id = z.string().uuid().parse(segments[2]);
        switch (segments[1]) {
          case "verification":
            await requireVerification(id);
            respond(response, 200, await service.verification(id));
            return;
          case "verifications":
            await requireSnapshot(id);
            respond(response, 200, await service.verifications(id, paging()));
            return;
          case "graph":
            await requireSnapshot(id);
            respond(response, 200, await service.graph(id, paging()));
            return;
          case "declarations":
            await requireSnapshot(id);
            respond(response, 200, await service.declarations(id, paging()));
            return;
          case "evidence":
            await requireSnapshot(await service.store.evidenceSnapshotId(id));
            respond(response, 200, await service.evidence(id));
            return;
          case "history":
            await requireProject(id);
            respond(response, 200, await service.history(id, paging()));
            return;
        }
      }
      respond(response, 404, { error: { code: "NOT_FOUND" } });
    };
    void run().catch((cause) => {
      if (response.destroyed) return;
      const code = cause instanceof PieError ? cause.code : "INVALID_INPUT";
      respond(
        response,
        code === "NOT_FOUND"
          ? 404
          : code === "POLICY_DENIED"
            ? 403
            : code === "LIMIT_EXCEEDED"
              ? 413
              : code === "BUSY"
                ? 429
                : 400,
        {
          error: {
            code,
            message:
              cause instanceof PieError
                ? cause.message
                : "Entrada inválida ou operação indisponível.",
          },
        },
      );
    });
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 16;
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new PieError("IO_ERROR", "API sem endereço local.");
  let closing: Promise<void> | undefined;
  let networkClosed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      closing ??= (async () => {
        networkClosed ??= new Promise<void>((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept())),
        );
        await options.verifier?.close();
        server.closeIdleConnections();
        // Drain admitted requests, including queue admission, before releasing their store.
        await networkClosed;
        await service.close();
        sessions?.clear();
      })().catch((cause) => {
        closing = undefined;
        throw cause;
      });
      return closing;
    },
  };
}
