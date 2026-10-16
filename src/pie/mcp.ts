import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { PieError } from "./contracts.js";
import { pageSchema } from "./graph.js";
import type { PieService } from "./service.js";
import { comparisonInput, comparisonOutput } from "./compare.js";
import { declarationsOutput } from "./outputContracts.js";
import { traceInput, traceOutput } from "./knowledgeGraph.js";
import {
  discoveryOutput,
  graphOutput,
  projectsOutput,
  historyOutput,
  evidenceOutput,
  withError,
} from "./outputContracts.js";

const idInput = z.strictObject({ id: z.string().uuid() });
const graphInput = pageSchema.extend({ snapshotId: z.string().uuid() });
const historyInput = pageSchema.extend({ projectId: z.string().uuid() });
const discoverInput = z.strictObject({
  maxFiles: z.number().int().positive().max(100_000).default(10_000),
});

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
    "pie_declarations_list",
    {
      description:
        "Lista declarações estáticas de manifests Node/Composer, Compose, OpenAPI 3.0/3.1 e modelos/campos Prisma, com evidências, origem e limitações. Não verifica runtime. Paginado até 200.",
      inputSchema: graphInput,
      outputSchema: withError(declarationsOutput),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.declarations(snapshotId, paging)),
  );
  server.registerTool(
    "pie_graph_trace",
    {
      description:
        "Rastreia um nó de arquivo ou declaração pelo grafo observado: imports, origem, dependências Compose e campos Prisma. Direção, profundidade, orçamento de nós e paginação explícitos; não verifica runtime.",
      inputSchema: traceInput,
      outputSchema: withError(traceOutput),
      annotations: read,
    },
    (input) => guarded(() => service.trace(input)),
  );
  server.registerTool(
    "pie_change_impact",
    {
      description:
        "Compara dois snapshots do mesmo projeto por hashes observados e calcula impacto pelos grafos anterior e posterior. Não executa testes. Cobertura parcial mantém ausências desconhecidas; paginação até 200.",
      inputSchema: comparisonInput,
      outputSchema: withError(comparisonOutput),
      annotations: read,
    },
    (input) => guarded(() => service.compare(input)),
  );
  server.registerTool(
    "pie_project_discover",
    {
      description:
        "Inventaria arquivos Git da raiz autorizada no início do servidor. Não executa o projeto. Grava evidências no banco PIE externo. Schema v1; timeout 30s; somente OBSERVE.",
      inputSchema: discoverInput,
      outputSchema: withError(discoveryOutput),
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
      outputSchema: withError(projectsOutput),
      annotations: read,
    },
    (input) => guarded(() => service.projects(input)),
  );
  server.registerTool(
    "pie_graph_query",
    {
      description:
        "Consulta inventário e arestas registradas, com cobertura e limitações; contrato v1, limite 200.",
      inputSchema: graphInput,
      outputSchema: withError(graphOutput),
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
      outputSchema: withError(evidenceOutput),
      annotations: read,
    },
    ({ id }) => guarded(() => service.evidence(id)),
  );
  server.registerTool(
    "pie_history_list",
    {
      description:
        "Histórico persistente por projeto, paginado; contrato v1, limite 200.",
      inputSchema: historyInput,
      outputSchema: withError(historyOutput),
      annotations: read,
    },
    ({ projectId, ...paging }) =>
      guarded(() => service.history(projectId, paging)),
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
