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
  options: { root: string; token: string; port?: number; queue?: JobQueue },
) {
  z.string().min(32).parse(options.token);
  await service.store.assertOutside(options.root);
  const authorizedRoot = await realpath(options.root);
  const server = createServer((request, response) => {
    const run = async () => {
      if (request.headers.origin) {
        respond(response, 403, { error: { code: "ORIGIN_DENIED" } });
        return;
      }
      if (!authenticate(request, options.token)) {
        respond(response, 401, { error: { code: "UNAUTHORIZED" } });
        return;
      }
      const host = request.headers.host ?? "";
      if (!/^127\.0\.0\.1:\d+$/.test(host)) {
        respond(response, 403, { error: { code: "HOST_DENIED" } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const paging = () =>
        pageSchema.parse({
          offset: Number(url.searchParams.get("offset") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
      const segments = url.pathname.split("/").filter(Boolean);
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
          await options.queue.get(z.string().uuid().parse(segments[2])),
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
        respond(
          response,
          200,
          await options.queue.cancel(z.string().uuid().parse(segments[2])),
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
      if (request.method === "GET" && url.pathname === "/v1/projects") {
        respond(response, 200, await service.projects(paging()));
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
        respond(response, 200, await service.compare(await body(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/trace") {
        respond(response, 200, await service.trace(await body(request)));
        return;
      }
      if (
        request.method === "GET" &&
        segments.length === 3 &&
        segments[0] === "v1"
      ) {
        const id = z.string().uuid().parse(segments[2]);
        switch (segments[1]) {
          case "graph":
            respond(response, 200, await service.graph(id, paging()));
            return;
          case "declarations":
            respond(response, 200, await service.declarations(id, paging()));
            return;
          case "evidence":
            respond(response, 200, await service.evidence(id));
            return;
          case "history":
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
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      closing ??= (async () => {
        const closed = new Promise<void>((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept())),
        );
        await service.close();
        server.closeIdleConnections();
        await closed;
      })();
      return closing;
    },
  };
}
