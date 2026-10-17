import { request } from "node:http";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { err, ok, type Result } from "../../domain/result.js";

/** A transport selection is internal; public admission must additionally bind operator authority. */
export const localHttpRequestSchema = z.strictObject({
  address: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65535),
  path: z
    .string()
    .min(1)
    .max(8192)
    .refine(
      (value) =>
        value.startsWith("/") &&
        /^[\x21-\x7e]+$/.test(value) &&
        !/[\\#]/.test(value),
      "Caminho HTTP codificado inválido.",
    ),
  method: z.enum(["GET", "HEAD"]),
  timeoutMs: z.number().int().min(10).max(30000),
  maxResponseBytes: z.number().int().min(1).max(10_000_000),
});
export interface HttpCapture {
  statusCode: number | null;
  bodyBytes: number;
  bodySha256: string;
  complete: boolean;
  elapsedMs: number;
  redirectsFollowed: 0;
}
export type HttpTransportFailure = {
  tag:
    | "invalid_request"
    | "cancelled"
    | "timeout"
    | "response_limit"
    | "transport";
  partial: HttpCapture;
};

/** Local, no DNS/proxy/cookies/redirects. Hashes bounded bytes; never retains response bodies or headers. */
export async function captureLocalHttp(
  input: unknown,
  signal?: AbortSignal,
): Promise<Result<HttpCapture, HttpTransportFailure>> {
  const started = performance.now();
  const hash = createHash("sha256");
  let statusCode: number | null = null;
  let bodyBytes = 0;
  const capture = (complete: boolean): HttpCapture => ({
    statusCode,
    bodyBytes,
    bodySha256: hash.copy().digest("hex"),
    complete,
    elapsedMs: performance.now() - started,
    redirectsFollowed: 0,
  });
  const parsed = localHttpRequestSchema.safeParse(input);
  if (!parsed.success)
    return err({ tag: "invalid_request", partial: capture(false) });
  if (signal?.aborted)
    return err({ tag: "cancelled", partial: capture(false) });
  const selected = parsed.data;
  return new Promise((resolve) => {
    let failure: HttpTransportFailure["tag"] | undefined;
    let complete = false;
    let settled = false;
    let response: import("node:http").IncomingMessage | undefined;
    // Literal destination and agent:false keep transport independent of ambient proxy/DNS/pools.
    const client = request(
      {
        host: selected.address,
        port: selected.port,
        path: selected.path,
        method: selected.method,
        agent: false,
        maxHeaderSize: 16384,
        headers: { Connection: "close" },
      },
      (incoming) => {
        response = incoming;
        statusCode = incoming.statusCode ?? null;
        incoming.on("data", (chunk: Buffer) => {
          if (failure) return;
          const remaining = selected.maxResponseBytes - bodyBytes;
          if (chunk.byteLength > remaining) {
            hash.update(chunk.subarray(0, remaining));
            bodyBytes += remaining;
            stop("response_limit");
          } else {
            hash.update(chunk);
            bodyBytes += chunk.byteLength;
          }
        });
        incoming.once("end", () => {
          complete = incoming.complete;
          if (!complete) stop("transport");
        });
        incoming.once("error", () => stop("transport"));
        incoming.once("aborted", () => stop("transport"));
      },
    );
    function stop(tag: HttpTransportFailure["tag"]) {
      failure ??= tag;
      response?.destroy();
      client.destroy();
    }
    const cancel = () => stop("cancelled");
    const timeout = setTimeout(() => stop("timeout"), selected.timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    client.once("error", () => stop("transport"));
    // No publication before the owned request/socket finishes finalization.
    client.once("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      const result = capture(!failure && complete);
      resolve(
        failure || !complete
          ? err({ tag: failure ?? "transport", partial: result })
          : ok(result),
      );
    });
    if (signal?.aborted) cancel();
    client.end();
  });
}
