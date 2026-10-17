import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { pageSchema } from "./graph.js";
import { httpGrantSchema } from "./execution/httpProbe.js";
import type { PieService } from "./service.js";

interface HttpProbeRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  service: PieService;
  authorizedRoot: string;
  url: URL;
  segments: string[];
  readBody(request: IncomingMessage): Promise<unknown>;
  respond(response: ServerResponse, status: number, value: unknown): void;
}

export async function handleHttpProbeRoute(
  context: HttpProbeRouteContext,
): Promise<boolean> {
  const { request, response, service, authorizedRoot, url, segments } = context;
  if (request.method === "POST" && url.pathname === "/v1/http-probes") {
    const controller = new AbortController();
    const cancel = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once("close", cancel);
    try {
      const outcome = await service.probeHttp(
        httpGrantSchema.parse(await context.readBody(request)),
        authorizedRoot,
        controller.signal,
      );
      context.respond(response, outcome.ok ? 201 : 403, outcome);
    } finally {
      response.off("close", cancel);
    }
    return true;
  }
  if (request.method !== "GET" || segments[0] !== "v1") return false;
  if (segments.length === 2 && segments[1] === "http-probes") {
    context.respond(
      response,
      200,
      await service.httpProbes(
        z.string().uuid().parse(url.searchParams.get("snapshotId")),
        pageSchema.parse({
          offset: Number(url.searchParams.get("offset") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 50),
        }),
      ),
    );
    return true;
  }
  if (segments.length === 3 && segments[1] === "http-probes") {
    context.respond(
      response,
      200,
      await service.httpProbe(z.string().uuid().parse(segments[2])),
    );
    return true;
  }
  return false;
}
