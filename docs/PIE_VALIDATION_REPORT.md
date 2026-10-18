## Sele??o incremental da integra??o PIE ? 17/10/2026

- `scripts/ci/pie-tests.mjs` permite modo focused apenas para diff n?o vazio composto exclusivamente por testes existentes na allowlist; diffs desconhecidos, dispatch manual e source/config seguem no conjunto completo. A su?te ? invocada por `spawnSync` com argumentos, sem interpolar paths no shell. Etapas PostgreSQL/Docker/browser e demais grupos continuam sempre executadas.
- `tests/conformance/pieCiSelection.test.ts`: 2/2; `workflowActionPinning` + `ciRequiredLanes`: 22/22. Parser YAML aceitou `.github/workflows/pie.yml`; `check:fast` passou ap?s adicionar declara??o `.d.mts` ao script ESM. O workflow inclui checkout completo para compara??o, fixa SHA base/head e executa sempre a regress?o do seletor. Actionlint n?o est? instalado neste Windows (comando `go` ausente); o CI geral executar? essa valida??o ap?s o push.
- GitHub Actions `PIE integration` #91 (commit `35e3c5445`, fallback completo) e #92 (commit s? de teste `1d023f5f5`, focused em `pieApi.test.ts`) conclu?ram `success`. Dura??o observada da etapa seletora: 12 s no fallback e 2 s no focused; do workflow: 2m02s e 1m53s. ? uma ?nica compara??o, sem medi??o de CPU/RAM e insuficiente para inferir ganho m?dio; o delta total n?o ? atribu?do somente ? sele??o. O fallback reduz apenas o grupo principal de 14 boundaries; PostgreSQL/Docker/browser e grupos dedicados continuam completos.
- CI geral run `39058695617` seguia `pending` na consulta. Release runs `39058184527` e `39058695587` falharam em `Update release proposal`; logs retornaram HTTP 403 sem autentica??o, ent?o causa e rela??o com mudan?as permanecem desconhecidas.

## Exporta??o paginada de execu??es VERIFY ? 17/10/2026

- `verification-export <id>`, `GET /v1/verifications/:id/export` e MCP `pie_verification_export` chamam o mesmo `PieService`. Cada p?gina inclui o JSON ?ntegro do registro retido, run/snapshot/treeDigest/Evidence e hashes do payload e artefato serializado. O run ? relido pela persist?ncia e validado contra Evidence e snapshot; n?o h? execu??o do grant.
- `npm.cmd run test:focused -- tests/boundary/pieRunPersistence.test.ts tests/boundary/mcp/toolSchemaValidity.test.ts`: SQLite/API/MCP/CLI passou; 16 testes passaram e o caso PostgreSQL real foi skipped (sem `PIE_TEST_DATABASE_URL`). O fixture provoca bloqueio real pela aus?ncia do execut?vel Docker; o estado permanece `blocked`. Schemas MCP 2020-12 foram validados para cat?logo inteiro.
- `npm.cmd run check:fast`, `npm.cmd run mcp-catalog:check`, `npm.cmd run docs:check`, `npm.cmd run format:check` e `git diff --check` passaram. A CI incremental segue pendente.

## Exporta??o do hist?rico funcional ? 17/10/2026

- `functional-record-export <id>`, `GET /v1/functional-records/:id/export` e MCP `pie_functional_record_export` chamam o mesmo servi?o; as p?ginas carregam registro/hash, snapshot/treeDigest e hash/tamanho do JSON serializado. Revalida payload hist?rico contra snapshot; n?o recalcula o motor.
- Valida??o executada: `npm.cmd run test:focused -- tests/boundary/pieApi.test.ts tests/boundary/mcp/pieMcp.test.ts tests/boundary/pieFunctionalPersistence.test.ts`: 3 arquivos/4 testes passaram. API usa Git/SQLite locais, checa aus?ncia de token e pagina??o; MCP stdio valida schema e igualdade byte a byte entre CLI e MCP.
- T6.1 segue parcial: export de VERIFY e CI incremental n?o foram inclu?dos.

# PIE — Registro de validação contínua

## Contestação do plano — 17/10/2026

- A boundary `pieUnifiedPlan`, `pieDoctor` e `piePostgres` executou 3 testes com sucesso; 1 teste Postgres foi ignorado porque `PIE_TEST_DATABASE_URL` não está configurada. SQLite/Git reais cobrem contestação justificada, hash/item histórico, retry idempotente, triggers que rejeitam UPDATE/DELETE, digest e Evidence inválidos, paginação e paridade CLI/API/MCP. Ajv valida os schemas MCP.
- `check:fast`, `format:check`, `docs:check` e `mcp-catalog:check` passaram; Prisma Client/schema gerados, migration adicionada e catálogo MCP regenerado. PostgreSQL real não foi verificado localmente.

## Owner/status de triagem — 17/10/2026

- `pieUnifiedPlan.test.ts` percorre SQLite real, CLI, API autenticada e MCP. Verifica revisão inicial, retry idempotente entre adapters, histórico/hashes, Ajv, rejeição por revisão stale, remoção de owner com estado preservado e trigger append-only. A projeção atualizada conserva `planDigest`, `state: unverified` e `executionAuthorized: false`.
- `check:fast` e os focused `pieUnifiedPlan`, `pieDoctor`, `piePostgres` passaram; o teste Postgres foi skipped sem `PIE_TEST_DATABASE_URL`. Não houve validação runtime PostgreSQL desta migration.

## Fluxo web do plano, triagem e contestação — 17/10/2026

- `tests/boundary/piePlanWeb.test.ts`: 1/1 passou no Chrome instalado, contra servidor PIE autenticado, repositório Git temporário e SQLite real. Pela interface, atribuiu owner/status com justificativa, conferiu evento persistido via PieService, contestou com Evidence selecionada e confirmou histórico e hash na persistência; verificou ausência de overflow horizontal em 360 e 1440 px.
- `npm.cmd run pie:web:typecheck`, `npm.cmd run pie:web:build`, `npm.cmd run test:focused -- tests/boundary/piePlanWeb.test.ts`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram. `PIE_TEST_DATABASE_URL` continua ausente; essa fatia não verifica PostgreSQL runtime nem priorização impacto/risco/esforço.

## Priorização humana auditável do plano — 17/10/2026

- Triage v2 adiciona notas 1–5 de impacto/risco/esforço, justificativa e 1–10 Evidence do snapshot. Eventos v1 continuam legíveis; v2 registra valor anterior/novo, hash e encadeamento. A ordenação pública é impacto desc., risco desc., esforço asc., ID estável; itens sem avaliação ficam por último. Notas nunca são inferidas do código e não mudam o `planDigest` estático.
- `tests/boundary/pieUnifiedPlan.test.ts` passou ordenação por cada dimensão, desempate estável por ID, paginação global, remoção de nota, digest estável e rejeição de Evidence externa; também preserva leitura/hash de eventos v1. `tests/boundary/piePlanWeb.test.ts` passou no Chrome local com API/SQLite reais, comprovando fluxo web de notas, triagem, contestação, persistência e layout responsivo. `check:fast`, `pie:build`, `mcp-catalog:generate/check`, `format:check` e `docs:check` passaram; execução de PostgreSQL runtime segue pendente.

## Runtime pinado e plano agregado inicial — 17/10/2026

- `npm.cmd exec --yes --package=node@24.18.0 -- node --version`: `v24.18.0` a partir do cache npm existente, sem instalação global. Com esse executável, `scripts/pie.mjs doctor` reportou `ready_for_observe`, Node/Git disponíveis, SQLite `not_configured` sem criar arquivo; Docker `unavailable` e PostgreSQL `not_configured`. Executado com `Join-Path $env:TEMP 'pie-doctor-absent.sqlite'`. O `node` global 22.17.1 reporta corretamente fora de `engines.node`.
- `npm.cmd exec --yes --package=node@24.18.0 --package=npm@11.16.0 -- npm run test:focused -- tests/boundary/pieUnifiedPlan.test.ts`: 1/1 passou no toolchain pinado. Repositório Git e SQLite reais; teste cobre contestação justificada, hash e item histórico, repetição idempotente, rejeição de substituição/digest inválido e leitura paginada em SQLite, CLI, API autenticada e MCP. Ajv valida os schemas MCP novos. PostgreSQL real não foi executado localmente (`PIE_TEST_DATABASE_URL` ausente); migration e schema Prisma foram compilados/generados.
- Sob Node 24.18.0/npm 11.16.0 passaram `check:fast`, `pie:build`, `docs:check`, `format:check` e `mcp-catalog:check`; `mcp-catalog:generate` incluiu a nova ferramenta e `git diff --check` passou. `docs:check` incluiu licenças e cinco testes de consistência README.

## Exportação paginada compartilhada — 17/10/2026

- `GET /v1/snapshots/:id/export` e MCP `pie_snapshot_export` agora chamam `PieService.exportSnapshot`; CLI também consome o serviço e concatena páginas até o fim. Formato JSON/MD/HTML, offset/limite em bytes UTF-8, `nextOffset`, tamanho total, digest da árvore e SHA-256 do artefato ficam no contrato v1.
- Boundary API/MCP compara o artefato completo com CLI, valida hash e continuação, força páginas de 128 bytes, testa UTF-8 sem corte, autenticação e schema MCP 2020-12. Focadas `pieApi`, `pieMcp` e `pieComparison`: 6/6 passaram. Build/execução das boundaries utilizou SQLite/Git reais; sem mock no caminho de aplicação.
- Ainda pendente: exportação persistida de relatórios de motores/histórico além do snapshot e CI incremental completa (T6.1 permanece parcial).

## Observação runtime VERIFY e regressão do reporter — 17/10/2026

- `NodeResult` v2 preserva v1 e recebe `runtimeLocations`; instrumentação de coverage só para grants v2 de arquivo único. O reporter inclui somente path integral focado, linha selecionada e contagem positiva; não atesta comportamento funcional nem cria `covers`.
- Node 24.18 real no Windows reportou caminho host fora de `/source`, então nenhum local foi atribuído. A regressão unitária com eventos de protocolo validou correspondência exata e casos negativos. Docker Linux real permanece pendente.
- `npm.cmd run test:focused -- tests/boundary/pieNodeResults.test.ts tests/boundary/pieDockerPlan.test.ts`: 8/8; `npm.cmd run check:fast`: 2/2; `npm.cmd run format:check` e `git diff --check` passaram. Execução de evento de coverage em fixture é sintética; não foi tratada como teste do alvo.

## Comparação rastreável de bindings VERIFY — 17/10/2026

- Resposta `verification-diff` v2 preserva, de cada execução, bindings declarados do grant, declaração observada e Evidence de origem; cada lado é paginado. V1/legado permanece `unknown`; v2 é `declared_unverified`. Validação de registros persistidos recusa binding cujo arquivo não está no grant ou cujo ID não existe no snapshot, mesmo com hash/Evidence recalculados.
- `NODE_NO_WARNINGS=1 node scripts/run-exact-tests.mjs tests/boundary/pieRegressionResults.test.ts tests/boundary/pieExecutionAdmission.test.ts tests/boundary/pieRunPersistence.test.ts`: 8 passaram e 2 foram skipped (symlink Windows e PostgreSQL sem URL). `pieRegressionResults` verifica resposta idêntica via serviço, API HTTP, CLI e MCP, schema MCP da resposta e binding inválido adulterado. `toolSchemaValidity.test.ts`: 15/15, validando schemas MCP gerais e catálogo de 207 ferramentas.
- `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2) e `npm.cmd run mcp-catalog:check` passaram. A comparação não afirma cobertura caso→capacidade nem runtime; PostgreSQL e Docker reais não foram executados.

## Grant VERIFY v2 e isolamento do workspace no Windows — 17/10/2026

- Grant v2 tem união JSON Schema discriminada: bindings teste→declaração são obrigatórios (podem estar vazios), v1 não os aceita. Admissão confere arquivo autorizado, ID observado e unicidade. Persistência/evidência usa o grant integral; os bindings são declarações do operador, não prova de cobertura executada.
- A boundary Windows reproduziu raiz do alvo em formas Unicode longo/8.3 e antes permitia preparar o workspace dentro do próprio alvo. `realpathSync.native` corrige comparação de identidade; a nova asserção valida a recusa.
- `npm.cmd run check:fast`: 2 tarefas passaram. `npm.cmd run pie:build` passou. `node scripts/run-exact-tests.mjs tests/boundary/pieExecutionAdmission.test.ts tests/boundary/pieVerification.test.ts tests/boundary/pieRegressionResults.test.ts`: 8 passaram, 3 skipped (Docker/plataforma). `NODE_NO_WARNINGS=1 node scripts/run-exact-tests.mjs tests/boundary/mcp/pieVerifyMcp.test.ts tests/boundary/pieVerifyCli.test.ts tests/boundary/pieExecutionAdmission.test.ts`: 6 passaram, 4 skipped (Docker/plataforma). `docs:check:built` e `format:check` passaram.
- `docs:generate` e `mcp-catalog:generate` regeneraram artefatos ignorados. Depois da regeneração, `NODE_NO_WARNINGS=1 node scripts/run-exact-tests.mjs tests/boundary/mcp/toolSchemaValidity.test.ts` passou 15/15, incluindo schema efetivamente anunciado para todas as 207 ferramentas. Antes dela, o teste detectou corretamente catálogo `.cache` desatualizado. Não há prova de execução real Docker, PostgreSQL nem cobertura funcional automatizada nesta entrega.

## Instalação, setup e update do pacote no Windows — 17/10/2026

- `npm.cmd run verify:package:windows`, sob Node 24.18.0/npm 11.16.0: passou. Instalou tarball local em prefixo temporário e verificou CLI help, catálogo MCP completo (207 ferramentas), setup de OpenCode/VS Code/Copilot CLI, idempotência, uninstall e update para a versão exata via registry fixture local.
- O primeiro ensaio sob Node 22.17.1 falhou em `build:cached` ao importar `.ts`, antes da instalação. No ensaio aprovado, Node 24 foi fixado também para comandos npm descendentes. O pacote declara engines compatíveis com Node 24.18.0.
- Limites: fatos est?ticos n?o comprovam frontend/expans?o, seguran?a de imagem, build/deploy ou runtime. Dockerfile inline e corpos `RUN`/`CMD`/`ENTRYPOINT`/`HEALTHCHECK`/`COPY`/`ADD` n?o s?o retidos; `ARG`/`ENV` preservam apenas nomes. Normaliza??o sem?ntica de volumes, Nginx real, containers e m?tricas de VPS permanecem pendentes.

## Leitura limitada do grant HTTP pela CLI — 17/10/2026

- Leitor compartilhado HTTP/Node limita a 1 MB, exige UTF-8/JSON válidos e ambos os schemas mapeiam entrada inválida para `INVALID_INPUT` antes de abrir banco ou runner. Rejeita arquivo acima do limite e diretório; o grant é fixture de teste.
- `NODE_NO_WARNINGS=1 node scripts/run-exact-tests.mjs tests/boundary/pieHttpGrantFile.test.ts tests/boundary/pieVerifyCli.test.ts tests/boundary/mcp/pieMcp.test.ts`: 3 passaram, 2 skipped Linux/Docker. Inclui caminho positivo CLI/MCP com persistência local real.
- `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2), `npm.cmd run format:check` (4.115 arquivos), `npm.cmd run docs:check:built` e `git diff --check` passaram. `PIE_TEST_DATABASE_URL` ausente; PostgreSQL não executado nesta rodada.

## Leitura segura de grant HTTP pela CLI — 17/10/2026

- Grant JSON limitado a 1 MB, UTF-8 fatal e schema estrito antes de abrir o banco; entrada inválida não chega ao runner.
- `NODE_NO_WARNINGS=1 node scripts/run-exact-tests.mjs tests/boundary/pieHttpGrantFile.test.ts tests/boundary/pieVerifyCli.test.ts tests/boundary/mcp/pieMcp.test.ts`: 3 passaram, 2 skipped Linux/Docker. Inclui UTF-8/JSON/schema inválidos, tamanho excessivo, diretório e fluxo positivo real dos CLIs HTTP/Node e MCP.
- `npm.cmd run pie:build` passou antes de ajuste somente no tipo de asserção do teste; depois, `npm.cmd run check:fast` (2/2), `npm.cmd run format:check`, `npm.cmd run docs:check:built` e `git diff --check` passaram. Sem PostgreSQL ou execução do alvo nesta validação.

## Cutoff de cancelamento na publicação HTTP — 17/10/2026

