# PIE — Plano mestre de implementação integral

## Endpoints Express derivados da AST — 16/10/2026

CI 38987552370 (428180d4a) passou, comprovando correção NDJSON da CLI contínua com SIGTERM e rotas Next. readExpressDeclarations agora consome a mesma árvore Babel de readCodeFacts, sem nova dependência/parser ou execução. Produz endpoint express-ast com método, padrão literal, receptor local em parent, linha e evidência selada. Reconhece imports de valor/default/Router e const require express, construtores app/Router; chamadas diretas no escopo superior somente. require sombreado por declaração/import/desestruturação é recusado; atribuições diretas invalidam o receptor. Métodos em objetos estranhos ou em escopos aninhados não viram endpoints.

Parent não é prefixo público: montagem use(), cadeias route(), aliases mutáveis, callbacks/factories, caminhos dinâmicos/arrays/regex e efeitos de código chamado permanecem não examinados. Não confirma handler válido, instalação, autenticação, listen, HTTP ou relação UI→API→DB. Não declarar T2.2 nem motor funcional completos.

Testes Git/SQLite reais comprovam persistência, linha, hash/prova, trace declared_in e ausência de prefixos fabricados. Casos negativos/limites incluem CommonJS, aliases, tipos, shadowing e mutação. Rodada adapters/fundação/trace: 14 passaram (5,53s). Build PIE passou; lint dos parsers/testes sem avisos/erros. Custos comparativos de tokens/CPU/memória e tarefas completas ainda não medidos; não há alegação de ganho de desempenho. Runners HTTP/Playwright, Laravel/PHP/Nginx, seis motores e aceite integral permanecem pendentes; goal ativo.

## Correção do protocolo contínuo e estado da CI — 16/10/2026

CI 38987122505 (8b4e9af13) falhou no teste POSIX da CLI contínua. Log autenticado confirmou consumo do job e exit 0 antes da falha; JSON.parse rejeitou o resumo final porque a CLI combinava um registro inicial de uma linha com JSON final indentado. Corrigido o produtor: no modo continuous, a resposta final também usa uma única linha, mantendo NDJSON consistente. Comandos de um job continuam com JSON indentado. Correção por inspeção da causa no produtor, sem relaxar o teste. Validação positiva dessa correção exige a próxima CI Linux; não registrar a execução anterior como verde. Typecheck completo e limites de módulos (2050 fontes), descoberta de 1463 testes passaram na entrega de rotas. Goal integral permanece ativo.

## Rotas Next App Router no grafo — 16/10/2026

readCodeFacts passa a ser dono da árvore Babel TS/JS/JSX e produz imports + declarações Next sem parsing duplicado. imports.ts agora mantém somente resolução convencional de referências; coletor recebe fatos já interpretados. Convenções app/**/page.tsx e route.ts/js produzem page e endpoint com exports explícitos, padrão de caminho, linha e prova selada. Grupos são removidos do padrão, segmentos dinâmicos permanecem literais; segmentos privados/paralelos/interceptados não são convertidos em rota pública. Alias de export nomeado é registrado, sem inventar valor resolvido ou execução. Adapter next-app-convention indica a fonte da derivação, não confirmação de framework ativo.

Integração Git/SQLite real comprova persistência, evidência, declared_in no trace e imports do mesmo AST. Testes distinguem comentários/strings, exports de tipo, nomes parecidos, JSX não suportado em route, orçamento e parse inválido. Rodada adapters/fundação/trace: 12 passaram (5,58s); após refinamentos, adapters/MCP: seis passaram (11,73s). Build PIE e typecheck web passaram. Lint dos novos parsers sem avisos/erros. Sem execução de aplicação Next nesta entrega; autenticação, build, rewrites/basePath, conflitos e disponibilidade HTTP não comprovados. Rotas Express/Laravel, demais runners/motores e aceite integral permanecem pendentes; goal ativo.

## Workers contínuos — 16/10/2026

CI 38986773802 (1d4880fe6) passou, incluindo enfileiramento/cancelamento real pelo painel Chrome Linux. work/work-verify agora aceitam --continuous e --poll-ms 100–30000 (padrão 1000). JobDaemon consome sequencialmente, concorrência 1, espera ociosa abortável e para diante de falha operacional; não repete auditorias VERIFY interrompidas. SIGINT/SIGTERM cancelam trabalho ativo e drenam worker/coordenador antes de fechar fila/store. Worker revalida encerramento após resolver raiz, antes de novo claim. Sem continuous, comportamento de um job preservado. É processo em primeiro plano; não instala serviço do sistema.

workerCli.ts passou a ser dono da composição/encerramento do worker; cli.ts mantém admissão de opções, fila e comandos. Testes locais SQLite/Git reais: consumo de jobs posteriores ao início, rejeição de segundo run, encerramento/retry idempotente, espera de 30s interrompida e raiz indisponível encerra sem retry. Rodada fila+MCP: cinco passaram, um skipped (12s); extensão de falha operacional passou em nova rodada (quatro passaram, um skipped, 4,76s). CLI contínua POSIX com SIGTERM foi adicionada à trilha existente, ignorada no Windows e aguarda CI. Build PIE passou. Lint sem erros; aviso de quantidade de parâmetros já existente em runJobCommand. Sem comprovação de desempenho comparativo/CPU/memória. Runners HTTP/Playwright, seis motores e aceite integral permanecem pendentes; goal ativo.

