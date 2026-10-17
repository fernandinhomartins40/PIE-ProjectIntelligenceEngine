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
  "painel registra triagem e contestação append-only ligadas a Evidence",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-plan-web-"));
    const repo = join(root, "repo");
    await mkdir(join(repo, "app", "api"), { recursive: true });
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(
      join(repo, "app", "api", "route.ts"),
      "export function GET(){throw new Error('não executar')}; export const POST=()=>null;\n",
    );
    await mkdir(join(repo, "app", "page"), { recursive: true });
    await writeFile(
      join(repo, "app", "page", "page.tsx"),
      "export default function Page(){return <div/>}\n",
    );
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "history.sqlite"), repo);
    const service = new PieService(store);
    const observed = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshotId = observed.snapshot.id;
    const plan = await service.plan({ snapshotId, limit: 20 });
    expect(plan.items.total).toBeGreaterThan(0);
    const item = plan.items.items[0]!;
    const token = "fixture-plan-panel-token-32-characters-minimum";
    const server = await startPieApi(service, {
      root: repo,
      token,
      webDirectory: resolve("dist/pie-web"),
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.getByLabel("Credencial do serviço local").fill(token);
      await page.getByRole("button", { name: "Conectar ao PIE" }).click();
      const panel = page.getByRole("region", {
        name: "Revisar e atribuir itens",
      });
      const card = panel
        .locator(".plan-item")
        .filter({ hasText: item.title })
        .first();
      await card.waitFor();
      await card.getByLabel("Responsável (opcional)").fill("equipe-integracao");
      await card.getByLabel("Estado de triagem").selectOption("in_progress");
      await card
        .getByLabel("Justificativa da alteração")
        .fill("Atribuída à equipe para análise técnica.");
      await card.getByRole("button", { name: "Registrar alteração" }).click();
      await card.getByText("Revisão de triagem 1.").waitFor();
      const triage = await service.planTriageHistory(snapshotId, {
        planDigest: plan.planDigest,
        itemId: item.id,
        limit: 20,
      });
      expect(triage.items.items[0]?.owner).toBe("equipe-integracao");
      expect(triage.items.items[0]?.status).toBe("in_progress");

      await card
        .getByRole("button", { name: "Contestar recomendação" })
        .click();
      await card.getByRole("checkbox").first().check();
      await card
        .getByLabel("Por que a recomendação deve ser revista?")
        .fill("A prova observada não sustenta esta recomendação.");
      await card.getByRole("button", { name: "Registrar contestação" }).click();
      await panel
        .getByRole("button", { name: "Histórico de contestações" })
        .click();
      await panel
        .getByText("A prova observada não sustenta esta recomendação.", {
          exact: true,
        })
        .waitFor();
      const contests = await service.planContestations(snapshotId, {
        planDigest: plan.planDigest,
        limit: 20,
      });
      expect(contests.items.total).toBe(1);
      expect(contests.items.items[0]?.item.id).toBe(item.id);
      expect(contests.items.items[0]?.evidenceIds).toHaveLength(1);

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
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