- `PieService.probeHttp` fixa a publicação atômica como cutoff: checa abort antes do início; depois do início, preserva e devolve o recibo committed.
- `node scripts/run-exact-tests.mjs tests/boundary/pieHttpPersistence.test.ts`: 3/3 passaram. O novo cenário sincroniza abort durante o commit usando servidor HTTP, Git e SQLite reais; `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2) e `npm.cmd run format:check` (4.113 arquivos) passaram.
- Sem execução PostgreSQL; prova de persistência/cutoff é SQLite. A resposta HTTP continua sem provar que o servidor executa os bytes do snapshot; T3.2 permanece parcial.

## Relações Prisma e chaves estrangeiras estáticas — 17/10/2026

- Discovery reconhece relações entre models, arrays Prisma `fields`/`references` e colunas de FKs em migrations (`CREATE TABLE` e `ALTER TABLE ADD`). `data-review` aplica `@@map`/`@map` literais, distinguindo colunas alinhadas, mismatch estático e alinhamento não comparável. Incompletude não vira ausência confirmada; Evidence inclui relation, fields, mappings e SQL. Contrato público schemaVersion 4.
- Fixture Git/SQLite cobre FK via ambas as formas DDL, `@map` alinhado, mismatch, relação inversa não comparável, FK ausente, FK composta, Evidence, paridade CLI/API/MCP e Ajv 2020-12. Executado: boundaries `pieAdapters`/`pieDataReview` 11/11, `pie:build`, `check:fast` (2/2), `docs:check:built` (licenses:check: 902 lock/365 runtime), `format:check` (4.113 arquivos) e `git diff --check`. PostgreSQL runtime não foi executado; T4.5 permanece parcial.

## Comparação de migrations PostgreSQL declarativas — 17/10/2026

- Leitor SQL restrito a `prisma/migrations/<nome>/migration.sql` emite Evidence de linha para formas suportadas de tabela/PK/UNIQUE; `data-review` compara o nome de tabela exato e respeita `@@map` literal de modelo. Mapping não literal retorna cobertura incompleta, e todos os resultados ficam `unverified`. O contrato público sobe para schemaVersion 2 para refletir as novas propriedades. Não conecta ao banco nem afirma estado final/aplicado.
- Executado: `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts tests/boundary/pieDataReview.test.ts` (11/11), `npm run pie:build`, `npm run check:fast` (2/2), `npm run docs:check:built` (licenses:check: 902 lock/365 runtime), `npm run format:check` (4.113 arquivos) e `git diff --check`. Boundary prova migration Git versionada, strings/comentários/dollar-quoted sem falsos positivos, `@@map` literal multilinha, mapping não literal incompleto, PK, UNIQUE, índice, chave composta, Evidence SQL, CLI/API/MCP equivalentes e validação Ajv 2020-12. A string de tabela é retida somente como argumento de `@@map`.
- PostgreSQL runtime não executado; Linux/macOS não verificados. Limites do parser e a ausência de prova sobre migrations aplicadas aparecem no contrato e nos achados `unverified`.

## Motor Dados Prisma — 17/10/2026

- Parser Prisma passou a emitir Facts/Evidence para seletores e diretivas de relação/default. Strings e comentários são ignorados; argumentos não são retidos. O motor usa exclusivamente declarações e snapshot validados para reportar ausência de seletor único declarado observado como `unverified` informativo; migration e banco continuam fora da cobertura.
- `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts tests/boundary/pieDataReview.test.ts`: 11/11 passaram. O teste cria repositório Git e SQLite reais, prova isoladamente `@id`/`@unique`/`@@id`/`@@unique`, comentário/string negativos, seleção limitada por orçamento, consulta Evidence, CLI, API autenticada, MCP/Ajv (schema e payload) e igualdade entre adapters.
- `npm run pie:build`, `npm run check:fast` (2/2), `npm run docs:check:built` (inclui licenses:check; 902 pacotes lockfile/365 runtime), `npm run format:check` (4.112 arquivos) e `git diff --check` passaram em Node 24.18.0/npm 11.16.0. Runtime Prisma/PostgreSQL não foi acessado.
- O contrato de saída expõe `coverage.runtime: false`; a boundary valida schema e payload MCP com Ajv 2020-12 e compara respostas equivalentes nos quatro adapters (serviço, CLI, HTTP e MCP).

## Reconciliação factual da matriz T2.2 — 17/10/2026

- A linha da matriz T2.2 foi corrigida: havia uma afirmação global de CommonJS cross-file pendente apesar do suporte parcial Express CommonJS registrado e testado. O escopo validado é top-level com require literal e exports estáticos suportados; reexports CommonJS, interop ESM/CJS, mutabilidade/shadowing e specifiers calculados continuam limitações.
- Conferência de fonte/testes: `src/pie/adapters/express.ts`, `src/pie/discovery.ts` e `tests/boundary/pieExpressCrossFile.test.ts`; sem nova alegação de execução runtime.

## Status de comparação sem viés de paginação — 17/10/2026

- Mudanças de declarações são avaliadas no conjunto inteiro antes da página; status `changed` decorre de mudança de bytes ou declaração observada, enquanto snapshot parcial/ambiguidade isolados não são promovidos a alteração comprovada.
- `node scripts/run-exact-tests.mjs tests/boundary/pieComparison.test.ts`: 3/3 passou; `npm run pie:build`, `npm run check:fast` (2/2), `npm run docs:check:built`, `npm run format:check` e `git diff --check` passaram. Inclui asserção de status com `limit: 1` e comparação de inventário parcial. Windows, Node 24.18.0/npm 11.16.0; plataformas Linux/macOS não executadas nesta validação.

## Interpretação de mudanças de declarações por cobertura — 17/10/2026

- `compareDeclarations` retorna interpretação explícita: mudança observada quando a declaração aparece só de um lado e o snapshot oposto tem enumeração completa; desconhecido quando esse snapshot é parcial; ambíguo para identidades duplicadas alteradas. O estado observacional original permanece e nada disso comprova runtime.
- `node scripts/run-exact-tests.mjs tests/boundary/pieComparison.test.ts`: 3/3 passaram. `npm run pie:build`, `npm run check:fast` (2/2), `npm run docs:check:built` (inclui `licenses:check`, 902 pacotes lockfile/365 runtime, fingerprint `0218c076d58ea6b6887d57a02b0b2533bb997f0c7472d398c156fd4062e03bbf`), `npm run format:check` (4.110 arquivos) e `git diff --check` passaram no Windows com Node 24.18.0/npm 11.16.0.
- Limite preservado: execução de teste não está ligada a endpoints/páginas por relações de cobertura verificáveis; semelhança de caminho/nome não prova que o teste valida a capacidade. T4.1 permanece parcial; não houve execução do sistema cliente.

## Next.js Pages Router por AST — 17/10/2026

- O mesmo parse AST agora produz declarações Pages Router com Evidence por arquivo/linha: páginas export default, API handlers sem método inferido, `index`, segmentos dinâmicos e prefixos em monorepo. Exclui tipos, arquivos especiais e APIs sem default; respeita limite de declarações.
- `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts`: 10/10 passou. Fixture usa Git/SQLite reais; valida snapshot, proveniência e ausência de `_app`/handler sem default. `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2), `npm.cmd run docs:check:built`, `npm.cmd run format:check` e `git diff --check` passaram no Windows. Nenhum runtime Next foi executado; suporte permanece estático e parcial.

## Result tagged do motor funcional — 17/10/2026

- `assessFunctionalResult` distingue rejeição de input, caminho não canônico, escopo/política e snapshot inválido por schema ou integridade. Não captura falhas inesperadas. O serviço aplica a tradução uma vez e a reutiliza em review e persistência funcional.
- Boundary `pieAdapters`/`pieFunctionalPersistence`: 11/11 passaram, incluindo snapshots Git/SQLite reais, paginação, erro de caminho e integridade histórica. `npm.cmd run pie:build` e `npm.cmd run check:fast` passaram; gatefast executou typecheck/lint (2/2, lint sem erros). Ainda falta Result uniforme nas demais trilhas.

## Cobertura do motor funcional paginado — 17/10/2026

- Corrigida a contagem de cobertura: total declarado permanece global ao módulo; examinados corresponde aos itens da página retornada. Validação de registros históricos exige as mesmas contagens derivadas do snapshot e da solicitação.
- `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts tests/boundary/pieFunctionalPersistence.test.ts`: 11/11 passaram, incluindo análise Next paginada e retenção/validação imutável em SQLite.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check` e `git diff --check` passaram no Windows. Nenhum runner funcional, navegador ou aplicação do usuário foi executado; T4.1 permanece parcial.

## Relatórios exigidos pelo protocolo de execução — 17/10/2026

- Verificados ausentes e criados: `PIE_PROJECT_MAP.md`, `PIE_AUDIT_PLAN.md`, `PIE_FINDINGS.md` e `PIE_UPSTREAM_DIFF.md`. O protocolo 05 exige os quatro artefatos e findings com ID, severidade, evidência, reprodução, correção, status e limitação.
- Comparação executada: `git rev-list --left-right --count upstream/main...HEAD` → `0 80`; `git diff --shortstat upstream/main...HEAD` → 173 arquivos, 51.949 inserções, 103 remoções. Base upstream `926e18b3f`; HEAD comparado `4451f1fc4`.
- Os relatórios registram o achado corrigido sobre ref Git inválida e o bloqueio de validação do pacote (`EPERM` em symlink Windows) sem atribuir instalação/update funcional. Sete notice gaps existentes continuam explícitos; não se declara revisão legal completa.
- `npm.cmd run docs:check:built` e `npm.cmd run format:check` passaram após formatação; `git diff --check` passou. Não houve execução de alvo cliente nem atualização de evidência de runtime.
- Commit `1b31911d01e6a474853f7cb606d46a3c32d5a27d` publicado nos dois remotos. Fetch verificou igualdade de refs e `git rev-list --left-right --count upstream/main...HEAD` retornou `0 81` (um commit documental novo sobre o baseline de diff `4451f1fc4`). CI PIE `39040621001` pending/Release `39040621073` queued; CI fork `39040625929` e Release `39040626022` pending. Mudança documental não aciona a lane de integração PIE.

## Publicação e CI do upstream sincronizado — 17/10/2026

## Descoberta Git: HEAD ausente vs. ref corrompida — 17/10/2026

## Proveniência tipada de imports Express cross-file — 17/10/2026

- `discoverProject` associa a Evidence derivada ao resultado `relative-file` tipado durante `resolveImports`; removida a releitura e análise do texto `Evidence.observation` para reconstruir specifier/destino.
- `node scripts/run-exact-tests.mjs tests/boundary/pieExpressCrossFile.test.ts`: 7/7; `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts`: 10/10. Exercitam mounts, reexports, ciclos e Evidence real em snapshots SQLite/Git da boundary.
- `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2 tarefas), `npm.cmd run format:check` e `git diff --check` passaram no Windows. Sem novos claims de stack/runtime e sem execução em Linux/macOS.
- Commit `998485ae4a7bc74f70c3e916d7d1c8ab261739d2` foi enviado por fast-forward a `origin/main` e `rea-fork/main`; fetch confirmou igualdade com `HEAD`, sem branch nova. Actions: integração PIE `39040260781` in_progress, CI `39040260802` pending, Release `39040260851` pending; integração fork `39040265372` queued, CI `39040265451` pending e Release `39040265445` pending.

Revisão posterior do commit `df2a983d1` encontrou um falso positivo no oráculo: o teste aceitava qualquer `IO_ERROR`, e o primeiro código consultava `git symbolic-ref`, que falha quando a referência de destino está corrompida. Correção lê `HEAD` simbólica e a ref no diretório Git resolvido, valida nome/formato, verifica refs empacotadas antes de classificar ausência e propaga falhas tipadas. O teste exige a mensagem específica `A referência Git simbólica possui formato inválido.`. A boundary completa passou 10/10. Correção publicada em `f3e979496` via fast-forward nos dois remotos; fetch confirmou HEAD/origin/fork iguais e apenas `main` local.

- A regressão cria repo Git real sem commit e fixa `HEAD` simbólica em `refs/heads/pie-test`; ref ausente mantém `revision: null`, enquanto conteúdo malformado da ref gera `IO_ERROR`.
- `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts`: 10/10 passaram. `npm.cmd run pie:build`, `npm.cmd run check:fast` (2/2 tarefas), `npm.cmd run docs:check:built`, `npm.cmd run format:check` e `git diff --check` passaram no Windows.
- Linux/macOS não executados. `check:pr` integral não foi repetido; a execução anterior foi interrompida e segue não comprovada.
- Commit `df2a983d14bc853c696ef0a8d489cae9d78f752c` publicado por fast-forward em `origin/main` e `rea-fork/main`; fetch confirma igualdade com `HEAD`; somente branch local `main`, e `upstream/main` é ancestral. Actions: PIE CI `39039487627` pending, integração `39039487588` queued e Release `39039487748` queued; fork CI `39039492220` pending, integração `39039492200` queued e Release `39039492290` queued. Resultado remoto ainda não concluído.

- `git push origin main` e `git push https://github.com/fernandinhomartins40/rea.git main`: fast-forward de `744c44c1d` para `9732f293585b4d1ebaed5d3f642e12199331dfe3`; hooks `check:fast` passaram (cache hit, 2/2).
- `git fetch origin main` e `git fetch rea-fork main`; `HEAD`, `origin/main` e `rea-fork/main` retornaram o mesmo SHA. `git merge-base --is-ancestor upstream/main HEAD` passou; branch local única: `main`.
- API GitHub confirmou `fernandinhomartins40/rea` com `fork=true`, parent `morluto/rea`; o repo PIE continua `fork=false` e separado.
- Actions para o SHA completo: PIE CI `39038524038` pending, PIE Release `39038524037` `in_progress`; fork CI `39038534862` pending, fork Release `39038534901` queued. Nenhum workflow desse SHA terminou na consulta.

## Merge do upstream corrente — 17/10/2026

- `git fetch upstream main`: atualizou `upstream/main` de `4838f4449` para `926e18b3f`. A diferença para `rea-fork/main` era 54 commits upstream-only e 70 PIE/fork-only.
- `git merge-tree --write-tree --name-only HEAD upstream/main` retornou árvore candidata sem conflito. `git merge --no-ff --no-edit upstream/main` criou merge local `734f5d20c`; a árvore do merge toca 268 arquivos (16.796 inserções, 3.083 remoções), sem tocar PIE, SQLite, manifests ou Prisma. `upstream/main` é ancestral de `HEAD`.
- `npm run pie:build`: passou depois desse segundo merge.
- `node scripts/run-exact-tests.mjs tests/boundary/filesystem/ciPortableBuildCache.test.ts tests/boundary/filesystem/windowsTargetSeparators.test.ts`: 5 passaram, 1 skipped; dois arquivos boundary passaram.
- O merge foi publicado com os registros e testes em `9732f293585b4d1ebaed5d3f642e12199331dfe3`; ver “Publicação e CI do upstream sincronizado” para confirmação dos dois remotos e workflows pendentes.

## Falha sintática como Result — 17/10/2026

`pie:build`, `check:fast`, `docs:check:built`, `format:check` e `git diff --check` passaram. `pieAdapters` e `pieFoundation` passaram (16 testes); a boundary integrada usa fixture em Git, mantém `invalid.ts` no inventário e confirma que a descoberta não cria relações e registra limitação. O contrato `readCodeFactsResult` converte apenas `SyntaxError` com `code=BABEL_PARSER_SYNTAX_ERROR`; falhas inesperadas são relançadas.

CI do SHA anterior `1f4ea65c9f2e34c2f4c92c58e04b207afdef7f64`: [PIE integration](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/39012738931) falhou no passo “Verify installed browser and panel”; log detalhado requer permissão administrativa segundo a API pública (403), então a causa raiz não foi verificada. [Release](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/39012738860) falhou porque o repositório não permite que GitHub Actions crie/aprove pull requests; etapas de Release Please/publicação foram ignoradas. A CI geral estava em fila na última consulta. Nenhuma dessas falhas foi atribuída à alteração atual de parser.

## Cadeia de reexports Express — 17/10/2026

`pie:build`, `check:fast`, `docs:check:built` e `format:check` passaram. As boundaries `pieExpressCrossFile`, `pieAdapters` e `pieTrace` passaram (17 testes) usando AST, Git e snapshots reais no harness; cobrem dois relays `export ... from`, Evidence da exportação intermediária, aresta de dependência em cada relay, composição no endpoint terminal, trace até a rota e cadeia cíclica sem `calls`/composição. Não executa o Express real. CI do novo SHA ainda não executada.

Medição única do checkout após a implementação: frio 29,676 s/22,875 s CPU; quente 13,781 s/11,437 s CPU; 4.273 enumerados, 4.250 examinados, 49.999.686 bytes, cobertura parcial, 16.150 arestas, 372 declarações, 615 limitações, cache quente 4.244 hits/2.968.772 bytes retidos, pico RSS cumulativo Node 513 MiB. Medição anterior equivalente no mesmo checkout registrada como 23,897 s/19,578 s frio e 12,711 s/10,688 s quente. Variações observadas +24,2%/+16,8% frio e +8,4%/+7,0% quente; conteúdo atual e carga do host não foram controlados, não atribuir causalidade. Família Git e tokens não medidos.

CI do SHA imediatamente anterior `4b69794def9689c65b4ef4c79d886194f4c21a91`: [PIE integration](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/39013301108) passou; Release falhou outra vez por permissão de criação de PR; CI geral ainda estava em execução. Isso valida a entrega anterior, não o código de reexports atual.

## Baseline upstream CLI/MCP/pacote — 17/10/2026

Validados no checkout real com Node 24.18.0 e npm 11.16.0 (`npx`). `node scripts/verify-windows-native-artifact.mjs` aprovou o addon `rea-agents@6.5.0` restaurado do tarball da versão exata: Windows x64, ABI 1, Node-API 8, SHA-256 `665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed`. `npx.cmd --yes npm@11.16.0 run build:cached` passou. `node scripts/pie.mjs --help` e `node scripts/rea.mjs --help` responderam; processo REA MCP stdio real completou initialize/tools/list, anunciando `rea@6.5.0`, protocolo 2025-03-26 e 207 tools. `tests/boundary/mcp/pieMcp.test.ts` passou (1 teste com CLI/MCP e Ajv); Evidence/Ledger upstream passou 36 testes (27+9).

`npx.cmd --yes npm@11.16.0 run verify:package` passou repository-skill e package-archive, mas falhou com `EPERM` criando symlink em fixture temporária (`scripts/verify-package-environment.mjs:73`), antes da instalação do pacote. Não alegar verificação de pacote instalado/update/setup ou startup MCP instalado. Provedores REA não foram iniciados. Tarball reportado por npm: SRI `sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==`.

## Imports de pacotes — 17/10/2026

`resolveImports` passou a relacionar imports estáticos de pacote com dependências de nome único em manifests inventariados. A Evidence importadora sela specifier, tipo e destino; a aresta de pacote também carrega a prova do campo declarado. `validateSnapshot` rejeita destino adulterado ou Evidence do manifest removida. Pacotes sem declaração ou com declaração ambígua não recebem destino. `piePackageImports.test.ts` usa Git e descoberta reais com fixture sintética somente no teste; cobre pacote scoped/subpath, pacote ausente, proveniência de ambas as pontas e limitação. Após endurecimento para nomes duplicados, quatro arquivos boundary passaram novamente (17 testes) e `check:fast` passou. `format:check`, build PIE e `docs:check:built` passaram após a formatação final. Não há resolução de pacote instalado, subpath export/runtime, dependência transitiva ou prova de carregamento. CPU/memória/tokens não medidos.

## Comparação de execuções VERIFY — 17/10/2026

Implementação de comparação foi adicionada ao serviço, CLI, API autenticada e MCP; o teste de fronteira usa Git/SQLite reais, compara as interfaces contra o mesmo resultado, valida schema MCP convertido com Ajv e cobre regressão, estabilidade, cronologia e divergência de imagem. A fixture é selada pelo produtor de Evidence e persistida no armazenamento real; não simula o serviço de produção. Passaram `npm run typecheck`, `npm run check:fast`, `npm run pie:build`, `npm run docs:check:built`, 4 testes focados em 3 arquivos e o teste pieMcp; 4 testes VERIFY dependentes de serviços/Docker foram skipped por ambiente. `git diff --check` passou. CI PIE ainda não executada para esta alteração; VERIFY Docker real segue restrito ao lane Linux.

O histórico paginado por projeto valida runs em snapshots distintos no SQLite e compara serviço/API/CLI/MCP no mesmo teste. A interface foi exercitada em Chrome local com duas execuções VERIFY reais do coordenador bloqueadas por Docker ausente; a comparação corretamente mostrou inconclusivo, sem inventar resultados de teste. O teste de persistência PostgreSQL agora chama também o histórico por projeto; não foi executado localmente sem `PIE_TEST_DATABASE_URL`. Após o ajuste final de paginação passaram `npm run check:fast`, `npm run pie:build`, `npm run docs:check:built`, `npm run format:check` e os testes boundary: 7 passaram e 2 foram skipped (PostgreSQL e um caso dependente de serviço). O workflow PIE 39006977560 passou no SHA `a5e0b64cc55c8d5b59e460e1c68edafdcfe35263`, incluindo o job PostgreSQL; o CI geral 39006977567 permanece pendente.

No CI geral 39007138614 (SHA `dee79796c44dad9efc0ab0ba8361c65df7f09b30`), `check:ci` falhou em `knip`: reexportações PIE sem consumidores e o utilitário de notices runtime sem comando npm. Removidas as reexportações redundantes, o enum compartilhado de motor passou a compor o schema funcional e `licenses:refresh-notices` expõe o utilitário. Após a correção, `npm run knip`, `check:fast`, typecheck, docs:check:built, format:check, guardas arquiteturais e 11 testes funcionais/MCP executáveis passaram. `check:pr` não iniciou por exigir os artefatos nativos Windows do REA ausentes no host. PIE integration 39007508787 passou no SHA `7cf2acb3d`; CI geral desse SHA ficou queued. O próximo CI executará a correção do `knip` junto à alteração Express.

