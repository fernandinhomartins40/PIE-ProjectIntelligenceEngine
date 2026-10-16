import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";

it("sessão do painel exige origem e CSRF, preserva Bearer e revoga cookie no logout", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-browser-auth-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(join(repo, "index.ts"), "export const value = 1;");
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const token = "fixture-browser-token-only-32-characters-minimum";
  const store = await openStore(join(root, "api.sqlite"), repo);
  const api = await startPieApi(new PieService(store), {
    root: repo,
    token,
    webDirectory: resolve("dist/pie-web"),
  });
  const login = (secret: string, origin?: string) =>
    fetch(`${api.url}/v1/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ token: secret }),
    });
  try {
    const page = await fetch(api.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(await page.text()).not.toContain(token);
    expect((await login(token)).status).toBe(403);
    expect((await login(token, "https://untrusted.invalid")).status).toBe(403);
    expect((await login("wrong", api.url)).status).toBe(401);
    const connected = await login(token, api.url);
    expect(connected.status).toBe(200);
    const cookieHeader = connected.headers.get("set-cookie")!;
    expect(cookieHeader).toContain("HttpOnly; SameSite=Strict; Path=/v1");
    expect(cookieHeader).not.toContain(token);
    const cookie = cookieHeader.split(";")[0]!;
    const session = (await connected.json()) as { csrfToken: string };
    const headers = {
      Cookie: cookie,
      Origin: api.url,
      "Content-Type": "application/json",
    };
    expect((await fetch(`${api.url}/v1/projects`, { headers })).status).toBe(
      200,
    );
    expect(
      (
        await fetch(`${api.url}/v1/discover`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const authenticated = { ...headers, "X-PIE-CSRF": session.csrfToken };
    const discovery = await fetch(`${api.url}/v1/discover`, {
      method: "POST",
      headers: authenticated,
      body: "{}",
    });
    expect(discovery.status).toBe(201);
    expect(await discovery.json()).toMatchObject({
      coverage: { runtime: false },
      nodeCount: 1,
    });
    expect(
      (
        await fetch(`${api.url}/v1/projects`, {
          headers: { ...authenticated, Origin: "https://untrusted.invalid" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${api.url}/v1/session`, {
          method: "DELETE",
          headers: authenticated,
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${api.url}/v1/projects`, { headers })).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${api.url}/v1/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    for (let index = 0; index < 9; index++)
      expect((await login("wrong", api.url)).status).toBe(401);
    expect((await login(token, api.url)).status).toBe(429);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
