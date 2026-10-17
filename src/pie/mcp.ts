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
  functionalInput,
  functionalOutput,
  productOutput,
} from "./functional.js";
import { dataReviewInput, dataReviewOutput } from "./dataReview.js";
import { securityInput, securityOutput } from "./security.js";
import { exportSnapshotInput } from "./exportSnapshot.js";
import { retestInput, retestOutput } from "./retestPlan.js";
import { planningInput, unifiedPlanOutput } from "./planning.js";
import {
  planContestationInput,
  planContestationSchema,
  planContestHistoryInput,
  planContestHistorySchema,
} from "./planContestation.js";
import {
  planTriageInput,
  planTriageEventSchema,
  planTriageHistoryInput,
  planTriageHistorySchema,
} from "./planTriage.js";
import {
  functionalRecordSchema,
  functionalRecordExportInput,
  functionalRecordExportOutput,
  functionalHistorySchema,
} from "./functionalRecord.js";
import type { VerificationCoordinator } from "./execution/coordinator.js";
import { nodeTestGrantSchema } from "./execution/contracts.js";
import { httpGrantSchema, httpProbeSchema } from "./execution/httpProbe.js";
import {
  verificationComparisonInput,
  verificationComparisonOutput,
} from "./regressionResults.js";
import { realpath } from "node:fs/promises";
import type { JobQueue } from "./jobs/contracts.js";
import { jobSchema } from "./jobs/contracts.js";
import { scopedJob } from "./jobs/access.js";
import {
  enqueueVerification,
  verificationJobInput,
} from "./jobs/verification.js";
import {
  verificationRunSchema,
  verificationHistorySchema,
  verificationExportInput,
  verificationExportOutput,
} from "./execution/runContracts.js";
import {
  discoveryOutput,
  graphOutput,
  projectsOutput,
  historyOutput,
  evidenceOutput,
  exportSnapshotOutput,
  httpProbeHistorySchema,
  withError,
} from "./outputContracts.js";

