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
  "trace permite páginas com relações depois do fim da lista de nós",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-edges-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    const files = Array.from(
      { length: 26 },
      (_, index) => `module-${index}.ts`,
    );
    for (const file of files) {
      const imports = files
        .filter((other) => other !== file)
        .map((other) => `import './${other}';`)
        .join("\n");
      await writeFile(join(repo, file), imports);
    }
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const service = new PieService(
      await openStore(join(root, "api.sqlite"), repo),
    );
    const token = "fixture-web-edges-32-characters-minimum";
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let api: Awaited<ReturnType<typeof startPieApi>> | undefined;
    try {
      await service.discover({
        repositoryRoot: repo,
        profile: "OBSERVE",
        environment: "local",
      });
      api = await startPieApi(service, {
        root: repo,
        token,
        webDirectory: resolve("dist/pie-web"),
      });
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.goto(api.url);
      await page.getByLabel("Credencial do serviço local").fill(token);
      await page.getByRole("button", { name: "Conectar ao PIE" }).click();
      await page
        .getByRole("button", { name: "Rastrear", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Rastrear relações" }).click();
      await page.getByText("1–25 de 650", { exact: true }).waitFor();
      const next = page
        .getByRole("region", { name: "Observações estáticas" })
        .getByRole("button", { name: "Próxima", exact: true });
      await next.click();
      await page.getByText("26–50 de 650", { exact: true }).waitFor();
      await next.click();
      await page.getByText("51–75 de 650", { exact: true }).waitFor();
      expect(
        await page
          .getByRole("table", { name: "Nós alcançados no trace" })
          .locator("tbody tr")
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("table", { name: "Relações registradas no trace" })
          .locator("tbody tr")
          .count(),
      ).toBe(25);
      await page
        .getByRole("table", { name: "Relações registradas no trace" })
        .getByRole("button", { name: "Ver evidência" })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "Evidência observada" })
        .waitFor();
    } finally {
      await browser?.close();
      if (api) await api.close();
      else await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