Após revisão de proveniência, cada fato v2 passou a selar seu conteúdo na Evidence principal e a registrar Evidence independente das linhas de mount usadas na composição. Trace, findings funcionais, registros imutáveis e export agora transportam as provas derivadas; snapshotIntegrity rejeita prefixo ou fato alterado e continua aceitando registros históricos v1 sem reescrevê-los. O teste Git/SQLite cobre linha/origem, adulteração, rota direta/aninhada, ciclo, wildcard, Evidence funcional e persistência. Na rodada ampla antes do último ajuste para agregar mounts repetidos: 23 arquivos boundary passaram, 4 foram skipped; 57 testes passaram e 19 foram skipped (inclui PostgreSQL local sem URL, Docker/VERIFY e provedores/plataformas indisponíveis). Após o ajuste, passaram de novo os 9 testes de `pieAdapters`, `check:fast`, `pie:build`, `docs:check:built`, `format:check` e `knip`. A integração PIE 39007844782 passou no commit precursor `0ec46c4ea`; CI desta revisão ainda não executou. Custos CPU/memória/tokens não medidos e não há teste de servidor Express real: montagem estática não prova ativação ou resposta HTTP. `check:pr` continua indisponível no host pela falta dos artefatos nativos Windows do REA.

## Execução HTTP compartilhada e retenção — 17/10/2026

Evidência executada nesta etapa: `npm run check:fast`, `tsc -p tsconfig.pie.json` e `docs:check:built` passaram. Quatro testes de comparação/admissão passaram em dois arquivos; Git e SQLite reais verificaram digest e recusa de arquivos não candidatos, plano adulterado e snapshot fora do escopo. API/fila: 7 passaram e 3 foram skipped; MCP stdio/Ajv: 1 passou e 1 foi skipped. CI 39005274487 passou no SHA `27af7591e`, incluindo o job `postgres`; a CI HTTP 39004309946 também passou no commit `8d1f85c42`. `test:focused` não executou neste Windows: o verificador de dependências bloqueia o fluxo por ausência dos artefatos REA `native/windows/build/manifest.json` e `.node`; Vitest boundary/MCP foi executado diretamente. Docker VERIFY real segue restrito ao Linux comprovado. A captura HTTP continua limitada a status/digest e não associa identidade do servidor ao snapshot.

CLI executa `http-probe-run <grant.json>`; MCP `pie_http_probe_run`; API autenticada `POST /v1/http-probes`. Os três chamam `PieService.probeHttp`, que valida grant/snapshot/raiz/expiração, limita operação, permite cancelamento e só retorna sucesso depois de persistir prova e registro. Consultas individuais usam `http-probe <id>`, `pie_http_probe_get` e `GET /v1/http-probes/:id`. Listagem por snapshot usa `http-probes <snapshot-id>`, `pie_http_probes_list` e `GET /v1/http-probes?snapshotId=...`; todas são paginadas e validam o registro completo antes de resumir. Migração SQLite v4 e PostgreSQL Prisma preservam evidência em tabelas com FKs, índices e proibição de update/delete. Testes usam resposta sintética apenas em servidor de loopback temporário; a aplicação não cria servidor ou mock. A listagem paginada PostgreSQL foi validada no job `postgres` da CI 39004309946.

## Base real do runner HTTP local — 17/10/2026

**Registro histórico:** esta etapa validou apenas o transporte e o workflow interno. A integração CLI/MCP/API com persistência está descrita na seção atual acima; a afirmação abaixo de que não estava registrada deixou de valer após o commit `8f1710352` e a CI 39003507601.

CI 38999421398 (fa7f25986) passou. Novo transporte interno captureLocalHttp envia GET/HEAD apenas a 127.0.0.1 e porta explícita, sem DNS, proxy, pool compartilhado, cookies, autenticação ou redirects. Caminho ASCII codificado é preservado; headers limitados a 16 KiB, corpo a 10 MB e prazo a 30s por seleção. Hash incremental retém somente bytes até o limite, sem corpo/headers na saída. Falhas esperadas usam Result/tag com captura parcial: entrada inválida, cancelamento, timeout, limite ou transporte. Não publica antes de finalizar o request/socket que possui.

Workflow interno probeLocalHttp exige grant VERIFY allowLocalHttpRequests explícito, snapshot/treeDigest, raiz fixa, expiração e TTL da evidência. Confere status esperado e digest opcional; parcial nunca passa. Resultado/prova são selados, preservam autorização e retornam TTL/limitações. A prova registra que não foi demonstrado que o processo respondente executa os bytes do snapshot, e que a asserção HTTP não comprova jornada, permissão ou persistência. Nenhum código do alvo é iniciado ou isolado por esse workflow. Não está registrado na CLI/API/MCP/UI: habilitação pública, armazenamento atômico, identificação do alvo e integração aos jobs ainda pendentes. Não apresentar como runner HTTP completo ou motor funcional pronto.

Testes com servidores HTTP reais e snapshot Git real (sem mocks) passaram: três testes, 2,53s. Cobrem GET/HEAD, caminho/query preservados, redirect não seguido, sem retenção de corpo/cookie, host e Unicode inválidos, limite, timeout, resposta interrompida, cancelamento com sockets drenados, grant expirado/snapshot divergente, digest/status incorretos, integridade e TTL. Build PIE e typecheck completo passaram; lint dos módulos/teste sem avisos/erros. Limites de módulos: 2059 fontes; descoberta: 1465 testes. Após usar erro de integridade tipado em português, nova rodada de três testes passou (3,15s). Testes acrescentados à CI PIE. Sem validação em aplicação real do usuário, TLS/autenticação/remotos não suportados; CPU/memória/tokens não medidos. Demais runners/motores e aceite integral pendentes; goal ativo.

## Proveniência de redação de transporte — 17/10/2026

Revisão encontrou metadado incorreto: nginx-config removia userinfo de URI, mas a evidência derivada herdava redactionStatus=not_collected do inventário de bytes. Parser agora devolve notas internas de redação por declaração; collectDeclarations, dono da prova derivada, aplica redactionStatus=redacted e inclui a transformação nas limitações antes de selar o hash. Nenhum consumidor reinterpreta o nome para inferir segredo/redação. Valores não redigidos e prova do inventário preservam o estado original; hash da fonte continua identificando bytes originais. Registros históricos não são alterados nem re-selados retroativamente.

Teste Git/SQLite Nginx real como fonte comprova URI redigida com caminho/query preservados, linha/contexto e prova redacted selada, ausência de usuário/senha no snapshot e inventário not_collected. Registros e relatórios seguem validando integridade. Adapters/comparação: 12 testes passaram em dois arquivos (9,39s). Build PIE e typecheck completo passaram, lint focado sem avisos/erros. Limites de módulos: 2057 fontes; descoberta: 1464 testes. Nenhum servidor Nginx executado. CI 38999252899 da entrega anterior 811998e13 terminou com sucesso. Correção atual aguarda CI. Não representa política completa de dados sensíveis nem motor de segurança/LGPD concluído. Goal integral ativo; demais runners/motores e aceite integral pendentes.

## Candidatos a reteste no painel — 17/10/2026

Comparar versões agora inclui Planejamento de retestes com modo por impacto ou inventário completo observado. Consulta usa antes/depois da comparação aceita, não os controles ainda não submetidos. Resultado mostra arquivo candidato, motivo, compatibilidade não verificada, prova do snapshot posterior, testes anteriores removidos/não observados e limitações. Paginação é independente das mudanças de arquivo/declaração. Não produz grant nem inicia worker ou teste; autorização VERIFY continua separada. Nova comparação remonta o componente e cancela leituras anteriores.

Teste Chrome real Git/SQLite adiciona arquivo isolated.test.mjs com código que falharia se fosse executado; affected não o seleciona sem dependência registrada e full o apresenta. Interface abre prova do candidato, sem execução. Teste focado passou (um teste, 12,40s). Após separar apresentação dos resultados, build, typecheck web e typecheck completo passaram, lint do componente/teste sem avisos/erros. Regressão ampla passou: seis testes e um Linux ignorado em três arquivos (36,35s). Limites de módulos: 2057 fontes; descoberta: 1464 testes. CI 38999031226 do commit anterior f000fabbb terminou com sucesso. Nova entrega aguarda CI. Plano de retestes não equivale a motor de regressão completo: execução vinculada, métricas/screenshots e demais motores seguem pendentes. Goal integral ativo; custos CPU/memória/tokens não medidos.

## Candidatos a reteste por impacto — 17/10/2026

CI 38998811119 (8ef69eed6) passou. Novo planRetests compara identidades de bytes e percorre impacto de ambos os grafos para selecionar arquivos de teste atuais. Import removido/arquivo não observado na versão posterior ainda pode afetar teste ligado no grafo anterior. Modo full inclui todos os testes observados na versão posterior, não apenas afetados. Seleção paginada preserva caminho/ID/prova atual, motivo e runnerCompatibility=not_probed. executionAuthorized/runtimeVerified permanecem false e estado unverified. Não gera grant nem inicia execução.

PieService.retestPlan compartilha o fluxo com CLI retest-plan <antes-id> <depois-id> --mode affected|full, MCP pie_retest_plan (schemas Ajv) e POST /v1/retest-plan autenticado. Cobertura distingue testes observados/selecionados, arquivos no impacto e testes antigos removidos ou não observados. Classificação por nome e imports estáticos não comprovam cobertura funcional; ausência de candidato não aprova regressão. Modos full e affected não substituem auditoria funcional completa. Runner HTTP/Playwright e execução do reteste com vínculo a achados continuam pendentes.

Git/SQLite reais testaram dependência alterada, teste desconectado incluído só em full, paginação, ausência de mudança, arquivo retirado do inventário e prova do snapshot posterior; código fixture não executado. Comparação/API: cinco testes passaram (7,77s); MCP/CLI validou contrato e igualdade durante rodada anterior, cujo teste de comparação falhou somente por setup Git da fixture (corrigido com stage antes de rm --cached). Build PIE, typecheck completo e web passaram; lint focado sem avisos/erros. Limites de módulos: 2057 fontes; descoberta: 1464 testes. Reteste é proposta, não execução comprovada. CPU/memória/tokens não medidos; goal integral ativo.

## Comparação de declarações no painel — 17/10/2026

Painel apresenta declarationChanges com observações antes/depois, receptor/contexto, arquivo/linha e acesso à prova de cada versão. Estados traduzidos explicitam ausência de observação, mudança de bytes e ambiguidade, sem afirmar remoção de funcionalidade ou regressão runtime. Paginação compartilhada usa maior total entre arquivos e declarações; páginas de declarações não ficam inacessíveis após acabar a lista de arquivos. A coluna de contexto preserva o valor declarado, sem derivar URL ou fluxo.

Teste Chrome real foi estendido com endpoint Express observado antes e ausente depois, abertura da prova anterior e comparação dos mesmos snapshots reais. Nova declaração expôs ambiguidade no seletor de teste Rastrear; corrigido para escolher a linha React explicitamente. Rodada focada passou (um teste, 8,92s); regressão ampla passou com seis testes e um Linux ignorado em três arquivos (39,17s). Build web, typecheck web e typecheck completo passaram; lint do componente/teste sem erros. Limites de módulos: 2056 fontes; descoberta: 1464 testes. CI 38998556410 da comparação anterior 856bcba85 terminou com sucesso. Nova entrega aguarda CI. Runners e motor completo de regressão, retestes e demais motores seguem pendentes; goal integral ativo. Sem medições de desempenho novas.

## Comparação de declarações — 17/10/2026

Comparação compartilhada CLI/API/MCP agora inclui declarationChanges paginado, preservando declarações e evidências dos dois snapshots. Identidade lógica usa arquivo, adapter, tipo, nome e contexto; linha/hash são observações comparadas. Estados observed_only_before/after não afirmam remoção/adição de comportamento, pois versões de parser e cobertura podem diferir. source_changed significa bytes do arquivo alterados, não handler alterado comprovadamente. Ocorrências repetidas com observações diferentes ficam ambiguous, sem alinhamento inventado. Diferença de declarações também impede status global unchanged.

Testes Git/SQLite cobrem endpoints Next, deslocamento de linha, métodos observados apenas de um lado, múltiplas ocorrências Express ambíguas, paginação e prova de ambos os snapshots; descoberta parcial não confirma remoção. Três testes focados de comparação/MCP passaram em dois arquivos (16,46s). Compilação PIE, typecheck web e lint focado passaram; typecheck completo desta retomada não executado. Interface específica do diff de declarações, seleção/reexecução de testes e motor completo de regressão permanecem pendentes. Goal integral ativo, sem alegação de conclusão ou ganho de desempenho. CI anterior não reconfirmada nesta retomada.

## Retenção e histórico funcional no painel — 16/10/2026

CI 38992307065 (dc540da8e) terminou com sucesso, incluindo paginação PostgreSQL real. Após limite público da API GitHub, conclusão foi lida usando credencial Git existente somente em memória, sem expor/persistir segredo. Painel agora salva explicitamente a página funcional analisada, lista histórico paginado e abre registro preservado por ID/hash sem recalcular achados. Mostra módulo, offset/quantidade/total e estado não verificado. Cada salvamento deliberado cria novo registro; não há retry automático de mutação incerta. Consulta e salvamento permanecem ações distintas.

FunctionalFinding é a apresentação compartilhada entre análise corrente e registro histórico; useFunctionalHistory é dono de consultas abortáveis, seleção, paginação e atualização. História limpa a página antiga ao iniciar consulta nova; não apresenta dados antigos sob novo offset. Seleção de prova é limpa ao salvar/abrir registro. API segue sessão/CSRF existentes; nada salvo em localStorage/sessionStorage. Não há autorização de execução inferida de uma análise.

Chrome real com Git/SQLite validou salvamento, prova/hash persistidos, consulta e abertura após reload, mantendo módulo/página do registro e responsividade 360/1440. Rodada ampla: seis testes passaram, um Linux ignorado, três arquivos (35,30s), incluindo trace, sessão/CSRF, resultado blocked e histórico de snapshots. Build web, typecheck web e typecheck completo passaram. Novos componentes/hooks/testes com lint sem avisos/erros; tamanho de FunctionalReview permanece dívida pré-existente. Teste focado repetido após ajuste da limpeza de página passou (um teste, 13,21s). Limites de módulos: 2055 fontes; descoberta: 1464 testes. Contestação, retestes vinculados, motores completos e aceite integral continuam pendentes; goal ativo. CPU/memória/tokens não medidos.

## Histórico funcional paginado — 16/10/2026

SQLite/PostgreSQL agora listam registros funcionais por snapshot com ordenação createdAt/id, limite 1–200 e offset, total/nextOffset. Resumo preserva ID, módulo, offset/quantidade de achados da página retida, total de declarações, estado unverified e SHA-256. Cada item deriva de registro validado, sem reinterpretar fontes nem recalcular achados. Contagem/leitura usam transação consistente (SQLite BEGIN e PostgreSQL RepeatableRead). Não confundir paginação do histórico com cobertura da página analisada.

PieService/PiePersistence compartilham functionalRecords. CLI functional-records <snapshot-id>, MCP pie_functional_records_list e GET /v1/functional-records?snapshotId=UUID&limit=1&offset=0 usam o contrato paginado versionado. Leitura por ID existente permanece. Testes SQLite reais cobrem duas páginas, vazio após fim e limite inválido; MCP Ajv e CLI comparam respostas; HTTP compara ao serviço. Quatro testes em três arquivos passaram (11,64s). PostgreSQL incluído no teste real da CI, ignorado localmente. Build PIE, typecheck completo e web passaram; lint focado sem avisos/erros. Limites de módulos: 2055 fontes; descoberta: 1464 testes. CI 38992099547 da entrega anterior 48d61ab69 terminou com sucesso, incluindo persistência PostgreSQL real. Nova entrega aguarda CI. UI de histórico/retenção, contestação, motores completos e aceite integral permanecem pendentes; goal ativo. Custos comparativos de leitura/CPU/memória/tokens não medidos.

## Registros funcionais imutáveis — 16/10/2026

Análise funcional pode ser preservada explicitamente com pedido completo, página retornada, data e SHA-256 canônico. Registro schemaVersion 1 é artefato derivado de observação, não prova runtime. Guarda somente a página solicitada: total/offset/nextOffset e módulo permanecem explícitos, sem alegar auditoria completa. selectFunctionalTargets é dono da seleção por módulo/página, reutilizado na validação do registro; fatos/IDs/provas e cobertura são conferidos contra o snapshot imutável. Texto histórico não é recalculado por nova versão do motor.

SQLite possui tabela/índice/triggers aditivos e PostgreSQL migration 202610160005 com FK e trigger UPDATE/DELETE imutáveis; modelo Prisma correspondente e client regenerado. Salvamento idêntico é idempotente; mesmo ID com conteúdo distinto é recusado. PiePersistence/PieService compartilham as operações. CLI functional-retain <snapshot-id> --module/limit/offset e functional-record <id>; MCP pie_functional_retain/pie_functional_record_get; API POST /v1/functional-records e GET /v1/functional-records/:id, com autenticação/origem/CSRF existentes. Consulta funcional anterior segue somente leitura. Não há listagem histórica paginada nem UI de retenção nesta entrega.

Teste SQLite real cobre reabertura, preservação da página, hash adulterado, troca re-selada sob mesmo ID, cobertura inconsistente e triggers. CLI/MCP stdio e HTTP com schemas Ajv passaram (quatro testes em três arquivos, 11s); extensão de integridade/API passou (três testes, 3,77s). PostgreSQL real foi acrescentado à trilha CI existente, ignorado localmente. Build PIE, typecheck completo e web passaram; lint focado dos novos contratos/testes sem avisos/erros. Limites de módulos: 2055 fontes; descoberta: 1464 testes. CPU/memória/tokens da persistência ainda não medidos. CI 38991840117 do painel anterior 86da7f14d terminou com sucesso. CI desta entrega ainda pendente. Nenhum motor completo nem prova de funcionamento do alvo é reivindicado; goal integral ativo.

## Análise funcional no painel — 16/10/2026

CI 38991625430 (dfaa30743) passou. Painel passa a consultar a análise funcional OBSERVE real: filtro por módulo relativo, páginas de dez achados, incerteza, reprodução/proposta/aceite e prova da declaração com SHA-256. Estado é Não verificado/informativo; responsável permanece explicitamente não definido. Escopo vazio informa que ausência de declaração não prova ausência de funcionalidade. Nenhuma execução/autoridade é inferida do formulário. Consulta usa API autenticada/CSRF, cancela requisição anterior e limpa prova ao trocar escopo; componente remonta ao mudar snapshot.

Hook useFunctionalReview é dono das consultas/estado; apresentação usa os fatos retornados sem reanalisar fontes. Chrome Windows com Git/SQLite reais validou 13 declarações, segunda página, filtro app/api, prova correspondente e remoção da prova ao filtrar módulo vazio, com larguras 360/1440. Teste focado inicial passou (8,10s). Após refatoração, build, typecheck web e typecheck completo passaram; regressão ampla sobre build atualizado passou: seis testes e um skipped em três arquivos (32,62s), incluindo Chrome real, trace, sessão/CSRF e histórico. Limites de módulos: 2054 fontes; descoberta: 1463 testes. Custos CPU/memória e tokens não medidos. Não usar rodada que tenha build falhado como prova do código atualizado. Lint sem erros, aviso de tamanho em FunctionalReview (104 linhas). Motor funcional completo, achados persistidos, demais runners/motores e aceite integral seguem pendentes; goal ativo.

## Análise funcional de lacunas OBSERVE — 16/10/2026

CI 38991366300 (a872b359e) passou. Nova assessFunctional lê snapshot validado, política OBSERVE e módulo relativo canônico, produz achados tipados para páginas/endpoints declarados com prova, informação de severidade, incerteza, passos de reprodução propostos, proposta e critérios de validação. Estado sempre unverified, responsável desconhecido null. Lacuna de verificação não é defeito nem ausência de implementação. Não associa teste aprovado à rota sem vínculo próprio, não executa cenários e não altera alvo. Sem declarações, não fabrica aprovação nem not_found.

