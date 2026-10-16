import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { startPieApi } from "../../src/pie/api.js";
import { PieService } from "../../src/pie/service.js";
import { openStore } from "../../src/pie/store.js";

const executablePath =
  process.env.PIE_BROWSER_EXECUTABLE ??
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");

it.skipIf(!existsSync(executablePath))(
  "painel usa descoberta, evidência, trace e comparação reais em navegador",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const value = 1;");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ dependencies: { react: "18.3.1" } }),
    );
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "api.sqlite"), repo);
    const token = "fixture-web-token-only-32-characters-minimum";
    const api = await startPieApi(new PieService(store), {
      root: repo,
      token,
      webDirectory: resolve("dist/pie-web"),
    });
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (entry) => {
        if (entry.text().includes("Content Security Policy"))
          errors.push(entry.text());
      });
      await page.goto(api.url);
      await page.getByLabel("Credencial do serviço local").fill(token);
      await page.getByLabel("Credencial do serviço local").press("Tab");
      expect(
        await page.evaluate(
          "document.activeElement?.textContent === 'Conectar ao PIE'",
        ),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Nova investigação" }).click();
      await page.getByRole("cell", { name: "index.ts", exact: true }).waitFor();
      await page
        .getByRole("row")
        .filter({
          has: page.getByRole("cell", { name: "index.ts", exact: true }),
        })
        .getByRole("button", { name: "Ver evidência" })
        .click();
      await page
        .getByRole("heading", { name: "Evidência observada" })
        .waitFor();
      await page
        .getByRole("button", { name: "Declarações", exact: true })
        .click();
      await page.getByRole("cell", { name: /^react/ }).waitFor();
      await page.getByRole("button", { name: "Rastrear", exact: true }).click();
      await page.getByRole("button", { name: "Rastrear relações" }).click();
      await page
        .getByRole("table", { name: "Nós alcançados no trace" })
        .waitFor();
      await writeFile(join(repo, "index.ts"), "export const value = 2;");
      await page.getByRole("button", { name: "Nova investigação" }).click();
      await expect.poll(() => page.locator("#snapshot option").count()).toBe(3);
      await expect
        .poll(() =>
          page.getByLabel("Snapshot observado", { exact: true }).isEnabled(),
        )
        .toBe(true);
      await page.getByRole("button", { name: "Comparar versões" }).click();
      await page
        .getByLabel("Comparar snapshot atual com")
        .selectOption({ index: 1 });
      await page.getByRole("button", { name: "Comparar snapshots" }).click();
      await page.getByText(/1 modificados/).waitFor();
      expect(
        await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      ).toEqual([0, 0]);
      await page.reload();
      await page.getByRole("button", { name: "Nova investigação" }).waitFor();
      await mkdir(resolve(".cache/pie-web"), { recursive: true });
      for (const width of [360, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth <= innerWidth",
          ),
        ).toBe(true);
        await page.screenshot({
          path: resolve(`.cache/pie-web/dashboard-${width}.png`),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "Sair", exact: true }).click();
      await page.getByRole("button", { name: "Conectar ao PIE" }).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await api.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
