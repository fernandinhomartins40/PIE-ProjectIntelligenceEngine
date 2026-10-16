# PIE — Plano mestre de implementação integral

Atualizado em 16/10/2026. Produto em desenvolvimento; nenhuma entrega equivale ao aceite integral.

## Autoridade e referência

Os 12 documentos de `blueprint/` são a especificação integral, lida nesta sessão e preservada sem edições. A autorização é desenvolver o fork PIE nesta pasta; não publicar como REA oficial nem modificar aplicações auditadas. As regras de contribuição ao upstream não exigem autorização do mantenedor REA para este fork independente.

## Plano por dependências

| ID | Prioridade | Entrega e critério verificável | Estado | Dependências / evidência |
|---|---|---|---|---|
| T0.1 | P0 | Preservar blueprint e histórico upstream | parcial | Branch main; SHA em UPSTREAM_REA_AUDIT.md; publicação autorizada, vínculo de rede de fork pendente |
| T0.2 | P0 | Auditar arquitetura, licenças, CLI/MCP, testes e extensões | em andamento | Inspeção local; baseline de runtime pendente |
| T0.3 | P0 | Baseline upstream e caracterização de CLI/MCP/evidências | parcial | Build empacotado, CLI help e catálogo MCP com 207 ferramentas verificados; 36 testes evidence/ledger passaram; provedores reais pendentes |
| T1.1 | P0 | Contratos versionados, estados, identidade, escopo e políticas OBSERVE/VERIFY/CHANGE | parcial | Schemas explícitos CLI/MCP, validação Ajv e controles OBSERVE testados; Result e runner pendentes |
| T1.2 | P0 | PostgreSQL, migrations, evidência imutável, redação e histórico | parcial | Migrações e teste dedicado PostgreSQL real passaram na CI Linux 38963487480; retenção/redação completa e demais entidades ainda pendentes |
| T1.3 | P0 | Fila persistente, workers, cancelamento, recuperação e limites | parcial | Fila SQLite e teste concorrente PostgreSQL real passaram; worker OBSERVE testado; daemon, runners isolados e demais tipos de jobs pendentes |
| T1.4 | P1 | API local autenticada; CLI e MCP sobre os mesmos serviços | parcial | API loopback com Bearer, raiz fixa, limites e teste integrado; jobs/API completa pendentes |
| T1.5 | P1 | Painel pt-BR conectar → investigar → resolver/validar | pendente | T1.4; E2E, teclado, telas 360–1440px |
| T2.1 | P1 | Inventário Git limitado, snapshots e proveniência por hash | parcial | Implementado e testado em Windows; snapshot atômico hostil não garantido |
| T2.2 | P1 | AST TS/JS/Node/React/Next e imports/rotas/serviços/testes | parcial | Imports/reexports relativos AST; rotas/frameworks e aliases pendentes |
| T2.3 | P1 | Laravel/PHP, Prisma/Postgres, Docker/Compose, Nginx e OpenAPI | parcial | Manifests Node/Composer, serviços/dependências Compose, operações OpenAPI 3.0/3.1 e model/campos Prisma integrados; PHP/Nginx e cobertura completa pendentes |
| T2.4 | P1 | Grafo tipado, trace, impacto e descoberta incremental | parcial | Comparação de snapshots e impacto pelos dois grafos em CLI/MCP/API; cache/incremental pendentes |
| T3.1 | P0 | Runners de testes com autorização, isolamento e resultado não ambíguo | pendente | T1.3; skipped/blocked não passam |
| T3.2 | P1 | Playwright, HTTP, DB de teste, logs e traces redigidos | pendente | T3.1; persistência após reload |
| T4.1 | P1 | Motor funcional e matriz de capacidades | pendente | T2/T3; falhas semeadas |
| T4.2 | P1 | Motor produto/UX: cinco movimentos com jornada observada | pendente | T2/T3; protocolo produto integral |
| T4.3 | P0 | Motor segurança/LGPD/receita | pendente | T2/T3; dois tenants, entitlement, webhook, créditos concorrentes |
| T4.4 | P1 | Motor infraestrutura/VPS/performance | pendente | T2/T3; baseline comparável, p95/p99, rollback |
| T4.5 | P1 | Motor dados/integrações | pendente | T2/T3; constraints, migrations, contratos, retry/idempotência |
| T4.6 | P1 | Motor regressão | pendente | T2.4/T3; impacto Git, reteste e comparação de métricas |
| T5.1 | P1 | Plano unificado e contestação com trilha histórica | pendente | T4; responsável/evidência/aceite |
| T5.2 | P1 | Handoff Codex/Claude, branch/patch, aprovação sensível e reteste | pendente | T5.1; demonstração ponta a ponta |
| T6.1 | P1 | Exports JSON/MD/HTML, histórico e CI incremental | parcial | Exports reais com escape, CSP e referência de evidências; CI incremental pendente |
| T6.2 | P1 | doctor, setup reversível, distribuição e Compose | pendente | T1–5; instalação limpa |
| T6.3 | P1 | CI e matriz Windows/Linux/macOS, limites e recursos PIE | pendente | T6.2; somente plataformas executadas são verificadas |
| T6.4 | P0 | Demonstração completa e checklist final com evidências | pendente | Todas; defeitos do checklist, correção e reteste |

## Regras de status

`verificado` exige resultado registrado; presença de código é `implementado não verificado`. Falta de credencial, serviço ou runtime é bloqueio localizado. Não substituir por mock, não reduzir escopo e continuar tarefas independentes. Fixtures sintéticas somente nos testes. Provedores REA continuam opcionais, com limitações explícitas.

## Progresso comprovado da primeira fatia

Contratos e políticas iniciais, inventário Git, evidências imutáveis, SQLite local, CLI e cinco ferramentas MCP implementados. Grafo AST de imports relativos TS/JS, proveniência por linha e impacto reverso testados. 43 testes selecionados passaram. T1.1/T1.4/T2.1/T2.2/T2.4 permanecem **parciais**: não abrangem todos os contratos, adaptadores e caminhos do blueprint. T1.2 tem modo SQLite implementado; PostgreSQL e migrações de produção pendentes. Estado das demais trilhas segue pendente. Baseline REA parcial: evidência/ledger testados e compilação TypeScript executada; CLI/MCP empacotados e provedores reais ainda não caracterizados.

## Continuidade

Ver `PIE_HANDOFF.md` e `PIE_VALIDATION_REPORT.md`. Cada entrega deve atualizar esta tabela, comandos e limitações. O checklist integral permanece em `blueprint/08_CHECKLIST_ACEITE_FINAL.md`.