PieService.functional centraliza o fluxo; CLI functional <snapshot-id> --module <caminho> --limit/offset, MCP pie_functional_review com schemas versionados e POST /v1/functional usam a mesma análise. O resultado é uma projeção das evidências, ainda sem histórico próprio de auditoria. Escopo por módulo usa fronteira de caminho, sem traversal. Páginas/endpoints não cobrem eventos, persistência, permissões, jornadas e jobs completos. Motor funcional e os demais motores continuam incompletos; aceite de defeitos semeados e runtime permanece pendente.

Testes Git/SQLite cobrem prova/linha, página/módulo, paginação, escopo/política recusados e estado vazio unverified. CLI/MCP real por stdio compara respostas e valida Ajv. HTTP compara resposta ao serviço real. Rodada inicial encontrou passagem incorreta de campos de escopo ao parser estrito de paginação; corrigido o produtor para fornecer somente offset/limit. Após correção, adapters/MCP passaram; API passou após correção de setup do teste (dois testes, 3,10s). Build PIE, typecheck completo e web passaram; lint dos novos módulos/testes sem avisos/erros. MCP/CLI após refatorar o helper passou (um teste, 14,51s). Limites de módulos: 2054 fontes; descoberta: 1463 testes. Custos de CPU/memória/tokens da nova análise ainda não medidos. Não há validação funcional runtime nesta entrega nem comprovação de motor completo. Goal integral ativo.

## Exportação com declarações, relações e provas — 16/10/2026

Relatórios Markdown/HTML deixam de conter somente arquivos: incluem declarações de todos os adapters, relações registradas pelo mesmo buildKnowledgeGraph dos consumidores, IDs dos arquivos, contexto/linha, hashes e metadados completos das evidências, limitações e contagem de relações não resolvidas. Raiz, treeDigest, estado Git, cobertura de arquivos e bytes também são exibidos. Não reinterpreta fontes nem transforma inventário em aprovação. O relatório de snapshot informa explicitamente que não incorpora resultados VERIFY separados. JSON mantém o snapshot integral.

renderSnapshot usa validateSnapshot como dono da verificação de integridade, recusando prova adulterada antes de serializar qualquer formato. Tabelas compartilham a representação entre HTML/Markdown e escapam conteúdo externo; HTML mantém CSP sem execução de scripts. Testes Git/SQLite confirmam declarações Nginx/provas/IDs/arestas no relatório, integridade, escape e compatibilidade CLI/MCP. Rodada adapters/comparação/MCP: 11 passaram (13,02s). Build PIE e typecheck completo passaram; lint focado sem avisos/erros. Limites de módulos: 2053 fontes; descoberta: 1463 testes. CI 38991181811 da entrega anterior 59559290f terminou com sucesso. Nova entrega aguarda CI. Relatório unificado de auditorias/VERIFY, demais runners/motores e aceite integral permanecem pendentes. Custos de relatórios grandes e medições CPU/memória ainda não medidos; goal ativo.

## Correção estrutural do lexer Nginx — 16/10/2026

Revisão do produtor identificou recusa incorreta de } dentro de token e de ) após argumento entre aspas. Lexer agora mantém um dono explícito do estado de token, escape, aspas, comentários, posições e blocos; fechamento de bloco ocorre somente em fronteira de token. Parêntese após aspas é preservado como token separado conforme o comportamento da fonte Nginx consultada. Sem reparos nos consumidores e sem representação antiga mantida. Os avisos anteriores de tamanho/complexidade do lexer foram eliminados pela separação do estado, com lint focado sem avisos/erros.

Novos casos verificam caminho literal contendo }, condição if com argumento entre aspas e contexto posterior. Regressão adapters/trace: dez testes passaram (5,39s), incluindo persistência e prova reais Git/SQLite. Build PIE e typecheck completo passaram. Limites de módulos: 2053 fontes; descoberta: 1463 testes. Nginx real/nginx -t não executados; não há nova alegação de compatibilidade completa ou configuração efetiva. CI 38990965656 da entrega anterior 08d8ccbe0 terminou com sucesso, incluindo as trilhas existentes de Docker/PostgreSQL/navegador. Correção atual aguarda nova CI. Runners, motores e aceite integral continuam pendentes; goal ativo.

## Configuração Nginx com proveniência — 16/10/2026

CI 38987902054 (94d0c77ea) passou, incluindo Express, PostgreSQL, Docker e navegador nas trilhas existentes. Novo adapter nginx-config reconhece nginx.conf, nginx.*.conf e arquivos .conf sob diretório nginx. Lexer iterativo próprio respeita comentários, aspas, escapes e variáveis ${...}; blocos têm limite de profundidade 128. location e diretivas listen/server_name/proxy_pass/fastcgi_pass/grpc_pass/include são preservadas com argumentos em array JSON, sem colapsar limites entre tokens, e contexto ancestral por diretiva/linha. Fatos persistidos usam location/config_directive e prova selada do arquivo; declared_in já integra trace/CLI/MCP/API/painel.

Nenhum include é expandido, nenhum caminho/URL/socket é acessado nem configuração executada. Configuração efetiva, precedência/herança, módulos, certificados/TLS, permissões, escuta, proxy funcionando e HTTP continuam não comprovados. Não chamar inventário de auditoria completa de infraestrutura. Lexer consultado contra fonte oficial ngx_conf_file.c: # no meio do token é literal, escapes desconhecidos preservam barra. Bloco/aspas incompletos não geram fatos. Testes cobrem casos hostis, limites, linha, evidência, persistência e trace real Git/SQLite.

Rodada adapters/trace/MCP: 11 testes passaram (10,78s). Build PIE, typecheck completo e web passaram. Limites de módulos: 2053 fontes; descoberta: 1463 testes. Userinfo de autenticação nas URIs de transporte é redigido sem normalizar o restante do destino; teste específico e nova rodada de nove testes de adapters passaram (6,63s). Lint sem erros, com avisos de complexidade/tamanho no lexer; refatoração do estado permanece como dívida explícita. Não executado nginx -t nem servidor Nginx real; sem medições comparativas de tokens/CPU/memória. Runners HTTP/Playwright, PHP/Laravel, motores e aceite integral continuam pendentes; goal ativo.

## Endpoints Express derivados da AST — 16/10/2026

CI 38987552370 (428180d4a) passou, comprovando correção NDJSON da CLI contínua com SIGTERM e rotas Next. readExpressDeclarations agora consome a mesma árvore Babel de readCodeFacts, sem nova dependência/parser ou execução. Produz endpoint express-ast com método, padrão literal, receptor local em parent, linha e evidência selada. Reconhece imports de valor/default/Router e const require express, construtores app/Router; chamadas diretas no escopo superior somente. require sombreado por declaração/import/desestruturação é recusado; atribuições diretas invalidam o receptor. Métodos em objetos estranhos ou em escopos aninhados não viram endpoints.

Parent não é prefixo público: montagem use(), cadeias route(), aliases mutáveis, callbacks/factories, caminhos dinâmicos/arrays/regex e efeitos de código chamado permanecem não examinados. Não confirma handler válido, instalação, autenticação, listen, HTTP ou relação UI→API→DB. Não declarar T2.2 nem motor funcional completos.

Testes Git/SQLite reais comprovam persistência, linha, hash/prova, trace declared_in e ausência de prefixos fabricados. Casos negativos/limites incluem CommonJS, aliases, tipos, shadowing e mutação. Rodada adapters/fundação/trace: 14 passaram (5,53s). Build PIE, typecheck completo e web passaram; lint dos parsers/testes sem avisos/erros. Limites de módulos: 2051 fontes; descoberta: 1463 testes. Comparação/MCP: dois testes passaram (16,46s); após refinamento de limites, sete testes de adapters passaram (4,20s). Custos comparativos de tokens/CPU/memória e tarefas completas ainda não medidos; não há alegação de ganho de desempenho. Runners HTTP/Playwright, Laravel/PHP/Nginx, seis motores e aceite integral permanecem pendentes; goal ativo.

## Correção do protocolo contínuo e estado da CI — 16/10/2026

CI 38987122505 (8b4e9af13) falhou no teste POSIX da CLI contínua. Log autenticado confirmou consumo do job e exit 0 antes da falha; JSON.parse rejeitou o resumo final porque a CLI combinava um registro inicial de uma linha com JSON final indentado. Corrigido o produtor: no modo continuous, a resposta final também usa uma única linha, mantendo NDJSON consistente. Comandos de um job continuam com JSON indentado. Correção por inspeção da causa no produtor, sem relaxar o teste. Validação positiva dessa correção exige a próxima CI Linux; não registrar a execução anterior como verde. Typecheck completo e limites de módulos (2050 fontes), descoberta de 1463 testes passaram na entrega de rotas. Goal integral permanece ativo.

## Rotas Next App Router no grafo — 16/10/2026

readCodeFacts passa a ser dono da árvore Babel TS/JS/JSX e produz imports + declarações Next sem parsing duplicado. imports.ts agora mantém somente resolução convencional de referências; coletor recebe fatos já interpretados. Convenções app/**/page.tsx e route.ts/js produzem page e endpoint com exports explícitos, padrão de caminho, linha e prova selada. Grupos são removidos do padrão, segmentos dinâmicos permanecem literais; segmentos privados/paralelos/interceptados não são convertidos em rota pública. Alias de export nomeado é registrado, sem inventar valor resolvido ou execução. Adapter next-app-convention indica a fonte da derivação, não confirmação de framework ativo.

Integração Git/SQLite real comprova persistência, evidência, declared_in no trace e imports do mesmo AST. Testes distinguem comentários/strings, exports de tipo, nomes parecidos, JSX não suportado em route, orçamento e parse inválido. Rodada adapters/fundação/trace: 12 passaram (5,58s); após refinamentos, adapters/MCP: seis passaram (11,73s). Build PIE, typecheck completo e web passaram. Limites de módulos: 2053 fontes; descoberta: 1463 testes. Userinfo de autenticação nas URIs de transporte é redigido sem normalizar o restante do destino; teste específico e nova rodada de nove testes de adapters passaram (6,63s). Lint dos novos parsers sem avisos/erros. Sem execução de aplicação Next nesta entrega; autenticação, build, rewrites/basePath, conflitos e disponibilidade HTTP não comprovados. Rotas Express/Laravel, demais runners/motores e aceite integral permanecem pendentes; goal ativo.

## Workers contínuos — 16/10/2026

CI 38986773802 (1d4880fe6) passou, incluindo enfileiramento/cancelamento real pelo painel Chrome Linux. work/work-verify agora aceitam --continuous e --poll-ms 100–30000 (padrão 1000). JobDaemon consome sequencialmente, concorrência 1, espera ociosa abortável e para diante de falha operacional; não repete auditorias VERIFY interrompidas. SIGINT/SIGTERM cancelam trabalho ativo e drenam worker/coordenador antes de fechar fila/store. Worker revalida encerramento após resolver raiz, antes de novo claim. Sem continuous, comportamento de um job preservado. É processo em primeiro plano; não instala serviço do sistema.

workerCli.ts passou a ser dono da composição/encerramento do worker; cli.ts mantém admissão de opções, fila e comandos. Testes locais SQLite/Git reais: consumo de jobs posteriores ao início, rejeição de segundo run, encerramento/retry idempotente, espera de 30s interrompida e raiz indisponível encerra sem retry. Rodada fila+MCP: cinco passaram, um skipped (12s); extensão de falha operacional passou em nova rodada (quatro passaram, um skipped, 4,76s). CLI contínua POSIX com SIGTERM foi adicionada à trilha existente, ignorada no Windows e aguarda CI. Build PIE e typecheck completo passaram. Limites de módulos: 2048 fontes; descoberta: 1463 testes. Lint sem erros; aviso de quantidade de parâmetros já existente em runJobCommand. Sem comprovação de desempenho comparativo/CPU/memória. Runners HTTP/Playwright, seis motores e aceite integral permanecem pendentes; goal ativo.

## Painel conectado à fila VERIFY — 16/10/2026

CI 38986542581 (d8f17ba62) passou, incluindo Chrome Linux. Painel agora envia authorization JSON completo com chave idempotente para a fila real, exige snapshot selecionado, consulta job por UUID e solicita cancelamento com sessão/CSRF. GET /v1/context informa verificationQueueEnabled somente quando fila e verificador existem; formulário permanece indisponível por padrão. Nenhuma autorização é gerada automaticamente nem armazenada no navegador; grant enviado permanece no job persistido. Estado succeeded é exibido como workflow concluído, com orientação para ler o resultado real. Worker permanece separado, sem início/retry automático pelo painel.

Teste Chrome Linux novo usa SQLite, grant e coordenador reais, confere snapshot incorreto recusado, fila sem execução, consulta, cancelamento, idempotência e ausência de dados em storage/reload. Ignorado neste Windows; CI da nova entrega ainda pendente. Rodada local: cinco testes passaram e um skipped em dois arquivos (29,88s). Rerun focado do caso blocked com formulário desabilitado passou (4,82s). Typecheck web, typecheck completo, build web e compilação PIE passaram. Limites de módulos: 2046 fontes; descoberta: 1463 testes. Custos de CPU/memória da interação ainda não medidos. Novos componentes/hooks com lint sem avisos/erros. Demais runners, daemon, recuperação completa, seis motores e aceite integral continuam pendentes; goal ativo.

## Painel de resultados VERIFY — 16/10/2026

CI 38986169418 (45d3a8900) passou: enfileiramento API/MCP, Ajv, idempotência/cancelamento e Docker/PostgreSQL reais. Painel agora consulta histórico paginado de verificações por snapshot, permite atualizar e abrir resultado persistido, mostra estado, limpeza, imagem, evidência/hash, falha/limitações e autorização v2 preservada. Formato v1 informa ausência de autorização completa. Casos são renderizados em páginas de 25. Dados vêm exclusivamente da API local autenticada. passed descreve somente o escopo executado; blocked/skipped/inconclusive não aprovam. Troca de snapshot desmonta seleção e cancela leituras pendentes.

Teste Chrome Windows usa NodeVerification real com Docker indisponível, persiste blocked e confere prova/autorização na interface, sem simular resultado nem executar alvo no host. Encontrou overflow de mensagens com caminhos longos em 360 px, corrigido na representação CSS e tabela existente. Teste blocked passou; os três testes do painel passaram na rodada ampla. Sessão/CSRF também passou. Novo paginador exigiu delimitar o teste de trace à região Observações estáticas; rerun passou (um teste, 16,20s). Typecheck web, typecheck completo e build passaram. Lint sem erros, com aviso de tamanho em Verifications; limites de módulos: 2046 fontes; descoberta: 1463 testes. Custos de CPU/memória desta tela ainda não medidos. Envio de autorização/fila e acompanhamento de job pela interface, demais runners e motores ainda pendentes; goal integral ativo.

## Enfileiramento VERIFY pela API/MCP — 16/10/2026

CI 38985908103 do commit d0cd0a6db passou: migração e fila PostgreSQL reais, worker VERIFY Docker e correlação job/run/journal. API agora oferece POST /v1/jobs/verification com idempotencyKey e authorization, apenas com fila e verificador habilitados; retorno 202 não executa testes. MCP habilitado oferece pie_verification_enqueue, pie_verification_job_get e pie_verification_job_cancel. Servidor MCP mantém fila até finalizar transporte/verificador. Consulta/cancelamento usam scopedJob compartilhado, restringindo raiz; MCP restringe também tipo verification. API mantém autenticação, origem e CSRF existentes.

Testes locais: API/MCP padrão três passaram e três skipped (8,88s); após aplicar escopo, API dois passaram (2,80s) e fila três passaram (3,22s), incluindo recusa de outra raiz/tipo. Compilação PIE e typecheck completo passaram. Limites de módulos: 2046 fontes; descoberta: 1463 testes. API close agora drena requisições admitidas antes de fechar o armazenamento; regressão de fechamento/retry passou novamente (dois testes, 3,12s). Schemas Ajv e idempotência/cancelamento das chamadas novas incluídos nos testes reais Linux existentes; ignorados neste Windows, sem prova positiva local dessas chamadas. CI desta entrega ainda pendente. UI de execução/fila, daemon e demais runners/motores continuam pendentes; goal integral ativo.

## Fila VERIFY — implementação em validação, 16/10/2026

CI 38984171283 (4bc84e2fc) e 38984646478 (8bb9308e6) passaram, incluindo API/MCP com Docker real. A fila agora discrimina discovery/verification, mantém grant completo e exige maxAttempts=1 em VERIFY. Workers selecionam o tipo; descoberta não consome execução. Lease vencida encerra VERIFY como failed/EXECUTION_INTERRUPTED e nunca reencaminha testes. Heartbeat mantém ownership durante cancelling, devolvendo false para cancelar o trabalho enquanto a finalização continua protegida. ID do job é o ID da execução/journal, permitindo localizar prova persistida mesmo se o recibo do job se perder.

CLI: enqueue-verify <grant.json> --key <chave> com as três opções Docker/estado; work-verify <raiz> processa um job. Pré-admissão valida snapshot/raiz/política; worker revalida antes de adquirir recursos. Migração PostgreSQL 202610160004 acrescenta tipo e limite de tentativas; SQLite preserva tabela existente. API/MCP/UI de enfileiramento VERIFY ainda pendentes. Não há daemon nem retomada automática de auditoria.

Validação local: cinco testes passaram e três skipped em quatro arquivos (17,92s), cobrindo SQLite real, fencing, idempotência, cancelamento/finalização e compatibilidade MCP padrão. Compilação PIE, typecheck completo e CLI help passaram. Limites de módulos validados em 2045 fontes; 1463 arquivos de teste descobertos exatamente uma vez. Testes novos de worker VERIFY com Docker e PostgreSQL foram adicionados às trilhas existentes da CI; ignorados neste Windows e ainda sem resultado remoto desta entrega. Lint dos módulos sem erros, com avisos de tamanho/quantidade de parâmetros no worker e contratos da fila. Produto integral permanece incompleto; goal ativo.

## MCP VERIFY opt-in — 16/10/2026

MCP stdio compartilha VerificationCoordinator com CLI/API. pie_test_run só é anunciado com state-dir/docker-bin/docker-host explícitos. Grant estrito, raiz fixa, cancelamento, persistência v2 e cleanup seguem o coordenador; openConfiguredVerifier interpreta a seleção também para API. Encerramento aguarda o verificador antes de liberar armazenamento.

Rodada local: três testes passaram, três ignorados em quatro arquivos (14,67s), incluindo MCP padrão real por stdio e API autenticada. Compilação PIE e typecheck completo passaram. Limites de módulos validados em 2043 arquivos; 1463 arquivos de teste descobertos exatamente uma vez. Lint sem erros; avisos de tamanho/complexidade em createPieMcp/runPie permanecem e exigem refatoração posterior. Novo teste Linux MCP valida schemas Ajv, raiz recusada sem gravação, autorização preservada, evidência íntegra, leitura compartilhada e BUSY com Docker real. Ignorado neste Windows, incluído na CI; execução positiva ainda não comprovada. CI anterior 4bc84e2fc sem confirmação por limite público da API GitHub. Fila VERIFY, UI de execução e outros runners permanecem pendentes.

## Coordenador compartilhado e API VERIFY — 16/10/2026

CI 38983218888 do commit 5af61014badf5c8b4fca62cf5352cf94664b05b8 terminou com sucesso: CLI verify/resources/recover reais, journal vivo concluído, estado externo, pass persistido e snapshot alterado blocked.

