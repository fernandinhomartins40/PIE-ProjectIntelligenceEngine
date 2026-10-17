import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { NodeVerification } from "../../src/pie/execution/verification.js";
import { VerificationCoordinator } from "../../src/pie/execution/coordinator.js";
import { SqliteJobQueue } from "../../src/pie/jobs/sqliteQueue.js";

const executablePath =
  process.env.PIE_BROWSER_EXECUTABLE ??
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");

it.skipIf(!existsSync(executablePath))(
  "painel funcional usa fatos reais, pagina módulo e abre evidência sem aprovação",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-functional-"));
    const repo = join(root, "repo");
    await mkdir(join(repo, "app", "api"), { recursive: true });
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(
      join(repo, "app", "api", "route.ts"),
      "export function GET(){throw new Error('não executar')}\nexport const POST=()=>null;",
    );
    for (let index = 0; index < 11; index++) {
      await mkdir(join(repo, "app", `page${index}`));
      await writeFile(
        join(repo, "app", `page${index}`, "page.tsx"),
        "export default function Page(){return <div/>}",
      );
    }
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "history.sqlite"), repo);
    const service = new PieService(store);
    const observed = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    const endpoint = snapshot.declarations.find(
      (fact) => fact.name === "GET /api",
    )!;
    const proof = store.evidence(endpoint.evidenceId);
    const token = "fixture-functional-web-token-32-characters-minimum";
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
        name: "Análise funcional estática",
      });
      await section
        .getByRole("button", { name: "Analisar lacunas funcionais" })
        .click();
      await section.getByText("1–10 de 13", { exact: true }).waitFor();
      await section
        .getByRole("group", { name: "Paginação da análise atual" })
        .getByRole("button", { name: "Próxima", exact: true })
        .click();
      await section.getByText("11–13 de 13", { exact: true }).waitFor();
      await section.getByLabel("Módulo relativo (opcional)").fill("app/api");
      await section
        .getByRole("button", { name: "Analisar lacunas funcionais" })
        .click();
      await section.getByText("1–2 de 2", { exact: true }).waitFor();
      const finding = section.getByRole("article", {
        name: "Lacuna GET /api",
        exact: true,
      });
      await finding
        .getByRole("button", { name: "Abrir prova da declaração" })
        .click();
      await section
        .getByLabel("Prova da análise funcional")
        .getByText(proof.sha256, { exact: true })
        .waitFor();
      await finding.getByText("Incertezas e validação proposta").click();
      await finding
        .getByRole("heading", { name: "Critérios de validação" })
        .waitFor();
      const history = section.getByRole("region", {
        name: "Histórico funcional preservado",
      });
      await history
        .getByRole("button", { name: "Salvar página analisada" })
        .click();
      const retained = history.getByRole("article", {
        name: "Análise funcional preservada",
        exact: true,
      });
      await retained
        .getByRole("heading", { name: "Registro histórico · não verificado" })
        .waitFor();
      const records = store.functionalRecords(snapshot.id);
      expect(records.total).toBe(1);
      await retained
        .getByText(records.items[0]!.sha256, { exact: true })
        .waitFor();
      await section.getByLabel("Módulo relativo (opcional)").fill("missing");
      await section
        .getByRole("button", { name: "Analisar lacunas funcionais" })
        .click();
      await section
        .getByText(
          "Nenhuma página ou endpoint declarado neste escopo. Isso não prova ausência de funcionalidade.",
          { exact: true },
        )
        .waitFor();
      expect(
        await section.getByLabel("Prova da análise funcional").count(),
      ).toBe(0);
      await page.reload();
      const restoredHistory = page.getByRole("region", {
        name: "Histórico funcional preservado",
      });
      await restoredHistory
        .getByRole("button", {
          name: `Abrir análise ${records.items[0]!.id.slice(0, 8)}`,
        })
        .click();
      await restoredHistory
        .getByRole("article", {
          name: "Análise funcional preservada",
          exact: true,
        })
        .getByText(records.items[0]!.sha256, { exact: true })
        .waitFor();
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
  30_000,
);

