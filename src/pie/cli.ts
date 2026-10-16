import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PieError } from "./contracts.js";
import { openStore } from "./store.js";
import { PieService } from "./service.js";

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
    },
  });
  const [command, target] = parsed.positionals;
  if (!command || parsed.values.help || command === "help") {
    console.log(
      "PIE — Project Intelligence Engine\nComandos: doctor | discover <raiz-git> | projects | history <projeto-id> | graph <snapshot-id> | evidence <evidência-id> | export <snapshot-id> | mcp\nOpções: --db <arquivo> --limit <1–200> --offset <n> --max-files <n> --max-bytes <n>\nModo atual: OBSERVE. Inventário estático não verifica funcionamento. Documentação: docs/PIE_DEVELOPMENT.md",
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
    ].includes(command)
  )
    throw new PieError("INVALID_INPUT", "Comando desconhecido; use help.");
  if (command !== "projects" && !target)
    throw new PieError("INVALID_INPUT", "Informe o alvo ou identificador.");
  const dbPath = parsed.values.db ?? join(homedir(), ".pie", "pie.sqlite");
  const store = await openStore(
    dbPath,
    command === "discover" || command === "mcp" ? target : undefined,
  );
  if (command === "mcp") {
    const { servePie } = await import("./mcp.js");
    await servePie(new PieService(store), target!);
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
      case "evidence":
        result = store.evidence(target!);
        break;
      case "export":
        result = store.snapshot(target!);
        break;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}
