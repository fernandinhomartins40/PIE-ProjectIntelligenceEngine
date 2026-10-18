# Plano de auditoria do PIE

Este arquivo operacionaliza os critérios de `docs/blueprint/` e não substitui o [`PIE_MASTER_PLAN.md`](PIE_MASTER_PLAN.md), que permanece a fonte canônica de status por entrega. Cada gate exige evidência do workflow indicado, na revisão exata; execução estática não aprova runtime.

## Regras de execução

1. Começar pelo escopo OBSERVE, snapshot identificado por revisão/digest e limites registrados.
2. Antes de VERIFY, exigir grant explícito e ambiente isolado; registrar `passed`, `failed`, `skipped`, `blocked` ou `inconclusive` sem promover estados.
3. Preservar Evidence, identidade do alvo, autorização, estado de cleanup e limitações entre CLI, MCP, API, jobs e UI.
4. Para cada finding, salvar evidência mínima reproduzível, dono, gravidade, status, reteste e risco residual. Não escrever em aplicação auditada sem autorização separada.
5. Medir tempo, CPU, memória de família de processos e expansão de retenção quando a entrega afetar custos; reportar custos não medidos.

## Gates por trilha

| Trilha                    | Escopo da auditoria                                                                                                | Evidência de aceite                                                                                                | Estado registrado                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0 — REA, fork e licenças | Ancestralidade, arquitetura real, CLI/MCP, Evidence, testes, dependências e notices                                | Git/API, testes aplicáveis, inventário verificável e revisão de distribuição                                       | Fork e ancestralidade verificados; `verify:package:windows` passou em Node 24: instalação, CLI/MCP (207), setup idempotente, uninstall e update exato. Verifier genérico ainda bloqueia em symlink `EPERM`; sete gaps de notices, revisão legal e Linux/macOS pendentes. |
| T1 — plataforma           | Schemas versionados, políticas, persistência SQLite/PostgreSQL, imutabilidade, jobs, adapters CLI/MCP/API e painel | Ajv/clientes reais, migrations/DB real, concorrência/falha/cancelamento/cleanup, UI navegável e acessível          | Parcial conforme tabela do plano mestre. PostgreSQL comprovado em CI para cenários selecionados; não significa aceite de todas as entidades.                                                                                                                             |
| T2 — descoberta/grafo     | Monorepo, linguagens e relações page→API→service→DB→permission→test; Compose e Dockerfile                          | Fixture multi-stack deliberadamente conhecida, proveniência por aresta, unknown preservado, tracing e diff         | Parcial; Compose build e fatos de instruções Dockerfile selecionadas agora preservam Evidence. Runtime/build frontend, volumes Compose e demais lacunas constam em `PIE_MASTER_PLAN.md`.                                                                                 |
| T3 — verificação          | Node/Docker, HTTP autorizado, Playwright, DB, logs/traces e job lifecycle                                          | Alvo isolado real, autorização e cleanup comprovados, cenários negativos, resultados tipados e sem falsa aprovação | Node/Docker e HTTP em escopos limitados; Playwright, DB de teste e captura geral ainda pendentes.                                                                                                                                                                        |
| T4 — motores              | Funcional; produto/UX; segurança/LGPD/receita; infraestrutura/performance; dados/integrações; regressão            | Fixtures sintéticas apenas em testes com defeitos semeados específicos por motor e findings rastreáveis            | Cinco motores ainda não completos; infraestrutura avançou com inventário estático Dockerfile/Compose, sem medir ou executar alvo; regressão parcial. Não declarar defeitos de alvo sem aplicação e evidência apropriadas.                                                |
| T5 — planejamento/agentes | Priorização comum, contestação, handoff, patch, revisão sensível e reteste                                         | Demonstração completa com finding→correção→reteste e histórico                                                     | Pendente. O fluxo atual opera diretamente na main por instrução explícita do usuário; criação de branch não será usada.                                                                                                                                                  |
| T6 — operação             | Exports, doctor/setup reversível, distribuição, Compose, CI e suporte OS                                           | Instalação limpa, upgrade/rollback, gates CI e matriz executada em cada SO declarado                               | Parcial/pendente; ver T6.1–T6.4.                                                                                                                                                                                                                                         |

## Próximos trabalhos seguros

1. Fechar lacunas T1.1: contrato versionado de respostas, `Result` uniforme em discovery/adapters e identidade/estados nas fronteiras.
2. Fechar T1.2/T1.3: retenção/redação e lifecycle/recuperação de jobs; usar PostgreSQL real via lane CI quando não houver DB local.
3. Construir Playwright e captura de DB/logs por grant, com isolamento e cleanup observáveis.
4. Implementar motores com contratos reais e evidências, cada qual ligado a critérios dos três protocolos universais.
5. Completar instalação/doctor/setup reversível e executar matriz Windows/Linux/macOS.
6. Rodar a demonstração integral com falhas semeadas apenas em fixtures de teste e publicar relatório de aceite com limitações.

Credenciais, permissões, decisão comercial/legal e custo de infraestrutura externo permanecem gates humanos quando forem realmente necessários. Um bloqueio de uma lane não interrompe as outras trilhas seguras.