VerificationCoordinator passa a ser dono da operação e persistência, usado por CLI/API; limita uma execução por instância, mantém cleanup pendente e aguarda/cancela operações antes de liberar journal. Estado privado é validado no mesmo módulo para todos os adaptadores. API POST /v1/verify só funciona quando serve recebe as três opções explícitas de estado/Docker; default 403. Grant/snapshot ficam presos à raiz de inicialização, autenticação/CSRF preservados, capacidade ocupada 429/BUSY. API close agora pode repetir finalização falhada e só fecha o armazenamento depois do verificador.

Registros novos usam schemaVersion 2 e preservam authorization completa e authorizedRoot, além do digest, para não perder escolhas de arquivos/limites. Leitores aceitam v1 sem fabricar dados ausentes. Prova selada cobre ambos os formatos; teste real SQLite de compatibilidade preserva v1, e adulteração de autorização v2 é recusada. Schemas CLI/MCP e leitores continuaram passando na rodada focada de persistência.

Local Windows: API desabilitada por padrão, autenticação, sessão/CSRF e retry após falha de finalização testados; quatro aprovados+quatro skipped em quatro arquivos (3,59s). Rotas de execução HTTP Linux positivas e encerramento durante VERIFY explicitamente skipped aqui; CI ampliada cobre execução real, raiz incorreta recusada, 429 e cancelamento com prova persistida. Typecheck/build passaram; lint focado dos novos módulos sem avisos/erros. O teste de falha de close usa spy exclusivamente no teste; não prova falha real de provider. Nova API não representa fila de verificação, MCP de execução, UI VERIFY ou motores completos. Custos por execução/histórico continuam sem medição desta composição.

Fechamento: seis testes aprovados em quatro arquivos de painel Chrome Windows/API/sessão (23,22s). Rodada de persistência/fluxo/MCP: três aprovados+dois skipped em três arquivos (8,20s), incluindo consulta de run v2 e fixtures de compatibilidade v1. Typecheck integral/web, build PIE e fronteiras em 2.043 fontes passaram. Testes de recuperação/execução Linux seguem dependentes da CI nova, sem substituição por mocks na aplicação.

## CLI VERIFY explícita — 16/10/2026

CI 38982553785 de 26b52a29f3a6defd2d6554fc2a2c8b4a13eb523d passou: claim concorrente, identidade da raiz, recuperação após saída real de processo e contêiner Docker real criado antes do encerramento abrupto.

CLI adiciona verify com grant JSON estrito, executable/daemon local explícitos e journal obrigatório; resources lista registro paginado sem tokens e sem afirmar liveness; recover verifica ownership atual antes de agir. Estado precisa ser privado/existente/externo ao alvo. Pré-leitura SQLite read-only valida snapshot/autoridade antes de permitir migrations; teste real confirmou que banco interno ou raiz divergente não sofrem migração. Fluxo vivo registra rootRemovedAt após remoção da raiz. Resultado é persistido antes de retornar; todo estado diferente de passed usa exit 1. API/MCP ainda só consultam resultados.

Local Windows: recusa sem criar estado comprovada por processo CLI real; casos positivos Linux/Docker explicitamente skipped. Suíte de autorização, fluxo indisponível, persistência e CLI: quatro aprovados + seis skipped em quatro arquivos (3,58s), mais pré-leitura/admissão três aprovados + dois skipped (2,73s). Typecheck/build e lint focado passaram. CI ampliada testa verify real, consulta persistida, resources sem tokens, recover idempotente e snapshot alterado blocked; aguardar resultado do novo commit. Escala de histórico/journal e custos de cada fluxo CLI não medidos nesta rodada; não afirmar suporte Windows/macOS, jobs VERIFY ou auditoria integral.

## Recuperação de recursos e claim — 16/10/2026

CI 38981881975 de 71bba20a7b161eb4068de74a02fd957abae6626c terminou com sucesso, incluindo journal reaberto após saída real de processo e eventos integrados ao Docker. Novas regras de recuperação ainda dependem da CI desta entrega.

Journal agora mantém claim de recuperação por identidade de processo/máquina/boot e token único em transação SQLite. Não toma recurso de dono vivo/unverified, não substitui recuperador vivo e compara novamente o registro após observações assíncronas. Eventos normais exigem dono original; eventos de recuperação exigem claim atual. Raiz tem token privado em .pie-owner além de dev/inode, UID, modo, caminho canônico e pai privado; registro antigo sem token permanece unverified quando a raiz existe. Isso evita autorizar remoção somente por PID, nome ou inode reutilizado.

ResourceRecovery só limpa: revalida cliente/daemon escolhido, claim, raiz e contêiner por ID/nome/label; remove contêiner antes da raiz, registra conclusão e preserva recursos se identidade/cleanup incertos. Creating sem contêiner visível permanece blocked por handshake tardio possível. Conclusão repetida não remove diretório novo que reutilize o caminho antigo. Não retoma testes nem gera resultado passed para auditoria interrompida.

Validação local Windows: cinco aprovados + cinco skipped em três arquivos (1,59s); testes Linux de claim concorrente, raiz substituída/marca alterada, cleanup tardio/retry e Docker real explicitamente não executados aqui. Build e typecheck passaram; lint focado sem avisos/erros após separar inspeção de identidade do fluxo de remoção. CI ampliada cria contêiner real por processo que sai abruptamente após created e tenta recuperar contêiner/raiz. Mocks de respostas Docker existem somente em regressão de transporte no teste; não comprovam o provider real. Nenhuma ferramenta pública de recovery nem retomada de auditoria foi anunciada. Claims não expiram por relógio: substituição exige prova de saída do processo, podendo bloquear se ele estiver travado ou não verificável.

## Journal de recursos VERIFY — 16/10/2026

CI 38981437126 do commit a90af71c5c17279b6c5cf464c07913c79e3dd3e2 terminou com sucesso: migrations, PostgreSQL real, replay/imutabilidade e execução Docker aprovada persistida nos dois adaptadores. Não confundir essa aprovação com o novo journal.

VerificationJournal usa SQLite local síncrono FULL e diretório/arquivo privados (Linux, UID proprietário, permissões, arquivo regular sem symlink). Registro conserva run/nome, raiz e identidade dev/inode, cliente/endpoint, PID e identidade de início do processo via primitivas upstream; inclui identidade de máquina por hash e boot para evitar interpretar PID/tempo de início de outro boot como dono atual. Prepared/creating/created/removed são transições verificadas e duráveis. DockerExecution aguarda callback creating antes de chamar create e registra ID comprovado/remoção; falha de gravação impede criação. NodeVerification aceita journal explicitamente configurado e o integra ao fluxo. Não recebe ambiente nem credenciais para persistir.

Seis testes locais aprovados + três skipped em três arquivos (2,02s); typecheck integral, build PIE e lint focado sem avisos/erros. Testes Linux de reabertura e saída abrupta de processo real incluídos na CI; não executados neste Windows. Falha de journal testada com fixture exclusivamente no teste de lifecycle, comprovando que create/start não foram chamados. Fluxo Docker da CI passa a conferir registro removed. Journal ainda opcional no workflow interno, sem comando público, tomada de posse concorrente, remoção recuperada de diretórios/contêineres ou retomada de auditoria. A saída do dono não prova ausência de criação tardia; registro creating permanece pendente. Detecção de órfãos não constitui recuperação completa; Windows/macOS sem implementação são recusados.

## Persistência e consultas de resultados VERIFY — 16/10/2026

CI 38980754712 de e8b0410654a462d660ceb4d1e3ed3c39818dd76e passou: descoberta Git → cópia privada → Docker real → evidência selada. A persistência desta entrega ainda não estava naquele commit.

Contratos VerificationRun separados do workflow, sem dependência de executor nos adaptadores. SQLite/Postgres recebem gravação transacional do run e da evidência, idempotência por identidade e recusa de substituição histórica. Migração PostgreSQL 202610160003 adiciona tabela, FKs, índice e trigger de imutabilidade; SQLite migra de forma aditiva e passa a proibir também DELETE em snapshots/evidências. Validador compartilhado confere contexto do snapshot/revisão, data, digest do registro completo e equivalência entre evidência relacional e payload. Histórico por snapshot paginado, sem anexar runtime a snapshot estático anterior.

CLI verification/verifications, API GET /v1/verification/:id e /v1/verifications/:snapshotId e MCP pie_verification_get/pie_verifications_list consultam os mesmos serviços, sem iniciar testes. Teste SQLite real comprovou reabertura, recusa de UPDATE/DELETE, idempotência, rollback de colisão com evidência validamente selada e paridade CLI/API/MCP em processos/servidores reais. Schemas convertidos SDK validados com Ajv nos testes MCP. Teste PostgreSQL foi explicitamente skipped localmente, incluído na CI com migrations; fluxo Docker real também foi ampliado para persistir resultado passed nos dois bancos. Não declarar essa ampliação comprovada antes do retorno da nova CI. Escala/custos do novo histórico ainda não medidos; saída é paginada e valida evidência antes de publicar fatos.

Rodada ampliada local: dez aprovados + dois skipped em cinco arquivos (10,49s). Após fechar a consistência dos estados individuais com o resumo e a regra de aprovação completa, rodada focada: cinco aprovados + um skipped em três arquivos (8,97s). Lint dos novos contratos/persistência/testes sem avisos/erros; typecheck e build PIE passaram. Testes extras recusam resumo de passed com caso failed e payload aprovado sem casos ou com cobertura incompleta. Histórico valida metadados indexados e prova relacional pelo mesmo dono nos dois adaptadores. Datas de runs exigem precisão de milissegundos para conservar representação entre SQLite e PostgreSQL.

## Composição VERIFY e evidência vinculada — 16/10/2026

CI 38980404425 de 9d3112418054671e3c7da44c918f5799cf435323 passou, incluindo supervisor com Docker real (sucesso, falha e cancelamento) e checagem de ausência de contêiner residual. O fluxo novo NodeVerification ainda aguarda a CI do próximo commit.

NodeVerification compõe admissão, cópia privada de bytes verificados, reporter/config privados e DockerExecution. É dono da cópia e do contêiner; cleanup do contêiner precede remoção dos arquivos montados. Falha mantém referências para close retry; close durante atividade cancela e aguarda operação. Deadline global inclui preparação e finalização. Resultado gera evidência selada vinculada a run/projeto/snapshot, autorização por digest, imagem e registro completo. verifyRunEvidence recusa alteração de resultado/projeto/imagem/autorização. Nomes de arquivos de teste com metacaracteres de glob são recusados para não expandir a seleção autorizada.

Validação local: nove aprovados + três skipped em quatro arquivos, 3,56s. Lint dos módulos novos sem erros/avisos. Fluxo indisponível real preserva projeto, produz estado blocked e não deixa diretórios temporários; não prova Docker positivo neste Windows. CI adiciona descoberta Git → cópia privada → execução Docker → prova selada com teste real sem alteração do projeto. Sem persistência de runs/evidências, journal de recursos ou integração pública; referências em memória não garantem recuperação após crash. T3.1 continua parcial.

## Supervisão Docker — 16/10/2026

CI 38980024074 do commit 7ee7e1c7542db0c294770c0ce8d835433009bc4f terminou com sucesso. Teste real Docker criou/inspecionou/iniciou fixture Node, comprovando restrições observadas (UID, mount/source readonly, rootfs, rede e ausência de socket) e resultado Node. Isso valida o plano anterior; não prova o novo supervisor ainda não publicado.

DockerCommand reutiliza runOwnedCommand/ProviderProcess para ownership do cliente, com executável absoluto, daemon local explícito, config privada e sem herdar credenciais/ambiente do processo pai. DockerExecution assume separadamente contêiner: preflight de imagem local Linux sem volumes, create sem pull, inspeção de identidade/configuração antes de start, captura limitada, estado final/exit e cleanup por ID comprovado. Resposta incerta de create retém ownership mesmo quando list vazio; retry pode receber o handshake tardio. Contêiner inválido não começa; identidade estrangeira não é removida. Cancelamento durante cleanup invalida aprovação e preserva fatos parciais. Dono e cópia devem ser retidos pelo futuro serviço se close falhar.

Seis testes locais aprovados em três arquivos (1,51s total), cobrindo contrato, recusa de daemon remoto, handshake tardio, cleanup retry, cancelamento final e identidade estrangeira. Cenários de falha usam spies Vitest somente nos testes; não comprovam transporte Docker real. CI ampliada inclui supervisor com sucesso/falha/cancelamento reais, ainda a executar. Sem journal persistente, recuperação após crash, evidências de runs persistidas ou integração pública; nenhuma capacidade completa de runner anunciada. Retenção em memória não protege contra encerramento abrupto do processo PIE.

## Configuração verificável do sandbox Docker — 16/10/2026

CI 38979741234 de 935514f26218e257eac86afc62b5cc82ac8cf04d passou, incluindo normalização Node real. dockerPlan.ts agora produz criação sem pull automático, Node sem shell, imagem digest, UID/GID 65534, rede none, rootfs e cópia somente leitura, mounts sem submounts recursivos, capabilities removidas, no-new-privileges, memória/swap/CPU/PIDs e tmpfs limitado. Não monta projeto original nem socket. Parser de inspect separa identidade (nome/token/ID) de validade, recusa configuração divergente e ambiente inesperado antes do start. Mesmo um contêiner owned pode ser inválido e ainda removível pelo dono.

Validação local: cinco testes aprovados + um teste Docker real skipped por ausência de PIE_TEST_DOCKER_IMAGE; lint focado sem avisos/erros, typecheck integral passou. Dados inspect nos testes de recusa são fixtures sintéticas e não comprovam enforcement real. CI adicionada para obter imagem Node explicitamente apenas na infraestrutura de testes, resolver digest, criar/inspecionar/iniciar fixture real e verificar UID, rootfs, rede, mounts e resultado Node. A aplicação não faz pull. Aguardar resultado dessa nova CI; ainda não há supervisor de contêiner, cancelamento com cleanup recuperável, persistência de runs ou integração de execução pública. Arquivos da cópia passam a 0444 dentro da raiz privada para leitura pelo UID do sandbox; raiz privada segue owner-only.

## Normalização de testes Node — 16/10/2026

CI 38968901325 do commit a00018b9d3ace774f6c78554ff01e39a8f7b7dd3 passou no Linux, incluindo admissão VERIFY, cópia privada por hash, links, limites e retenção/retry de limpeza. Isso não comprova execução em contêiner.

Reporter próprio consome eventos públicos Node TestsStream e emite protocolo JSONL v1; parser estrito limita bytes/registros, recusa UTF-8 inválido, truncamento, múltiplos resumos, contagens incompatíveis e resumo sem casos correspondentes. Normalizador preserva casos parciais e separa passed/failed/skipped/blocked/inconclusive. Não aprova mistura com skip/TODO, cancelamento, processo incompleto, saída desconhecida ou apenas carregamento de arquivo sem testes distinguíveis.

Três testes de fronteira passaram com processos Node 24.18.0 reais (1,93s testes; 2,85s total), cobrindo suite/pass, falha deliberada, skip inclusive razão vazia, TODO, mistura, arquivo vazio e erro no carregamento; mutações de protocolo/capture testam dados malformados e incompletos. Execução direta no host somente dessas fixtures sintéticas de teste; aplicação não ganhou fallback de execução host. Reporter e normalizador ainda internos, sem persistência de resultados ou exposição CLI/MCP/API. Não constituem runner isolado completo. Referência de protocolo: https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream ; saída de reporters humanizados não interpretada.

## Preparação de execução VERIFY — 16/10/2026

CI 38968024969 de 94e08801471e5393cfa4e3e7bc55108d23d46654 terminou com sucesso, incluindo PostgreSQL e Chrome Linux para paginação e relações. Base interna de execução adicionada sem anunciar runner pronto: admissão estrita por raiz/snapshot/conteúdo, autorização explícita/expiração, imagem por digest e limites; preparação de cópia privada dos arquivos observados verifica cada hash e mantém dono em falha de limpeza.

Identidade de arquivos centralizada em snapshotFiles, consumida por integridade, comparação e preparação. inventoryPath centraliza recusa de links/escape; implementações supersedidas removidas. Teste rejeita duplicatas de caminho e provas conflitantes mesmo com hashes de evidência válidos. Corrigida documentação de serve (raiz é argumento posicional) e doctor deixou de listar painel como indisponível.

Validação Windows: suíte ampliada teve 17 aprovados + 1 skipped antes da regressão adicional de limpeza. Typecheck integral, build PIE, fronteiras de 2.029 fontes e lint dos novos módulos passaram. Cópia positiva não comprovada localmente: native Windows ausente, e a preparação retorna AnalysisCapabilityUnavailableError sem escrever. Testes POSIX e retenção/retry aguardam execução na CI Linux; falha de cleanup é injetada só no teste, não na aplicação. Chamadas de filesystem são verificadas contra deadline após retornarem; ainda não há isolamento de testes, execução de alvo, prova de limites de contêiner ou relatórios de testes reais. T3.1 permanece parcial.

## Navegação completa dos registros — 16/10/2026

CI 38967326152 do commit b478b19b20619466028bc22f08c3d57d25503a57 terminou com sucesso: build, migrações, PostgreSQL real, typecheck, inventário e painel no Chrome Linux.

Removidos cortes da UI em 200 projetos/50 snapshots: consultas paginadas com seleção independente da página e carregamento/cancelamento explícitos. Histórico inicia na última página e permite todas as anteriores; comparação usa candidatos da página consultada, preservando o snapshot atual. Componentes Dashboard/ProjectSelectors e hook useProjectNavigation assumem navegação antes misturada ao App.

Trace agora mostra relações e respectivas evidências, além dos nós. Paginação usa o maior total das duas listas, evitando esconder arestas quando há mais relações que nós. Testes reais Chrome Windows: 3 aprovados em 21,70s, incluindo 51 descobertas persistidas, 27 projetos (26 entidades de catálogo sintéticas, sem falsos snapshots), comparação entre páginas e grafo de 26 arquivos/650 imports. Página 51–75 contém zero nós e 25 relações consultáveis. Nenhum mock de servidor/provedor. Revalidação final após ajustes: quatro testes aprovados em três arquivos, 22,78s, incluindo autenticação. Typechecks raiz/web, build e fronteiras passaram; lint sem erros, seis avisos de tamanho/complexidade nos componentes/hooks. Refatoração completa dos componentes de investigação permanece pendente; não há aceite integral de acessibilidade ou motores.

## Painel local — 16/10/2026

React 18.3.1 integrado à API loopback real, sem hospedagem externa ou dados de demonstração. Sessão opaca HttpOnly/SameSite Strict, expiração de 30 minutos, limites de sessões/tentativas, origem/Host exatos, CSRF e CSP sem unsafe-inline/unsafe-eval. Bearer preservado; API-only continua sem aceitar Origin.

Executados: compilação PIE, typecheck raiz e web, geração/check do inventário de 892 dependências (325 runtime), fronteiras em 2.024 fontes. Suíte ampliada: 16 aprovados e E2E inicialmente falhou ao esperar histórico anterior; após corrigir sincronização e espera incompatível com CSP, E2E Chrome Windows aprovado em 3,63s (5,65s total). Autenticação real aprovada isoladamente e na suíte. PostgreSQL não executado localmente nesta rodada; CI anterior 38965547500 passou com banco real.

E2E comprova conexão por teclado, descoberta Git/SQLite, arquivos/declarações/evidência/trace, segunda descoberta após alteração, comparação, reload com sessão, ausência de localStorage/sessionStorage e logout. Capturas ignoradas em .cache/pie-web para 360/768/1024/1440 px, sem overflow da página; mobile revisado. Sem erros JavaScript/CSP no fluxo final. Não comprova acessibilidade integral, motores, execução de alvos ou resolver/retestar. Projetos limitados aos primeiros 200 e histórico aos últimos 50 com aviso. Lint focado sem erros e dez avisos de complexidade/tamanho em API/componentes; refatoração pendente, sem supressões.