## Painel conectado à fila VERIFY — 16/10/2026

CI 38986542581 (d8f17ba62) passou, incluindo Chrome Linux. Painel agora envia authorization JSON completo com chave idempotente para a fila real, exige snapshot selecionado, consulta job por UUID e solicita cancelamento com sessão/CSRF. GET /v1/context informa verificationQueueEnabled somente quando fila e verificador existem; formulário permanece indisponível por padrão. Nenhuma autorização é gerada automaticamente nem armazenada no navegador; grant enviado permanece no job persistido. Estado succeeded é exibido como workflow concluído, com orientação para ler o resultado real. Worker permanece separado, sem início/retry automático pelo painel.

Teste Chrome Linux novo usa SQLite, grant e coordenador reais, confere snapshot incorreto recusado, fila sem execução, consulta, cancelamento, idempotência e ausência de dados em storage/reload. Ignorado neste Windows; CI da nova entrega ainda pendente. Rodada local: cinco testes passaram e um skipped em dois arquivos (29,88s). Rerun focado do caso blocked com formulário desabilitado passou (4,82s). Typecheck web/build e compilação PIE passaram. Novos componentes/hooks com lint sem avisos/erros. Demais runners, daemon, recuperação completa, seis motores e aceite integral continuam pendentes; goal ativo.

## Painel de resultados VERIFY — 16/10/2026

CI 38986169418 (45d3a8900) passou: enfileiramento API/MCP, Ajv, idempotência/cancelamento e Docker/PostgreSQL reais. Painel agora consulta histórico paginado de verificações por snapshot, permite atualizar e abrir resultado persistido, mostra estado, limpeza, imagem, evidência/hash, falha/limitações e autorização v2 preservada. Formato v1 informa ausência de autorização completa. Casos são renderizados em páginas de 25. Dados vêm exclusivamente da API local autenticada. passed descreve somente o escopo executado; blocked/skipped/inconclusive não aprovam. Troca de snapshot desmonta seleção e cancela leituras pendentes.

Teste Chrome Windows usa NodeVerification real com Docker indisponível, persiste blocked e confere prova/autorização na interface, sem simular resultado nem executar alvo no host. Encontrou overflow de mensagens com caminhos longos em 360 px, corrigido na representação CSS e tabela existente. Teste blocked passou; os três testes do painel passaram na rodada ampla. Sessão/CSRF também passou. Novo paginador exigiu delimitar o teste de trace à região Observações estáticas; rerun passou (um teste, 16,20s). Typecheck web e build passaram. Lint sem erros, com aviso de tamanho em Verifications; limites de módulos: 2046 fontes; descoberta: 1463 testes. Custos de CPU/memória desta tela ainda não medidos. Envio de autorização/fila e acompanhamento de job pela interface, demais runners e motores ainda pendentes; goal integral ativo.

## Enfileiramento VERIFY pela API/MCP — 16/10/2026

CI 38985908103 do commit d0cd0a6db passou: migração e fila PostgreSQL reais, worker VERIFY Docker e correlação job/run/journal. API agora oferece POST /v1/jobs/verification com idempotencyKey e authorization, apenas com fila e verificador habilitados; retorno 202 não executa testes. MCP habilitado oferece pie_verification_enqueue, pie_verification_job_get e pie_verification_job_cancel. Servidor MCP mantém fila até finalizar transporte/verificador. Consulta/cancelamento usam scopedJob compartilhado, restringindo raiz; MCP restringe também tipo verification. API mantém autenticação, origem e CSRF existentes.

Testes locais: API/MCP padrão três passaram e três skipped (8,88s); após aplicar escopo, API dois passaram (2,80s) e fila três passaram (3,22s), incluindo recusa de outra raiz/tipo. Compilação PIE passou. Schemas Ajv e idempotência/cancelamento das chamadas novas incluídos nos testes reais Linux existentes; ignorados neste Windows, sem prova positiva local dessas chamadas. CI desta entrega ainda pendente. UI de execução/fila, daemon e demais runners/motores continuam pendentes; goal integral ativo.

## Fila VERIFY — implementação em validação, 16/10/2026

CI 38984171283 (4bc84e2fc) e 38984646478 (8bb9308e6) passaram, incluindo API/MCP com Docker real. A fila agora discrimina discovery/verification, mantém grant completo e exige maxAttempts=1 em VERIFY. Workers selecionam o tipo; descoberta não consome execução. Lease vencida encerra VERIFY como failed/EXECUTION_INTERRUPTED e nunca reencaminha testes. Heartbeat mantém ownership durante cancelling, devolvendo false para cancelar o trabalho enquanto a finalização continua protegida. ID do job é o ID da execução/journal, permitindo localizar prova persistida mesmo se o recibo do job se perder.

