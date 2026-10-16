import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const equalSecret = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
type Session = { csrfToken: string; expiresAt: number };
const key = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Bounded, process-local browser sessions; no API secret is stored in cookies. */
export class BrowserSessions {
  readonly #sessions = new Map<string, Session>();
  #failures = 0;
  #window = 0;
  constructor(
    private readonly apiToken: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30 * 60_000,
  ) {}

  #cookie(request: IncomingMessage): string | null {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith("pie_session="));
    if (values.length !== 1) return null;
    const value = values[0]!.slice("pie_session=".length);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  #find(request: IncomingMessage): Session | null {
    for (const [id, session] of this.#sessions)
      if (session.expiresAt <= this.now()) this.#sessions.delete(id);
    const cookie = this.#cookie(request);
    return cookie ? (this.#sessions.get(key(cookie)) ?? null) : null;
  }
  info(request: IncomingMessage) {
    const session = this.#find(request);
    return session
      ? { authenticated: true, ...session }
      : { authenticated: false, csrfToken: null, expiresAt: null };
  }
  login(request: IncomingMessage, token: string) {
    if (this.now() - this.#window >= 60_000) {
      this.#window = this.now();
      this.#failures = 0;
    }
    if (this.#failures >= 10)
      return { status: 429, cookie: null, info: null } as const;
    if (!equalSecret(token, this.apiToken)) {
      this.#failures++;
      return { status: 401, cookie: null, info: null } as const;
    }
    this.logout(request);
    if (this.#sessions.size >= 16)
      this.#sessions.delete(this.#sessions.keys().next().value!);
    const cookie = randomBytes(32).toString("base64url");
    const session = {
      csrfToken: randomBytes(32).toString("base64url"),
      expiresAt: this.now() + this.ttlMs,
    };
    this.#sessions.set(key(cookie), session);
    return {
      status: 200,
      cookie: `pie_session=${cookie}; HttpOnly; SameSite=Strict; Path=/v1; Max-Age=${Math.floor(this.ttlMs / 1000)}`,
      info: { authenticated: true, ...session },
    } as const;
  }
  authorized(request: IncomingMessage, origin: string): boolean {
    const session = this.#find(request);
    if (!session) return false;
    if (request.method === "GET" || request.method === "HEAD") return true;
    return (
      request.headers.origin === origin &&
      typeof request.headers["x-pie-csrf"] === "string" &&
      equalSecret(request.headers["x-pie-csrf"], session.csrfToken)
    );
  }
  logout(request: IncomingMessage): string {
    const cookie = this.#cookie(request);
    if (cookie) this.#sessions.delete(key(cookie));
    return "pie_session=; HttpOnly; SameSite=Strict; Path=/v1; Max-Age=0";
  }
  clear(): void {
    this.#sessions.clear();
  }
}