Data inicial: 16/10/2026. Ambiente: Windows, PowerShell, workspace local autorizado.

| Verificação executada                        | Resultado                                                            | Limite                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| git status e remote -v iniciais              | Repositório vazio, sem commits e origin configurado                  | Não havia código PIE anterior                                                               |
| Leitura dos 12 documentos                    | Realizada integralmente, com releitura em blocos após saída truncada | Documentos descrevem requisitos, não implementação                                          |
| git fetch upstream main --tags               | Histórico e refs obtidos                                             | Comando composto terminou 1 por descoberta de gh ausente; fetch confirmado por branch e SHA |
| git switch -c pie/integration upstream/main  | Sucesso                                                              | Sem push                                                                                    |
| API GitHub origin fork                       | false                                                                | Fork remoto não criado                                                                      |
| npm ci --ignore-scripts --no-audit --no-fund | EBADENGINE                                                           | Node 22.17.1 não satisfaz engines; não desativar requisito                                  |

## Resultados posteriores

- Node 24.18.0 obtido em cache local por npm exec, sem substituir Node global. Instalação: 540 dependências com --ignore-scripts; npm utilizado 10.9.2, divergência do pin 11.16.0 registrada.
- `node node_modules/typescript/bin/tsc -p tsconfig.pie.json`: passou após correção de acesso ao sinal do SDK (`ctx.mcpReq.signal`).
- `node node_modules/typescript/bin/tsc -p tsconfig.build.json`: passou antes do reforço final de lifecycle; isso é compilação, não build empacotado REA completo.
- `node node_modules/typescript/bin/tsc --noEmit`: passou numa rodada anterior; rodada posterior identificou tipo do schema Ajv no teste, corrigido; reexecução mais recente em andamento.
- `node node_modules/vitest/vitest.mjs run tests/boundary/pieFoundation.test.ts tests/boundary/mcp/pieMcp.test.ts src/domain/evidence.test.ts src/application/investigation/EvidenceLedger.test.ts`: **43 testes passaram em 4 arquivos**, última rodada 13,94s no Windows.
- Casos PIE: Git real; SQLite real; reabertura; adulteração de hash; vínculos inválidos; limites; cancelamento; lifecycle com espera de descoberta; imports AST por linha; mudança de digest; impacto; políticas; paginação; CLI e MCP stdio com schemas validados por Ajv.
- Falha inicial do teste de adulteração: teste passava o campo sha256 para schema estrito de evidência ainda não selada; corrigida a construção do teste sem afrouxar schema de produção.
- Lint focado encontrou erro de tamanho no bloco describe, separado em dois blocos. Warnings de complexidade/tamanho de discovery e CLI ainda precisam de refatoração. Não declarar lint integral verde.
- O formatter foi executado somente sobre arquivos PIE e testes correspondentes; blueprint preservado.

Não verificados: CLI/MCP REA empacotados, provedores nativos, PostgreSQL, API/painel, runners e seis motores. SQLite validado é somente modo local. Nenhum ganho de performance medido. Nenhuma garantia de segurança/LGPD emitida. Nenhum push ou fork remoto realizado.

Fechamento desta rodada: typecheck integral `tsc --noEmit` passou. Lint focado passou com quatro warnings (complexidade/tamanho CLI, tamanho/profundidade discovery), sem erros. `git diff --check` passou para arquivos rastreados alterados; novos arquivos ainda estão não rastreados, preservados no workspace.

## Publicação solicitada na main

Em 16/10/2026, usuário solicitou commit/push direto na main sem nova branch. A branch existente foi renomeada para main; todos os arquivos já estavam na pasta do projeto. Compilação PIE reexecutada com sucesso; suíte selecionada reexecutada: 43 testes passaram em 4 arquivos (8,92s). Nenhuma alteração de instalação global. Preparação do commit inclui blueprint, código e documentação, excluindo dist, node_modules, bancos e credenciais. Status do push deve ser confirmado pela resposta Git e correspondência de SHA remoto.

## Segunda entrega integrada — 16/10/2026

- Publicação anterior confirmada: 60de85a40358616dbbe8d605bd649c785c0f37d1 em origin/main.
- Implementados comparação de snapshots, impacto pelos grafos anterior/posterior, contratos explícitos de output MCP, exports JSON/MD/HTML e API local autenticada.
- Teste real HTTP local: token obrigatório, bloqueio Origin, raiz fixa, limites de corpo, descoberta, consulta de grafo e erros; SQLite e Git reais, sem mocks.
- Comparação testada: bytes modificados, adição e remoção reais do índice Git, IDs estáveis, impacto de arestas antigas, paginação, projetos incompatíveis e ausência em snapshot parcial.
- CLI compare e export testados como subprocessos; ferramenta pie_change_impact testada via MCP stdio; outputs reais de sucesso/erro validados contra os schemas anunciados com Ajv.
- Controle de até duas descobertas simultâneas e cancelamento durante shutdown testados. Cancelamento propagado aos subprocessos Git.
- `tsc -p tsconfig.pie.json`: passou. `tsc --noEmit` passou antes da última adição da API; revalidar integral após ela.
- Suíte selecionada atual: **45 testes passaram em 6 arquivos**, 7,57s. Contém 36 testes upstream e 9 PIE; não representa cobertura integral do produto.
- Lint focado passou sem erros, com nove warnings de tamanho/complexidade/profundidade; refatoração ainda necessária. Formatter aplicado aos arquivos alterados de código e testes.
- Docker CLI disponível, mas daemon Linux inacessível (`dockerDesktopLinuxEngine` não encontrado). PostgreSQL em container não foi iniciado nem validado. Isso não bloqueia as outras entregas.
- Falha de fixture durante teste de remoção Git corrigida preparando o índice antes de git rm --cached; não foi necessário usar force nem alterar arquivos de produção.

Pendentes: PostgreSQL, jobs persistentes, painel, seis motores completos, runners isolados, adaptadores adicionais, instalação/matriz multiplataforma e demonstração final. Nenhuma conclusão de 100% implementado.

Verificação final desta entrega: `tsc --noEmit` e `tsc -p tsconfig.build.json` passaram após API; `scripts/verify-module-boundaries.mjs` passou em 2.004 arquivos. `scripts/record-catalog-digests.mjs` e `scripts/bundle-runtime.mjs` passaram; bundler emitiu dois avisos sobre imports dinâmicos upstream que também são estáticos. CLI pública `scripts/rea.mjs --help` retornou código 0. Cliente MCP real conectado ao dispatcher REA confirmou 207 ferramentas, incluindo binary_session e get_evidence_bundle. Nenhum alvo de aplicação nem motor externo foi executado por essa caracterização.

## Terceira entrega — persistência e jobs (16/10/2026)

- Persistência assíncrona comum aos serviços, com modo SQLite preservado e adaptador PostgreSQL/Prisma 7.10.1. Schema e duas migrações para projetos, snapshots, evidências, grafo e jobs. Geração de cliente e prisma validate passaram. Migrações ainda não aplicadas localmente a PostgreSQL real.
- Validador único de snapshot verifica evidências, vínculos, duplicação de nós/arestas e digest da árvore na gravação e leitura. Serviços aguardam leituras/discoveries antes de desconectar o banco.
- Fila SQLite real e adaptador de fila PostgreSQL implementados: idempotência, leases, fencing de worker antigo, cancelamento e recuperação de worker perdido. Worker somente OBSERVE e somente raiz autorizada. CLI enqueue/job/cancel-job/work e API /v1/jobs integradas.
- Docker Desktop existente foi iniciado sem instalação privilegiada. O daemon retornou HTTP 500 nas APIs 1.56 e 1.45; nenhum banco Docker foi criado. Não houve limpeza, remoção de volumes ou modificação de aplicações auditadas.
- Suíte selecionada: **47 passaram e 1 skipped em 8 arquivos** (9,48s). O skipped é PostgreSQL real, dependente de PIE_TEST_DATABASE_URL. Rodadas focadas posteriores mantiveram CLI/API/fila e descoberta funcionando. Teste PostgreSQL e workflow CI preparados; execução remota ainda não inspecionada.
- Teste revelou diferença real entre realpathSync e realpath no Windows para aliases DOS 8.3; diagnóstico mostrou que realpathSync.native coincide com realpath assíncrono. Admissão da fila corrigida no produtor, sem relaxar o filtro de projeto. Regressão do worker passou após correção.
- `tsc -p tsconfig.pie.json` passou após fila; typecheck integral passou antes do último ajuste de caminhos/escopo e está sendo reexecutado. Fronteiras de módulos passaram em 2.016 arquivos na rodada intermediária. Lint focado sem erros na rodada intermediária, com warnings de complexidade/tamanho e quantidade de parâmetros.
- Lockfile atualizado com versões fixadas. Inventário de 891 entradas e 325 runtime verificado. 146 entradas de notices adicionadas a partir de tarballs com SHA do lockfile e identidade de pacote conferidos, sem extração nem execução. Sete archives não têm documentos originais reconhecidos: @prisma/dev@0.24.17, @radix-ui/react-compose-refs@1.1.2, @radix-ui/react-use-layout-effect@1.1.1, pg-types@2.2.0, pgpass@1.0.5, postgres@3.4.7 e remeda@2.33.4. Gaps documentados; isso bloqueia alegação de completude legal para redistribuição, não o desenvolvimento privado.

Nenhum provedor nativo, runner de aplicação ou teste de segurança de alvo foi executado por esta entrega. Goal integral permanece ativo; painel, seis motores e demais critérios ainda não concluídos.

Fechamento local da terceira entrega: typecheck integral passou após todas as alterações. Suíte ampliada reexecutada: 47 passaram e 1 skipped em 8 arquivos (20,94s sob concorrência com typecheck). Compilação PIE, validação Prisma e inventário de licenças passaram. Lint focado terminou sem erros e com 14 warnings de complexidade/tamanho/profundidade/parâmetros, que permanecem como dívida de refatoração; regras não foram desabilitadas. Nenhum teste ignorado foi contado como aprovação. A fila PostgreSQL usa relógio do banco para leases e filtro de raiz no claim, evitando consumir job de outra aplicação.

## Quarta entrega — descoberta declarativa (16/10/2026)

CI anterior confirmada por API GitHub: execução [38963487480](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38963487480), commit d78d53ae255354d3983ec7964c7a0917d989130a, status completed/success. Etapas de container PostgreSQL, instalação limpa, build, migrate deploy, typecheck, inventário e suíte dedicada passaram. PIE_TEST_DATABASE_URL estava configurada para pie_test no workflow. Isso valida o teste dedicado em PostgreSQL 17.6/Linux; não estabelece cobertura integral de persistência, plataforma ou produto.

Implementados adaptadores estáticos integrados à descoberta: dependências/nomes de scripts Node e Composer, serviços e depends_on Compose, operações literais OpenAPI 3.0/3.1, model/campos Prisma via lexer limitado. Fatos têm identidade estável, evidência com hash, linha, snapshot e estado unverified. Não são retidos comandos, exemplos, URLs, valores de environment ou secrets. Erros e limites permanecem explícitos nas limitações. Nenhum alvo ou URL de documento é executado/acessado.

Consulta paginada por CLI declarations, GET /v1/declarations/:snapshot e MCP pie_declarations_list. discovery informa declarationCount. Snapshots históricos sem o novo campo são interpretados como sem declarações, preservando leitura e idempotência sem alterar o registro original. Identidade de declaração e proveniência são verificadas pelo mesmo dono em produção e na persistência.

Testes reais de fixture cobrem parsing, fatos esperados, estados não verificados, ausência de segredos, documentos inválidos, limites, Prisma com comentários/strings, evidência inconsistente, paginação e compatibilidade de snapshot legado. Erro de localização YAML encontrado e corrigido no produtor: a linha agora vem da chave do nó YAML, não da primeira propriedade de seu valor. Propriedades JSON usam offsets da árvore jsonc-parser após validação JSON estrita. Testes focados passaram, incluindo cliente MCP/CLI e API HTTP. Nenhuma mock substituiu a aplicação.

Limitações: dependência laravel/framework declarada não comprova suporte de análise PHP; não há parsing de rotas Laravel/Nginx nesta entrega. Compose não resolve include/extends/profiles/interpolação; OpenAPI não resolve $ref nem verifica contratos runtime; lexer Prisma não valida migrations/constraints. Relatórios Markdown/HTML continuam como inventário de arquivos; o export JSON inclui declarações. Os próximos módulos e todos os seis motores continuam no plano.

Fechamento da quarta entrega: suíte ampliada local com 50 aprovados e 1 skipped em 9 arquivos (11,81s). Typecheck integral, compilação PIE e fronteiras em 2.021 fontes passaram. Lint dos novos adaptadores, integridade e testes passou sem erros após extração dos donos de identidade/coleta e lexer; warnings preexistentes em outras áreas continuam registrados. Correção final de identificadores vazios/excessivos revalidada por 3 testes do adaptador. Sem dependências novas. CI ampliada inclui o novo teste de adaptadores; seu resultado pertence à próxima revisão após push.

## Quinta entrega — relações e trace (16/10/2026)

CI da quarta entrega confirmada via API GitHub: [38964648240](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38964648240), head 0a7e01d0dd9eb3990c7cbabb4436f00cb8399d18, completed/success. Portanto a suíte de adaptadores e a integração PostgreSQL configuradas naquele workflow passaram no Linux. Isso não valida código novo desta quinta entrega antes de sua própria CI.

Grafo de investigação derivado de observações persistidas: arquivos/imports, declaração→arquivo, campo→model e dependência entre serviços Compose do mesmo arquivo. Nós/arestas têm tipos, confiança e evidenceIds; ambiguidades/ausências não escolhem destinos arbitrários. Trace disponível por CLI, HTTP e MCP com contratos convertidos/validados no cliente real. Limites de profundidade/nós/arestas, ciclos, paginação, seed ausente e descoberta parcial testados. runtime permanece false.

Suíte ampliada intermediária: 51 aprovados e 1 skipped em 10 arquivos (31,93s durante typecheck concorrente). Não foi medido ganho de performance. Compilação e typecheck integral passaram nessa rodada; lint de knowledgeGraph, coletor e testes focados sem erros/avisos. Depois, consolidada duplicação de declarações idênticas na mesma linha no produtor para evitar colisão de identidade, preservando limitação explícita; teste de trace com depends_on duplicado passou. Schema de tipos de nós/arestas foi fechado para o vocabulário atual. Teste PostgreSQL ampliado para declaração Prisma e trace; permanece skipped localmente, depende da próxima CI.

Escopo ainda incompleto: relações executáveis UI/API/serviço/dados, rotas Laravel/Nginx, consulta/trace paginados diretamente no banco, painel, runners, seis motores e demais itens do plano. O novo trace não é prova de uma funcionalidade verificada.

Fechamento local da quinta entrega: compilação PIE e typecheck integral reexecutados após enums/limites finais, ambos aprovados. Fronteiras passaram em 2.022 fontes. Revalidação focada final: 6 aprovados e 1 skipped em 5 arquivos, cobrindo consumidores CLI/MCP/HTTP, adaptadores e trace. Lint do novo módulo de grafo, coletor e testes focados passou sem avisos/erros. git diff --check passou. Nenhuma dependência nova e nenhum alvo executado. Publicação na main e nova CI devem ser confirmadas pelo Git/GitHub.

## Cache incremental de parsing PIE — 17/10/2026

**Executado:** Node 24.18.0, npm 11.16.0 via npx. `npm run pie:build` passou. `npm run check:fast` passou (typecheck e lint: 2/2 tarefas, 1m56,666s na execução final). Testes boundary direcionados `pieIncrementalDiscovery`, `pieFoundation` e `pieAdapters`: 3 arquivos, 17 testes aprovados.

O cache é LRU de processo, com chave por versão explícita do parser, caminho, hash de conteúdo e limites, teto de 8.192 entradas, 16 MiB serializados e 256 KiB por entrada. Mantém apenas saídas de parser. Teste Git real observou 2 misses no frio, 2 hits na repetição, IDs/Evidence novos para o segundo snapshot e reparse após alterar o TypeScript; teste separado prova que mudar o limite altera a chave.

Medição no próprio repositório, duas descobertas sequenciais no mesmo processo, Node 24.18.0, OBSERVE, limites 10.000 arquivos/1.000.000 bytes por arquivo/50.000.000 bytes totais: frio 24.972 ms, 20.827 ms CPU; aquecido 14.834 ms, 12.126 ms CPU. Ambas examinaram 4.246 arquivos e leram 49.999.533 bytes, com cobertura parcial por limite de bytes. Cache final: 4.240 entradas/hits por repetição, 2.541.730 bytes, seis resultados não retidos por excederem 256 KiB, zero expulsões. Redução observada de 40,6% em tempo e 41,8% em CPU; pico RSS máximo do processo Node durante todo o ensaio 429 MiB. Medida única, não controlada; RSS agregado dos subprocessos Git não foi medido. A varredura continua pagando Git, leitura/hash, grafo e emissão de Evidence. Isso não comprova cache persistente, descoberta incremental por commit, consistência atômica ou performance geral.

## Mounts Express cross-file — 17/10/2026

**Executado:** `npm run pie:build` passou; testes boundary em seis arquivos (`pieExpressCrossFile`, `pieAdapters`, `pieFoundation`, `pieTrace`, `pieWebTrace`, `pieIncrementalDiscovery`) passaram: 23 testes, incluindo save/reopen SQLite. `npm run check:fast` passou: 2/2 tarefas (typecheck/lint, 34,111 s). `docs:check:built`, formatação e `git diff --check` passaram.

A relação só se forma para import default/named relativo com target rastreado e um export AST único de variável já identificado como `express.Router()`, montado por `app.use()`/`router.use()` com prefixo literal. Aresta `calls` vincula arquivos e contém provas seladas do import, linha de mount/prefixo e export/linha. Validação de snapshot recusa adulteração mesmo com Evidence novamente selada. Trace bidirecional alcança a declaração de endpoint local. O prefixo não é composto no nome do endpoint. Exports ambíguos/ausentes não geram aresta; namespaces, reexports, CommonJS cross-file, factories e runtime permanecem desconhecidos.

Medição no checkout Node 24.18.0, processo único, OBSERVE, 10.000 arquivos/1.000.000 bytes por arquivo/50.000.000 totais: frio 23.632 ms, CPU 20.687 ms; aquecido 14.418 ms, CPU 10.937 ms. Ambos examinaram 4.246 arquivos e leram 49.999.829 bytes, cobertura parcial pelo limite total; 16.148 arestas existentes e zero `calls` cross-file elegíveis no checkout. Cache final: 4.240 hits, 2.825.742 bytes serializados, zero expulsões. Redução observada 39,0%/47,1%; RSS máximo do processo Node 498 MiB. Execução única não controlada; memória agregada dos subprocessos Git não foi medida. Não estabelece performance geral ou runtime Express real.

# Prefixos Express cross-file — 17/10/2026

`pie:build` executado com Node 24.18.0/npm 11.16.0 passou. A boundary `pieExpressCrossFile` passou (4 testes): import/export/mount cross-file, prefixos externos múltiplos, composição de router local aninhado e export não-router. `pieAdapters`, `pieFoundation` e `pieTrace` também passaram; a compatibilidade com snapshot v2 passou dentro de `pieAdapters`. Uma rodada combinada do harness passou em 20 testes e falhou em `pieWebTrace` porque `test:focused` preparou o bundle upstream e removeu `dist/pie-web`, necessário pelo teste; esse teste precisa ser repetido após reconstruir o bundle PIE web. O comando inicial `test:local` foi corretamente recusado pelo harness para boundaries, e um caminho de cache fornecido não existe no checkout; nenhum dos dois é resultado de teste.