CLI: enqueue-verify <grant.json> --key <chave> com as três opções Docker/estado; work-verify <raiz> processa um job. Pré-admissão valida snapshot/raiz/política; worker revalida antes de adquirir recursos. Migração PostgreSQL 202610160004 acrescenta tipo e limite de tentativas; SQLite preserva tabela existente. API/MCP/UI de enfileiramento VERIFY ainda pendentes. Não há daemon nem retomada automática de auditoria.

Validação local: cinco testes passaram e três skipped em quatro arquivos (17,92s), cobrindo SQLite real, fencing, idempotência, cancelamento/finalização e compatibilidade MCP padrão. Compilação PIE, typecheck completo e CLI help passaram. Limites de módulos validados em 2045 fontes; 1463 arquivos de teste descobertos exatamente uma vez. Testes novos de worker VERIFY com Docker e PostgreSQL foram adicionados às trilhas existentes da CI; ignorados neste Windows e ainda sem resultado remoto desta entrega. Lint dos módulos sem erros, com avisos de tamanho/quantidade de parâmetros no worker e contratos da fila. Produto integral permanece incompleto; goal ativo.

Atualizado em 16/10/2026. Produto em desenvolvimento; nenhuma entrega equivale ao aceite integral.

MCP VERIFY opt-in comprovado na CI 38984646478. T1.4 permanece parcial: API/MCP da fila, UI de execução e motores pendentes.

## Autoridade e referência

Os 12 documentos de `blueprint/` são a especificação integral, lida nesta sessão e preservada sem edições. A autorização é desenvolver o fork PIE nesta pasta; não publicar como REA oficial nem modificar aplicações auditadas. As regras de contribuição ao upstream não exigem autorização do mantenedor REA para este fork independente.

## Plano por dependências

| ID | Prioridade | Entrega e critério verificável | Estado | Dependências / evidência |
|---|---|---|---|---|
| T0.1 | P0 | Preservar blueprint e histórico upstream | parcial | Branch main; SHA em UPSTREAM_REA_AUDIT.md; publicação autorizada, vínculo de rede de fork pendente |
| T0.2 | P0 | Auditar arquitetura, licenças, CLI/MCP, testes e extensões | em andamento | Inspeção local; baseline de runtime pendente |
| T0.3 | P0 | Baseline upstream e caracterização de CLI/MCP/evidências | parcial | Build empacotado, CLI help e catálogo MCP com 207 ferramentas verificados; 36 testes evidence/ledger passaram; provedores reais pendentes |
| T1.1 | P0 | Contratos versionados, estados, identidade, escopo e políticas OBSERVE/VERIFY/CHANGE | parcial | Schemas explícitos CLI/MCP, validação Ajv e controles OBSERVE testados; Result e runner pendentes |
| T1.2 | P0 | PostgreSQL, migrations, evidência imutável, redação e histórico | parcial | PostgreSQL real comprovado na CI; resultados VERIFY e evidências agora persistidos atomicamente nos dois adaptadores, aguardando nova CI PostgreSQL; retenção/redação completa e demais entidades pendentes |
| T1.3 | P0 | Fila persistente, workers, cancelamento, recuperação e limites | parcial | Fila SQLite e teste concorrente PostgreSQL real passaram; worker OBSERVE testado; daemon, runners isolados e demais tipos de jobs pendentes |
| T1.4 | P1 | API local autenticada; CLI e MCP sobre os mesmos serviços | parcial | CLI/API/MCP VERIFY compartilham coordenador persistente; API/MCP opt-in com grant/raiz fixa e BUSY; novas execuções HTTP/MCP aguardam CI; jobs completos pendentes |
| T1.5 | P1 | Painel pt-BR conectar → investigar → resolver/validar | parcial | React local com sessão/CSRF, descoberta, evidências, trace, comparação e páginas completas de projetos/histórico; Chrome Windows e telas 360–1440px testados; resolução/reteste e auditoria acessível completa pendentes |
| T2.1 | P1 | Inventário Git limitado, snapshots e proveniência por hash | parcial | Implementado e testado em Windows; snapshot atômico hostil não garantido |
| T2.2 | P1 | AST TS/JS/Node/React/Next e imports/rotas/serviços/testes | parcial | Imports/reexports relativos AST; rotas/frameworks e aliases pendentes |
| T2.3 | P1 | Laravel/PHP, Prisma/Postgres, Docker/Compose, Nginx e OpenAPI | parcial | Manifests Node/Composer, serviços/dependências Compose, operações OpenAPI 3.0/3.1 e model/campos Prisma integrados; PHP/Nginx e cobertura completa pendentes |
| T2.4 | P1 | Grafo tipado, trace, impacto e descoberta incremental | parcial | Comparação/impacto e trace limitado de imports, origem de declarações, serviços Compose e campos Prisma pela CLI/MCP/API; grafo completo UI/API/DB e incremental pendentes |
| T3.1 | P0 | Runners de testes com autorização, isolamento e resultado não ambíguo | parcial | Admissão/cópia/Node/Docker, persistência, recovery e CLI comprovados na CI; coordenador/API opt-in novos aguardam CI; jobs/UI/MCP de execução, retomada e demais runners pendentes; skipped/blocked não passam |
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