it.skipIf(process.platform !== "linux" || !existsSync(executablePath))(
  "painel enfileira autorização real com sessão/CSRF, consulta e cancela sem executar",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-queue-"));
    const repo = join(root, "repo");
    const state = join(root, "private");
    await mkdir(repo);
    await mkdir(state, { mode: 0o700 });
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(
      join(repo, "test.mjs"),
      "throw new Error('enfileirar não executa');",
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
    const verifier = await VerificationCoordinator.open(store, {
      root: repo,
      stateDirectory: state,
      executable: join(root, "missing-docker"),
      endpoint: "unix:///var/run/docker.sock",
    });
    const queue = new SqliteJobQueue(join(root, "jobs.sqlite"));
    const token = "fixture-web-queue-token-32-characters-minimum";
    const server = await startPieApi(service, {
      root: repo,
      token,
      verifier,
      queue,
      webDirectory: resolve("dist/pie-web"),
    });
    const grant = {
      schemaVersion: 1,
      profile: "VERIFY",
      allowTargetExecution: true,
      environment: "local",
      repositoryRoot: repo,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      image: `node@sha256:${"1".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      testFiles: ["test.mjs"],
      limits: {
        timeoutMs: 1000,
        memoryMiB: 256,
        cpus: 1,
        pids: 32,
        workspaceMiB: 64,
        outputBytes: 65536,
        sourceBytes: 100000,
      },
    };
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.getByLabel("Credencial do serviço local").fill(token);
      await page.getByRole("button", { name: "Conectar ao PIE" }).click();
      const section = page.getByRole("region", { name: "Fila de verificação" });
      await section
        .getByLabel("Autorização VERIFY em JSON")
        .fill(JSON.stringify({ ...grant, snapshotId: randomUUID() }));
      await section
        .getByLabel("Chave idempotente da solicitação")
        .fill("browser-queue");
      await section
        .getByRole("button", { name: "Autorizar e enfileirar testes" })
        .click();
      await section
        .getByText("A autorização deve indicar o snapshot selecionado.", {
          exact: true,
        })
        .waitFor();
      await section
        .getByLabel("Autorização VERIFY em JSON")
        .fill(JSON.stringify(grant));
      await section
        .getByRole("button", { name: "Autorizar e enfileirar testes" })
        .click();
      const job = section.getByRole("article", { name: "Job de verificação" });
      await job
        .getByRole("heading", { name: "Na fila", exact: true })
        .waitFor();
      const id = await section.getByLabel("UUID do job VERIFY").inputValue();
      expect(queue.get(id)).toMatchObject({
        payload: grant,
        attempts: 0,
        state: "queued",
      });
      expect(store.verifications(snapshot.id).total).toBe(0);
      await section.getByRole("button", { name: "Consultar job" }).click();
      await job
        .getByRole("heading", { name: "Na fila", exact: true })
        .waitFor();
      await section
        .getByRole("button", { name: "Solicitar cancelamento" })
        .click();
      await job
        .getByRole("heading", { name: "Cancelado", exact: true })
        .waitFor();
      expect(queue.get(id).state).toBe("cancelled");
      await section
        .getByRole("button", { name: "Autorizar e enfileirar testes" })
        .click();
      await job
        .getByRole("heading", { name: "Cancelado", exact: true })
        .waitFor();
      expect(await section.getByLabel("UUID do job VERIFY").inputValue()).toBe(
        id,
      );
      await page.reload();
      expect(
        await section.getByLabel("Autorização VERIFY em JSON").inputValue(),
      ).toBe("");
      expect(await section.getByLabel("UUID do job VERIFY").inputValue()).toBe(
        "",
      );
      expect(
        await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      ).toEqual([0, 0]);
    } finally {
      await browser?.close();
      await server.close();
      queue.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it.skipIf(!existsSync(executablePath))(
  "painel apresenta execução blocked real e prova preservada sem alegar aprovação",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-verification-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(
      join(repo, "test.mjs"),
      "import {test} from 'node:test';test('fixture',()=>{});",
    );
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "history.sqlite"), repo);
    const service = new PieService(store);
    const observed = await service.discover({
      profile: "OBSERVE",
      environment: "local",
      repositoryRoot: repo,
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    const owner = new NodeVerification({
      executable: join(root, "missing-docker"),
      endpoint: "unix:///var/run/docker.sock",
      temporaryParent: root,
    });
    const grant = {
      schemaVersion: 1,
      profile: "VERIFY",
      allowTargetExecution: true,
      environment: "local",
      repositoryRoot: repo,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      image: `node@sha256:${"1".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      testFiles: ["test.mjs"],
      limits: {
        timeoutMs: 1000,
        memoryMiB: 256,
        cpus: 1,
        pids: 32,
        workspaceMiB: 64,
        outputBytes: 65536,
        sourceBytes: 100000,
      },
    };
    const run = await owner.execute(grant, snapshot);
    await store.saveVerification(run);
    await owner.close();
    const token = "fixture-web-verify-32-characters-minimum";
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
        name: "Verificações do snapshot",
      });
      await page
        .getByRole("region", { name: "Fila de verificação" })
        .getByText("Enfileiramento VERIFY não habilitado neste servidor.", {
          exact: true,
        })
        .waitFor();
      await section
        .getByRole("cell", { name: "Bloqueado", exact: true })
        .waitFor();
      await section
        .getByRole("button", {
          name: `Abrir verificação ${run.id.slice(0, 8)}`,
        })
        .click();
      const details = section.getByRole("article", {
        name: "Detalhes da verificação",
      });
      await details
        .getByRole("heading", { name: "Bloqueado", exact: true })
        .waitFor();
      await details.getByText(run.evidence.sha256, { exact: true }).waitFor();
      await details
        .getByText("Nenhum caso de teste comprovado nesta execução.")
        .waitFor();
      await details.getByText("Autorização e limites preservados").click();
      expect(await details.locator("pre").textContent()).toContain(
        '"test.mjs"',
      );
      expect(
        await section
          .getByText("Aprovado no escopo executado", { exact: true })
          .count(),
      ).toBe(0);
      await section
        .getByRole("button", { name: "Atualizar verificações" })
        .click();
      await section
        .getByRole("cell", { name: "Bloqueado", exact: true })
        .waitFor();
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth <= innerWidth",
          ),
          JSON.stringify(
            await page.evaluate(
              "Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > innerWidth).map(e => [e.tagName, e.className, e.getBoundingClientRect().width]).slice(0,15)",
            ),
          ),
        ).toBe(true);
      }
    } finally {
      await browser?.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

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
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ executablePath, headless: true });
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
      await browser?.close();
      await api.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(!existsSync(executablePath))(
  "histórico paginado preserva snapshot e permite comparar com outra página",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-web-pages-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    await promisify(execFile)("git", ["init", repo]);
    await writeFile(join(repo, "index.ts"), "export const value = 1;");
    await promisify(execFile)("git", ["-C", repo, "add", "."]);
    const store = await openStore(join(root, "api.sqlite"), repo);
    const service = new PieService(store);
    const token = "fixture-web-pagination-32-characters-minimum";
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let api: Awaited<ReturnType<typeof startPieApi>> | undefined;
    try {
      let latest = "";
      let first = "";
      for (let index = 0; index < 51; index++) {
        const result = await service.discover({
          repositoryRoot: repo,
          profile: "OBSERVE",
          environment: "local",
        });
        if (!first) first = result.snapshot.id;
        latest = result.snapshot.id;
      }
      // Synthetic catalog fixtures only; no fake snapshots or API responses.
      for (let index = 0; index < 26; index++)
        store.addProject(
          randomUUID(),
          join(root, `catalog-${index}`),
          `catalog-${index}`,
        );
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
      const snapshots = page.getByRole("group", {
        name: "Snapshots",
        exact: true,
      });
      await snapshots.getByText("51–51 de 51", { exact: true }).waitFor();
      expect(
        await page
          .getByLabel("Snapshot observado", { exact: true })
          .inputValue(),
      ).toBe(latest);
      await snapshots
        .getByRole("button", { name: "Anterior", exact: true })
        .click();
      await snapshots.getByText("1–50 de 51", { exact: true }).waitFor();
      expect(
        await page
          .getByLabel("Snapshot observado", { exact: true })
          .inputValue(),
      ).toBe(latest);
      await page.getByRole("button", { name: "Comparar versões" }).click();
      await page.getByLabel("Comparar snapshot atual com").selectOption(first);
      await page.getByRole("button", { name: "Comparar snapshots" }).click();
      await page.getByText(/Conteúdo observado sem alteração/).waitFor();
      const projects = page.getByRole("group", {
        name: "Projetos",
        exact: true,
      });
      const selected = await page
        .getByLabel("Histórico do projeto", { exact: true })
        .inputValue();
      await projects
        .getByRole("button", { name: "Próxima", exact: true })
        .click();
      await projects.getByText("26–27 de 27", { exact: true }).waitFor();
      expect(
        await page
          .getByLabel("Histórico do projeto", { exact: true })
          .inputValue(),
      ).toBe(selected);
      await page
        .getByLabel("Histórico do projeto", { exact: true })
        .selectOption({ index: 2 });
      await page
        .getByRole("heading", { name: "Comece pela primeira investigação" })
        .waitFor();
      expect(
        await page
          .getByLabel("Snapshot observado", { exact: true })
          .inputValue(),
      ).toBe("");
    } finally {
      await browser?.close();
      if (api) await api.close();
      else await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
