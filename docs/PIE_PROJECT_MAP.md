# Mapa do projeto PIE

Estado observado em 18/10/2026. Este mapa descreve o código e os limites atualmente confirmados; presença de módulo não significa aceite integral. O detalhamento do produto continua em [`PIE_MASTER_PLAN.md`](PIE_MASTER_PLAN.md), e a arquitetura original REA está em [`architecture.mermaid`](architecture.mermaid).

## Repositório e limites de confiança

O checkout deriva de `morluto/rea`, preserva o código, a licença MIT e os avisos de terceiros, e contém uma camada PIE adicionada ao pacote `rea-agents`. O ponto de entrada PIE separado é `scripts/pie.mjs`; o dispatcher REA original continua em vigor. A análise OBSERVE lê arquivos rastreados, nunca executa conteúdo do projeto e marca descoberta estática como não verificada. VERIFY exige grant explícito, snapshot/digest, imagem fixada por digest, limites de recursos e limpeza pertencente ao runner. Não foi observado CHANGE end-to-end.

## Fluxo de composição

```text
scripts/pie.mjs
   └── src/pie/cli.ts ──┬── PieService (src/pie/service.ts)
                        ├── CLI/MCP workflows
                        ├── API local (src/pie/api.ts)
                        └── SQLite ou PostgreSQL/Prisma

PieService ── discovery ── Git + inventário + adapters ── Snapshot/Evidence
          ├── jobs/queue + workers ── discovery ou VerificationCoordinator
          ├── execution/ ── grant ── workspace ── Docker ── journal/cleanup
          └── functional/trace/compare/reports ── contratos e provas persistidas

apps/web ── API local autenticada ── PieService
```

O diagrama é uma orientação. Os limites efetivamente implementados e testados devem ser conferidos nos contratos e testes listados abaixo.

## Componentes PIE observados

| Camada               | Fontes representativas                                                                             | Papel e limite atual                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada              | `scripts/pie.mjs`, `src/pie/cli.ts`, `src/pie/apiCli.ts`                                           | Dispatcher CLI, comandos de produto e cliente HTTP local. Instalação global/update ainda sem validação completa neste Windows.                                                                 |
| Contratos/domínio    | `src/pie/contracts.ts`, `source.ts`, `policy.ts`, `evidence.ts`                                    | Schemas Zod, política, identidade e Evidence selada; nem todos os resultados esperados usam `Result` uniformemente.                                                                            |
| Descoberta           | `discovery.ts`, `inventoryPath.ts`, `readFile.ts`, `codeFacts.ts`                                  | Inventário Git limitado, snapshots e grafo; estático, não atômico diante de alterações concorrentes, com matriz multi-stack parcial.                                                           |
| Adapters             | `adapters/`                                                                                        | Facts TS/JS, manifests, Express, Next App/Pages Router, Laravel, Nginx, Compose/build e instruções selecionadas Dockerfile, OpenAPI e Prisma; Evidence preservada, sem prova de build/runtime. |
| Persistência         | `store.ts`, `postgresStore.ts`, `openPersistence.ts`, `prisma/schema.prisma`, `prisma/migrations/` | SQLite local e PostgreSQL/Prisma; CI PostgreSQL real existe, mas retenção/redação e todas as entidades ainda não fecham T1.2.                                                                  |
| Jobs                 | `jobs/`                                                                                            | Fila persistente, idempotência, lease, heartbeat, cancelamento e workers de descoberta/VERIFY; cobertura de daemon, recuperação e tipos de job permanece parcial.                              |
| Execução             | `execution/`                                                                                       | Grant para testes Node em Docker e probe HTTP local limitado; Playwright, DB de teste e captura geral de logs/traces ainda ausentes.                                                           |
| Aplicação            | `service.ts`, `functional.ts`, `trace.ts`, `compare.ts`, `retestPlan.ts`                           | Fluxos compartilhados de descoberta, análise estática, trace, comparação e plano de reteste. O motor funcional atual só reporta lacunas de verificação; não é um motor completo de defeitos.   |
| Adaptadores públicos | `api.ts`, `mcp.ts`, `cli.ts`                                                                       | Superfícies CLI, MCP e API sobre serviços comuns; workflows/contratos ainda não cobrem toda a especificação.                                                                                   |
| Interface            | `apps/web/`                                                                                        | React pt-BR conectado à API para projeto, investigação, histórico e VERIFY; cobertura de motores, resolução, acessibilidade e jornadas ainda parcial.                                          |
| Distribuição         | `compose.pie.yml`, `.github/workflows/pie.yml`, `README_PIE.md`                                    | Compose e CI PIE existem; instalação limpa, doctor/setup reversível e matriz multiplataforma não estão comprovados integralmente.                                                              |

## Persistência e proveniência

O modelo PostgreSQL registra projetos, snapshots, Evidence, nós/arestas, jobs, execuções VERIFY, registros funcionais e probes HTTP. Migrations usam FKs e índices; tabelas de Evidence e execuções retêm payloads imutáveis via validação da aplicação e constraints relacionais. SQLite é o modo local. O conteúdo serializado é validado antes de consultas; histórico não deve ser recalculado silenciosamente por uma versão nova do motor.

Evidence contém schema version, origem, revisão, ambiente, método, confiança, estado, timestamp, sensibilidade, estado de redação, expiração, limitações e digest. A descoberta não retém corpos nem ambiente herdado. Isso não demonstra política completa de retenção, eliminação para titulares ou conformidade jurídica; ver lacunas T1.2/T4.3.

## Evidência de validação existente

- `tests/boundary/pieFoundation.test.ts`, `pieAdapters.test.ts`, `pieExpressCrossFile.test.ts`, `pieJobs.test.ts`, `piePostgres.test.ts`, `pieVerification.test.ts`, `pieWeb.test.ts` atravessam fronteiras reais em escopos delimitados.
- CI tem lanes PIE e PostgreSQL; uma lane verde prova apenas os cenários daquele workflow e SHA.
- Execução local recente no Windows: build PIE, check rápido, documentação, formatação e boundaries selecionadas passaram. Linux/macOS e provedores opcionais não foram cobertos nessa rodada.

Os status por trilha e verificações pendentes permanecem no plano mestre; este mapa não os promove.
