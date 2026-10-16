import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PieError } from "./contracts.js";
import { openPersistence } from "./openPersistence.js";
import { PieService } from "./service.js";
import { renderSnapshot } from "./reports.js";
import { z } from "zod";

export async function runPie(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      db: { type: "string" },
      limit: { type: "string" },
      offset: { type: "string" },
      "max-files": { type: "string" },
      "max-bytes": { type: "string" },
      help: { type: "boolean" },
      format: { type: "string" },
      port: { type: "string" },
      key: { type: "string" },
      direction: { type: "string" },
      depth: { type: "string" },
      "max-nodes": { type: "string" },
      "max-edges": { type: "string" },
      "api-only": { type: "boolean" },
      "state-dir": { type: "string" },
      "docker-bin": { type: "string" },
      "docker-host": { type: "string" },
    },
  });
  const [command, target] = parsed.positionals;
  if (!command || parsed.values.help || command === "help") {
    console.log(
      "PIE — Project Intelligence Engine\nComandos: doctor | discover <raiz-git> | projects | history <projeto-id> | graph <snapshot-id> | compare <antes-id> <depois-id> | evidence <evidência-id> | export <snapshot-id> | mcp <raiz-git>\nOpções: --db <arquivo> --format <json|md|html> --limit <1–200> --offset <n> --max-files <n> --max-bytes <n>\nModo atual: OBSERVE. Inventário estático não verifica funcionamento. Documentação: docs/PIE_DEVELOPMENT.md",
    );
    console.log(
      "Fila: enqueue <raiz-git> --key <chave> | job <id> | cancel-job <id> | work <raiz-git> (um job por execução). API: serve <raiz-git> --port <n>. PostgreSQL: configure PIE_DATABASE_URL e aplique pie:db:migrate antes de usar.",
    );
    console.log(
      "Resultados persistidos: verification <run-id> | verifications <snapshot-id> --limit <1–200> --offset <n>. Consulta não inicia testes.",
    );
    console.log(
      "VERIFY Linux: verify <autorização.json> --state-dir <diretório-0700> --docker-bin <executável-absoluto> --docker-host <daemon-local>. Recursos: resources --state-dir <diretório> | recover <run-id> com as mesmas opções Docker. Sem pull automático.",
    );
    return;
  }
  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          product: "PIE",
          node: process.versions.node,
          sqlite: process.versions.sqlite ?? null,
          profile: "OBSERVE",
          implemented: [
            "git-tracked-file-inventory",
            "hashed-evidence",
            "sqlite-local-history",
            "pagination",
            "relative-import-ast",
            "snapshot-comparison",
            "graph-impact",
            "json-md-html-export",
            "persistent-discovery-queue",
            "postgresql-prisma-adapter",
            "declarative-stack-inventory",
            "recorded-graph-trace",
            "local-react-dashboard",
          ],
          unavailable: ["audit-engines"],
          verification: {
            supportedPlatforms: ["linux"],
            readiness: "not-probed",
            requires: [
              "explicit-grant",
              "private-state-directory",
              "local-docker",
              "preinstalled-digest-image",
            ],
          },
          upstreamProviders: "não verificados",
          postgresqlRuntime:
            "não verificado nesta máquina; exige PIE_DATABASE_URL e migrações",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (["verify", "resources", "recover"].includes(command)) {
    const { verifyCli, resourcesCli, recoverCli } =
      await import("./execution/cli.js");
    const options = {
      stateDirectory: parsed.values["state-dir"],
      executable: parsed.values["docker-bin"],
      endpoint: parsed.values["docker-host"],
      limit: parsed.values.limit,
      offset: parsed.values.offset,
    };
    if (command !== "resources" && !target)
      throw new PieError(
        "INVALID_INPUT",
        "Informe arquivo de autorização ou run-id.",
      );
    const result =
      command === "verify"
        ? await verifyCli(
            target!,
            parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite"),
            options,
          )
        : command === "recover"
          ? await recoverCli(target!, options)
          : await resourcesCli(options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (
    ![
      "discover",
      "projects",
      "history",
      "graph",
      "declarations",
      "trace",
      "evidence",
      "verification",
      "verifications",
      "export",
      "mcp",
      "compare",
      "serve",
      "enqueue",
      "job",
      "cancel-job",
      "work",
    ].includes(command)
  )
    throw new PieError("INVALID_INPUT", "Comando desconhecido; use help.");
  if (command !== "projects" && !target)
    throw new PieError("INVALID_INPUT", "Informe o alvo ou identificador.");
  const dbPath = parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite");
  const store = await openPersistence(
    dbPath,
    ["discover", "mcp", "serve", "enqueue", "work"].includes(command)
      ? target
      : undefined,
  );
  if (command === "mcp") {
    const { servePie } = await import("./mcp.js");
    await servePie(new PieService(store), target!);
    return;
  }
  if (command === "serve") {
    try {
      const { serveApiCommand } = await import("./apiCli.js");
      await serveApiCommand(new PieService(store), target!, dbPath, {
        port: parsed.values.port,
        apiOnly: parsed.values["api-only"] ?? false,
        ...([
          parsed.values["state-dir"],
          parsed.values["docker-bin"],
          parsed.values["docker-host"],
        ].some((value) => value !== undefined)
          ? {
              verification: {
                stateDirectory: parsed.values["state-dir"],
                executable: parsed.values["docker-bin"],
                endpoint: parsed.values["docker-host"],
              },
            }
          : {}),
      });
    } catch (cause) {
      await store.close();
      throw cause;
    }
    return;
  }
  try {
    const service = new PieService(store);
    if (["enqueue", "job", "cancel-job", "work"].includes(command)) {
      const { runJobCommand } = await import("./jobs/cli.js");
      console.log(
        JSON.stringify(
          await runJobCommand(
            command,
            target!,
            dbPath,
            service,
            parsed.values.key,
          ),
          null,
          2,
        ),
      );
      return;
    }
    const paging = {
      offset: Number(parsed.values.offset ?? 0),
      limit: Number(parsed.values.limit ?? 50),
    };
    let result: unknown;
    switch (command) {
      case "discover":
        result = await service.discover({
          repositoryRoot: target,
          profile: "OBSERVE",
          environment: "local",
          ...(parsed.values["max-files"]
            ? { maxFiles: Number(parsed.values["max-files"]) }
            : {}),
          ...(parsed.values["max-bytes"]
            ? { maxTotalBytes: Number(parsed.values["max-bytes"]) }
            : {}),
        });
        break;
      case "projects":
        result = await service.projects(paging);
        break;
      case "history":
        result = await service.history(target!, paging);
        break;
      case "graph":
        result = await service.graph(target!, paging);
        break;
      case "declarations":
        result = await service.declarations(target!, paging);
        break;
      case "trace":
        result = await service.trace({
          snapshotId: target,
          nodeId: parsed.positionals[2],
          direction: parsed.values.direction ?? "dependencies",
          maxDepth: Number(parsed.values.depth ?? 4),
          maxNodes: Number(parsed.values["max-nodes"] ?? 200),
          maxEdges: Number(parsed.values["max-edges"] ?? 1000),
          ...paging,
        });
        break;
      case "compare":
        result = await service.compare({
          beforeId: target,
          afterId: parsed.positionals[2],
          ...paging,
        });
        break;
      case "evidence":
        result = await service.evidence(target!);
        break;
      case "verification":
        result = await service.verification(target!);
        break;
      case "verifications":
        result = await service.verifications(target!, paging);
        break;
      case "export":
        console.log(
          renderSnapshot(
            await store.snapshot(target!),
            z
              .enum(["json", "md", "html"])
              .parse(parsed.values.format ?? "json"),
          ),
        );
        return;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}
