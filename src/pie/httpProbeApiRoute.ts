import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { pageSchema } from "./graph.js";
import {
  httpGrantSchema,
  type httpProbeSchema,
} from "./execution/httpProbe.js";
import type { PieService } from "./service.js";
import { httpProbeExportInput } from "./execution/httpProbeExport.js";

interface HttpProbeRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  service: PieService;
  authorizedRoot: string;
  url: URL;
  segments: string[];
  requireSnapshot(id: string): Promise<unknown>;
  requireHttpProbe(id: string): Promise<z.infer<typeof httpProbeSchema>>;
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
    await context.requireSnapshot(
      z.string().uuid().parse(url.searchParams.get("snapshotId")),
    );
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
    const probe = await context.requireHttpProbe(
      z.string().uuid().parse(segments[2]),
    );
    context.respond(response, 200, probe);
    return true;
  }
  if (
    segments.length === 4 &&
    segments[1] === "http-probes" &&
    segments[3] === "export"
  ) {
    const id = z.string().uuid().parse(segments[2]);
    await context.requireHttpProbe(id);
    context.respond(
      response,
      200,
      await service.exportHttpProbe(
        httpProbeExportInput.parse({
          id,
          format: url.searchParams.get("format") ?? "json",
          offset: Number(url.searchParams.get("offset") ?? 0),
          limitBytes: Number(url.searchParams.get("limitBytes") ?? 65_536),
        }),
      ),
    );
    return true;
  }
  return false;
}
