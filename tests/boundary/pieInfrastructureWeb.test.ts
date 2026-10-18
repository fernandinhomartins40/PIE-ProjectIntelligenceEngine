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

const exec = promisify(execFile);
const executablePath =
  process.env.PIE_BROWSER_EXECUTABLE ??
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");

it.skipIf(!existsSync(executablePath))(
  "painel mostra configurações Compose com Evidence sem reter comando de healthcheck",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-infrastructure-web-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await exec("git", ["init", repo]);
    await writeFile(
      join(repo, "compose.yaml"),
      'include:\n  - ./shared/base.compose.yaml\nservices:\n  api:\n    image: node:24-alpine\n    network_mode: host\n    privileged: true\n    build:\n      context: app\n      dockerfile: Dockerfile.api\n    ports:\n      - "127.0.0.1:8080:3000"\n    environment:\n      API_KEY: NEVER_RETAIN_ENV_VALUE\n    env_file:\n      - .env.production\n    volumes:\n      - "data:/var/lib/app:ro"\n    secrets:\n      - api_key\n    configs:\n      - app_config\n    restart: unless-stopped\n    profiles: [production]\n    extends:\n      file: ./shared/services.yaml\n      service: base-api\n    depends_on:\n      database:\n        condition: service_healthy\n        restart: true\n    healthcheck:\n      test: ["CMD", "echo", "DO_NOT_RETAIN"]\n    deploy:\n      replicas: 2\n      resources:\n        limits:\n          cpus: "0.50"\n          memory: 512M\n          pids: 128\n        reservations:\n          cpus: "0.25"\n          memory: 256M\n          pids: 64\nvolumes:\n  data:\n    external: true\nsecrets:\n  api_key:\n    file: ./secrets/api_key.txt\nconfigs:\n  app_config:\n    file: ./config/app.yml\n',
    );
    await mkdir(join(repo, "app"));
    await writeFile(
      join(repo, "app", "Dockerfile.api"),
      "FROM node:24-alpine\nENV APP_MODE=production\nRUN echo NEVER_RETAIN_COMMAND\nEXPOSE 3000\n",
    );
    await exec("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "history.sqlite"), repo);
    const service = new PieService(store);
    const observed = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const token = "fixture-infrastructure-web-token-32-characters";
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
      const section = page.getByRole("region", {
        name: "Infraestrutura e performance",
      });
      const security = page.getByRole("region", {
        name: "Seguran\u00e7a e privacidade",
      });
      await security
        .getByRole("heading", { name: "Findings de seguran\u00e7a" })
        .waitFor();
      expect(await security.innerText()).toContain("compose_host_network_mode");
      expect(await security.innerText()).toContain("network_mode: host");
      expect(await security.innerText()).toContain(
        "compose_privileged_container",
      );
      expect(await security.innerText()).toContain("privileged: true");
      await security
        .getByRole("button", { name: "Consultar Evidence" })
        .first()
        .click();
      await page.locator("aside.evidence").waitFor();
      const serviceCard = section.getByRole("article", {
        name: "Serviço api",
      });
      await serviceCard
        .getByRole("list", { name: "Configurações Compose declaradas" })
        .getByText("node:24-alpine", { exact: true })
        .waitFor();
      await serviceCard
        .getByText("127.0.0.1:8080:3000", { exact: true })
        .waitFor();
      await serviceCard.getByText("unless-stopped", { exact: true }).waitFor();
      await serviceCard.getByText("declared", { exact: true }).waitFor();
      await serviceCard
        .getByText("CPU (limite declarado):", { exact: false })
        .waitFor();
      await serviceCard.getByText("512M", { exact: true }).waitFor();
      await serviceCard
        .getByRole("list", { name: "Configurações Compose declaradas" })
        .getByText("Montagem de volume declarada", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("app/Dockerfile.api", { exact: true })
        .waitFor();
      await serviceCard.getByText("Dockerfile observado no snapshot").waitFor();
      await section
        .getByRole("article", { name: "Volume Compose data" })
        .waitFor();
      const dockerfileInstructions = serviceCard.getByRole("list", {
        name: "Instruções Dockerfile observadas",
      });
      await dockerfileInstructions.waitFor();
      await dockerfileInstructions
        .getByText("FROM: node:24-alpine", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Réplicas declaradas:", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Variável de ambiente declarada: API_KEY", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Arquivo env declarado: .env.production", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Referência de secret declarada: api_key", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Perfil Compose declarado: production", { exact: false })
        .waitFor();
      await serviceCard
        .getByText("Opções de dependência declaradas:", { exact: false })
        .waitFor();
      await section
        .getByRole("article", { name: "Recurso Compose api_key" })
        .waitFor();
      await serviceCard
        .getByText("Serviço Compose estendido:", { exact: false })
        .waitFor();
      await section
        .getByRole("article", { name: "Configuração Compose incluída" })
        .waitFor();
      expect(
        await page.getByText("DO_NOT_RETAIN", { exact: false }).count(),
      ).toBe(0);
      expect(
        await page.getByText("NEVER_RETAIN_COMMAND", { exact: false }).count(),
      ).toBe(0);
      expect(
        await page
          .getByText("NEVER_RETAIN_ENV_VALUE", { exact: false })
          .count(),
      ).toBe(0);
      await serviceCard
        .getByRole("list", { name: "Configurações Compose declaradas" })
        .getByRole("button", { name: "Evidence" })
        .first()
        .click();
      await page.locator("aside.evidence").waitFor();
      expect(observed.snapshot.id).toBeTruthy();
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
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