Após refatorar o teste para separar fixture e assertions (exigência do limite `max-lines-per-function`), `check:fast` passou. As quatro boundaries focadas passaram (21/21), e `pieWebTrace` passou isoladamente após build (1/1). `docs:check:built` e `format:check` passaram após a atualização documental. A detecção de ciclos na closure impede composição cross-file de endpoints em routers cíclicos, preserva a rota local e registra a limitação. Medição única do código final: frio 23,897 s/19,578 s CPU; quente 12,711 s/10,688 s CPU; 4.273 enumerados, 4.248 examinados, 49.999.473 bytes, 16.150 arestas, 372 declarações, cobertura parcial/615 limitações, cache quente 4.242 hits; pico RSS cumulativo do processo 510,6 MiB. Não medidos subprocessos Git, família de processos ou tokens; rodada não controlada e sem alegação causal. Sem execução Express real; CI não confirmada.

## Result nos parsers declarativos — 17/10/2026

Implementação `b3e03b83c8c59374a59c0ce89bb9a2369a232c46` altera falhas esperadas de adapters declarativos para `Result` tagged: sintaxe inválida, estrutura inválida e formato OpenAPI não suportado. O lexer Nginx preserva mensagens detalhadas enquanto fornece tipo estável. A descoberta mantém o nó do arquivo e explica a omissão sem criar fatos. `collectDeclarations` não captura erros internos; discovery só absorve falhas reconhecidas de inventário (I/O/política).

Validação executada: `pie:build`, `check:fast`, `docs:check:built`, `format:check`, `git diff --check`, `pieAdapters` e `pieExpressCrossFile` (16 testes) passaram. A fixture usa Git real e remove um arquivo depois do stage. Nenhum código do projeto alvo é executado. CI do novo SHA ainda não foi listada pela API pública nesta consulta.

## Adapter Laravel/PHP — 17/10/2026

`node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts` passou: 10 testes, incluindo descoberta via Git real, Evidence/snapshot íntegros, aliases de namespace, grupos com prefixo fluent e array, `match`, omissão dinâmica, comentários/strings, função não invocada e sintaxe inválida. `pie:build`, `check:fast`, `docs:check:built`, `format:check` e `git diff --check` passaram. `test:local` recusou boundary conforme harness; runner exato foi usado. Nenhum código Laravel/PHP foi executado.

Dependência runtime `php-parser@3.7.0`, BSD-3-Clause, entrou no lockfile. `npm run licenses:refresh-notices` verificou integridade dos tarballs fixados e adicionou 28 notices runtime, sem gaps; `npm run licenses:check` passou (893 lockados, 353 runtime). Runtime Laravel/PHP, matrix de versões e custo desempenho continuam não medidos/verificados.

Precisão de dialect: gramática php-parser fixada em PHP 8.4. Rejeição por essa gramática não prova invalidade de sintaxe em outras versões; nenhuma rota é inferida da AST rejeitada.

# Validação incremental — cancelamento e timeout Git — 17/10/2026

- `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts`: 9/9 passaram. Os dois casos novos usam checkout Git temporário real; um preserva o mesmo `DOMException` `AbortError` após cancelamento assíncrono, outro confirma `LIMIT_EXCEEDED` no prazo total de 1 ms.
- Reproduzido separadamente no host Windows que o timeout do `execFile` do Node 24 reporta `killed: true`, `signal: SIGTERM` e `code: null`; a classificação de limite inclui essa forma observada.
- `npm run pie:build`: passou.
- `npm run check:fast`, `npm run docs:check:built`, `npm run format:check` e `git diff --check`: passaram após a implementação e atualização documental.
- No SHA `476e6d6925ebb5470212d7df0e2ea599b7c2734c`, PIE integration run `39016437574` passou; CI run `39016437605` continua pendente; Release run `39016437844` falhou no job “Update release proposal”, step Release Please. O motivo exato da falha ainda não foi consultado.
- Evidência limitada à supervisão Git de descoberta no Windows; Linux/macOS, outros processos e persistência de estados de cancelamento não verificados. Nenhum código do repositório alvo é executado.

## Fork oficial e remotos — 17/10/2026

- API autenticada de `GET /user` confirmou a conta `fernandinhomartins40`; `GET /repos/fernandinhomartins40/PIE-ProjectIntelligenceEngine` confirmou que o remoto PIE não é fork.
- `POST /repos/morluto/rea/forks` criou `fernandinhomartins40/rea`; resposta confirmou `fork=true`, parent `morluto/rea`, branch padrão `main`.
- `git fetch rea-fork main` passou. `git rev-list --left-right --count main...rea-fork/main` retornou `67 93`; `git merge-base --is-ancestor rea-fork/main HEAD` retornou falso. Push ao fork não tentado porque não é fast-forward; sem force-push/merge e sem branch criada.
- `origin` PIE ficou intacto; remotos `upstream` e `rea-fork` receberam push URL local `DISABLED`. A configuração está fora do versionamento.

# Validação incremental — merge upstream e caminho SQLite Windows — 17/10/2026

- Merge local `f9da18125` integrou `rea-fork/main` a `main` sem conflitos. `git merge-base --is-ancestor rea-fork/main HEAD` e o mesmo teste para `origin/main` passaram; ambos os pushes resultantes são fast-forward. A comparação da árvore indicou 391 arquivos alterados por upstream (42.572 inserções, 3.836 remoções) antes da correção de teste; `src/pie`, painel PIE, `package.json`, lockfile e Prisma não foram alterados pelo merge.
- `npm run pie:build`: passou depois do merge.
- `npm run check:fast`: passou depois do merge e da correção do teste (2/2 tarefas).
- `npm run docs:check:built`, `npm run format:check` e `git diff --check`: passaram após a atualização das notas (format/diff reexecutados depois de normalizar o EOF).
- `npm run check:pr`: iniciado na revisão do merge, mas interrompido manualmente. Typecheck, compile, format, metadata e lint built terminaram sem erro (lint: 3.733 arquivos, 0 erros, 1.676 avisos); a suíte Vitest parcial levou até 434 s em um arquivo e não chegou ao término. `test:python`, `docs:check`, `jscpd` e `scan:todos` desse gate não foram verificados como parte da execução.
- Falha reproduzida em `tests/acceptance/sqliteDatabaseCli.test.ts`: antes da mudança, `node scripts/run-exact-tests.mjs tests/acceptance/sqliteDatabaseCli.test.ts -t 'ENAMETOOLONG'` falhou porque a asserção esperava `ENAMETOOLONG`, enquanto o Windows retornou “Selected SQLite database does not exist”. O produtor `optionalStat` trata `ENOENT` como ausência e mantém outros erros tipados; nenhuma alteração de produção foi necessária.
- Regressão corrigida: o teste observa `lstat` no caminho exato e admite `ENOENT` apenas como semântica nativa alternativa ao `ENAMETOOLONG`; rejeição CLI/MCP continua exigida. `node scripts/run-exact-tests.mjs tests/acceptance/sqliteDatabaseCli.test.ts` passou: 10 passaram, 3 skipped entre 13. Nenhuma aplicação alvo foi executada.
- Esta evidência é Windows x64 local; o branch mergeado ainda precisa de CI remota. O merge é local até publicação; nenhum force-push ou branch foi usado.

# Validação incremental — fronteira tagged de descoberta — 17/10/2026

- `npm run pie:build`: passou.
- `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts`: passou, 11/11 testes. Inclui Git/SQLite reais, input inválido, caminho ausente e sinal já cancelado; o boundary não executa scripts do repositório-fixture.
- Falhas inesperadas não foram injetadas; Linux/macOS e demais boundaries não fazem parte desta rodada ainda.
- O serviço preserva a razão de cancelamento chamando `throwIfAborted()` quando recebe a tag `cancelled`.

- Correção adicional antes da execução completa: validação inválida enviada ao `PieService.discover` retorna `PieError(INVALID_INPUT)`, coberta por teste real de serviço/SQLite; boundary passou 12/12.

# Validação incremental — erro esperado de raiz ausente — 17/10/2026

- `npm run pie:build`: passou.
- `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts`: 13/13 passou; teste adicional confirma `PieError(IO_ERROR)` e ausência de projeto persistido para raiz inexistente.
- Gates `check:fast`, `docs:check:built`, `format:check` e `git diff --check` serão executados sobre o conjunto final antes da publicação.

# Revalidação incremental — jobs/daemon — 17/10/2026

- `node scripts/run-exact-tests.mjs tests/boundary/pieJobs.test.ts`: passou, 4 testes; 1 skip condicional Linux-only no Windows local.
- Cobertura observada: daemon consome jobs enfileirados após ficar ocioso e encerra espera longa; workflows OBSERVE/VERIFY; leases, recuperação de worker perdido e rejeição de publicação por lease obsoleta.
- CLI daemon Linux e PostgreSQL não foram reexecutados nesta rodada; esses resultados não são inferidos do teste Windows.

# Validação incremental — imports dinâmicos com specifier literal — 17/10/2026

- `npm run pie:build`: passou.
- `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts tests/boundary/pieExpressCrossFile.test.ts tests/boundary/pieFoundation.test.ts`: passou, 31/31 testes.
- Fixture com Git real comprova `import("./lazy.js")` → `lazy.ts`, aresta `depends`, Evidence na linha de origem marcada `syntax=dynamic`; specifier calculado não é resolvido. Provas de import estáticas e integridade/cross-file permanecem válidas.
- Não houve execução de aplicação alvo nem medição de performance nesta rodada.

# Validação incremental — require CommonJS literal — 17/10/2026

- Build executado com Node 24.18.0 e npm 11.16.0 (`npm run pie:build`): passou após alinhar `@babel/traverse` a 8.0.4, versão de parser/types.
- `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts tests/boundary/pieAdapters.test.ts tests/boundary/pieExpressCrossFile.test.ts`: passou, 31/31.
- Evidência em Git/SQLite comprova `require("./lazy.js")` → `lazy.ts`; chamada dentro de função com parâmetro `require` foi excluída. Não cobre require calculado nem composição Express cross-file CommonJS.
- `npm run licenses:refresh-notices`: 12 avisos de runtime adicionados, zero gaps, fingerprint `0218c076d58ea6b6887d57a02b0b2533bb997f0c7472d398c156fd4062e03bbf`.

# Validação incremental — Express CommonJS cross-file — 17/10/2026

- `npm run pie:build` com Node 24.18.0/npm 11.16.0: passou.
- `node scripts/run-exact-tests.mjs tests/boundary/pieExpressCrossFile.test.ts tests/boundary/pieAdapters.test.ts tests/boundary/pieFoundation.test.ts`: 32/32 passou.
- Fixture Git real: `main.cjs` importa router com `require` literal e prefixa `/api`; `routes/api.cjs` define endpoint, exporta por `module.exports`. Snapshot produz `GET /api/health`, Evidence distinta para require/mount/export e trace até endpoint; `validateSnapshot` passou.
- Limite: sem reexports CommonJS, bindings dinâmicos/sombreados, chamadas aninhadas ou app Express real executado.

Reteste negativo da composição: import ESM apontando a `module.exports` CommonJS não gera relação de mount nem endpoint prefixado; a limitação continua explícita e o snapshot valida. Boundary final: 33/33 testes em `pieExpressCrossFile`, `pieAdapters`, `pieFoundation`.

# Integração do produto/UX no painel — 17/10/2026

`ProductReview` consome a rota autenticada local existente via sessão/CSRF e mostra declaração, origem, estado de evidência insuficiente, lacunas e paginação. Evidence vinculada abre pelo GET persistente existente e apresenta hash, método/confiança, estado e limitações; seleção limpa ao trocar snapshot, módulo ou página. `npm.cmd run pie:build` e `node scripts/run-exact-tests.mjs tests/boundary/pieProductWeb.test.ts` passaram; 1/1 browser real Chrome/Playwright executou login, consulta SHA/localização, troca de escopo e viewports 360/1440 sem overflow. `check:fast`, typecheck explícito de `apps/web` e `format:check` também passaram. O teste percorreu a interface do PIE com fixture de fonte inerte; não captura jornada de projeto-alvo nem avalia acessibilidade de aplicação externa.

## Exportação do plano unificado — 17/10/2026

- `npm.cmd run pie:build`: passou (inclui geração Prisma, compilação do serviço PIE e build web).
- `npm.cmd exec -- vitest run --project boundary tests/boundary/pieUnifiedPlan.test.ts`: 2/2 passou, com SQLite/Git reais; verifica JSON UTF-8 paginado (257 bytes), continuidade e SHA-256, `planDigest` preservado, triagem ordenada e nota humana no conteúdo exportado, paridade API/MCP/CLI, schema Ajv e rejeição da API sem token.
- `npm.cmd run check:fast`: passou após lint/typecheck (2 tarefas); duração Turbo 1m47s.
- PostgreSQL não executado: `PIE_TEST_DATABASE_URL` indisponível. Exportação de artefatos além do plano permanece fora desta fatia; T6.1 parcial.

## Exportação dos históricos append-only do plano — 17/10/2026

- `npm.cmd run pie:build`: passou.
- `npm.cmd exec -- vitest run --project boundary tests/boundary/pieUnifiedPlan.test.ts`: 2/2 passou. Com SQLite/Git reais, verifica cadeia de triagem com prioridade humana, contestação, JSON dividido em páginas de 241 bytes, hash/concatenação, paridade API/MCP/CLI e schema Ajv.
- `npm.cmd run check:fast`: typecheck e lint passaram (2 tarefas; 1m25s). `npm.cmd run mcp-catalog:check`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.
- PostgreSQL não executado: `PIE_TEST_DATABASE_URL` indisponível. Exports restantes e CI geral mantêm T6.1 parcial.

## Inventário estático inicial de infraestrutura — 17/10/2026

- `npm.cmd run pie:build` e `npm.cmd run pie:web:typecheck`: passaram.
- `npm.cmd exec -- vitest run --project boundary tests/boundary/pieInfrastructure.test.ts tests/boundary/pieUnifiedPlan.test.ts tests/boundary/pieProductWeb.test.ts`: 4/4 passaram. Git/SQLite reais validam Compose/Nginx, Evidence e dependências, paginação, plano, API autenticada, CLI/MCP e schemas Ajv; Chrome real valida estado `NOT_MEASURED`, inventário vazio sem alegar ausência e o fluxo responsivo existente em 360/1440 px.
- `npm.cmd run mcp-catalog:generate`, `npm.cmd run mcp-catalog:check`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check`: passaram.
- PostgreSQL/VPS/Docker do projeto-alvo não foram acessados nem medidos. CPU, memória, disco, I/O, rede, p95/p99 e reinícios permanecem `NOT_MEASURED`; T4.4 continua parcial.

## Pacote de handoff para agentes — 17/10/2026

- `npm.cmd run pie:build` e `npm.cmd run check:fast`: passaram após incluir `fix-handoff` no PieService, CLI, API autenticada e MCP. O catálogo MCP foi gerado e validado com `mcp-catalog:generate`/`mcp-catalog:check`.
- `npm.cmd run test:focused -- tests/boundary/pieUnifiedPlan.test.ts`: 2/2 passaram. A boundary usa Git/SQLite reais e testa página UTF-8/hash, Evidence primária e de relações, redaction/hash, ausência de canário secreto, recusa de digest errado, autenticação API, paridade CLI/MCP e schemas MCP Ajv.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check`, `npm.cmd run mcp-catalog:generate`, `npm.cmd run mcp-catalog:check` e `git diff --check`: passaram. A boundary focada foi repetida depois do formatador (2/2).
- O pacote não infere comandos, não executa alvos, não aplica patch e não cria branch; o ciclo completo com Codex/Claude, aprovação sensível, correção isolada e reteste permanece não implementado. PostgreSQL não foi necessário/consultado nesta fatia.

## Suspeita estática de permissões amplas em workflow — 17/10/2026

- `npm.cmd run pie:build`: passou.
- `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts tests/boundary/pieAdapters.test.ts`: 13/13 passou com repositório Git/SQLite real. Verifica fato YAML/Evidence e linha, finding suspeito, formato granular de permissão de job e `read-all` sem finding, hash stale após edição, redaction, limite de findings e paridade CLI/API/MCP/Ajv.
- O scanner não lê/reinterpreta YAML bruto: consome o fato dono do adapter e só relata se o arquivo atual ainda coincide com hash Evidence. `permissions: write-all` é observado como configuração estática; workflow ativo, trigger, token e conjunto efetivo de permissões não são provados. Nenhum workflow foi executado.
- `npm.cmd run check:fast`, `npm.cmd run mcp-catalog:generate`, `npm.cmd run mcp-catalog:check`, `npm.cmd run docs:check`, `npm.cmd run format:check` e `git diff --check`: passaram. O `format:check` inicial apontou somente layout em `PIE_MASTER_PLAN.md` e `security.ts`; após Oxfmt, a verificação global passou.

## Result tipado na revisão de dados — 17/10/2026

- Testes executados: `npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts tests/boundary/pieUnifiedPlan.test.ts`; 2 arquivos/3 testes passaram. A fixture usa repositório Git e SQLite locais e valida tags para entrada/snapshot divergentes e paridade dos adapters.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram. T1.1 permanece parcial.

## Result tipado no motor de infraestrutura — 17/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieInfrastructure.test.ts tests/boundary/pieUnifiedPlan.test.ts`: 2 arquivos/3 testes passaram com Git/SQLite reais; cobre tags de entrada, identidade e snapshot inválidos e fluxo compartilhado.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram. O `check:fast` inicial apontou o limite de tamanho da função de teste; asserções foram extraídas para helper e a execução subsequente passou.
- O contrato não comprova runtime de containers ou métricas; a saída continua `unverified`/`NOT_MEASURED`.

## Result tipado no motor de produto/UX — 17/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieProduct.test.ts tests/boundary/pieUnifiedPlan.test.ts tests/boundary/pieAdapters.test.ts`: 3 arquivos/14 testes passaram. Cobrem tags de falha, plano unificado e paridade/adaptação de produto.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.

## Result tipado no motor de segurança — 17/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts tests/boundary/pieAdapters.test.ts`: 2 arquivos/13 testes passaram. A boundary valida scan Git/SQLite real, redaction do valor, limites e paridade CLI/API/MCP; adapters passaram sem regressão.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.
- A mudança não amplia padrões detectados nem remove validação de hash/Evidence, redaction, limites ou incertezas do relatório.

## Result tipado na comparação de regressão — 17/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieRegressionResults.test.ts`: 1 arquivo/2 testes passaram. Inclui SQLite e runs persistidos, comparação e paridade CLI/API/MCP, além das tags para solicitação inválida, run inconsistente e escopo recusado.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.
- As tags não transformam declarações estáticas em jornadas ou oportunidades UX observadas.

## Result tipado no plano de reteste — 18/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieComparison.test.ts tests/boundary/pieRetestAdmission.test.ts`: 2 arquivos/4 testes passaram. Inclui seleção por impacto, paginação, escopo inválido e nova validação do grant VERIFY.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.
- O plano continua sem autoridade de execução; a recomputação de candidatos usada na admissão do VERIFY preserva o contrato anterior.

## Typed Result for VERIFY export - 18/10/2026

