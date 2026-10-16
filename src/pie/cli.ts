import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PieError } from "./contracts.js";
import { openStore } from "./store.js";
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
    },
  });
  const [command, target] = parsed.positionals;
  if (!command || parsed.values.help || command === "help") {
    console.log(
      "PIE — Project Intelligence Engine\nComandos: doctor | discover <raiz-git> | projects | history <projeto-id> | graph <snapshot-id> | compare <antes-id> <depois-id> | evidence <evidência-id> | export <snapshot-id> | mcp <raiz-git>\nOpções: --db <arquivo> --format <json|md|html> --limit <1–200> --offset <n> --max-files <n> --max-bytes <n>\nModo atual: OBSERVE. Inventário estático não verifica funcionamento. Documentação: docs/PIE_DEVELOPMENT.md",
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
          ],
          unavailable: [
            "audit-engines",
            "target-execution",
            "postgresql",
            "dashboard",
          ],
          upstreamProviders: "não verificados",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    ![
      "discover",
      "projects",
      "history",
      "graph",
      "evidence",
      "export",
      "mcp",
      "compare",
      "serve",
    ].includes(command)
  )
    throw new PieError("INVALID_INPUT", "Comando desconhecido; use help.");
  if (command !== "projects" && !target)
    throw new PieError("INVALID_INPUT", "Informe o alvo ou identificador.");
  const dbPath = parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite");
  const store = await openStore(
    dbPath,
    ["discover", "mcp", "serve"].includes(command) ? target : undefined,
  );
  if (command === "mcp") {
    const { servePie } = await import("./mcp.js");
    await servePie(new PieService(store), target!);
    return;
  }
  if (command === "serve") {
    try {
      const { startPieApi } = await import("./api.js");
      const api = await startPieApi(new PieService(store), {
        root: target!,
        token: process.env.PIE_API_TOKEN ?? "",
        port: z.coerce
          .number()
          .int()
          .min(0)
          .max(65535)
          .parse(parsed.values.port ?? 0),
      });
      console.log(
        JSON.stringify({
          url: api.url,
          profile: "OBSERVE",
          authentication: "Bearer PIE_API_TOKEN",
        }),
      );
      const shutdown = () => {
        void api.close().catch(() => {
          process.exitCode = 1;
        });
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } catch (cause) {
      store.close();
      throw cause;
    }
    return;
  }
  try {
    const service = new PieService(store);
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
        result = store.projects(paging);
        break;
      case "history":
        result = store.history(target!, paging);
        break;
      case "graph":
        result = service.graph(target!, paging);
        break;
      case "compare":
        result = service.compare({
          beforeId: target,
          afterId: parsed.positionals[2],
          ...paging,
        });
        break;
      case "evidence":
        result = store.evidence(target!);
        break;
      case "export":
        console.log(
          renderSnapshot(
            store.snapshot(target!),
            z
              .enum(["json", "md", "html"])
              .parse(parsed.values.format ?? "json"),
          ),
        );
        return;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}