const idInput = z.strictObject({ id: z.string().uuid() });
const graphInput = pageSchema.extend({ snapshotId: z.string().uuid() });
const historyInput = pageSchema.extend({ projectId: z.string().uuid() });
const discoverInput = z.strictObject({
  maxFiles: z.number().int().positive().max(100_000).default(10_000),
});
const httpProbeResultOutput = z.strictObject({
  schemaVersion: z.literal(1),
  record: httpProbeSchema,
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
  verifier?: VerificationCoordinator,
  queue?: JobQueue,
): McpServer {
  if (verifier && verifier.options.root !== repositoryRoot)
    throw new PieError(
      "POLICY_DENIED",
      "Verificador MCP pertence a outra raiz.",
    );
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
    "pie_data_review",
    {
      description:
        "Analisa fatos Prisma e observações estáticas de migrations PostgreSQL preservados no snapshot. Compara relações, tabelas e colunas, considerando @@map/@map literais, e observa seletores, constraints únicas e REFERENCES; não calcula o estado final nem conecta ao banco. Relações ou mappings incompletos permanecem inconclusivos; achados seguem unverified.",
      inputSchema: dataReviewInput,
      outputSchema: withError(dataReviewOutput),
      annotations: read,
    },
    (input) => guarded(() => service.dataReview(input)),
  );
  server.registerTool(
    "pie_security_review",
    {
      description:
        "Procura padrões reconhecíveis de credenciais em arquivos estáticos cujo hash atual coincide com Evidence do snapshot. Valores nunca são retornados. Findings são suspeitas não verificadas; não valida credenciais e não cobre toda classe de segredo, autorização, runtime ou LGPD.",
      inputSchema: securityInput,
      outputSchema: withError(securityOutput),
      annotations: read,
    },
    (input) => guarded(() => service.security(input)),
  );
  server.registerTool(
    "pie_product_review",
    {
      description:
        "Revisa cobertura para análise de produto/UX sem inferir fricção a partir de código estático. Declarações geram lacunas de evidência; oportunidades só podem ser confirmadas com jornadas observadas.",
      inputSchema: functionalInput,
      outputSchema: withError(productOutput),
      annotations: read,
    },
    (input) => guarded(() => service.product(input)),
  );
  server.registerTool(
    "pie_functional_review",
    {
      description:
        "Analisa lacunas de verificação de páginas/endpoints declarados no snapshot, por módulo e com evidências. OBSERVE: não executa cenários, não comprova defeitos ou funcionamento. Retorna proposta/reprodução/aceite e incerteza.",
      inputSchema: functionalInput,
      outputSchema: withError(functionalOutput),
      annotations: read,
    },
    (input) => guarded(() => service.functional(input)),
  );
  server.registerTool(
    "pie_functional_retain",
    {
      description:
        "Executa análise estática e preserva a página solicitada como registro imutável ligado ao snapshot. Não executa alvo, não comprova defeito ou funcionamento. Retorna ID/hash para consulta histórica.",
      inputSchema: functionalInput,
      outputSchema: withError(functionalRecordSchema),
      annotations: write,
    },
    (input) => guarded(() => service.retainFunctional(input)),
  );
  server.registerTool(
    "pie_functional_record_get",
    {
      description:
        "Lê registro funcional preservado por ID e verifica integridade/proveniência; não recalcula com a versão atual do motor.",
      inputSchema: idInput,
      outputSchema: withError(functionalRecordSchema),
      annotations: read,
    },
    ({ id }) => guarded(() => service.functionalRecord(id)),
  );
  server.registerTool(
    "pie_functional_record_export",
    {
      description:
        "Exporta em páginas UTF-8 o JSON do registro funcional histórico imutável, com hash do registro e digest da árvore do snapshot. Não recalcula o motor nem transforma estado unverified em aprovação.",
      inputSchema: functionalRecordExportInput,
      outputSchema: withError(functionalRecordExportOutput),
      annotations: read,
    },
    (input) => guarded(() => service.exportFunctionalRecord(input)),
  );
  server.registerTool(
    "pie_functional_records_list",
    {
      description:
        "Lista páginas de análises funcionais preservadas por snapshot, ordenadas por data/ID, com módulo, cobertura e hash. Não recalcula nem aprova funcionalidades; leitura do registro completo por ID.",
      inputSchema: pageSchema.extend({ snapshotId: z.string().uuid() }),
      outputSchema: withError(functionalHistorySchema),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.functionalRecords(snapshotId, paging)),
  );
  server.registerTool(
    "pie_retest_plan",
    {
      description:
        "Seleciona candidatos a reteste nos snapshots antes/depois, por impacto de imports registrados ou inventário completo de testes observados. Não autoriza execução, não comprova cobertura ou regressão; inclui provas e limitações.",
      inputSchema: retestInput,
      outputSchema: withError(retestOutput),
      annotations: read,
    },
    (input) => guarded(() => service.retestPlan(input)),
  );
  server.registerTool(
    "pie_plan_generate",
    {
      description:
        "Agrega itens estáticos existentes dos motores funcional, produto, segurança e dados em um plano paginado ligado a Evidence, incluindo triagem humana atual de responsável e estado quando houver. Prioridade continua não avaliada; use pie_plan_triage_set para registrar alterações e pie_plan_contest para contestar com justificativa e Evidence. Não autoriza execução e não cobre os motores de infraestrutura/regressão.",
      inputSchema: planningInput,
      outputSchema: withError(unifiedPlanOutput),
      annotations: read,
    },
    (input) => guarded(() => service.plan(input)),
  );
  server.registerTool(
    "pie_plan_contest",
    {
      description:
        "Registra contestação justificada e append-only de um item do plano atual, com Evidence de apoio e snapshot íntegro do item; não altera estado nem autoriza execução.",
      inputSchema: planContestationInput,
      outputSchema: withError(planContestationSchema),
      annotations: write,
    },
    (input) => guarded(() => service.contestPlanItem(input)),
  );
  server.registerTool(
    "pie_plan_contestation_get",
    {
      description:
        "Lê uma contestação histórica e valida seu hash e vínculo ao snapshot original.",
      inputSchema: idInput,
      outputSchema: withError(planContestationSchema),
      annotations: read,
    },
    ({ id }) => guarded(() => service.planContestation(id)),
  );
  server.registerTool(
    "pie_plan_contestations_list",
    {
      description:
        "Lista contestações preservadas para um digest de plano e snapshot, com histórico paginado.",
      inputSchema: planContestHistoryInput,
      outputSchema: withError(planContestHistorySchema),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.planContestations(snapshotId, paging)),
  );
  server.registerTool(
    "pie_plan_triage_set",
    {
      description:
        "Registra mudança explícita de owner e/ou status da triagem com justificativa e revisão esperada; completed continua sem verificação técnica e não autoriza execução.",
      inputSchema: planTriageInput,
      outputSchema: withError(planTriageEventSchema),
      annotations: { ...write, idempotentHint: true },
    },
    (input) => guarded(() => service.updatePlanTriage(input)),
  );
  server.registerTool(
    "pie_plan_triage_history",
    {
      description:
        "Lê estado atual e histórico append-only das mudanças de triagem para um item/digest, validando revisões e hash.",
      inputSchema: planTriageHistoryInput,
      outputSchema: withError(planTriageHistorySchema),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.planTriageHistory(snapshotId, paging)),
  );
  if (verifier && queue) {
    server.registerTool(
      "pie_verification_enqueue",
      {
        description:
          "Enfileira grant VERIFY explícito; não inicia testes. Worker separado, uma tentativa, sem repetição após interrupção. Job-id identifica execução e journal.",
        inputSchema: verificationJobInput,
        outputSchema: withError(jobSchema),
        annotations: { ...write, idempotentHint: true },
      },
      (input) => guarded(() => enqueueVerification(queue, verifier, input)),
    );
    server.registerTool(
      "pie_verification_job_get",
      {
        description:
          "Consulta job VERIFY desta raiz; succeeded significa workflow concluído, examine result.state para aprovação.",
        inputSchema: idInput,
        outputSchema: withError(jobSchema),
        annotations: read,
      },
      ({ id }) =>
        guarded(() => scopedJob(queue, repositoryRoot, id, "verification")),
    );
    server.registerTool(
      "pie_verification_job_cancel",
      {
        description:
          "Solicita cancelamento de job VERIFY desta raiz; cancelling aguarda finalização e liberação dos recursos.",
        inputSchema: idInput,
        outputSchema: withError(jobSchema),
        annotations: { ...write, idempotentHint: true },
      },
      ({ id }) =>
        guarded(async () => {
          await scopedJob(queue, repositoryRoot, id, "verification");
          return queue.cancel(id);
        }),
    );
  }
  server.registerTool(
    "pie_http_probe_run",
    {
      description:
        "Envia somente a requisição HTTP local declarada no grant VERIFY explícito, limita status/digest e persiste prova imutável antes de retornar. Não inicia o processo-alvo nem comprova que o servidor executa o snapshot.",
      inputSchema: httpGrantSchema,
      outputSchema: httpProbeResultOutput,
      annotations: { ...write, openWorldHint: false },
    },
    (input, extra) =>
      guarded(async () => {
        const outcome = await service.probeHttp(
          input,
          repositoryRoot,
          extra.mcpReq.signal,
        );
        if (!outcome.ok)
          throw new PieError(
            "POLICY_DENIED",
            `Sondagem HTTP não autorizada ou indisponível: ${outcome.error.tag}.`,
          );
        return { schemaVersion: 1 as const, record: outcome.value };
      }),
  );
  server.registerTool(
    "pie_http_probes_list",
    {
      description:
        "Lista sondagens HTTP locais preservadas por snapshot, paginadas e ordenadas por data/ID. Valida a prova de cada registro; consulta não envia requisições.",
      inputSchema: graphInput,
      outputSchema: withError(httpProbeHistorySchema),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.httpProbes(snapshotId, paging)),
  );
  server.registerTool(
    "pie_http_probe_get",
    {
      description:
        "Lê sondagem HTTP local persistida e valida prova e vínculo ao snapshot. Não executa uma nova requisição.",
      inputSchema: idInput,
      outputSchema: withError(httpProbeSchema),
      annotations: read,
    },
    ({ id }) => guarded(() => service.httpProbe(id)),
  );
  if (verifier)
    server.registerTool(
      "pie_test_run",
      {
        description:
          "Executa somente os testes Node explicitamente autorizados pelo grant VERIFY, em cópia privada e contêiner Docker local sem rede. Imagem deve estar instalada e fixada por digest. Raiz fixa do servidor, journal e persistência obrigatórios. Pode executar código do alvo na sandbox; não altera fontes originais. Resultado v2 selado; skipped/blocked/inconclusive não aprovam. Não inferir autorização de arquivos do projeto.",
        inputSchema: nodeTestGrantSchema,
        outputSchema: withError(verificationRunSchema),
        annotations: { ...write, destructiveHint: false },
      },
      (input, extra) => guarded(() => verifier.run(input, extra.mcpReq.signal)),
    );
  server.registerTool(
    "pie_verification_compare",
    {
      description:
        "Compara casos Node entre duas execuções VERIFY persistidas. Só alinha identidades únicas dentro dos arquivos autorizados; imagem, captura incompleta, limpeza, skips e casos sem contraparte limitam a conclusão. No máximo informa regressão observada ou ausência observada; nunca aprova o produto.",
      inputSchema: verificationComparisonInput,
      outputSchema: withError(verificationComparisonOutput),
      annotations: read,
    },
    (input) => guarded(() => service.verificationComparison(input)),
  );
  server.registerTool(
    "pie_verification_get",
    {
      description:
        "Lê execução persistida e verifica vínculos e hashes da evidência. Não inicia testes nem altera o projeto.",
      inputSchema: idInput,
      outputSchema: withError(verificationRunSchema),
      annotations: read,
    },
    ({ id }) => guarded(() => service.verification(id)),
  );
  server.registerTool(
    "pie_verification_export",
    {
      description:
        "Exporta em páginas UTF-8 o JSON do registro VERIFY imutável, preservando grant, resultado e Evidence; inclui digest do snapshot e hash do payload vinculado à Evidence. Skipped/blocked continuam sem aprovação e nenhum teste é reexecutado.",
      inputSchema: verificationExportInput,
      outputSchema: withError(verificationExportOutput),
      annotations: read,
    },
    (input) => guarded(() => service.exportVerification(input)),
  );
  server.registerTool(
    "pie_verifications_list",
    {
      description:
        "Lista resultados persistidos por snapshot, com estado e referência de evidência; paginado até 200. Skipped/blocked não significam aprovação.",
      inputSchema: graphInput,
      outputSchema: withError(verificationHistorySchema),
      annotations: read,
    },
    ({ snapshotId, ...paging }) =>
      guarded(() => service.verifications(snapshotId, paging)),
  );
  server.registerTool(
    "pie_project_verifications_list",
    {
      description:
        "Lista execuções VERIFY persistidas em todos os snapshots do projeto, em ordem cronológica e com estado, Evidence e paginação; resultados não aprovam o projeto.",
      inputSchema: historyInput,
      outputSchema: withError(verificationHistorySchema),
      annotations: read,
    },
    ({ projectId, ...paging }) =>
      guarded(() => service.projectVerifications(projectId, paging)),
  );
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
    "pie_snapshot_export",
    {
      description:
        "Exporta o snapshot observado em JSON, Markdown ou HTML por páginas UTF-8. Cada página preserva snapshot, digest da árvore, hash e offset do artefato completo; concatene as páginas em nextOffset. Exporta somente fatos estáticos, sem aprovar o projeto.",
      inputSchema: exportSnapshotInput,
      outputSchema: withError(exportSnapshotOutput),
      annotations: read,
    },
    (input) => guarded(() => service.exportSnapshot(input)),
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
  verifier?: VerificationCoordinator,
  queue?: JobQueue,
): Promise<void> {
  const root = await realpath(repositoryRoot);
  const handle = serveStdio(() => createPieMcp(service, root, verifier, queue));
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    closing ??= (async () => {
      await verifier?.close();
      await handle.close();
      await queue?.close();
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
