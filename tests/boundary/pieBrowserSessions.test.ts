import type { IncomingMessage } from "node:http";
import { expect, it } from "vitest";
import { BrowserSessions } from "../../src/pie/browserSessions.js";

function request(input: {
  method: string;
  cookie?: string;
  origin?: string;
  csrf?: string;
}): IncomingMessage {
  return {
    method: input.method,
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.csrf ? { "x-pie-csrf": input.csrf } : {}),
    },
  } as unknown as IncomingMessage;
}

function cookieValue(setCookie: string) {
  return setCookie.split(";")[0]!;
}

it("binds browser writes to the session, same origin, CSRF token, and TTL", () => {
  let now = 100_000;
  const sessions = new BrowserSessions("local-api-secret", () => now, 1000);
  const origin = "http://127.0.0.1:4321";
  const login = sessions.login(
    request({ method: "POST", cookie: "" }),
    "local-api-secret",
  );
  expect(login.status).toBe(200);
  expect(login.cookie).toContain("HttpOnly");
  expect(login.cookie).toContain("SameSite=Strict");
  expect(login.cookie).not.toContain("local-api-secret");
  const cookie = cookieValue(login.cookie!);
  const csrf = login.info!.csrfToken;

  expect(sessions.authorized(request({ method: "GET", cookie }), origin)).toBe(
    true,
  );
  expect(
    sessions.authorized(
      request({ method: "POST", cookie, origin, csrf }),
      origin,
    ),
  ).toBe(true);
  expect(
    sessions.authorized(request({ method: "POST", cookie, origin }), origin),
  ).toBe(false);
  expect(
    sessions.authorized(
      request({ method: "POST", cookie, origin, csrf: "wrong" }),
      origin,
    ),
  ).toBe(false);
  expect(
    sessions.authorized(
      request({
        method: "POST",
        cookie,
        origin: "https://untrusted.invalid",
        csrf,
      }),
      origin,
    ),
  ).toBe(false);

  now += 1001;
  expect(sessions.authorized(request({ method: "GET", cookie }), origin)).toBe(
    false,
  );
  expect(sessions.info(request({ method: "GET", cookie })).authenticated).toBe(
    false,
  );
});

it("rate limits failed login attempts and opens a fresh window after expiry", () => {
  let now = 100_000;
  const sessions = new BrowserSessions("local-api-secret", () => now);
  const loginRequest = request({ method: "POST" });
  for (let attempt = 0; attempt < 10; attempt++)
    expect(sessions.login(loginRequest, "incorrect").status).toBe(401);
  expect(sessions.login(loginRequest, "local-api-secret").status).toBe(429);
  now += 60_001;
  expect(sessions.login(loginRequest, "incorrect").status).toBe(401);
  expect(sessions.login(loginRequest, "local-api-secret").status).toBe(200);
});

it("evicts the oldest bounded session and invalidates a logged out cookie", () => {
  const sessions = new BrowserSessions("local-api-secret");
  const origin = "http://127.0.0.1:4321";
  const cookies: Array<{ cookie: string; csrf: string }> = [];
  for (let index = 0; index < 17; index++) {
    const login = sessions.login(
      request({ method: "POST" }),
      "local-api-secret",
    );
    cookies.push({
      cookie: cookieValue(login.cookie!),
      csrf: login.info!.csrfToken,
    });
  }
  expect(
    sessions.authorized(
      request({ method: "GET", cookie: cookies[0]!.cookie }),
      origin,
    ),
  ).toBe(false);
  const newest = cookies.at(-1)!;
  const logoutRequest = request({
    method: "DELETE",
    cookie: newest.cookie,
    origin,
    csrf: newest.csrf,
  });
  expect(sessions.logout(logoutRequest)).toContain("Max-Age=0");
  expect(
    sessions.authorized(
      request({ method: "GET", cookie: newest.cookie }),
      origin,
    ),
  ).toBe(false);
});
