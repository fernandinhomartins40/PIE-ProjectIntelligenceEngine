import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PieError } from "./contracts.js";
import { openPersistence } from "./openPersistence.js";
import { PieService } from "./service.js";
import { z } from "zod";
import type { VerificationCoordinator } from "./execution/coordinator.js";
import { readHttpProbeGrant } from "./execution/httpGrantFile.js";
import { inspectPieEnvironment } from "./doctor.js";

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
      continuous: { type: "boolean" },
      "poll-ms": { type: "string" },
      module: { type: "string" },
      mode: { type: "string" },
    },
  });
  const [command, target] = parsed.positionals;
  if (command === "enqueue-verify") {
    if (!target)
      throw new PieError("INVALID_INPUT", "Informe o arquivo de autorização.");
    const { enqueueVerificationCli } = await import("./jobs/cli.js");
    console.log(
      JSON.stringify(
        await enqueueVerificationCli(
          target,
          parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite"),
          parsed.values.key,
          {
            stateDirectory: parsed.values["state-dir"],
            executable: parsed.values["docker-bin"],
            endpoint: parsed.values["docker-host"],
          },
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "http-probe-run") {
    if (!target)
      throw new PieError("INVALID_INPUT", "Informe o arquivo de grant HTTP.");
    const grant = await readHttpProbeGrant(target);
    const store = await openPersistence(
      parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite"),
      grant.repositoryRoot,
    );
    try {
      const result = await new PieService(store).probeHttp(
        grant,
        grant.repositoryRoot,
      );
      if (!result.ok)
        throw new PieError(
          "POLICY_DENIED",
          `Sondagem HTTP não autorizada ou indisponível: ${result.error.tag}.`,
        );
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await store.close();
    }
    return;
  }
  if (!command || parsed.values.help || command === "help") {
    console.log(
      "Regressão: verification-diff <run-antes-id> <run-depois-id> --limit <1–200> --offset <n>. Compara somente casos Node compatíveis e pode concluir inconclusivo.",
    );
    console.log(
      "PIE — Project Intelligence Engine\nComandos: doctor | discover <raiz-git> | projects | history <projeto-id> | graph <snapshot-id> | compare <antes-id> <depois-id> | evidence <evidência-id> | export <snapshot-id> | mcp <raiz-git>\nOpções: --db <arquivo> --format <json|md|html> --limit <1–200> --offset <n> --max-files <n> --max-bytes <n>\nModo atual: OBSERVE. Inventário estático não verifica funcionamento. Documentação: docs/PIE_DEVELOPMENT.md",
    );
    console.log(
      "Fila: enqueue <raiz-git> --key <chave> | job <id> | cancel-job <id> | work <raiz-git> (um job por execução). API: serve <raiz-git> --port <n>. PostgreSQL: configure PIE_DATABASE_URL e aplique pie:db:migrate antes de usar.",
    );
    console.log(
      "Resultados persistidos: verification <run-id> | verification-export <run-id> | verification-diff <run-antes-id> <run-depois-id> | verifications <snapshot-id> | project-verifications <project-id> --limit <1–200> --offset <n>. Consulta/exportação e comparação não iniciam testes.",
    );
    console.log(
      "HTTP VERIFY: http-probe-run <grant.json> --db <banco> executa somente a requisição local explicitamente autorizada; http-probe <run-id> lê a prova e http-probes <snapshot-id> lista o histórico. Não inicia o servidor do projeto.",
    );
    console.log(
      "Análises OBSERVE: functional <snapshot-id> | product-review <snapshot-id> | data-review <snapshot-id> | security-review <snapshot-id>; aceitam --limit <1–200> --offset <n>. Código estático não comprova comportamento, fricção ou segurança.",
    );
    console.log(
      "Histórico funcional: functional-retain <snapshot-id> | functional-record <id> | functional-records <snapshot-id> --limit <1–200> --offset <n> | functional-record-export <id>. Retenção preserva somente a página solicitada.",
      "Plano: plan <snapshot-id>; plan-export <snapshot-id> --format json|md|html; plan-item-history-export <snapshot-id> <digest> <item-id> --format json|md|html; plan-contest <request.json>; plan-triage <request.json>; plan-triage-history <snapshot-id> <digest> <item-id>. completed não significa verificado.",
    );
    console.log(
      "Candidatos a reteste: retest-plan <antes-id> <depois-id> --mode affected|full --limit <1–200> --offset <n>. Plano não autoriza execução nem comprova cobertura.",
    );
    console.log(
      "VERIFY Linux: verify <autorização.json> --state-dir <diretório-0700> --docker-bin <executável-absoluto> --docker-host <daemon-local>. Recursos: resources --state-dir <diretório> | recover <run-id> com as mesmas opções Docker. Sem pull automático.",
    );
    console.log(
      "Fila VERIFY Linux: enqueue-verify <autorização.json> --key <chave> | work-verify <raiz-git>, com as mesmas opções Docker/estado e --db. Sem repetição automática após interrupção; job-id também identifica execução/journal.",
    );
    console.log(
      "Workers: work/work-verify aceitam --continuous --poll-ms <100–30000> para consumir sequencialmente até SIGINT/SIGTERM. Sem continuous, processam um job.",
    );
    return;
  }
  if (command === "doctor") {
    const databasePath =
      parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite");
    console.log(
      JSON.stringify(await inspectPieEnvironment(databasePath), null, 2),
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
      "functional",
      "product-review",
      "functional-retain",
      "functional-record",
      "functional-record-export",
      "functional-records",
      "data-review",
      "security-review",
      "http-probe",
      "http-probes",
      "trace",
      "evidence",
      "verification",
      "verification-export",
      "verification-diff",
      "verifications",
      "project-verifications",
      "export",
      "mcp",
      "compare",
      "retest-plan",
      "plan",
      "plan-export",
      "plan-item-history-export",
      "plan-contest",
      "plan-triage",
      "plan-triage-history",
      "serve",
      "enqueue",
      "job",
      "cancel-job",
      "work",
      "work-verify",
    ].includes(command)
  )
    throw new PieError("INVALID_INPUT", "Comando desconhecido; use help.");
  if (command !== "projects" && !target)
    throw new PieError("INVALID_INPUT", "Informe o alvo ou identificador.");
  const dbPath = parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite");
  const store = await openPersistence(
    dbPath,
    ["discover", "mcp", "serve", "enqueue", "work", "work-verify"].includes(
      command,
    )
      ? target
      : undefined,
  );
  const verification = [
    parsed.values["state-dir"],
    parsed.values["docker-bin"],
    parsed.values["docker-host"],
  ].some((value) => value !== undefined)
    ? {
        stateDirectory: parsed.values["state-dir"],
        executable: parsed.values["docker-bin"],
        endpoint: parsed.values["docker-host"],
      }
    : undefined;
  if (command === "mcp") {
    const { servePie } = await import("./mcp.js");
    const { openConfiguredVerifier } =
      await import("./execution/coordinator.js");
    let verifier: VerificationCoordinator | undefined;
    let queue: import("./jobs/contracts.js").JobQueue | undefined;
    try {
      verifier = await openConfiguredVerifier(store, target!, verification);
      if (verifier) {
        const { openQueue } = await import("./jobs/openQueue.js");
        queue = await openQueue(dbPath);
      }
      await servePie(new PieService(store), target!, verifier, queue);
    } catch (cause) {
      try {
        await verifier?.close();
      } finally {
        await queue?.close();
        await store.close();
      }
      throw cause;
    }
    return;
  }
  if (command === "serve") {
    try {
      const { serveApiCommand } = await import("./apiCli.js");
      await serveApiCommand(new PieService(store), target!, dbPath, {
        port: parsed.values.port,
        apiOnly: parsed.values["api-only"] ?? false,
        verification,
      });
    } catch (cause) {
      await store.close();
      throw cause;
    }
    return;
  }
  try {
    const service = new PieService(store);
    if (
      ["enqueue", "job", "cancel-job", "work", "work-verify"].includes(command)
    ) {
      const { runJobCommand } = await import("./jobs/cli.js");
      console.log(
        JSON.stringify(
          await runJobCommand(command, target!, dbPath, service, {
            key: parsed.values.key,
            verification,
            continuous: parsed.values.continuous,
            pollMs:
              parsed.values["poll-ms"] === undefined
                ? undefined
                : Number(parsed.values["poll-ms"]),
          }),
          null,
          parsed.values.continuous ? undefined : 2,
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
      case "data-review":
        result = await service.dataReview({ snapshotId: target!, ...paging });
        break;
      case "security-review":
        result = await service.security({ snapshotId: target!, ...paging });
        break;
      case "functional":
        result = await service.functional({
          snapshotId: target!,
          ...paging,
          modulePath: parsed.values.module ?? "",
        });
        break;
      case "product-review":
        result = await service.product({
          snapshotId: target!,
          ...paging,
          modulePath: parsed.values.module ?? "",
        });
        break;
      case "functional-retain":
        result = await service.retainFunctional({
          snapshotId: target!,
          ...paging,
          modulePath: parsed.values.module ?? "",
        });
        break;
      case "functional-record":
        result = await service.functionalRecord(
          z.string().uuid().parse(target!),
        );
        break;
      case "functional-record-export":
        {
          let offset = 0;
          let report = "";
          const id = z.string().uuid().parse(target!);
          do {
            const exported = await service.exportFunctionalRecord({
              id,
              offset,
              limitBytes: 1_000_000,
            });
            report += exported.content;
            if (exported.nextOffset === null) break;
            offset = exported.nextOffset;
          } while (true);
          process.stdout.write(`${report}\n`);
        }
        return;
      case "functional-records":
        result = await service.functionalRecords(
          z.string().uuid().parse(target!),
          paging,
        );
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
      case "retest-plan":
        result = await service.retestPlan({
          beforeId: target!,
          afterId: parsed.positionals[2],
          mode: parsed.values.mode ?? "affected",
          ...paging,
        });
        break;
      case "plan":
        result = await service.plan({
          snapshotId: target,
          ...paging,
        });
        break;
      case "plan-export":
        {
          let offset = 0;
          let report = "";
          do {
            const exported = await service.exportPlan({
              snapshotId: z.string().uuid().parse(target!),
              format: z
                .enum(["json", "md", "html"])
                .parse(parsed.values.format ?? "json"),
              offset,
              limitBytes: 1_000_000,
            });
            report += exported.content;
            if (exported.nextOffset === null) break;
            offset = exported.nextOffset;
          } while (true);
          process.stdout.write(`${report}\n`);
        }
        return;
      case "plan-item-history-export":
        {
          let offset = 0;
          let report = "";
          do {
            const exported = await service.exportPlanItemHistory({
              snapshotId: z.string().uuid().parse(target!),
              planDigest: parsed.positionals[2],
              itemId: parsed.positionals[3],
              format: z
                .enum(["json", "md", "html"])
                .parse(parsed.values.format ?? "json"),
              offset,
              limitBytes: 1_000_000,
            });
            report += exported.content;
            if (exported.nextOffset === null) break;
            offset = exported.nextOffset;
          } while (true);
          process.stdout.write(`${report}\n`);
        }
        return;
      case "plan-contest":
        result = await service.contestPlanItem(
          JSON.parse(await readFile(target!, "utf8")) as unknown,
        );
        break;
      case "plan-triage":
        result = await service.updatePlanTriage(
          JSON.parse(await readFile(target!, "utf8")) as unknown,
        );
        break;
      case "plan-triage-history":
        result = await service.planTriageHistory(target!, {
          planDigest: parsed.positionals[2],
          itemId: parsed.positionals[3],
          ...paging,
        });
        break;
      case "evidence":
        result = await service.evidence(target!);
        break;
      case "verification":
        result = await service.verification(target!);
        break;
      case "verification-export":
        {
          let offset = 0;
          let report = "";
          const id = z.string().uuid().parse(target!);
          do {
            const exported = await service.exportVerification({
              id,
              offset,
              limitBytes: 1_000_000,
            });
            report += exported.content;
            if (exported.nextOffset === null) break;
            offset = exported.nextOffset;
          } while (true);
          process.stdout.write(`${report}\n`);
        }
        return;
      case "verification-diff":
        result = await service.verificationComparison({
          beforeRunId: target!,
          afterRunId: parsed.positionals[2],
          ...paging,
        });
        break;
      case "http-probe":
        result = await service.httpProbe(z.string().uuid().parse(target!));
        break;
      case "http-probes":
        result = await service.httpProbes(
          z.string().uuid().parse(target!),
          paging,
        );
        break;
      case "verifications":
        result = await service.verifications(target!, paging);
        break;
      case "project-verifications":
        result = await service.projectVerifications(target!, paging);
        break;
      case "export":
        {
          let offset = 0;
          let report = "";
          do {
            const exported = await service.exportSnapshot({
              snapshotId: target!,
              format: z
                .enum(["json", "md", "html"])
                .parse(parsed.values.format ?? "json"),
              offset,
              limitBytes: 1_000_000,
            });
            report += exported.content;
            if (exported.nextOffset === null) break;
            offset = exported.nextOffset;
          } while (true);
          process.stdout.write(`${report}\n`);
        }
        return;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}
