import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { satisfies } from "semver";
import { z } from "zod";
import { PostgresPieStore } from "./postgresStore.js";

const exec = promisify(execFile);
const sqliteTables = [
  "pie_migrations",
  "pie_projects",
  "pie_snapshots",
  "pie_evidence",
  "pie_verification_runs",
  "pie_functional_records",
  "pie_http_probes",
];

type Check = {
  status: "available" | "unavailable" | "not_configured" | "incomplete";
  detail: string;
};

const packageRuntimeSchema = z.object({
  engines: z.object({ node: z.string().min(1) }),
});

async function nodeRuntime(): Promise<Check> {
  let supportedRange = "";
  try {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as unknown;
    supportedRange = packageRuntimeSchema.parse(manifest).engines.node;
  } catch {
    return {
      status: "incomplete",
      detail: "Não foi possível ler a faixa Node.js declarada pelo pacote.",
    };
  }
  const supported = satisfies(process.versions.node, supportedRange);
  return {
    status: supported ? "available" : "unavailable",
    detail: supported
      ? `Node.js ${process.versions.node} atende a engines.node (${supportedRange}).`
      : `Node.js ${process.versions.node} não atende a engines.node (${supportedRange}).`,
  };
}

async function executableCheck(
  executable: string,
  args: string[],
): Promise<Check> {
  try {
    const result = await exec(executable, args, {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 16_384,
    });
    const gitVersion =
      executable === "git"
        ? /\bgit version ([A-Za-z0-9.+-]+)/u.exec(result.stdout)?.[1]
        : undefined;
    return {
      status: "available",
      detail: gitVersion
        ? `Git ${gitVersion} respondeu.`
        : "Daemon Docker respondeu; saída adicional omitida.",
    };
  } catch {
    return {
      status: "unavailable",
      detail:
        "Executável ausente, indisponível ou não respondeu no limite de 4 segundos.",
    };
  }
}

async function sqliteCheck(path: string): Promise<Check> {
  let info;
  try {
    info = await stat(path);
  } catch (cause) {
    const code =
      cause instanceof Error
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    return code === "ENOENT"
      ? {
          status: "not_configured",
          detail: "Arquivo SQLite ainda não existe; doctor não o criou.",
        }
      : {
          status: "unavailable",
          detail:
            "Caminho SQLite inacessível; doctor não criou nem migrou arquivos.",
        };
  }
  if (!info.isFile())
    return {
      status: "incomplete",
      detail: "O caminho SQLite não é um arquivo regular.",
    };
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => String(row.name)),
      );
      const missing = sqliteTables.filter((table) => !tables.has(table));
      const migrationVersion = tables.has("pie_migrations")
        ? Number(
            db
              .prepare("SELECT MAX(version) AS version FROM pie_migrations")
              .get()?.version ?? 0,
          )
        : 0;
      return missing.length === 0 && migrationVersion >= 4
        ? {
            status: "available",
            detail:
              "Banco existente, migração SQLite v4 e tabelas PIE reconhecidas; abertura somente leitura.",
          }
        : {
            status: "incomplete",
            detail:
              missing.length > 0
                ? `Banco existente sem todas as tabelas PIE; faltam ${missing.length} tabela(s), nenhuma migração foi executada.`
                : `Banco existente na migração v${migrationVersion}; esperado v4. Nenhuma migração foi executada.`,
          };
    } finally {
      db.close();
    }
  } catch {
    return {
      status: "unavailable",
      detail:
        "Banco inacessível ou inválido; doctor não criou nem migrou arquivos.",
    };
  }
}

async function postgresCheck(connection: string | undefined): Promise<Check> {
  if (!connection)
    return {
      status: "not_configured",
      detail: "PIE_DATABASE_URL não configurada; conexão não testada.",
    };
  let store: PostgresPieStore | undefined;
  try {
    store = new PostgresPieStore(connection);
    await store.connect();
    return {
      status: "available",
      detail:
        "PostgreSQL respondeu e pie_projects foi encontrada; outras tabelas/migrações não foram verificadas.",
    };
  } catch {
    return {
      status: "unavailable",
      detail:
        "PostgreSQL indisponível ou schema PIE incompleto; URL e detalhes de autenticação foram omitidos.",
    };
  } finally {
    await store?.close().catch(() => {});
  }
}

export async function inspectPieEnvironment(databasePath: string) {
  const [node, git, docker, postgres] = await Promise.all([
    nodeRuntime(),
    executableCheck("git", ["--version"]),
    executableCheck("docker", ["info", "--format", "{{.ServerVersion}}"]),
    postgresCheck(process.env.PIE_DATABASE_URL),
  ]);
  const database = process.env.PIE_DATABASE_URL
    ? {
        status: "not_configured" as const,
        detail: "SQLite não selecionado; PIE_DATABASE_URL define o backend.",
      }
    : await sqliteCheck(databasePath);
  const checks = {
    node,
    git,
    sqlite: database,
    dockerDaemon: docker,
    postgresql: postgres,
  };
  const persistenceReady =
    checks.sqlite.status === "available" ||
    (!process.env.PIE_DATABASE_URL &&
      checks.sqlite.status === "not_configured");
  return {
    product: "PIE",
    profile: "OBSERVE",
    state:
      checks.node.status === "available" &&
      checks.git.status === "available" &&
      persistenceReady
        ? "ready_for_observe"
        : "prerequisites_missing",
    checks,
    notes: [
      "O estado geral cobre runtime, Git e backend de persistência selecionado; SQLite ausente pode ser inicializado pela operação normal.",
      "As verificações são somente leitura; nenhuma migração, instalação, pull de imagem ou criação de banco foi realizada.",
      "PostgreSQL disponível significa apenas conexão e tabela pie_projects; não valida todas as migrations nem o comportamento dos workers.",
      "Docker disponível significa daemon acessível; imagens autorizadas e limites de execução não foram verificados.",
    ],
  };
}
