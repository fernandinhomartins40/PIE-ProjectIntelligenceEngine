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
  "painel de produto abre Evidence real e limpa a seleção ao trocar o escopo",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-product-web-"));
    const repo = join(root, "repo");
    await mkdir(join(repo, "app", "api"), { recursive: true });
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(
      join(repo, "app", "api", "route.ts"),
      "export function GET(){throw new Error('fonte não executada')}\n",
    );
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "history.sqlite"), repo);
    const service = new PieService(store);
    const observed = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    const declaration = snapshot.declarations[0]!;
    const proof = store.evidence(declaration.evidenceId);
    const token = "fixture-product-panel-token-32-characters-minimum";
    const api = await startPieApi(service, {
      root: repo,
      token,
      webDirectory: resolve("dist/pie-web"),
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.goto(api.url);
      await page.getByLabel("Credencial do serviço local").fill(token);
      await page.getByRole("button", { name: "Conectar ao PIE" }).click();
      const section = page.getByRole("region", {
        name: "Análise de produto e UX",
      });
      await section
        .getByRole("button", { name: "Analisar evidências de produto" })
        .click();
      const evidenceButton = section.getByRole("button", {
        name: `Consultar Evidence ${declaration.evidenceId}`,
      });
      await evidenceButton.click();
      const evidence = section.getByLabel(
        "Evidence vinculada à análise de produto",
      );
      await evidence.getByText(proof.sha256, { exact: true }).waitFor();
      await evidence.getByText(proof.source.path).waitFor();

      await section.getByLabel("Módulo relativo (opcional)").fill("app/api");
      await section
        .getByRole("button", { name: "Analisar evidências de produto" })
        .click();
      await section.getByText("1 declarações no escopo").waitFor();
      await evidence.waitFor({ state: "detached" });
      expect(await evidence.count()).toBe(0);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth <= innerWidth",
          ),
        ).toBe(true);
      }
    } finally {
      await browser?.close();
      await api.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