- `npm.cmd run test:focused -- tests/boundary/pieRunPersistence.test.ts`: SQLite/boundary passed; 1 test passed and PostgreSQL was skipped because `PIE_TEST_DATABASE_URL` was unset. CLI/API/MCP checked paginated bytes/digest; expected failure tags were exercised.
- `npm.cmd run pie:build`, `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.

## Sondagem estrutural PostgreSQL no doctor — 18/10/2026

- `doctor` usa `information_schema.tables`, verifica as 11 tabelas mapeadas pelo Prisma e reporta `incomplete` quando faltam tabelas; não executa migrations. `openPersistence` também recusa schema estruturalmente incompleto, com falha explícita, sem fallback para SQLite.
- `npm.cmd run test:focused -- tests/boundary/pieDoctor.test.ts`: 3/3 passaram. Teste de contrato compara tabela requerida com `@@map` reais; os testes existentes cobrem SQLite read-only e redaction de credenciais. `PIE_TEST_DATABASE_URL` ausente e Docker indisponível, portanto PostgreSQL real não foi verificado nesta entrega. Colunas, índices, triggers e histórico de migrations permanecem fora do alcance da sondagem.
- `npm.cmd run check:fast`, `npm.cmd run format:check`, `npm.cmd run docs:check` e `git diff --check` passaram.

## Validação de duração da lease — 18/10/2026

- Regra única em `src/pie/jobs/contracts.ts`: lease inteira segura de 100 a 300.000 ms, usada por `claim` e `heartbeat` nos adapters SQLite/PostgreSQL. Entrada inválida é recusada antes da transação.
- `npm.cmd run test:focused -- tests/boundary/pieJobs.test.ts`: 4 passaram, 1 skipped por plataforma Linux; fila SQLite real confirmou que heartbeat inválido não muda a expiração persistida. PostgreSQL real não foi executado porque `PIE_TEST_DATABASE_URL` está ausente.
- T1.3 segue parcial; a validação uniforme de contrato não comprova concorrência/falhas do adapter PostgreSQL nesta máquina.

## Proveniência de colunas UNIQUE em migrations — 18/10/2026

- O adapter `sql-migration` retém `sourceFields` ordenados em Evidence para índices/constraints UNIQUE literais em `CREATE UNIQUE INDEX`, `CREATE TABLE` e `ALTER TABLE ... ADD ... UNIQUE`. Expressões como `lower(email)` preservam a observação da constraint com `relation: null`, sem inventar a coluna.
- `npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts tests/boundary/pieAdapters.test.ts`: 2 arquivos, 12 testes passaram. Fixture Git/SQLite valida mapeamento de tabela, coluna simples, constraint composta, `ALTER TABLE`, índice funcional desconhecido, Evidence e paridade service/CLI/API/MCP já coberta.
- Limites: os fatos ainda não são comparados aos seletores `@unique`/`@@unique` do Prisma; migrations não são reduzidas a estado final e nenhuma constraint aplicada no PostgreSQL foi consultada. T4.5 continua parcial.

## Seletores únicos Prisma↔SQL — contrato schemaVersion 5 — 18/10/2026

- Factos Prisma de `@id`, `@unique`, `@@id`, `@@unique` agora preservam colunas literais; migrations preservam PK/UNIQUE ordenados. `data-review` compara seletores com `@@map`/`@map` literal e retorna Evidence de ambas as fontes mais `uncertainty`. Mismatch é observação de fontes; `not_observed` não declara ausência no PostgreSQL; índice funcional e diretiva/mapping não literal permanecem inconclusivos.
- `npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts tests/boundary/pieAdapters.test.ts`: 2 arquivos, 12 testes passaram. Cobertura inclui PK e UNIQUE simples/compostos, coluna mapeada, mismatch, expressão `lower(email)`, schema dinâmico, Evidence e paridade service/CLI/API/MCP com validação Ajv.
- `check:fast`, `format:check`, `docs:check` e `git diff --check` serão executados antes da publicação. Não houve validação PostgreSQL real; o estado final/aplicado das migrations segue desconhecido. T4.5 permanece parcial.

## Data Review no painel — 18/10/2026

- Implementação web: chamada autenticada existente POST /v1/data-review, estados observacionais traduzidos para pt-BR, coverage e incertezas apresentados, Evidence vinculada navegável e paginação para modelos, migrations e relações.
- npm.cmd run pie:web:typecheck: passou. npm.cmd run pie:web:build: passou.
- npm.cmd run test:focused -- tests/boundary/pieWeb.test.ts: 4 passaram, 1 skipped por ser cenário Linux-only. Chrome real em Windows verificou schema/migration descobertos por Git/SQLite, seletor alinhado e abertura de Evidence.
- Limites: o teste de navegador usa fixture de projeto e não conecta PostgreSQL; o painel mostra fatos estáticos do snapshot. Naquele momento os gates ainda aguardavam execução; a atualização final abaixo registra os resultados concluídos.

Atualização de gates finais — 18/10/2026

- npm.cmd run check:fast: passou (typecheck e lint).
- npm.cmd run format:check: passou em 4.149 arquivos.
- npm.cmd run docs:check: passou; readmeConsistency passou 5/5; catálogo e inventário de licenças válidos (902 pacotes lockfile, 365 runtime).
- npm.cmd run pie:web:typecheck e git diff --check: passaram.
- npm.cmd run test:focused -- tests/boundary/pieWeb.test.ts: 4 passaram, 1 cenário Linux-only skipped. pie:web:build também passou.
- O ledger do projeto permanece complete=false e T1.5/T4.5 parciais.

## Exportação do Data Review — 18/10/2026

- Comando/API/MCP: data-review-export, GET autenticado /v1/data-review/export e pie_data_review_export usam o mesmo PieService.
- JSON/Markdown/HTML são paginados por bytes UTF-8. A agregação verifica snapshot, coverage e totais entre páginas; CLI verifica tamanho total e SHA-256. A exportação inclui digest da árvore e deixa state=unverified.
- npm.cmd run pie:build: passou. npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts: 1 teste passou; Git/SQLite reais validaram paginação/hash, CLI/API/MCP e schemas de entrada/saída MCP com Ajv.
- Limites: não houve PostgreSQL real; não calcula estado final das migrations nem exporta todos os outros registros do PIE. T6.1 permanece parcial.

## Cancelamento de job antes do despacho - 18/10/2026

- `JobWorker` realiza heartbeat apos validar a raiz autorizada e antes de chamar discovery/VERIFY. Cancelamento persistido encerra o job sem iniciar workflow; token/lease perdidos impedem despacho.
- `npm.cmd run test:focused -- tests/boundary/pieJobs.test.ts`: 5 passaram, 1 skipped (worker CLI continuo Linux-only). A regressao usa fila SQLite e `PieService` reais; persiste cancelamento entre claim e despacho e confirma nenhum projeto/snapshot ou resultado publicado.
- Esta validacao cobre a corrida antes do inicio do workflow, nao todo cancelamento durante execucao/finalizacao. PostgreSQL runtime e execucao Linux nao foram executados localmente.

## Corrida de heartbeat e cancelamento na publicacao final - 18/10/2026

- Antes do despacho, `JobWorker` recusa executar quando o AbortSignal ja foi acionado, inclusive por heartbeat periodico concorrente ao heartbeat imediato.
- Nova regressao em `tests/boundary/pieJobs.test.ts` cancela no limite de publicacao usando fila SQLite e `PieService` reais: job `cancelled`, sem payload de sucesso; snapshot OBSERVE ja persistido continua consultavel no historico imutavel.
- `npm.cmd run test:focused -- tests/boundary/pieJobs.test.ts`: 6 passaram e 1 worker CLI continuo Linux-only foi skipped. Cancelamento tardio nao reverte discovery concluida. PostgreSQL e Linux runtime permanecem sem prova local.

## Readiness de migrations PostgreSQL - 18/10/2026

- `PostgresPieStore.inspectSchema` consulta tabelas e `_prisma_migrations` em leitura. A classificacao exige todas as migrations versionadas desta aplicacao finalizadas, ignora tentativas explicitamente revertidas, e denuncia faltantes, incompletas e migrations desconhecidas de uma versao futura.
- Doctor reporta `incomplete` sem aplicar migrations; `openPersistence` recusa o banco com mensagem segura e sem fallback para SQLite. O catalogo de migrations e testado contra os diretorios reais em `prisma/migrations`.
- `npm.cmd run test:focused -- tests/boundary/piePostgresMigrations.test.ts tests/boundary/pieDoctor.test.ts tests/boundary/piePostgres.test.ts`: 5 passaram, 1 PostgreSQL real foi skipped. `PIE_TEST_DATABASE_URL` nao esta configurada; `docker info` confirmou daemon Linux indisponivel. A consulta real ao historico nao foi exercitada neste host.

## Verificacao de checksum do historico Prisma - 18/10/2026

- `PostgresPieStore.inspectSchema` tambem seleciona `checksum`. O catalogo embutido contem SHA-256 esperado por migration; status `drifted` bloqueia `doctor` como incomplete e impede `openPersistence`. Prisma documenta `_prisma_migrations.checksum` como SHA-256 do arquivo migration (`prisma-engines/schema-engine/ARCHITECTURE.md`).
- `piePostgresMigrations.test.ts` recalcula os oito hashes dos bytes de `migration.sql`, compara ao catalogo e valida checksum alterado, migration ausente/futura/incompleta e rollback. `pieDoctor` + `piePostgresMigrations`: 5 passaram; `piePostgres` real foi skipped.
- `PIE_TEST_DATABASE_URL` continua ausente e Docker daemon Linux indisponivel; nao alegar verificacao do checksum contra banco real.

## Colunas do schema PostgreSQL - 18/10/2026

- `npm.cmd run test:focused -- tests/boundary/piePostgresSchema.test.ts tests/boundary/piePostgresMigrations.test.ts tests/boundary/pieDoctor.test.ts tests/boundary/piePostgres.test.ts`: 8 passaram; 1 teste de PostgreSQL real foi skipped.
- `npm.cmd run check:fast`, `npm.cmd run docs:check` (ledger continua `complete=false`), `npm.cmd run format:check` e `git diff --check`: passaram.
- Doctor e abertura conferem tabelas e nomes de colunas escalares esperadas pelo DMMF Prisma gerado. A comparação ignora tabelas não pertencentes ao PIE. Ela não valida tipos, índices, constraints ou dados.
- PostgreSQL real não foi testado: `PIE_TEST_DATABASE_URL` ausente e Docker Desktop Linux daemon indisponível.

## Correção candidata para migrations rejeitadas em CI - 18/10/2026

- Runs `39103462410` (SHA `8368bff28`) e `39103643148` (SHA `63503fd61`) falharam no passo `npm run pie:db:migrate`; no run mais recente, `npm audit --audit-level=low` passou antes da falha.
- Inspeção dos arquivos mostrou BOM UTF-8 (`EF BB BF`) no primeiro byte das migrations `202610170002_plan_contestations` e `202610170003_plan_triage_events`. PostgreSQL `scan.l` define whitespace como ASCII `[ \t\n\r\f\v]`; bytes BOM não compõem esse conjunto. A relação causal é inferida, pois o log detalhado da migration não foi acessível sem autenticação.
- O BOM foi removido, catálogo de checksum atualizado e a boundary `piePostgresMigrations` ganhou uma asserção sobre todos os arquivos. CI `39103950984` passou: `prisma migrate deploy`, boundary `pieRunPersistence` com PostgreSQL real, build e typecheck concluíram no job PostgreSQL. PostgreSQL local continua indisponível neste host.

## Dockerfile estático integrado ao Compose — 18/10/2026

- `npm ci` pelo toolchain Node 24.18.0/npm 11.16.0 instalou 695 pacotes do lockfile; audit da instalação e `npm audit --audit-level=low` reportaram zero vulnerabilidades. `licenses:refresh-notices` verificou tarballs e acrescentou três notices MIT sem gaps; `licenses:generate` atualizou o inventário para 905 pacotes lockados/368 runtime.
- `npm.cmd run pie:build` passou. `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts tests/boundary/mcp/pieMcp.test.ts`: 17/17 passaram, com fixtures Dockerfile/Compose sintéticas somente nos testes e Git/SQLite reais. Cobrem parser directive `escape`, continuação multilinha, heredoc, multi-stage, fatos `FROM`/`ARG`/`ENV`/`WORKDIR`/`USER`/`EXPOSE`/`VOLUME`, linhas/Evidence, limite de fatos, contextos Compose, redaction de URL e não retenção de valores/comandos.
- Após `npm.cmd run pie:web:build`, `npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts`: 1/1 passou no Chrome real; o painel apresenta instruções selecionadas e permite abrir Evidence, sem mostrar corpos de comandos. `npm.cmd run pie:web:typecheck` passou.
- `npm.cmd run check:fast`, `npm.cmd run format:check` e `npm.cmd run docs:check` passaram após regeneração dos inventários de terceiros. O ledger gerado continua `complete=false`.
- Medição diagnóstica de fixture sintética de 274 bytes/13 linhas: fria 10,133 ms; 1.000 hits quentes 66,921 ms/0,066921 ms por hit; CPU de processo 94 ms; RSS 50,55→55,48 MiB; heap final 13,91 MiB. São números de um processo Node, não pico da família nem atribuição isolada ao parser. Não há Dockerfile versionado no alvo para comparação equivalente antes/depois; a implementação anterior não parseava esse tipo de arquivo. Tokens, Docker/VPS, recursos de família e custo em alvo real não foram medidos.
- Limites: fatos estáticos não comprovam frontend/expansão, segurança de imagem, build/deploy ou runtime. Dockerfile inline e corpos `RUN`/`CMD`/`ENTRYPOINT`/`HEALTHCHECK`/`COPY`/`ADD` não são retidos; `ARG`/`ENV` preservam apenas nomes. Montagens Compose, Nginx real, containers e métricas de VPS permanecem pendentes.

## Montagens Compose estáticas — 18/10/2026

- Implementados adapter de mounts declarados por serviço e componentes separados para definições top-level; opções arbitrárias de driver não são serializadas. Evidence mantém caminho/linha originais. Interpretação de sintaxe, expansão e aplicação runtime seguem desconhecidas.
- `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts`: 16/16 passaram com fixtures apenas nos testes e Git/SQLite reais. Cobre sintaxe curta/longa, referências de volume nomeado, linha e Evidence.
- `npm.cmd run pie:web:build`; `npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts`: 1/1 passou em Chrome, apresentando mount e volume nomeado. `npm.cmd run pie:web:typecheck` passou.
- Tamb?m passaram `npm.cmd run check:fast`, `npm.cmd run format:check` e `npm.cmd run docs:check`; o ledger permanece `complete=false`. Nenhum Docker/Compose real ou VPS foi executado.

## Ambiente Compose declarado ? 18/10/2026

- Compose emite somente nomes v?lidos de chaves `environment` e caminhos `env_file`; n?o l? arquivos nem ret?m valores, inclusive valores `KEY=value` da forma em lista.
- `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts tests/boundary/mcp/pieMcp.test.ts`: 18/18 passaram. A integra??o Git/SQLite e MCP preserva Evidence e oculta valor-can?rio.
- `npm.cmd run pie:web:build`; `npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts`: 1/1 passou em Chrome, mostrando nome da vari?vel e caminho env_file sem valor-can?rio.
- O conte?do dos arquivos `.env`, interpola??o Compose e ambiente efetivo n?o foi lido ou medido.

## Secrets e configs Compose - 18/10/2026

- Adapter: referencias curtas/longas de secrets/configs por servico; definicoes top-level preservam somente external/name/file como metadados. Arquivos nao sao abertos e nenhum conteudo e retido.
- `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts tests/boundary/mcp/pieMcp.test.ts`: 18/18 passaram; Git/SQLite real verificou componentes, referencias e Evidence.
- `npm.cmd run pie:build`; `npm.cmd run pie:web:build`; `npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts`: 1/1 passou no Chrome exibindo referencia e definicao. Nenhum secret/config real ou runtime foi consultado.

## Profiles e dependencias Compose

Boundary adapter/infra/MCP passou 20 testes focados e Chrome passou 1/1. Profiles e opcoes condicionais aparecem como facts com Evidence; nao estabelecem ordem, saude ou ativacao efetiva.

## Referencias Compose include/extends

- Adapter emite Evidence para include path/project_directory no nivel Compose e extends service/file no nivel de servico; nao abre arquivos nem agrega fatos herdados.
- `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts`: 20/20 passaram com Git/SQLite na integracao; `tests/boundary/mcp/pieMcp.test.ts` passou 1/1 com schemas MCP. Fixture declara caminhos nao lidos e confirma que servicos herdados nao aparecem.
- `npm.cmd run pie:web:build`; `npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts`: Chrome 1/1 confirma apresentacao das referencias. Include/extends reais, merge e runtime nao foram validados.

## Redes Compose estáticas — 18/10/2026

- Compose registra `network_mode`, `network_attachment` e `network_definition` com Evidence da origem. Opções arbitrárias IPAM/driver não são retidas; nenhuma conectividade ou recurso runtime é inferido.
- `npm.cmd run pie:build` passou. `npm.cmd run test:focused -- tests/boundary/pieAdapters.test.ts tests/boundary/pieInfrastructure.test.ts tests/boundary/mcp/pieMcp.test.ts tests/boundary/pieInfrastructureWeb.test.ts` passou: 23/23 com Git/SQLite, MCP e Chrome.
- Compose/Docker real, IPAM, recursos externos e conectividade não foram validados. T2.3/T4.4 continuam parciais.

## UI de seguranca e correcao responsiva - 18/10/2026

- O painel de investigacao apresenta Security Review com findings paginados, superficies de autorizacao unverified, limitacoes, incertezas, remediacao e links para Evidence.
- Chrome real percorreu finding Compose network_mode: host e abriu Evidence persistida. Viewports 360/1440 validam ausencia de overflow horizontal; a boundary revelou titulo longo deslocando badge de triagem, corrigido com quebra de linha/min-width flex.

- O adapter Compose registra `privileged: true` como `privileged_mode`; `security-review` schemaVersion 5 emite `compose_privileged_container` com Evidence atual e omite o finding quando a origem fica stale. Boundaries cobrem adapter, inventário de infraestrutura, paridade CLI/API/MCP/Ajv e Chrome 1/1. A cobertura é estática e parcial; Docker/Compose runtime não foi executado.
- Continuação: `cap_add`/`cap_drop` literais agora são fatos com Evidence; schemaVersion 6 detecta cinco capabilities selecionadas de alto impacto sem inferir permissões efetivas. `pie:build`, boundaries de adapter/infra/security e gates gerais serão registrados após a validação desta entrega; nenhuma runtime Compose foi executada.
- npm.cmd run pie:web:typecheck, npm.cmd run pie:web:build e npm.cmd run test:focused -- tests/boundary/pieInfrastructureWeb.test.ts passaram. Seguranca/runtime do alvo nao foram verificados.

## Compose capabilities declaradas - 18/10/2026

cap_add/cap_drop literais agora sao fatos com Evidence; security-review schemaVersion 6 detecta cinco capabilities selecionadas sem inferir permissoes efetivas. pie:build; boundaries adapter/infra/security 23/23; pie:web:typecheck; boundary Chrome 1/1. `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram; completion ledger permanece `complete=false`. Docker/Compose runtime nao foi executado.

## DDL de migration fora do subconjunto — 18/10/2026

`ALTER TABLE` nao reconhecido, DDL `DROP`/`TRUNCATE`/`RENAME`, nomes qualificados e contexto de schema (`SET/RESET search_path`, `SET SCHEMA`, `set_config`) marcam a migration incompleta. Facts de schema qualificado nao sao comparados a nomes Prisma homonimos. `npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts tests/boundary/pieAdapters.test.ts`: 24/24.
