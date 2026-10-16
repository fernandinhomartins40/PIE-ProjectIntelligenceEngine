# Arquitetura de referência — PIE

## 1. Princípios
Local-first, pluggable, evidence-first, read-only por padrão, cross-stack, offline quando possível, modelos de IA opcionais, transparência de cobertura, componentes reutilizáveis, sem mock em produção, português brasileiro. Priorizar implementação correta sobre abstrações prematuras.

## 2. Topologia proposta (validar com upstream)
```text
CLI / MCP (stdio; HTTP autenticado opcional) / Painel React
                        |
                  API/Orchestrator
                        |
       +----------------+----------------+
       |                |                |
  Discovery & Graph  Evidence Store   Policy/Approval
       |                |                |
  Adapters/Parsers  PostgreSQL       Job Queue/Workers
       |                |                |
       +------------ Six Engines --------+
                        |
            Test runners / Browser / Metrics
                        |
           Repositórios e ambientes autorizados
```

## 3. Stack interna recomendada
- TypeScript + Node.js, monorepo Turborepo; **ajustar após verificar a arquitetura existente do REA**, evitando reescrita desnecessária.
- MCP SDK oficial compatível com versões atuais; servidor stdio local; HTTP somente com autenticação/autorização.
- React/Vite/Tailwind no painel; acessibilidade e responsividade desktop/tablet/mobile.
- PostgreSQL + Prisma para histórico e grafo inicial via tabelas relacionais; **não adicionar Neo4j sem demonstrar necessidade**.
- Playwright para web; HTTP client para APIs; parsers AST/Tree-sitter conforme linguagem; OpenTelemetry/Prometheus compatíveis quando disponíveis.
- Jobs isolados com limites de CPU/memória/tempo; Docker opcional para execução sandbox; não montar Docker socket indiscriminadamente.
- SQLite local como modo simplificado é opcional, sem sacrificar o backend persistente de produção.

## 4. Pacotes sugeridos (não presumir estrutura upstream)
```text
apps/web                 Painel de auditoria
apps/api                 API e orquestração
apps/cli                 Comandos pie
apps/mcp                 Ferramentas para agentes
packages/core            Domínio, contratos, policies
packages/discovery       Repositórios, linguagens, rotas, serviços
packages/graph           Nós, arestas, impacto, diff
packages/evidence        Coleta, hash, proveniência, retenção
packages/execution       Jobs, sandbox, aprovação, isolamento
packages/adapters        Laravel, Node, React, Docker etc.
packages/engines         functional, product, security, infra, data, regression
packages/reports         Exportações JSON, MD, HTML, PDF opcional
packages/rea-adapter     Capacidades REA quando necessárias
packages/shared          Schemas e UI compartilhada
```
Organizar dentro do fork após mapeamento; caminhos são proposta, não fatos do REA.

## 5. Modelo de domínio mínimo
`Project`, `Repository`, `Environment`, `Snapshot`, `AuditRun`, `AuditScope`, `Capability`, `GraphNode`, `GraphEdge`, `Evidence`, `Finding`, `Recommendation`, `TestCase`, `TestRun`, `MetricSample`, `ChangeSet`, `Approval`, `AgentSession`, `Integration`, `Policy`, `Artifact`.

**Campos essenciais:** UUID, projectId, environmentId quando aplicável, revision SHA, timestamps, sourceLocator (arquivo:linha, rota, teste, métrica), confidence, method (`static|runtime|test|inferred`), state, sensitivity, redactionStatus, expiration/TTL, hash, owner e auditRunId. Evidence tem vínculo imutável com versão e escopo; não substituir silenciosamente evidência histórica.

## 6. Contratos JSON exemplificativos
```json
{
  "findingId": "uuid", "projectId": "uuid", "auditRunId": "uuid",
  "engine": "security", "severity": "high", "state": "confirmed",
  "title": "Autorização ausente em rota premium",
  "evidenceIds": ["uuid"], "affectedNodeIds": ["uuid"],
  "reproduction": "teste isolado reproduzível", "remediation": "controle backend",
  "verificationStatus": "failed", "revision": "git-sha"
}
```
```json
{
  "capabilityId": "uuid", "name": "Criar pedido", "status": "unverified",
  "paths": {"ui": [], "api": [], "service": [], "data": [], "permissions": [], "tests": []},
  "coverage": {"static": true, "runtime": false}, "evidenceIds": []
}
```
Os JSONs são **contratos de referência**, não dados reais do usuário. Implementar schemas validados e versionados; enums explícitos, migrações compatíveis e idempotência.

## 7. Ferramentas MCP propostas
`pie_project_discover`, `pie_graph_query`, `pie_capability_trace`, `pie_audit_start`, `pie_audit_status`, `pie_evidence_get`, `pie_findings_list`, `pie_test_run`, `pie_metrics_compare`, `pie_change_impact`, `pie_plan_generate`, `pie_fix_handoff`, `pie_validation_run`.
- Toda ferramenta informa schema, permissões, limites, timeout, erros estruturados e capability flags.
- Execução e correção são ferramentas de alto privilégio: **nunca ativadas sem política de aprovação**.
- Respostas paginadas para projetos grandes; IDs estáveis e links de evidência, sem despejar todo o repositório no contexto da IA.

## 8. Adapters e descoberta
`Adapter.detect()`, `discover()`, `trace()`, `collectEvidence()`, `test()` (opcional), `capabilities()`. Cada adaptador declara versões suportadas, permissões necessárias, cobertura e limitações. Adaptadores prioritários: TS/JS, Node, React/Vite/Next, Laravel/PHP, Prisma, PostgreSQL, Docker/Compose, Nginx, REST/OpenAPI, Playwright, Git; ampliar Python, Java, .NET, mobile por contrato. **Fallback genérico não é cobertura total**.

## 9. Grafo de dependências
Nós tipados: página, componente, evento, endpoint, middleware, serviço, regra, job, tabela, coluna, integração, permissão, teste, container, recurso. Arestas tipadas: chama, lê, escreve, autoriza, publica, consome, depende, cobre, executa_em. Preservar proveniência por aresta, grau de confiança e snapshot.

## 10. Escalabilidade e recursos
Executar descoberta incremental por hash/commit; caches com invalidação; fila com limites por projeto; paralelismo configurável; índices no banco; paginação; retenção de traces/screenshots; limitação de artefatos. Medir o custo do próprio PIE.

## 11. Integração com agentes
PIE **investiga e valida**; agente de desenvolvimento **propõe e implementa** em branch isolada. PIE entrega pacotes de contexto compactos: problema, evidências, arquivos, dependências, critérios de aceite e comandos de teste. Nenhum patch aplicado automaticamente em produção.
