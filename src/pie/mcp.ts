import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { PieError } from "./contracts.js";
import { pageSchema } from "./graph.js";
import type { PieService } from "./service.js";

const idInput = z.strictObject({ id: z.string().uuid() });
const graphInput = pageSchema.extend({ snapshotId: z.string().uuid() });
const historyInput = pageSchema.extend({ projectId: z.string().uuid() });
const discoverInput = z.strictObject({
  maxFiles: z.number().int().positive().max(100_000).default(10_000),
});
const outputSchema = z.record(z.string(), z.unknown());

function result(value: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { ...value },
  };
}

/** Root is selected by the operator at process launch, never by untrusted tool input. */
export function createPieMcp(
  service: PieService,
  repositoryRoot: string,
): McpServer {
  const server = new McpServer(
    { name: "pie-project-intelligence-engine", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  };
  const write = { ...read, readOnlyHint: false, idempotentHint: false };
  const guarded = async (action: () => object | Promise<object>) => {
    try {
      return result(await action());
    } catch (cause) {
      const error =
        cause instanceof PieError
          ? { code: cause.code, message: cause.message }
          : {
              code: "INPUT_OR_STORAGE_ERROR",
              message: "Entrada inválida ou falha no armazenamento local.",
            };
      return { ...result({ schemaVersion: 1, error }), isError: true };
    }
  };
  server.registerTool(
    "pie_project_discover",
    {
      description:
        "Inventaria arquivos Git da raiz autorizada no início do servidor. Não executa o projeto. Grava evidências no banco PIE externo. Schema v1; timeout 30s; somente OBSERVE.",
      inputSchema: discoverInput,
      outputSchema,
      annotations: write,
    },
    (input, extra) =>
      guarded(() =>
        service.discover(
          {
            repositoryRoot,
            profile: "OBSERVE",
            environment: "local",
            maxFiles: input.maxFiles,
          },
          extra.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "pie_projects_list",
    {
      description:
        "Lista paginada de projetos reais no banco local; contrato v1, limite 200.",
      inputSchema: pageSchema,
      outputSchema,
      annotations: read,
    },
    (input) => guarded(() => service.store.projects(input)),
  );
  server.registerTool(
    "pie_graph_query",
    {
      description:
        "Consulta inventário e arestas registradas, com cobertura e limitações; contrato v1, limite 200.",
      inputSchema: graphInput,
      outputSchema,
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.graph(snapshotId, paging)),
  );
  server.registerTool(
    "pie_evidence_get",
    {
      description:
        "Lê evidência por UUID e verifica integridade SHA-256; contrato v1.",
      inputSchema: idInput,
      outputSchema,
      annotations: read,
    },
    ({ id }) => guarded(() => service.store.evidence(id)),
  );
  server.registerTool(
    "pie_history_list",
    {
      description:
        "Histórico persistente por projeto, paginado; contrato v1, limite 200.",
      inputSchema: historyInput,
      outputSchema,
      annotations: read,
    },
    ({ projectId, ...paging }) =>
      guarded(() => service.store.history(projectId, paging)),
  );
  return server;
}

export async function servePie(
  service: PieService,
  repositoryRoot: string,
): Promise<void> {
  const handle = serveStdio(() => createPieMcp(service, repositoryRoot));
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    closing ??= (async () => {
      await handle.close();
      await service.close();
    })();
    void closing.catch(() => {
      process.stderr.write("Falha no encerramento do PIE.\n");
      process.exitCode = 1;
      closing = undefined;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
}
