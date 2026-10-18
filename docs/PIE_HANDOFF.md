## Exports de registros HTTP, funcional e VERIFY — 18/10/2026

Registros HTTP, funcionais e VERIFY são exportados pelo serviço compartilhado, CLI, API local autenticada e MCP em JSON, Markdown e HTML paginados em UTF-8. O renderer comum escapa HTML, anota Evidence/snapshot e conserva o JSON integral em bloco de código. Cada fluxo relê e valida o registro persistido; não reexecuta análise nem requisição.

Validação: `pie:build`; `pieHttpPersistence` 3/3; API funcional, VERIFY SQLite, MCP/CLI e schemas Ajv passaram 22 testes, com 1 cenário PostgreSQL skipped; `check:fast`, `format:check`, `docs:check` e `git diff --check` passaram. PIE integration #190 (`2ff2131`) e #191 (`9b9bd27`) passaram; #192 (`db3dbd0`) estava na fila. CI geral #247 (`2ff2131`) falhou nos cinco shards de teste; build, source tests e checks estáticos passaram. Logs não foram acessíveis pela API pública (403), portanto causa desconhecida. CI #248 (`9b9bd27`) estava na fila e #250 (`db3dbd0`) aguardava serialização; sem resultado geral conclusivo para a revisão atual. PostgreSQL real não foi exercitado localmente. Próximas frentes continuam T6.1 exports restantes/CI geral, T3.1 execução de cliente ligada a processo autorizado e T4.1 semântica das asserções; export não é aprovação funcional.

## Pr?xima frente ? comprovar workflow PIE incremental e ampliar sele??o ? 17/10/2026

Seletor incremental cobre apenas o conjunto principal: quando o diff muda exclusivamente boundaries existentes da allowlist, roda os testes modificados; fonte/config/dispatch/diff desconhecido rodam o conjunto completo. As demais etapas PostgreSQL/Docker/browser seguem completas em todos os eventos. 2 testes de sele??o e 22 guards de workflow passaram; parser YAML e `check:fast` tamb?m passaram. `PIE integration` #91 passou com fallback completo e #92 passou focused (`pieApi.test.ts`) ap?s commit exclusivamente de teste. A etapa seletora levou 12 s/2 s; workflow total 2m02s/1m53s em uma amostra, sem prova de economia m?dia. CI geral `39058695617` ainda estava pendente. Dois Release runs falharam em `Update release proposal`; API p?blica bloqueia os logs (403), portanto a causa ? desconhecida. Actionlint n?o est? dispon?vel localmente (`go` ausente). Pr?ximo: acompanhar CI geral, investigar Release se necess?rio com acesso autorizado, medir mais execu??es e continuar outras lacunas T6.1/T6.3 e da matriz.

## Pr?xima frente ? CI incremental ? 17/10/2026

Export de snapshots, registros funcionais e runs VERIFY agora compartilham servi?os paginados; runs VERIFY s?o revalidados com Evidence e snapshot e preservam estados sem reexecu??o. A boundary usou SQLite real/CLI/API/MCP e um run realmente bloqueado pelo Docker ausente; PostgreSQL foi skipped por aus?ncia de `PIE_TEST_DATABASE_URL`. Pr?ximo: auditar os workflows existentes e os contratos de path/commit para adicionar uma execu??o PIE incremental reproduz?vel, sem alegar cobertura CI ainda. Depois avan?ar T6.1/T6.3 e frentes restantes da matriz.

## Pr?xima frente ? export de execu??es VERIFY e CI incremental ? 17/10/2026

Exporta??o JSON do hist?rico funcional agora ? compartilhada e paginada nos tr?s adapters, revalidada contra snapshot, ID e hashes preservados. Testes `pieApi`, `pieMcp`, `pieFunctionalPersistence`: 4/4 passaram. Pr?ximo: auditar formato e integridade dos `verification_runs` antes de adicionar export hist?rico, depois caracterizar a CI incremental existente sem alterar workflows at? determinar gatilhos e contratos. PostgreSQL real n?o foi validado nesta entrega.

# PIE — Continuidade

## Continuidade T4.1 — resultados por arquivo vinculado — schema v4 — 18/10/2026

`verification-diff` retorna, para cada binding autorizado, contagens de casos do arquivo exato, completude do relatório e Evidence do run. Estados separados distinguem todos os casos reportados aprovados, falha observada, skipped/TODO, observação parcial, nenhum caso reportado e desconhecido. A declaração continua `declared_unverified`; nem linha observada nem todos os casos aprovados prova que o teste afirma a capacidade. A saída é schemaVersion 4 e CLI/API/MCP usam o mesmo serviço.

Boundary SQLite/API autenticada/CLI/MCP: `tests/boundary/pieRegressionResults.test.ts` passou 2/2 após cobrir resultados mistos com falha, execução legada sem instrumentação, relatório de linha incompleto com testes completos, skipped/TODO, zero casos e relatório de teste incompleto; schemas MCP Ajv passaram 15/15. Limites: a associação é por arquivo escolhido pelo operador, não por caso/asserção; não gera `covers`. PostgreSQL e Docker não são necessários para esta projeção de registros. Próximo: definir evidência verificável para ligação semântica entre asserções de teste e capacidade, ou manter estado inconclusivo.

## Continuidade T0.2 — notices npm por `gitHead` exato — 18/10/2026

Notices recuperados de cinco identidades do lockfile: dois pacotes Radix e Remeda por LICENSE raiz, `pg-types@2.2.0` e `pgpass@1.0.5` pelas seções MIT dos READMEs nos commits publicados em `gitHead`. SRI dos tarballs confere com o lockfile; as fontes estão fixadas por URL/SHA-256 em `licenses/upstream-sources.json` e nas entradas runtime. `postgres@3.4.7` declara Unlicense no pacote e no lockfile; seu texto canônico SPDX está preservado como suplemento, não como notice original, pois archive e `gitHead` não contêm arquivo de licença. Dois `UPSTREAM_NOTICE_GAP` continuam explícitos (`@prisma/dev@0.24.17` sem `gitHead`/repositório nos metadados npm e a ausência de notice original de `postgres@3.4.7`); revisão jurídica/fonte continua aberta. A busca adicional confirmou license `ISC` e author no registry, mas não provenance: o endpoint de attestations respondeu HTTP 404; o commit Prisma [67ee5dc](https://github.com/prisma/orm/commit/67ee5dc) só registra atualização de dependência e não prova a origem do pacote. `licenses:check`, `docs:check` e `format:check` passaram antes desta segunda rodada; ledger `complete=false`. Próximo: buscar proveniência/publicação exata de `@prisma/dev`; se não houver registro verificável, manter o gap sem inferir autoria ou copyright.

## Próxima frente — prova semântica de capacidade a partir de testes — 18/10/2026

`verification-diff` v3 agora apresenta a observação de linha separada do binding declarado; Evidence aponta ao run quando houve instrumentação. Resultado legado v1 fica `not_instrumented` sem Evidence de runtime; relatório v2 incompleto fica `unknown` com Evidence do run. Linha executada/não observada não declara cobertura de comportamento. Focused regression + `toolSchemaValidity`: 17/17 no primeiro incremento; focused regression: 2/2 com v1 sem instrumentação e v2 incompleto, CLI/API/MCP e Ajv; `check:fast`, `docs:check` e `format:check` passaram antes desta cobertura ampliada. Próximo: investigar relações explícitas de asserção entre teste e capacidade por semântica estática limitada/contrato de teste, com provenance e estados inconclusivos; nunca derivar `covers` somente de import, binding ou execução de linha.

## Próxima frente — associação semântica teste→capacidade — 18/10/2026

`runIntegrity.ts` agora impede que runtime locations persistidas extrapolem o binding v2/path/linha do snapshot; grants com múltiplos arquivos não podem reportar localização focal, e duplicatas/path/linhas divergentes são rejeitadas. Focused regression/persistence/admission passou (8 pass, 2 skips); `check:fast` passou. Próximo em T4.1: projetar uma relação explícita de resultado executado para capacidade sem tratá-la como `covers` automaticamente. Exigir prova adicional de asserção/comportamento; linha executada sozinha é somente observação, não cobertura semântica.

## Próxima frente — auditoria seletiva dos 104 commits REA pendentes — 18/10/2026

Upstream foi atualizado por fetch para `23f984b1a` (104 commits à frente somente de upstream; 219 locais-only antes do cherry-pick). `093ce695f` foi integrado em `068815b30`, com ownership reconhecível nos diretórios temporários e teste de hygiene. Node 24.18 `.nvmrc`: boundary 7/7, descoberta 1.583/1.583, `check:fast` passou. A primeira execução com Node 22 falhou por import direto de `.ts`, resolvido usando o runtime fixado, sem patch no teste. Próximo: classificar os commits upstream restantes por impacto PIE/segurança/compatibilidade, simulando conflitos e selecionando slices sem misturar os quatro conflitos de lifecycle; revalidar licenças/dependências antes de integrar mudanças que os alterem.

## Próxima frente — medição runtime local de infraestrutura — 18/10/2026

Revalidação da boundary `tests/boundary/pieInfrastructure.test.ts`: 1/1 passou com Git/SQLite reais, cobrindo PieService/API autenticada/MCP stdio + Ajv/CLI, Evidence, paginação e redaction. O teste levou 2,36 s, processo Vitest 15,81 s em uma amostra; não é baseline comparativa. O motor continua estático e todas as métricas do alvo são `NOT_MEASURED`. Próximo: especificar e implementar uma operação runtime separada, opt-in e exclusivamente local, que exija seleção explícita de recursos e produza Evidence ligada à raiz/snapshot; definir ownership e política de cancelamento/cleanup antes de chamar Docker. Não inferir seleção a partir de Compose nem coletar todos os containers do daemon.

## Próxima frente — Result em fronteiras compartilhadas — 18/10/2026

Slice executado: leitura bounded compartilhada agora usa Result discriminado (`limit_exceeded`/`not_regular_file`) em descoberta, segurança, workspace VERIFY, assets, JSON de grants e journal. As boundaries passaram 22 testes; 1 caso POSIX foi skipped no Windows. `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram; depois, priorizar Result nos serviços/mutações restantes ou outra entrega P0 material do plano.

## Diligência REA após atualização de refs — 18/10/2026

Refs atuais: HEAD/`origin/main` `80872c6ea`; `upstream/main` `c12d9eda8` (tag 6.7.0 `27dc42d10`), base comum `926e18b3f`; `rea-fork/main` `d200b8618`. O fork é ancestral, 118 commits atrás; upstream contém 101 commits que ainda não estão na árvore PIE (215 commits locais-only). `git merge-tree --write-tree` encontrou quatro conflitos textuais em arquivos de processo. Nenhuma integração foi aplicada; refs foram atualizados e worktree permaneceu limpo. A comparação do slice compartilhado de processo foi concluída: comportamento já adaptado no PIE e testes locais mais abrangentes; conferir a seção abaixo. Próximo: selecionar outras mudanças upstream pertinentes e revalidar dependências/notices e workflows antes de integrar. A página pública de Actions consultada ainda não expunha run para `80872c6ea`; não atribuir resultado remoto.

Reconciliação do slice de processo: commits upstream `701695139`, `3ad1032b1` e `182e9a268` cobrem a adaptação já presente no PIE. `ProviderProcess.ts` não tem diferença de comportamento (diff excluindo comentários vazio); os conflitos nos testes refletem a suíte local maior e descrições de asserção diferentes. A validação local anterior segue 24 passed/1 skip no Windows, sem prova POSIX. Isso permite fechar a comparação deste slice; não valida nem integra os outros commits REA.

## Próxima validação — ordenação da triagem manual — 18/10/2026

A regra confirmada é lexicográfica: impacto desc., risco desc., esforço asc.; ID desempata e notas ausentes ficam por último. A boundary `pieUnifiedPlan` foi reforçada com combinações discriminantes para os três critérios e passou 2/2 usando Git/SQLite reais; `check:fast`, `docs:check` e `format:check` também passaram. Notas continuam exclusivamente humanas.

## Próxima frente — histórico de exportações e CI incremental — 17/10/2026

Export de snapshot JSON/Markdown/HTML agora é um workflow único do `PieService`, paginado em UTF-8 e compartilhado por CLI, GET autenticado `/v1/snapshots/:id/export` e MCP `pie_snapshot_export`. API/MCP/CLI produzem o mesmo HTML; páginas validam offset, hash, identidade e não cortam codepoints. Testes focados `pieApi`, `pieMcp`, `pieComparison`: 6/6; atualização da CI incremental e export persistido de relatórios funcionais/VERIFY ainda pendentes. Próximo: revisar ownership/contrato da CI incremental do repo e integrar export histórico somente sobre registros persistidos e verificados.

## Próximo passo — identidade do path de coverage no Docker — 17/10/2026

`NodeResult` v2 preserva leitura v1; coverage experimental é ativada apenas para grant v2 de arquivo único e paths só são associados por identidade integral. A regressão do reporter cobre path/linha/count positivos e negativos (pieNodeResults + pieDockerPlan: 8/8); typecheck/lint 2/2 e format check passaram. Node 24.18 real em Windows emitiu path host incompatível com `/source`; nenhuma localização foi atribuída. Docker Linux real ausente. Confirmar o path dentro do container antes de projetar os resultados nos bindings CLI/API/MCP. T4.1 permanece parcial.

## Comparação de bindings VERIFY — 17/10/2026

O comparador de execuções agora tem schema v2 e publica, nas mesmas respostas CLI/API/MCP, os bindings teste→declaração de cada grant, os fatos estáticos e Evidence de origem. Pagina cada lado; execução legada/grant v1 fica `unknown`, e v2 é `declared_unverified`. Leitura persistida verifica novamente que os arquivos pertencem ao grant e as declarações ao snapshot. Boundary `pieRegressionResults` passou 2/2 incluindo igualdade dos três adapters e registro adulterado com hash/Evidence recalculados recusado por ID ausente; `pieExecutionAdmission` 5/1 skip, `pieRunPersistence` 1/1 skip; schemas gerais MCP 15/15. `check:fast`, `pie:build` e `mcp-catalog:check` passaram. Essa associação ainda não prova cobertura runtime nem cria `covers`; seguir com uma fonte real de execução de capacidades e ampliar o motor funcional.

## Distribuição Windows do pacote — 17/10/2026

`npm run verify:package:windows` passou em Node 24.18.0/npm 11.16.0. Confirmados tarball instalado em prefixo temporário, help CLI, catálogo MCP completo (207 ferramentas), setup OpenCode/VS Code/Copilot CLI, idempotência, uninstall e update exato. O Node 22.17.0 inicial falhou no build antes da instalação; o rerun fixou Node 24 também para npm descendente. O verifier genérico e seus casos de symlink, Linux/macOS, providers e Compose continuam pendentes.

## Leitura limitada do grant HTTP no CLI — 17/10/2026

`http-probe-run` deixou de ler grant JSON sem limite: lê até 1 MB por descritor regular, exige UTF-8 válido e valida o schema estrito antes de abrir a persistência. Teste boundary cobre grant válido, arquivo acima do limite e diretório; o teste MCP/CLI real mantém o fluxo positivo. `pieHttpGrantFile` + `pieMcp`: 2/2; `pie:build` passou antes da correção exclusiva de tipagem do teste; `check:fast` (2/2) passou depois. PostgreSQL/runtime de alvo não envolvidos.

## Leitura limitada do grant HTTP no CLI — 17/10/2026

Leitor compartilhado para grants HTTP e Node limita a 1 MB, exige UTF-8/JSON válidos e converte schema inválido em `INVALID_INPUT` antes de abrir persistência/runner. Boundary cobre grant válido, tamanho excedido, diretório, UTF-8/JSON inválidos e campo extra; CLIs HTTP/Node e MCP reais passaram. Três boundaries passaram; dois casos Linux/Docker foram skipped no Windows. `pie:build` e `check:fast` (2/2) passaram. `PIE_TEST_DATABASE_URL` ausente, então PostgreSQL real não foi executado nesta rodada. Sem prova de runtime/identidade do alvo; T3.2 permanece parcial.

## Runner HTTP: cutoff de cancelamento na publicação — 17/10/2026

O `PieService.probeHttp` agora documenta o cutoff: abort antes da chamada síncrona/atômica impede publicação; após entrar no commit assíncrono, retorna o recibo persistido mesmo se o caller cancelar. Boundary usa servidor HTTP, repositório Git e SQLite reais com barreira na fronteira de publicação. `pieHttpPersistence` 3/3, `pie:build`, `check:fast` 2/2 e `format:check` (4.113 arquivos) passaram. PostgreSQL não executado; sem vínculo de identidade entre servidor e bytes do snapshot; T3.2 segue parcial.

## Motor Dados: relações Prisma e FOREIGN KEY — 17/10/2026

Quarto slice T4.5: relation facts preservam field, arrays ordenadas `fields`/`references` e colunas SQL da FK. `data-review` aplica `@@map` e `@map` literais e retorna colunas alinhadas, incompatíveis ou não comparáveis; relação inversa sem arrays explícitos não recebe falso aceite por coluna. Mappings, fields não encontrados, alvo ambíguo e cobertura parcial permanecem inconclusivos. Contrato schemaVersion 4. Fixture cobre FK via `CREATE TABLE` e `ALTER TABLE`, alinhamento com coluna mapeada, mismatch, relação inversa não comparável, FK ausente e FK composta. Validação: boundaries `pieAdapters`/`pieDataReview` 11/11, `pie:build`, `check:fast` (2/2), `docs:check:built` (licenses:check: 902 lock/365 runtime), `format:check` (4.113 arquivos) e `git diff --check` passaram. PostgreSQL runtime não foi executado; T4.5 permanece parcial.

## Motor Dados: observações de migrations Prisma — 17/10/2026

Segundo slice T4.5: reader limitado de PostgreSQL em `prisma/migrations/*/migration.sql` registra tabelas e constraints únicas suportadas como facts/Evidence. `data-review` compara nomes exatos, respeita `@@map` literal de modelo e retorna estado observacional `unverified`; mapeamento não literal/desconhecido deixa a comparação incompleta. Preserva Evidence da tabela/constraint/mapping e paginação. Contrato atualizado para schemaVersion 2. Teste Git/SQLite valida comentário/string negativa, PK, UNIQUE, índice, chave composta, modelo mapeado e mapping não resolvido, schema/payload MCP e paridade service/CLI/HTTP/MCP. 11/11 boundaries, `pie:build`, `check:fast` (2/2), `docs:check:built` (licenses:check: 902 lock/365 runtime), `format:check` (4.113 arquivos) e `git diff --check` passaram em Windows/Node 24.18.0/npm 11.16.0. Limites: sem cálculo do estado final, `@map`/schema SQL, SQL dinâmico ou banco real. T4.5 parcial.

## Motor Dados: seletores Prisma declarados — 17/10/2026

Primeiro slice T4.5 integrado: Prisma facts registram diretivas de seletor e ownership sem persistir argumentos; análise em snapshot sinaliza somente modelos sem `@id`/`@@id`/`@unique`/`@@unique` observados, estado `unverified`, com Evidence e limite por arquivo. `PieService`, CLI, API e MCP compartilham contrato; nenhum acesso ao banco é feito. Boundary Git/SQLite e consumers: 11/11; `pie:build`, `check:fast` (2/2), `docs:check:built`, `format:check` e `git diff --check` passaram. Seguir com migrations/constraints e testes PostgreSQL reais; T4.5 permanece parcial.

## Reconciliação do escopo CommonJS em T2.2 — 17/10/2026

A tabela mestre agora reconhece o suporte de composição Express CommonJS top-level já validado: require literal e export default/nomeado estático em CommonJS. Permanecem pendentes reexports CommonJS, interop ESM/CJS, bindings mutáveis/sombreados, specifiers calculados e outros frameworks. Nenhuma relação `covers` é criada a partir de import; dependência estrutural não prova que um teste verifica uma capacidade.

## Estado agregado de comparação e paginação — 17/10/2026

O status global compara todas as mudanças declarativas antes de paginar; alterações confirmadas continuam visíveis como `changed`, e apenas lacunas/ambiguidades sem mudança de bytes mantêm `inconclusive`. Boundary `pieComparison` (3/3), `pie:build`, `check:fast` (2/2), `docs:check:built`, `format:check` e `git diff --check` passaram. Próximo: seguir com cobertura entre casos e capacidades quando houver relação de origem verificável; T4.1 não está concluído.

## Interpretação conservadora de mudanças funcionais — 17/10/2026

O diff por snapshot agora expõe `interpretation` para separar mudança observada de lacuna de cobertura: inventário completo permite `observed_change`; snapshot parcial produz `unknown_before`/`unknown_after`; alinhamento duplicado fica `ambiguous`. Isso não declara remoção de funcionalidade nem regressão runtime. `pieComparison` passou 3/3, além de `pie:build`, `check:fast`, `docs:check:built`, `format:check` e `git diff --check`. Próximo passo: produzir relações de cobertura entre testes executados e capacidades apenas quando houver origem verificável; T4.1 e o goal integral seguem abertos.

## Next.js Pages Router por AST — 17/10/2026

O coletor Next agora cobre `pages/**` na AST TS/JS já parseada. Páginas com export default viram `page`; `pages/api/**` vira `endpoint` `API handler` sem inferir método. `index` e segmentos dinâmicos são preservados; `_app`/`_document`/`_error`, `.d.ts` e módulo API sem default não são contados. Limites de orçamento viram limitation. Boundary `pieAdapters` passou 10/10 com integração Git/SQLite, Evidence e validação do snapshot. Ainda sem runtime Next; T2.2 parcial. Próximo trabalho deve cobrir mais semântica cross-file sem inferir disponibilidade HTTP.

## Erros esperados tagged no motor funcional — 17/10/2026

`assessFunctionalResult` tipa input/schema inválido, module path inválido, escopo/política recusados e snapshot inválido pelo schema/integridade; falhas inesperadas não são capturadas. `PieService` converte falhas esperadas ao erro compartilhado usado pelos adaptadores CLI/MCP/API, tanto em review quanto em retenção. Boundary funcional/persistência 11/11, `pie:build` e `check:fast` passaram. T1.1 permanece parcial; aplicar o padrão nas demais fronteiras é trabalho restante. Próximo eixo: T1.2 retenção/expiração e redação com ownership no produtor, preservando evidências históricas imutáveis.

## Continuação do motor funcional — 17/10/2026

Corrigida a semântica da cobertura paginada: `declaredTargets` é o total no escopo e `examinedTargets` é o tamanho da página efetivamente avaliada. O validador histórico confere ambas as contagens contra snapshot e request. Validação: 11/11 boundaries (`pieAdapters`, `pieFunctionalPersistence`), `pie:build`, `check:fast`, `format:check` e `git diff --check`. Próximo: seguir o plano integral com execução real autorizada e vinculada a cenários/evidências; o motor permanece `unverified`, e não há suporte completo para jornadas funcionais.

## Artefatos de auditoria obrigatórios

Criados `PIE_PROJECT_MAP.md`, `PIE_AUDIT_PLAN.md`, `PIE_FINDINGS.md` e `PIE_UPSTREAM_DIFF.md`, exigidos pela seção 7 do protocolo de execução. A comparação `upstream/main...HEAD` confirmou zero commits upstream-only e 80 commits PIE-only no SHA `4451f1fc4`; diff de árvore: 173 arquivos, +51.949/−103. Licença MIT/notices preservados; sete gaps de notices e revisão legal permanecem abertos. `docs:check:built` e `format:check` passam após formatação. Próximo avanço: `Result` uniforme T1.1 ou retenção/redação T1.2, sem reduzir o restante do objetivo.

## Estado atual — remotos sincronizados — 17/10/2026

Após publicar os relatórios, o commit `1b31911d0` foi enviado por fast-forward aos dois remotos. Fetch confirmou `HEAD`, `origin/main` e `rea-fork/main` iguais; upstream `926e18b3f` ancestral; somente `main` local. Para `1b31911d0`, CI PIE `39040621001` pending, Release `39040621073` queued; CI fork `39040625929` e Release `39040626022` pending. A CI de integração não é acionada por esse conjunto de alterações somente documentais. Próximo: avançar T1.1/T1.2 ou execução Playwright; os motores e o aceite integral seguem por completar.

`origin/main` e `rea-fork/main` estão ambos em `9732f293585b4d1ebaed5d3f642e12199331dfe3`; `upstream/main` `926e18b3f` é ancestral e só existe a branch local `main`. Para esse SHA, CI do PIE `39038524038` e do fork `39038534862` estão pendentes; Release do PIE `39038524037` está `in_progress` e do fork `39038534901` está `queued`. Próximo: acompanhar conclusões e seguir trilhas T1.1/T1.2/T1.3/T1.4/T1.5 ainda parciais; não declarar aceite integral.

## Continuidade atual — novo avanço upstream — 17/10/2026

Após atualizar o fork oficial para `744c44c1d`, `upstream/main` avançou para `926e18b3f`. Merge local `734f5d20c` o integrou sem conflitos; preserva os 71 commits PIE e não altera `src/pie`, painel, testes SQLite ou manifests. `pie:build` passou; boundaries `ciPortableBuildCache` e `windowsTargetSeparators` passaram (5 pass, 1 skip). Próximo: `check:fast`, docs e formatação; depois publicar por fast-forward em `origin/main` e `rea-fork/main`, e acompanhar CI do novo SHA.

## Continuidade atual — integração upstream REA e teste Windows — 17/10/2026

Merge `rea-fork/main` está em `main` local (`f9da18125`) sem conflitos, preservando todos os commits. A correção SQLite e os registros foram publicados em ambos os remotos no SHA `744c44c1d`; após isso, upstream avançou para `926e18b3f`, integrado localmente em `734f5d20c`. A suíte completa `check:pr` foi interrompida após um arquivo acceptance levar 434 s; Vitest parcial apontou expectativa ENAMETOOLONG incompatível com `ENOENT` observado no Windows. Corrigido o oráculo por observação `lstat`; `tests/acceptance/sqliteDatabaseCli.test.ts` passou inteiro (10/13, três skips do arquivo). Próximo: `check:fast`/docs/formato e publicar fast-forward em ambos os remotos. Não registrar `check:pr` como verde.

## Histórico — preparação inicial do fork oficial — 17/10/2026

Na preparação inicial, a conta autenticada foi `fernandinhomartins40`; o fork `fernandinhomartins40/rea` foi criado com parent `morluto/rea`, enquanto `origin` permaneceu o repositório PIE. A primeira medição mostrou divergência 67/93 e motivou os merges posteriores. Esse estado foi superado: histórico e fork foram sincronizados em `9732f293585b4d1ebaed5d3f642e12199331dfe3`, conforme o bloco de estado atual no topo. O registro do SHA anterior `476e6d6925ebb5470212d7df0e2ea599b7c2734c` é histórico: PIE integration passou, CI geral estava pendente e Release falhou em Release Please.

## Continuidade atual — supervisão/cancelamento Git — 17/10/2026

Outra fragilidade de ownership foi removida em `discoverProject`: a associação entre Evidence e import cross-file passa a ser capturada junto da resolução tipada, sem reparse de texto de observação. Validado por `pieExpressCrossFile` 7/7, `pieAdapters` 10/10, build PIE, `check:fast`, `format:check` e `docs:check:built`. Publicada em `998485ae4` diretamente na main dos dois remotos. Próximos alvos de maior escopo seguem T1.1 (Result uniforme), T1.2 (retenção/redação) e T3.1/T3.2 (runners).

Auditoria do comportamento no commit `df2a983d1` identificou que a regressão inicial aceitava qualquer `IO_ERROR`, sem provar a causa, e que `git symbolic-ref HEAD` não consegue ler uma referência cujo destino está corrompido. A leitura direta dos metadados Git foi corrigida para distinguir ref inexistente de conteúdo inválido; o teste agora exige também a mensagem tipada específica. Boundary `pieFoundation` completo: 10/10. A correção está publicada em `f3e979496` nos dois remotos.

Correção adicional na mesma fronteira: revisão nula só para HEAD simbólica sem ref; ref malformada dá `IO_ERROR`. O prazo é consultado de novo em cada subprocesso Git aninhado. `pieFoundation` 10/10, `pie:build`, `check:fast`, `docs:check:built`, `format:check` e `git diff --check` passaram no Windows. Próximo: registrar/publicar na `main` e conferir CI. Linux/macOS e cobertura de todos os workers/processos ainda ausentes; T1.1/T1.3 parciais.

Na descoberta, o wrapper Git convertia toda falha de `execFile` em `IO_ERROR`; abortar subprocesso ativo podia ser confundido com erro de inventário, e o timeout real Windows era `killed=true`, `signal=SIGTERM`, `code=null`. O produtor agora preserva `signal.reason` quando cancelado e representa timeout/capacidade do filho como `LIMIT_EXCEEDED`. `pieFoundation` passou 9/9 com repositório Git real, incluindo cancelamento assíncrono e timeout total de 1 ms. `pie:build`, `check:fast`, `docs:check:built`, `format:check` e `git diff --check` passaram. Próximo: publicar diretamente em `main` e conferir os workflows do novo SHA. Não ampliar a alegação para workers/jobs ou outros subprocessos; T1.1/T1.3 seguem parciais.

## Continuidade atual — caracterização do runtime upstream — 17/10/2026

Node 24.18.0/npm 11.16.0; artefato Windows x64 exato de `rea-agents@6.5.0` restaurado/validado; `build:cached` passou. REA CLI help e MCP stdio real listaram 207 ferramentas; PIE MCP stdio/Ajv passou em teste real, assim como 36 testes Evidence/Ledger upstream. `verify:package` gerou tarball mas bloqueou em EPERM criando symlink de fixture no Windows antes de install/update; não comprova pacote instalado. Próxima frente segura: continuar T2.2/grafo e acompanhar lanes CI para package verification Linux; fork de rede e provedores externos continuam não confirmados.

## Histórico da continuidade — imports de pacotes no grafo — 17/10/2026

Implementação local relaciona imports estáticos a dependências declaradas de nome único, com Evidence do import vinculada a specifier/destino e do manifest; snapshotIntegrity rejeita divergência; pacotes ausentes ou ambiguamente declarados permanecem sem destino. Após o endurecimento para nomes duplicados, quatro arquivos boundary passaram novamente (17 testes) e `check:fast` passou. `format:check`, build PIE e `docs:check:built` passaram; próximo passo: commit/push direto em `main`. A aresta chega ao manifest e não comprova instalação, subpath runtime ou carregamento. Goal integral ativo.

## Histórico da continuidade — comparação VERIFY — 17/10/2026

Comparação compartilhada (`verification-diff`, `pie_verification_compare`, POST `/v1/verification-comparison`) implementada e validada localmente. `check:fast`, typecheck, build PIE, docs:check:built, Git/SQLite com API/CLI/MCP e Ajv passaram; testes VERIFY dependentes de Docker foram skipped no Windows. A próxima ação autorizada é revisar diff, commit e push em `main`; depois acompanhar CI e registrar seu resultado. Não alegar CI antes da execução nem encerrar o goal; findings vinculados, métricas, comparison UI e motores integrais seguem no plano.

Extensão do histórico VERIFY concluída: serviço, API/CLI/MCP/Ajv, SQLite, painel e comparação paginada passaram. `check:fast`, `pie:build`, `docs:check:built`, `format:check` e sete testes boundary passaram; dois casos foram skipped, incluindo PostgreSQL local sem `PIE_TEST_DATABASE_URL`. O workflow PIE 39006977560 passou no SHA `a5e0b64cc55c8d5b59e460e1c68edafdcfe35263`, incluindo PostgreSQL real. O CI geral 39006977567 está pendente na fila do GitHub.

Correção de qualidade após CI: `knip` apontou reexports PIE sem consumidores e utilitário de notices sem comando; removidas as reexportações, o contrato funcional usa `engineName.extract`, e `licenses:refresh-notices` expõe o utilitário. `knip` e gates locais passaram; PIE integration 39007508787 passou no SHA `7cf2acb3d`; CI geral permaneceu queued. Trabalho atual: resolver prefixos literais em montagens Express/Router no AST, mantendo mounts dinâmicos, ciclos, wildcard e cross-file explicitamente limitados.

Revisão estrutural do Express encontrou que a Evidence do endpoint não explicitava as linhas de `use()` que contribuíram para o prefixo público. Corrigido com provenanceVersion 2, observação principal vinculada aos campos declarados, Evidence por cada linha de mount e propagação às arestas do trace, findings funcionais, persistência e export. O validador central checa os vínculos; snapshots antigos continuam v1 sem alteração retroativa. A rodada boundary ampla (antes da agregação final de mounts duplicados) teve 23 arquivos pass e 4 skipped (57 testes passaram, 19 skipped); após a agregação passaram novamente os 9 testes de adapter, `check:fast`, `pie:build`, `docs:check:built`, `format:check` e `knip`. CI desta revisão aguarda push; sem teste de servidor Express real, CPU/memória/tokens ou `PIE_TEST_DATABASE_URL` local.

## Estado atual — 17/10/2026

O runner HTTP está integrado à CLI, MCP e API. Execução explícita usa `PieService.probeHttp`; histórico individual e paginado preserva Evidence imutável e valida hash/vínculos. SQLite/API e MCP/CLI passaram em testes reais com servidor local. A listagem PostgreSQL passou no job `postgres` da CI 39004309946 (commit `8d1f85c42`). PostgreSQL local foi pulado por falta de `PIE_TEST_DATABASE_URL`. Nesta continuação, o reteste passou a vincular um grant VERIFY a digest determinístico e aos snapshots; o coordenador recalcula plano e seleção antes da execução. Quatro testes Git/SQLite passaram, assim como `npm run check:fast`; API/fila/MCP também passaram nos testes executáveis. A CI 39005274487 passou no commit `27af7591e`, inclusive job `postgres`. `test:focused` é bloqueado pela ausência dos binários nativos Windows REA, e VERIFY Docker não está comprovado neste host. Captura HTTP não associa a identidade do servidor ao snapshot. Motores e critérios integrais continuam pendentes; goal ativo.

## Base real do runner HTTP local — 17/10/2026

CI 38999421398 (fa7f25986) passou. Novo transporte interno captureLocalHttp envia GET/HEAD apenas a 127.0.0.1 e porta explícita, sem DNS, proxy, pool compartilhado, cookies, autenticação ou redirects. Caminho ASCII codificado é preservado; headers limitados a 16 KiB, corpo a 10 MB e prazo a 30s por seleção. Hash incremental retém somente bytes até o limite, sem corpo/headers na saída. Falhas esperadas usam Result/tag com captura parcial: entrada inválida, cancelamento, timeout, limite ou transporte. Não publica antes de finalizar o request/socket que possui.

Workflow interno probeLocalHttp exige grant VERIFY allowLocalHttpRequests explícito, snapshot/treeDigest, raiz fixa, expiração e TTL da evidência. Confere status esperado e digest opcional; parcial nunca passa. Resultado/prova são selados, preservam autorização e retornam TTL/limitações. A prova registra que não foi demonstrado que o processo respondente executa os bytes do snapshot, e que a asserção HTTP não comprova jornada, permissão ou persistência. Nenhum código do alvo é iniciado ou isolado por esse workflow. Não está registrado na CLI/API/MCP/UI: habilitação pública, armazenamento atômico, identificação do alvo e integração aos jobs ainda pendentes. Não apresentar como runner HTTP completo ou motor funcional pronto.

Testes com servidores HTTP reais e snapshot Git real (sem mocks) passaram: três testes, 2,53s. Cobrem GET/HEAD, caminho/query preservados, redirect não seguido, sem retenção de corpo/cookie, host e Unicode inválidos, limite, timeout, resposta interrompida, cancelamento com sockets drenados, grant expirado/snapshot divergente, digest/status incorretos, integridade e TTL. Build PIE passou; lint dos módulos/teste sem avisos/erros. Testes acrescentados à CI PIE. Sem validação em aplicação real do usuário, TLS/autenticação/remotos não suportados; CPU/memória/tokens não medidos. Demais runners/motores e aceite integral pendentes; goal ativo.

## Proveniência de redação de transporte — 17/10/2026

Revisão encontrou metadado incorreto: nginx-config removia userinfo de URI, mas a evidência derivada herdava redactionStatus=not_collected do inventário de bytes. Parser agora devolve notas internas de redação por declaração; collectDeclarations, dono da prova derivada, aplica redactionStatus=redacted e inclui a transformação nas limitações antes de selar o hash. Nenhum consumidor reinterpreta o nome para inferir segredo/redação. Valores não redigidos e prova do inventário preservam o estado original; hash da fonte continua identificando bytes originais. Registros históricos não são alterados nem re-selados retroativamente.

Teste Git/SQLite Nginx real como fonte comprova URI redigida com caminho/query preservados, linha/contexto e prova redacted selada, ausência de usuário/senha no snapshot e inventário not_collected. Registros e relatórios seguem validando integridade. Adapters/comparação: 12 testes passaram em dois arquivos (9,39s). Build PIE e typecheck completo passaram, lint focado sem avisos/erros. Limites de módulos: 2057 fontes; descoberta: 1464 testes. Nenhum servidor Nginx executado. CI 38999252899 da entrega anterior 811998e13 terminou com sucesso. Correção atual aguarda CI. Não representa política completa de dados sensíveis nem motor de segurança/LGPD concluído. Goal integral ativo; demais runners/motores e aceite integral pendentes.

## Candidatos a reteste no painel — 17/10/2026

Comparar versões agora inclui Planejamento de retestes com modo por impacto ou inventário completo observado. Consulta usa antes/depois da comparação aceita, não os controles ainda não submetidos. Resultado mostra arquivo candidato, motivo, compatibilidade não verificada, prova do snapshot posterior, testes anteriores removidos/não observados e limitações. Paginação é independente das mudanças de arquivo/declaração. Não produz grant nem inicia worker ou teste; autorização VERIFY continua separada. Nova comparação remonta o componente e cancela leituras anteriores.

Teste Chrome real Git/SQLite adiciona arquivo isolated.test.mjs com código que falharia se fosse executado; affected não o seleciona sem dependência registrada e full o apresenta. Interface abre prova do candidato, sem execução. Teste focado passou (um teste, 12,40s). Após separar apresentação dos resultados, build e typecheck web passaram, lint do componente/teste sem avisos/erros. Regressão ampla passou: seis testes e um Linux ignorado em três arquivos (36,35s). Limites de módulos: 2057 fontes; descoberta: 1464 testes. CI 38999031226 do commit anterior f000fabbb terminou com sucesso. Nova entrega aguarda CI. Plano de retestes não equivale a motor de regressão completo: execução vinculada, métricas/screenshots e demais motores seguem pendentes. Goal integral ativo; custos CPU/memória/tokens não medidos.

## Candidatos a reteste por impacto — 17/10/2026

CI 38998811119 (8ef69eed6) passou. Novo planRetests compara identidades de bytes e percorre impacto de ambos os grafos para selecionar arquivos de teste atuais. Import removido/arquivo não observado na versão posterior ainda pode afetar teste ligado no grafo anterior. Modo full inclui todos os testes observados na versão posterior, não apenas afetados. Seleção paginada preserva caminho/ID/prova atual, motivo e runnerCompatibility=not_probed. executionAuthorized/runtimeVerified permanecem false e estado unverified. Não gera grant nem inicia execução.

PieService.retestPlan compartilha o fluxo com CLI retest-plan <antes-id> <depois-id> --mode affected|full, MCP pie_retest_plan (schemas Ajv) e POST /v1/retest-plan autenticado. Cobertura distingue testes observados/selecionados, arquivos no impacto e testes antigos removidos ou não observados. Classificação por nome e imports estáticos não comprovam cobertura funcional; ausência de candidato não aprova regressão. Modos full e affected não substituem auditoria funcional completa. Runner HTTP/Playwright e execução do reteste com vínculo a achados continuam pendentes.

Git/SQLite reais testaram dependência alterada, teste desconectado incluído só em full, paginação, ausência de mudança, arquivo retirado do inventário e prova do snapshot posterior; código fixture não executado. Comparação/API: cinco testes passaram (7,77s); MCP/CLI validou contrato e igualdade durante rodada anterior, cujo teste de comparação falhou somente por setup Git da fixture (corrigido com stage antes de rm --cached). Build PIE e typecheck web passaram; lint focado sem avisos/erros. Reteste é proposta, não execução comprovada. CPU/memória/tokens não medidos; goal integral ativo.

## Comparação de declarações no painel — 17/10/2026

Painel apresenta declarationChanges com observações antes/depois, receptor/contexto, arquivo/linha e acesso à prova de cada versão. Estados traduzidos explicitam ausência de observação, mudança de bytes e ambiguidade, sem afirmar remoção de funcionalidade ou regressão runtime. Paginação compartilhada usa maior total entre arquivos e declarações; páginas de declarações não ficam inacessíveis após acabar a lista de arquivos. A coluna de contexto preserva o valor declarado, sem derivar URL ou fluxo.

Teste Chrome real foi estendido com endpoint Express observado antes e ausente depois, abertura da prova anterior e comparação dos mesmos snapshots reais. Nova declaração expôs ambiguidade no seletor de teste Rastrear; corrigido para escolher a linha React explicitamente. Rodada focada passou (um teste, 8,92s); regressão ampla passou com seis testes e um Linux ignorado em três arquivos (39,17s). Build web e typecheck web passaram; lint do componente/teste sem erros. CI 38998556410 da comparação anterior 856bcba85 terminou com sucesso. Nova entrega aguarda CI. Runners e motor completo de regressão, retestes e demais motores seguem pendentes; goal integral ativo. Sem medições de desempenho novas.

## Comparação de declarações — 17/10/2026

Comparação compartilhada CLI/API/MCP agora inclui declarationChanges paginado, preservando declarações e evidências dos dois snapshots. Identidade lógica usa arquivo, adapter, tipo, nome e contexto; linha/hash são observações comparadas. Estados observed_only_before/after não afirmam remoção/adição de comportamento, pois versões de parser e cobertura podem diferir. source_changed significa bytes do arquivo alterados, não handler alterado comprovadamente. Ocorrências repetidas com observações diferentes ficam ambiguous, sem alinhamento inventado. Diferença de declarações também impede status global unchanged.

Testes Git/SQLite cobrem endpoints Next, deslocamento de linha, métodos observados apenas de um lado, múltiplas ocorrências Express ambíguas, paginação e prova de ambos os snapshots; descoberta parcial não confirma remoção. Três testes focados de comparação/MCP passaram em dois arquivos (16,46s). Compilação PIE, typecheck web e lint focado passaram; typecheck completo desta retomada não executado. Interface específica do diff de declarações, seleção/reexecução de testes e motor completo de regressão permanecem pendentes. Goal integral ativo, sem alegação de conclusão ou ganho de desempenho. CI anterior não reconfirmada nesta retomada.

## Retenção e histórico funcional no painel — 16/10/2026

CI 38992307065 (dc540da8e) terminou com sucesso, incluindo paginação PostgreSQL real. Após limite público da API GitHub, conclusão foi lida usando credencial Git existente somente em memória, sem expor/persistir segredo. Painel agora salva explicitamente a página funcional analisada, lista histórico paginado e abre registro preservado por ID/hash sem recalcular achados. Mostra módulo, offset/quantidade/total e estado não verificado. Cada salvamento deliberado cria novo registro; não há retry automático de mutação incerta. Consulta e salvamento permanecem ações distintas.

FunctionalFinding é a apresentação compartilhada entre análise corrente e registro histórico; useFunctionalHistory é dono de consultas abortáveis, seleção, paginação e atualização. História limpa a página antiga ao iniciar consulta nova; não apresenta dados antigos sob novo offset. Seleção de prova é limpa ao salvar/abrir registro. API segue sessão/CSRF existentes; nada salvo em localStorage/sessionStorage. Não há autorização de execução inferida de uma análise.

Chrome real com Git/SQLite validou salvamento, prova/hash persistidos, consulta e abertura após reload, mantendo módulo/página do registro e responsividade 360/1440. Rodada ampla: seis testes passaram, um Linux ignorado, três arquivos (35,30s), incluindo trace, sessão/CSRF, resultado blocked e histórico de snapshots. Build web e typecheck web passaram. Novos componentes/hooks/testes com lint sem avisos/erros; tamanho de FunctionalReview permanece dívida pré-existente. Teste focado repetido após ajuste da limpeza de página passou (um teste, 13,21s). Limites de módulos: 2055 fontes; descoberta: 1464 testes. Contestação, retestes vinculados, motores completos e aceite integral continuam pendentes; goal ativo. CPU/memória/tokens não medidos.

## Histórico funcional paginado — 16/10/2026

SQLite/PostgreSQL agora listam registros funcionais por snapshot com ordenação createdAt/id, limite 1–200 e offset, total/nextOffset. Resumo preserva ID, módulo, offset/quantidade de achados da página retida, total de declarações, estado unverified e SHA-256. Cada item deriva de registro validado, sem reinterpretar fontes nem recalcular achados. Contagem/leitura usam transação consistente (SQLite BEGIN e PostgreSQL RepeatableRead). Não confundir paginação do histórico com cobertura da página analisada.

PieService/PiePersistence compartilham functionalRecords. CLI functional-records <snapshot-id>, MCP pie_functional_records_list e GET /v1/functional-records?snapshotId=UUID&limit=1&offset=0 usam o contrato paginado versionado. Leitura por ID existente permanece. Testes SQLite reais cobrem duas páginas, vazio após fim e limite inválido; MCP Ajv e CLI comparam respostas; HTTP compara ao serviço. Quatro testes em três arquivos passaram (11,64s). PostgreSQL incluído no teste real da CI, ignorado localmente. Build PIE e typecheck web passaram; lint focado sem avisos/erros. CI 38992099547 da entrega anterior 48d61ab69 terminou com sucesso, incluindo persistência PostgreSQL real. Nova entrega aguarda CI. UI de histórico/retenção, contestação, motores completos e aceite integral permanecem pendentes; goal ativo. Custos comparativos de leitura/CPU/memória/tokens não medidos.

## Registros funcionais imutáveis — 16/10/2026

Análise funcional pode ser preservada explicitamente com pedido completo, página retornada, data e SHA-256 canônico. Registro schemaVersion 1 é artefato derivado de observação, não prova runtime. Guarda somente a página solicitada: total/offset/nextOffset e módulo permanecem explícitos, sem alegar auditoria completa. selectFunctionalTargets é dono da seleção por módulo/página, reutilizado na validação do registro; fatos/IDs/provas e cobertura são conferidos contra o snapshot imutável. Texto histórico não é recalculado por nova versão do motor.

SQLite possui tabela/índice/triggers aditivos e PostgreSQL migration 202610160005 com FK e trigger UPDATE/DELETE imutáveis; modelo Prisma correspondente e client regenerado. Salvamento idêntico é idempotente; mesmo ID com conteúdo distinto é recusado. PiePersistence/PieService compartilham as operações. CLI functional-retain <snapshot-id> --module/limit/offset e functional-record <id>; MCP pie_functional_retain/pie_functional_record_get; API POST /v1/functional-records e GET /v1/functional-records/:id, com autenticação/origem/CSRF existentes. Consulta funcional anterior segue somente leitura. Não há listagem histórica paginada nem UI de retenção nesta entrega.

Teste SQLite real cobre reabertura, preservação da página, hash adulterado, troca re-selada sob mesmo ID, cobertura inconsistente e triggers. CLI/MCP stdio e HTTP com schemas Ajv passaram (quatro testes em três arquivos, 11s); extensão de integridade/API passou (três testes, 3,77s). PostgreSQL real foi acrescentado à trilha CI existente, ignorado localmente. Build PIE, typecheck completo e web passaram; lint focado dos novos contratos/testes sem avisos/erros. Limites de módulos: 2055 fontes; descoberta: 1464 testes. CPU/memória/tokens da persistência ainda não medidos. CI 38991840117 do painel anterior 86da7f14d terminou com sucesso. CI desta entrega ainda pendente. Nenhum motor completo nem prova de funcionamento do alvo é reivindicado; goal integral ativo.

## Análise funcional no painel — 16/10/2026

CI 38991625430 (dfaa30743) passou. Painel passa a consultar a análise funcional OBSERVE real: filtro por módulo relativo, páginas de dez achados, incerteza, reprodução/proposta/aceite e prova da declaração com SHA-256. Estado é Não verificado/informativo; responsável permanece explicitamente não definido. Escopo vazio informa que ausência de declaração não prova ausência de funcionalidade. Nenhuma execução/autoridade é inferida do formulário. Consulta usa API autenticada/CSRF, cancela requisição anterior e limpa prova ao trocar escopo; componente remonta ao mudar snapshot.

Hook useFunctionalReview é dono das consultas/estado; apresentação usa os fatos retornados sem reanalisar fontes. Chrome Windows com Git/SQLite reais validou 13 declarações, segunda página, filtro app/api, prova correspondente e remoção da prova ao filtrar módulo vazio, com larguras 360/1440. Teste focado inicial passou (8,10s). Após refatoração, build e typecheck web passaram; regressão ampla sobre build atualizado passou: seis testes e um skipped em três arquivos (32,62s), incluindo Chrome real, trace, sessão/CSRF e histórico. Limites de módulos: 2054 fontes; descoberta: 1463 testes. Custos CPU/memória e tokens não medidos. Não usar rodada que tenha build falhado como prova do código atualizado. Lint sem erros, aviso de tamanho em FunctionalReview (104 linhas). Motor funcional completo, achados persistidos, demais runners/motores e aceite integral seguem pendentes; goal ativo.

## Análise funcional de lacunas OBSERVE — 16/10/2026

CI 38991366300 (a872b359e) passou. Nova assessFunctional lê snapshot validado, política OBSERVE e módulo relativo canônico, produz achados tipados para páginas/endpoints declarados com prova, informação de severidade, incerteza, passos de reprodução propostos, proposta e critérios de validação. Estado sempre unverified, responsável desconhecido null. Lacuna de verificação não é defeito nem ausência de implementação. Não associa teste aprovado à rota sem vínculo próprio, não executa cenários e não altera alvo. Sem declarações, não fabrica aprovação nem not_found.

PieService.functional centraliza o fluxo; CLI functional <snapshot-id> --module <caminho> --limit/offset, MCP pie_functional_review com schemas versionados e POST /v1/functional usam a mesma análise. O resultado é uma projeção das evidências, ainda sem histórico próprio de auditoria. Escopo por módulo usa fronteira de caminho, sem traversal. Páginas/endpoints não cobrem eventos, persistência, permissões, jornadas e jobs completos. Motor funcional e os demais motores continuam incompletos; aceite de defeitos semeados e runtime permanece pendente.

Testes Git/SQLite cobrem prova/linha, página/módulo, paginação, escopo/política recusados e estado vazio unverified. CLI/MCP real por stdio compara respostas e valida Ajv. HTTP compara resposta ao serviço real. Rodada inicial encontrou passagem incorreta de campos de escopo ao parser estrito de paginação; corrigido o produtor para fornecer somente offset/limit. Após correção, adapters/MCP passaram; API passou após correção de setup do teste (dois testes, 3,10s). Build PIE passou; lint dos novos módulos/testes sem avisos/erros. Não há validação funcional runtime nesta entrega nem comprovação de motor completo. Goal integral ativo.

## Exportação com declarações, relações e provas — 16/10/2026

Relatórios Markdown/HTML deixam de conter somente arquivos: incluem declarações de todos os adapters, relações registradas pelo mesmo buildKnowledgeGraph dos consumidores, IDs dos arquivos, contexto/linha, hashes e metadados completos das evidências, limitações e contagem de relações não resolvidas. Raiz, treeDigest, estado Git, cobertura de arquivos e bytes também são exibidos. Não reinterpreta fontes nem transforma inventário em aprovação. O relatório de snapshot informa explicitamente que não incorpora resultados VERIFY separados. JSON mantém o snapshot integral.

renderSnapshot usa validateSnapshot como dono da verificação de integridade, recusando prova adulterada antes de serializar qualquer formato. Tabelas compartilham a representação entre HTML/Markdown e escapam conteúdo externo; HTML mantém CSP sem execução de scripts. Testes Git/SQLite confirmam declarações Nginx/provas/IDs/arestas no relatório, integridade, escape e compatibilidade CLI/MCP. Rodada adapters/comparação/MCP: 11 passaram (13,02s). Build PIE passou; lint focado sem avisos/erros. CI 38991181811 da entrega anterior 59559290f terminou com sucesso. Nova entrega aguarda CI. Relatório unificado de auditorias/VERIFY, demais runners/motores e aceite integral permanecem pendentes. Custos de relatórios grandes e medições CPU/memória ainda não medidos; goal ativo.

## Correção estrutural do lexer Nginx — 16/10/2026

Revisão do produtor identificou recusa incorreta de } dentro de token e de ) após argumento entre aspas. Lexer agora mantém um dono explícito do estado de token, escape, aspas, comentários, posições e blocos; fechamento de bloco ocorre somente em fronteira de token. Parêntese após aspas é preservado como token separado conforme o comportamento da fonte Nginx consultada. Sem reparos nos consumidores e sem representação antiga mantida. Os avisos anteriores de tamanho/complexidade do lexer foram eliminados pela separação do estado, com lint focado sem avisos/erros.

Novos casos verificam caminho literal contendo }, condição if com argumento entre aspas e contexto posterior. Regressão adapters/trace: dez testes passaram (5,39s), incluindo persistência e prova reais Git/SQLite. Build PIE e typecheck completo passaram. Limites de módulos: 2053 fontes; descoberta: 1463 testes. Nginx real/nginx -t não executados; não há nova alegação de compatibilidade completa ou configuração efetiva. CI 38990965656 da entrega anterior 08d8ccbe0 terminou com sucesso, incluindo as trilhas existentes de Docker/PostgreSQL/navegador. Correção atual aguarda nova CI. Runners, motores e aceite integral continuam pendentes; goal ativo.

## Configuração Nginx com proveniência — 16/10/2026

CI 38987902054 (94d0c77ea) passou, incluindo Express, PostgreSQL, Docker e navegador nas trilhas existentes. Novo adapter nginx-config reconhece nginx.conf, nginx.*.conf e arquivos .conf sob diretório nginx. Lexer iterativo próprio respeita comentários, aspas, escapes e variáveis ${...}; blocos têm limite de profundidade 128. location e diretivas listen/server_name/proxy_pass/fastcgi_pass/grpc_pass/include são preservadas com argumentos em array JSON, sem colapsar limites entre tokens, e contexto ancestral por diretiva/linha. Fatos persistidos usam location/config_directive e prova selada do arquivo; declared_in já integra trace/CLI/MCP/API/painel.

Nenhum include é expandido, nenhum caminho/URL/socket é acessado nem configuração executada. Configuração efetiva, precedência/herança, módulos, certificados/TLS, permissões, escuta, proxy funcionando e HTTP continuam não comprovados. Não chamar inventário de auditoria completa de infraestrutura. Lexer consultado contra fonte oficial ngx_conf_file.c: # no meio do token é literal, escapes desconhecidos preservam barra. Bloco/aspas incompletos não geram fatos. Testes cobrem casos hostis, limites, linha, evidência, persistência e trace real Git/SQLite.

Rodada adapters/trace/MCP: 11 testes passaram (10,78s). Build PIE e typecheck web passaram. Lint sem erros, com avisos de complexidade/tamanho no lexer; refatoração do estado permanece como dívida explícita. Não executado nginx -t nem servidor Nginx real; sem medições comparativas de tokens/CPU/memória. Runners HTTP/Playwright, PHP/Laravel, motores e aceite integral continuam pendentes; goal ativo.

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

## Estado prioritário — MCP VERIFY opt-in

pie_test_run só é registrado com state-dir/docker-bin/docker-host explícitos no comando mcp. CLI/API/MCP reutilizam VerificationCoordinator; openConfiguredVerifier rejeita seleção parcial. servePie canonicaliza raiz e encerra verificador antes do armazenamento. Novo teste tests/boundary/mcp/pieVerifyMcp.test.ts usa stdio real, Ajv e Docker na CI Linux; ignorado no Windows. Rodada local MCP/API: três passaram, três skipped. CI anterior 4bc84e2fc ainda sem confirmação por limite GitHub. Próximo: confirmar CI/corrigir, integrar fila VERIFY sem retry cego após crash, acompanhamento UI, runners HTTP/Playwright e motores. Goal integral ativo na main; produto continua incompleto.

## Estado prioritário — coordenador e API opt-in

CI 5af61014b passou: run 38983218888 (CLI Node real, recursos/recover, persistência). Nova execution/coordinator.ts centraliza NodeVerification, gravação e cleanup; CLI já usa. API POST /v1/verify opt-in somente se serve recebe state-dir/docker-bin/docker-host; coordinator bound à raiz selecionada. Capacidade por coordenador 1, 429/BUSY; root/grant conflitante nega. API close guarda encerramento de rede separado e pode retry sem liberar store antes do verificador. Sem execução por padrão/MCP/UI. Testes HTTP Linux/Docker e fechamento durante execução estão na próxima CI; Windows só validou default/controle de sessão/close retry.

Contratos de run agora discriminam v1/v2: novos resultados v2 incluem authorization completa e authorizedRoot, selados; v1 legível sem inventar escolhas ausentes. Isso altera a versão de saída de runs novos e deve constar no commit breaking. Compatibilidade SQLite e provas adulteradas testadas; CI Postgres ampliada usa o mesmo teste. stateDirectory.ts é dono da admissão do estado privado; não duplicar sua interpretação nos adaptadores. Próximo: acompanhar CI e corrigir, integrar MCP explicitamente habilitado e fila VERIFY com idempotência/cancelamento/sem retry cego após crash; adicionar UI de acompanhamento, demais runners e motores. Goal integral ativo na main, sem novas branches.

## Estado prioritário — comandos VERIFY

CI 26b52a29f passou: run 38982553785, incluindo recovery Docker real. Nova CLI execution/cli.ts: verify <grant.json>, resources, recover <run-id>, flags --state-dir (privado 0700 externo), --docker-bin absoluto, --docker-host local. Journal obrigatório na CLI, sem pull/fallback host; estados não passed usam exit 1. resources omite tokens e não consulta liveness (ownerStatus not_checked); recover faz a verificação atual. Workflow interno ainda aceita journal opcional para consumidores em integração, mas CLI sempre fornece. finishLive registra raiz removida após cleanup; registro final impede futuras remoções no mesmo caminho.

openVerificationPersistence faz preflight read-only de SQLite e valida grant/snapshot antes de migrations; não permitir banco dentro do alvo sob grant de raiz divergente. readStoredSnapshot é dono dessa leitura no adaptador. Testes locais comprovaram recusa Windows/estado sem criação e pré-leitura sem migração; positivos de CLI Linux/Docker aguardam CI do novo push. Teste real novo cobre pass persistido, consulta/resources/recover e snapshot alterado blocked. Próximo: acompanhar CI, corrigir problemas; incorporar verificação à fila/jobs e a workflows compartilhados para API/MCP/UI sem executar grants vindos do projeto. Falta concluir clientes Docker órfãos/retomada de auditoria e Windows/macOS. Não confundir CLI Node funcional com seis motores completos.

## Estado prioritário — recuperação com ownership

CI 71bba20a7 passou: run 38981881975. Journal Linux ganhou claim transacional/fencing por token + identidade completa de processo/máquina/boot, eventos autenticados pelo dono original ou claim atual e token privado da raiz (.pie-owner). Novos campos default null preservam leitura de registros antigos, mas rootToken ausente impede afirmar ownership de raiz existente. Não inventar marca depois do crash. resourceRecovery.ts remove somente recursos comprovados, contêiner antes da raiz; creating sem ID visível permanece unknown/blocked, falha mantém claim e permite retry no mesmo dono. rootRemovedAt torna conclusão idempotente sem remover futuro diretório no mesmo caminho.

Local Windows validou bloqueio e lifecycle anterior; positivos Linux/recovery estão skipped aqui. CI ampliada: claim concorrente, token inválido, diretório substituído/marca alterada, processo real encerrado, cleanup retry (transporte simulado só em teste) e contêiner Docker real deixado por processo que termina no handshake created, antes de executar teste. Aguardar nova CI e corrigir falhas reais. Próximo: ligar journal obrigatório ao serviço/CLI de execução e recovery, finalizar registro de raiz removida no fluxo vivo, ligar persistência de resultado antes de liberação e jobs VERIFY. Recovery não retoma auditoria nem transforma interrupção em passed. Windows/macOS e recuperação de clientes Docker órfãos após crash ainda não comprovados; não anunciar suporte integral.

## Estado prioritário — journal local de recursos

CI a90af71c5 passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38981437126, com resultado Docker real persisted SQLite/Postgres e testes de imutabilidade. Novo VerificationJournal em execution/resourceJournal.ts, Linux-only, SQLite privado síncrono FULL, identidade de raiz dev/inode e processo start identity upstream, machine hash/boot. Registra prepared/creating/created/removed; eventos aguardados por DockerExecution antes do create e após identidade/cleanup. NodeVerification aceita options.journal, sem habilitar execução pública. Falha creating impede side effect do create; journal é dono da interpretação do registro.

Local Windows: seis aprovados+três skipped; typecheck/build/lint passaram. Novos testes de reabertura/processo real encerrado dependem da próxima CI Linux; Docker integrado passa a usar journal e conferir removed. Próximo: acompanhar CI e implementar recuperação com claim concorrente/fencing, revalidação de identidade do filesystem e do contêiner antes de remover; creating ausente continua unknown por handshake tardio. Não apagar raiz enquanto contêiner não tiver cleanup confirmado; não recuperar dono vivo ou unverified; não tratar estado skipped como passed. Registro de recursos é opcional e interno até integrar serviço obrigatório/journal seguro. Falta fechar journal com remoção da raiz e persistência de tentativa de recovery; não anunciar crash recovery completa. Goal integral/main permanecem ativos.

## Estado prioritário — persistência de runs e leitores

CI e8b041065 passou: run 38980754712, fluxo Git/cópia/Docker/evidência real. Nova migração 202610160003_verification_runs e model Prisma VerificationRun; gerar client antes de build/check. runContracts/runIntegrity são donos dos contratos/validação; adaptadores não importam NodeVerification. SQLite/Postgres gravam run+evidência em transação; validação de integridade e contexto compartilhada, triggers imutáveis, histórico paginado. CLI verification/verifications, MCP pie_verification_get/list e API GET /v1/verification/:id e /v1/verifications/:snapshotId disponíveis apenas para leitura. Nome MCP correto da lista: pie_verifications_list.

Teste real SQLite cobre replay, conflito, colisão de evidence ID com prova válida/rollback, bloqueio SQL update/delete, reabertura e consumidores CLI/API/MCP. CI adiciona pieRunPersistence com Postgres real e amplia fluxo Docker para salvar passed nos dois bancos. Aguardar CI do próximo commit; local não tem PostgreSQL/Docker positivo. Execução ainda interna: faltam journal/recovery de ownership, job de verificação, endpoint/CLI de grant, acompanhamento na UI e demais runners. Nunca liberar workspace enquanto contêiner pendente, nem repetir verificação após crash como se fosse retry seguro sem journal. Goal integral permanece ativo, main, sem branches.

## Estado prioritário — composição VERIFY

CI 9d3112418 passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38980404425, incluindo supervisor Docker real pass/fail/cancel. NodeVerification agora integra admissão+workspace+reporter/config privados+DockerExecution, retendo workspace até cleanup do contêiner confirmado. close cancela e aguarda atividade; retry conserva ownership. Deadline global inclui preparação. runEvidence cobre hash do registro inteiro (resultado, imagem, autorização, IDs, timestamps e cleanup), além de sealEvidence. Não há resultado persistido ainda. Testes locais nove aprovados+três skipped; CI do próximo push terá fluxo integrado real em pieVerification.test.ts.

Próxima dependência: persistir VerificationRun e evidência de teste de forma atômica, imutável e idempotente no SQLite/Postgres; validar vínculo com snapshot/revisão. Separar contratos puros do workflow antes de importá-los pela persistência. Adicionar histórico/leitura de runs compartilhados e journal/recovery de ownership antes de expor comandos de execução; não inventar remoção após crash. Input VERIFY é grant explícito por snapshot, sem execução host. Todos os motores/HTTP/Playwright de auditoria e correção/reteste continuam no escopo integral.

## Estado prioritário — supervisor de contêiner

CI 7ee7e1c75 passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38980024074, incluindo Docker real (plano/configuração e execução fixture). Novos dockerCommand.ts/dockerExecution.ts usam runOwnedCommand e supervisão de processos upstream para clientes, separados do recurso daemon-side. Endpoint local/executável/config explícitos, ambiente mínimo sem credenciais herdadas. Supervisor cria/inspeciona/valida antes de iniciar, normaliza saída real e retém owner se limpeza incerta. Close retry trata handshake tardio sem confundir list vazio com ausência enquanto create não confirmado.

Testes locais de lifecycle com spies passaram: incerteza e recuperação, cancelamento em finalização com remoção falhando e retry, config inválida e identidade estrangeira. Seis aprovados em três arquivos. CI real adiciona supervisor com pass/fail/cancel, aguardando novo push. Próximo: observar CI e corrigir divergências; integrar preparação+reporter privado+DockerExecution e journal/retomada de ownership, persistência de runs/evidências em SQLite/Postgres, comandos e contratos CLI/MCP/API antes do painel VERIFY. Caller tem obrigação de reter PreparedWorkspace enquanto cleanupOwner existir; isso ainda precisa ser imposto pelo serviço integrado. Não anunciar runner completo nem motores. Goal integral permanece ativo na main.

## Estado prioritário — plano e validação Docker

CI 935514f26 passou: run 38979741234. dockerPlan.ts gera comando fixo create e valida inspect antes de iniciar. Ownership por nome/token/ID é separado da validade. Limites, rede none, mounts readonly/nonrecursive, rootfs, UID, caps, env, comando, imagem e estado created conferidos. Testes de fixtures: pieDockerPlan, cinco aprovados somando NodeResults; DockerReal skipped localmente sem imagem explícita. CI passa a fazer pull somente para fixture Node 24.18.0-bookworm-slim, resolve digest, cria/inspeciona e executa teste real, cleanup por ID comprovado. Aguardar nova CI para corrigir eventual deriva do contrato real Docker; não tratar schema fixture como validação de provider.

Próxima etapa: supervisor real da aplicação com runOwnedCommand, imagem/daemon local selecionados, ownership recuperável após create tardio, cancelamento/deadline/cleanup retry e retenção da cópia até confirmar remoção do contêiner. Não há runner pronto exposto. Cópia agora usa arquivos 0444 dentro da raiz privada para UID sem privilégios. Persistência de auditoria/resultados e integração CLI/MCP/API/UI continuam pendentes; escopo integral preservado.

## Estado prioritário — resultados Node

CI a00018b9d passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38968901325. Caminho Linux da preparação privada validado, incluindo cleanup retry. Reporter próprio nodeReporter.ts usa eventos TestsStream, sem interpretar texto humanizado. nodeResults.ts possui protocolo JSONL estrito e normalização dos cinco estados; testes reais Node em pieNodeResults.test.ts. Não há executor Docker, persistência de runs, endpoints de execução nem fallback host. Arquivo vazio gera pass sintético no Node; resultado tratado como inconclusivo quando todos os casos têm identidade indistinguível de wrapper de arquivo. Não inferir testes registrados somente por saída zero.

Próximo trabalho central: provider Docker com ownership de contêiner/cliente separados, sem pull automático, limites e rede none, verificação da configuração real antes de iniciar, deadline/cancelamento/finalização e retenção de cleanup. Integrar resultados e evidências persistidas e depois CLI/MCP/API/UI. Goal integral segue ativo; todos os motores continuam pendentes.

## Estado prioritário — base de execução VERIFY

CI 38968024969 do commit 94e08801471e5393cfa4e3e7bc55108d23d46654 passou (PostgreSQL e painel paginado/trace Chrome Linux). Novos módulos internos src/pie/execution: grant Node VERIFY estrito (execução explícita, ambiente local, raiz/snapshot/treeDigest, imagem por digest, validade, testes e limites); admission usa Result e erros tagueados upstream; workspace usa PrivateRuntimeRoot e cópia de arquivos observados, por hashes, limites e cancelamento, sem executar alvo.

inventoryPath agora é dono compartilhado da recusa de links/caminhos fora da raiz. snapshotFiles é dono das identidades consumidas por integridade/comparação/preparação: rejeita caminhos duplicados e evidências de arquivo conflitantes. Supersedidas interpretações privadas removidas. Windows local não possui native/windows/build/manifest.json/rea-windows-x64.node: runtime privado retorna capability unavailable, corretamente; não declarar cópia positiva nesta máquina. CI Linux contém teste positivo real, mais regressões de link/limite/cleanup; aguardar o novo commit para evidência. Um teste usa falha de limpeza simulada exclusivamente em fixture Vitest e retoma close no dono real.

Não há comando/API/MCP de execução anunciados. Próximo passo: implementar provider Docker real sem pull automático, daemon local explicitamente selecionado, imagem inspecionada, rede none, caps removidas, usuário sem privilégios, rootfs somente leitura, tmpfs limitado e ownership de contêiner separado do cliente Docker. Reutilizar runOwnedCommand/ProviderProcess; preservar/reter cleanup se cancelamento ou handshake tardio falhar. Normalizar resultados reais (passed/failed/skipped/blocked/inconclusive) e persistir provas imutáveis antes de expor execução ao usuário. Node, outros test runners, HTTP, Playwright, todos os seis motores e correção/reteste seguem no escopo integral.

## Estado prioritário — navegação paginada e relações

CI da entrega b478b19b2: sucesso em https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38967326152, com PostgreSQL/Chrome Linux reais. Navegação agora percorre todas as páginas de projetos e histórico, preservando identidades selecionadas fora da página. Hook useProjectNavigation é dono dessas seleções; Dashboard/ProjectSelectors extraídos do App. Histórico começa na última página; comparação pode usar snapshot atual fixo e candidato de outra página.

TraceResult mostra nós e relações com evidências; paginação considera max(totalNós,totalRelações), pois o contrato pagina as duas coleções com mesmo offset. IDs são mostrados quando o rótulo do endpoint está fora da página, sem buscar tudo silenciosamente. Novos E2E reais: 51 descobertas, 27 projetos de fixture, comparação entre páginas, e 26 arquivos/650 imports com relações além do fim dos nós. Três E2E passaram; conferir validação final e push desta entrega. Advertências de tamanho/complexidade continuam em componentes; modularizar donos de consultas/views antes de expandir os fluxos de execução. Próxima dependência central do plano: runners VERIFY autorizados, isolamento/ownership e evidência real de execução, sem atalhos nem simular motores.

## Estado prioritário — painel local em validação

CI da quinta entrega passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38965547500 (8b5870a64882531ae377919f5f21b944fcf87112). Inclui PostgreSQL real com declarações e trace.

Painel em apps/web (React 18.3.1), build rolldown em scripts/build-pie-web.mjs, assets gerados em dist/pie-web e servidos por whitelist no loopback. Sessões em browserSessions.ts: cookies opacos HttpOnly/SameSite Strict, CSRF para operações, limite de sessões/expiração/tentativas, origem/Host exatos. API Bearer continua disponível; --api-only desabilita assets/sessões. Sem hospedagem externa, mocks, token no HTML/localStorage/sessionStorage ou execução de código auditado.

Teste Chrome real já passou individualmente com descoberta, evidência, declarações, trace, comparação, reload, logout e larguras 360/768/1024/1440. Capturas locais ignoradas em .cache/pie-web. Revalidação ampliada em andamento após ajustes de remount por snapshot e teclado; conferir resultado antes do commit. UI limita projetos a 200 e histórico aos últimos 50 com aviso; paginação integral, fluxo resolver/retestar e acessibilidade completa ainda pendentes. Plano integral permanece ativo; não declarar produto completo.

## Estado prioritário — quinta entrega

CI da quarta entrega passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38964648240 (0a7e01d0dd9eb3990c7cbabb4436f00cb8399d18). Banco real e adaptadores naquele commit validados no Linux. Não confundir com CI do próximo commit.

knowledgeGraph.ts combina arquivos/imports e declarações persistidas; adiciona declared_in, field_of e depends Compose somente com alvos únicos no mesmo arquivo. Trace compartilhado por PieService.trace, CLI trace, POST /v1/trace e MCP pie_graph_trace. Limites maxDepth/maxNodes/maxEdges, direção e paginação, coverage.scope recorded-relationships, discoveryStatus e runtime false. Não inventa execução nem cadeia UI→DB. Não relê fontes. Duplicatas de fatos idênticos na mesma linha consolidadas pelo coletor com limitação explícita.

Antes de publicar: última rodada ampliada tinha 51 aprovados+1 skipped, typecheck passou. Após ela foram fechados enums e ampliado teste PostgreSQL para trace; compilar/revalidar consumidores pertinentes e inspecionar próxima CI. T2.4 segue parcial; próximos eixos são relações de rotas/serviços e consulta escalável no backend, painel/execução/motores do plano. Goal ativo, main, commits/push autorizados, sem novas branches.

Fechamento local: compilação/typecheck integral passaram após ajustes finais; revalidação focada 6 aprovados+1 skipped; fronteiras em 2.022 fontes passaram. Lint do novo grafo/coletor/testes sem avisos/erros. Nenhuma dependência nova. Pronto para commit/push na main e acompanhamento do teste PostgreSQL ampliado na CI. Próximo turno deve conferir o status remoto atual, então avançar a investigação integrada/experiência e os módulos restantes do plano.

## Estado atual prioritário — quarta entrega

CI da terceira entrega passou: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38963487480, head d78d53ae255354d3983ec7964c7a0917d989130a. Migrações e teste dedicado de PostgreSQL real executados no Linux; não repetir como bloqueio global. Docker local ainda não está funcional. Sete gaps de notices continuam abertos para redistribuição.

Descoberta agora coleta declarações estáticas de manifests Node/Composer, Compose, OpenAPI 3.0/3.1 e model/campos Prisma. Código em src/pie/adapters; identities/evidências compartilhadas com integridade do snapshot. Novos campos declarations (default vazio para histórico) e declarationCount; consulta paginada CLI declarations, API /v1/declarations/:id e MCP pie_declarations_list. Não há parser PHP/Nginx, resolução $ref nem execução de serviços. Exports JSON contêm fatos; MD/HTML ainda são inventário de arquivos. Testes integrados novos em pieAdapters.test.ts e consumidores CLI/MCP/API.

Antes do push: confirmar typecheck final e suíte ampliada. Próximo eixo: completar inventário/trace de relações (rotas/serviços/tabelas) e paginação PostgreSQL de fatos/grafo, depois painel com dados reais; seguir os seis motores e runners do plano sem reduzir escopo. Goal permanece ativo na main.

Fechamento local: 50 aprovados + 1 skipped em 9 arquivos; compilação PIE, typecheck integral e fronteiras em 2.021 fontes passaram. Novo teste em pieAdapters possui 3 cenários integrados. Nenhuma dependência nova. Preservada idempotência de snapshots legados sem campo declarations. Código pronto para publicar na main e monitorar a nova CI. Próxima etapa deve construir relações rastreáveis e experiência de investigação real, mantendo o escopo integral aberto.

## Histórico da terceira entrega

## Estado atual prioritário — terceira entrega

Continuar na main, sem novas branches. PostgreSQL/Prisma e duas migrações implementados em prisma/, postgresStore.ts e jobs/postgresQueue.ts; modo SQLite preservado por PiePersistence. Geração Prisma obrigatória antes de typecheck/build, já integrada nos scripts. Não há conexão padrão: PIE_DATABASE_URL habilita PostgreSQL explicitamente. Banco local real não validado: Docker Desktop iniciado, daemon retorna HTTP 500. Workflow .github/workflows/pie.yml preparado para banco real; conferir resultado depois do push.

Fila persistente integrada por CLI e API: enqueue/job/cancel-job/work e /v1/jobs. Worker processa um job OBSERVE por invocação, com escopo de raiz canônica, sem execução do alvo. Testes cobrem leases, idempotência, recuperação, cancelamento, worker antigo, raiz diferente, recibo e reabertura. Validação de integridade de snapshots centralizada e digest conferido na gravação/leitura. Leitura de serviços agora participa do encerramento assíncrono.

Última suíte ampliada: 47 passaram + 1 skipped (PostgreSQL real). Corrigida depois diferença Windows DOS8.3 no produtor (realpathSync.native); revalidar suíte final e typecheck antes do commit. Licenças/inventário atualizados de tarballs verificados; sete gaps de notices explícitos em THIRD_PARTY_NOTICES.md e relatório. Não declarar redistribuição legal completa. Goal permanece ativo. Próximo eixo após validação de storage/jobs: acesso paginado ao grafo no backend PostgreSQL, contratos Result/erro, adaptação multi-stack e painel com dados reais. Runners e seis motores seguem pendentes.

Fechamento: suíte final depois da correção DOS8.3 passou (47 + 1 skipped); typecheck integral passou. Lint sem erros, 14 warnings ainda abertos. Inventário consistente. Código pronto para commit/push na main; depois inspecionar workflow PIE integration para PostgreSQL real. A fila local foi exercitada por CLI e API; worker é de um job por invocação. Para os próximos módulos, não confundir isso com daemon persistente nem execução sandbox de testes.

## Histórico das entregas anteriores

Leia PIE_MASTER_PLAN.md, UPSTREAM_REA_AUDIT.md e PIE_VALIDATION_REPORT.md antes de continuar.

Base upstream: 4838f444939677107902549c59b73439e14d3ae9. Branch atual: main (a branch inicial foi renomeada, sem criação de outra). Usuário autorizou commit e push direto na main e pediu que não se criem novas branches. Pasta real: C:/Users/Usuário/Desktop/PIE-ProjectIntelligenceEngine; "workspace" era somente terminologia da sessão, não outro diretório. Blueprint integral em docs/blueprint. Origin não pertence à rede GitHub de forks (fork=false); preservar a distinção entre derivação com histórico e fork registrado no GitHub.

Implementado em src/pie: contratos, políticas puras, inventário Git limitado, leitura com detecção de alterações, evidências SHA-256, grafo de imports relativos AST Babel, impacto reverso, armazenamento SQLite local externo ao alvo, CLI e cinco ferramentas MCP. O serviço cancela e aguarda descobertas antes de fechar o banco. Nenhum runner de alvo habilitado.

Runtime compatível local: C:/Users/Usuário/AppData/Local/npm-cache/_npx/4aa47c519def57bc/node_modules/node/bin/node.exe (24.18.0). npm ci --ignore-scripts executado com esse Node e npm global 10.9.2; npm 11.16.0 do manifesto ainda não foi usado. 540 pacotes instalados, lockfile preservado salvo adição de bin pie. Não repetir instalação sem necessidade.

Validação: compilação PIE e compilação TypeScript build upstream passaram; 43 testes selecionados passaram (27 evidence REA, 9 ledger REA, 6 fundação PIE, 1 CLI/MCP stdio PIE). Typecheck integral pós-alterações em andamento na última verificação. Lint apontou warnings de tamanho/complexidade em discovery/cli; erro de tamanho de describe foi corrigido separando escopos. Revalidar lint após correção.

Fechamento: typecheck integral passou; lint focado passou sem erros e com quatro warnings; diff --check passou nos arquivos rastreados. Novos arquivos permanecem não rastreados, sem commit/push.

Próximas ações: concluir revisão de lifecycle/contratos (outputs MCP ainda genéricos), migrar falhas esperadas para Result, reduzir complexidade de discovery/cli, caracterizar CLI/MCP REA completos via build empacotado, adicionar comparação real de snapshots e impacto consultável por CLI/MCP. Depois persistência PostgreSQL/Prisma, jobs, API e painel conforme plano integral. Os seis motores, runners, PostgreSQL e painel continuam pendentes. Não declarar produto completo.

Atualização da segunda entrega: comparação/impacto implementados em compare.ts e expostos CLI/MCP/API; outputs MCP agora explícitos (outputContracts.ts). API local Bearer em api.ts com bloqueio de Origin, raiz fixa, limites de corpo/conexões e descoberta compartilhada. Exports reais JSON/MD/HTML em reports.ts, sem dados inventados. 45 testes selecionados passaram. `tsc --noEmit` precisa da rodada final após API. Docker daemon não acessível; não iniciar instalação privilegiada nem afirmar PostgreSQL validado. Próximos passos válidos: contratos Result, refatorar warnings, backend PostgreSQL/Prisma e fila persistente, depois API completa/painel e motores. A lista anterior de próximos passos descreve o ponto inicial da entrega e está parcialmente superada por esta atualização.

Fechamento da segunda entrega: typecheck integral e build TypeScript passaram após API; fronteiras em 2.004 fontes passaram; registro de digests e bundle upstream passaram. CLI REA --help executada com sucesso. MCP REA stdio conectado por cliente real retornou 207 ferramentas. Baseline de inicialização/catálogo comprovado; execução de provedores ainda não. Continuar na main, sem criar branches novas; commits e push autorizados pelo usuário. Nenhum percentual de conclusão integral foi afirmado.

## Continuação — cache incremental PIE — 17/10/2026

Entregue e validado cache LRU de parsing AST/declarativo com invalidação por conteúdo/versão/orçamento, limites explícitos, teste Git real e Evidence renovada por snapshot. `pie:build`, `check:fast` e 17 testes boundary focados passaram no toolchain pinado. Medição no repositório: 4.246 arquivos, frio 24,972 s/20,827 s CPU; aquecido 14,834 s/12,126 s CPU, cache 4.240 hits; cobertura parcial no orçamento de 50 MB. Pico RSS Node 429 MiB; subprocessos Git não amostrados. Persistência por commit e cache de grafo ainda pendentes; T2.4 continua parcial. Ver `PIE_MASTER_PLAN.md` e `PIE_VALIDATION_REPORT.md` para limites e detalhes.

## Continuação — mounts Express entre arquivos — 17/10/2026

Feita primeira integração cross-file com escopo explícito: imports relativos default/named, router exportado literalmente e mount literal passam a gerar aresta `calls` com três Evidence verificadas; trace alcança o endpoint no módulo importado. Prefixo não é apresentado como rota pública composta. 23 testes boundary passaram, incluindo persistência/reabertura SQLite, adulteração de Evidence e export não-router; build PIE, `check:fast` e `docs:check:built` passaram. Medição frio/quente e limitações estão em `PIE_MASTER_PLAN.md` e `PIE_VALIDATION_REPORT.md`. Permanecem pendentes reexports, namespaces, CommonJS/require, composição do prefixo no nome da rota e integração UI/API/DB abrangente. Trabalhar a seguir na expansão do resolver com testes/proveniência, mantendo incertezas explícitas.

## Continuação — composição do prefixo Express — 17/10/2026

Prefixo literal cross-file compõe endpoints exportados, incluindo router local aninhado, com Evidence da rota e do arquivo/linha do mount em proveniência v3 (`sourcePath`). Snapshots v1/v2 seguem aceitos. Closure cíclica não é composta; rota local é preservada com limitação. Após a guarda passaram `pie:build`, `check:fast`, `docs:check:built`, `format:check`, 21 boundaries e `pieWebTrace` (1). Medição única do código final: frio 23,897 s/19,578 s CPU; quente 12,711 s/10,688 s CPU; 4.273 enumerados/4.248 examinados, 49.999.473 bytes, parcial, 4.242 hits quentes, 16.150 arestas/372 declarações; pico RSS Node 510,6 MiB. Sem subprocessos Git/família/tokens; rodada não controlada. Sem runtime Express real; CI pendente. Alterações não commitadas/pushadas; seguir direto na `main`.

CI consultada na API pública para SHA `1f4ea65c9f2e34c2f4c92c58e04b207afdef7f64`: PIE integration e Release ainda `in_progress`; CI geral `queued`. Não declarar CI aprovada. `gh` CLI não está instalado; a consulta REST funcionou.

Na consulta seguinte, PIE integration terminou com falha no passo “Verify installed browser and panel”; a API pública não fornece o log detalhado sem permissão administrativa. Release Please falhou pela configuração do repositório que não permite Actions criar/aprovar pull requests; a publicação foi pulada. CI geral permanecia em fila. Não inferir a causa da falha do browser; retestar no novo SHA e manter a anterior como não resolvida.

## Continuação — Result de erro de sintaxe AST — 17/10/2026

`readCodeFactsResult` converte somente `BABEL_PARSER_SYNTAX_ERROR` em `Result` tagged `invalid_syntax`; falhas inesperadas relançam. `discoverProject` mantém o nó inventariado, registra limitação e não inventa relações. Build PIE, `check:fast`, `docs:check:built`, `format:check` e boundaries `pieAdapters`/`pieFoundation` (16) passaram. T1.1 continua parcial; adotar Result em todas as falhas esperadas ainda pendente.

## Continuação — reexports de routers Express — 17/10/2026

ESM relativos `export ... from` são seguidos recursivamente até router local único. `calls` aponta para o relay inicial; `depends` existentes mantêm o caminho até o endpoint terminal. `validateSnapshot` exige que Evidence do reexport tenha dependência AST correspondente. Cadeia de dois relays/trace e ciclo passaram nas boundaries (17/17); `pie:build`, `check:fast`, docs/formatação passaram. CI do SHA e commit ainda pendentes. T2.2 permanece parcial.

Medição única após o reexport: frio 29,676 s/22,875 s CPU; quente 13,781 s/11,437 s CPU; 4.273 enumerados/4.250 examinados, 49.999.686 bytes, cobertura parcial, cache 4.244 hits/2.968.772 bytes retidos; pico RSS cumulativo 513 MiB. Anterior: 23,897/19,578 s frio e 12,711/10,688 s quente; diferença observada (+24,2%/+16,8% frio, +8,4%/+7,0% quente) não é causal, pois foi uma rodada única sem controlar conteúdo/carga. Família Git e tokens não medidos.

CI pública observada do commit anterior `4b69794de`: PIE integration passou (39013301108), Release falhou pela política de criação de PR do Actions, CI geral estava em execução. A falha de browser no SHA `1f4ea65c9` foi superada pelo integration success posterior; a origem histórica não foi apurada por falta de acesso aos logs privados.

## Continuação — falhas tipadas nos parsers declarativos — 17/10/2026

Commit-base `4e6d06d5a34f422ce200176912eceb63ca151d92`; implementação publicada em `b3e03b83c8c59374a59c0ce89bb9a2369a232c46`. `readDeclarationsResult` retorna `invalid_syntax`, `invalid_structure` ou `unsupported_format` para rejeições esperadas de JSON/YAML/Prisma/Nginx/OpenAPI. O conversor de Evidence já não mascara falhas internas; a descoberta só omite erros conhecidos de I/O/política e relança os inesperados. Fixture Git real cobre arquivo removido após stage.

Validação: `pie:build`, `check:fast`, `docs:check:built`, `format:check`, `git diff --check` e 16 testes nas boundaries `pieAdapters`/`pieExpressCrossFile` passaram. Goal integral segue ativo; T1.1 permanece parcial. CI no novo SHA ainda não apareceu na API pública durante esta consulta.

## Continuação — adapter Laravel/PHP por AST — 17/10/2026

`php-parser@3.7.0` adicionado como dependência runtime; parser BSD-3-Clause, sem dependências runtime declaradas. `readDeclarations` chama `readLaravelDeclarations` somente em `routes/**/*.php`; contratos incluem o adapter `laravel-php`. Rotas diretas, `any`, `match` literal e grupos/prefixos literais fluentes ou em array geram Evidence estática. Imports/aliases são delimitados por namespace; funções/classes não são contadas. Sintaxe rejeitada vira `invalid_syntax`; não há execução PHP.

Limites explícitos: resource/apiResource, aliases não observados/ambíguos, rotas dinâmicas, chamadas fluentes fora de groups, efeitos condicionais, middleware/autorização, providers/includes, handler/registro/runtime. Teste exato `node scripts/run-exact-tests.mjs tests/boundary/pieAdapters.test.ts`: 10/10. `pie:build`, `check:fast`, `docs:check:built`, `format:check`, `git diff --check` passaram. Refresh legal validou os tarballs de dependências e completou notices sem gaps; app real e custos de desempenho PHP não medidos. T2.3 segue parcial.

Precisão de versão: php-parser foi configurado com gramática PHP 8.4; invalid_syntax significa rejeitado por esse parser/versão, não uma afirmação sobre qualquer outra versão PHP.

## Continuação — falhas tagged na descoberta — 17/10/2026

`discoverProjectResult` converte somente falhas previstas em tags e deixa falhas inesperadas propagarem; `PieService` traduz as tags mantendo a razão original de cancelamento do sinal. Build PIE e boundary de fundação passaram (11 testes) no Windows. Cobertura desta rodada: input inválido, caminho ausente e cancelamento prévio. Result ainda não foi uniformizado nos demais serviços/runners; T1.1 segue parcial.

A validação inicial de política em `PieService.discover` também foi ajustada para produzir `PieError(INVALID_INPUT)` estável. Regressão de serviço com SQLite real passou dentro dos 12 testes de `pieFoundation`.

A resolução inicial da raiz em `PieService.discover` agora converte errnos esperados em `PieError(IO_ERROR)`; erro não reconhecido continua propagando. Teste com SQLite confirma que raiz inexistente não cria projeto parcial. `pie:build` e `pieFoundation` passaram (13/13); T1.1 permanece parcial.

Revalidação T1.3 (Windows): `node scripts/run-exact-tests.mjs tests/boundary/pieJobs.test.ts` passou, 4 testes e 1 skip Linux-only. A cobertura inclui daemon contínuo real, OBSERVE/VERIFY, leases, recuperação de worker perdido e recusa de resultado antigo. O teste de CLI subprocesso Linux e PostgreSQL não foram reexecutados nesta rodada; T1.3 segue parcial.

T2.2: `readCodeFacts` reconhece imports ESM dinâmicos somente quando o specifier é string literal. Aresta e Evidence mantêm arquivo/linha e `syntax=dynamic`; imports calculados continuam limitação. Validadores de snapshots aceitam a marca nova e preservam Evidence histórica. Build PIE e três boundaries (`pieFoundation`, `pieAdapters`, `pieExpressCrossFile`) passaram, 31/31. CommonJS cross-file e aliases continuam sem resolução.

T2.2 agora também extrai `require("literal")` com Babel scope e exclui `require` sombreado; Evidence usa `syntax=commonjs`. Composição de rotas Express por CommonJS permanece desconhecida. `@babel/traverse@8.0.4` é dependência direta alinhada ao parser/types pinados e os notices runtime foram regenerados, sem gaps. Rebuild Node 24.18.0 e boundaries foundation/adapters/Express cross-file passaram (31/31).

T2.2 CommonJS: composição Express cross-file cobre requires top-level literais para export `default` (`module.exports = router`) e alguns exports nomeados estáticos (`exports.router`, `module.exports.router`, objeto literal); bindings sombreados/dinâmicos, reexports CJS e chamadas aninhadas permanecem desconhecidos. Teste Git real valida rota composta, três Evidence, snapshot e trace; 32/32 foundation/adapters/Express cross-file passaram e `pie:build` passou.

Reteste final acrescentou negativa ESM→CommonJS: nenhuma chamada/rota composta, limitação preservada e snapshot íntegro. Suíte focada agora 33/33 em `pieExpressCrossFile`, `pieAdapters`, `pieFoundation`.

# Continuação — Grant VERIFY v2 e identidade de caminho Windows (17/10/2026)

Foi adicionado grant discriminado v2 com bindings explícitos teste→declaração: arquivo precisa estar no grant e declaração no snapshot; duplicatas são recusadas. V1 permanece aceito. O registro/evidence digest preserva o grant completo, mas binding continua declarado e não equivale a cobertura comprovada. O teste Windows encontrou contorno do isolamento quando a mesma raiz era apresentada como nome Unicode longo e caminho 8.3; a fronteira de cópia agora usa `realpathSync.native`, e a regressão verifica que preparar workspace dentro do alvo é recusado. `check:fast`, `pie:build`, `toolSchemaValidity` (15/15), boundaries (8 passou, 3 skips por plataforma/Docker), formato e gate docs passaram. Próximo: expor bindings declarados com semântica explícita na comparação e avançar para cobertura funcional real; T4.1 não está completo.

# Baseline local de segurança — 17/10/2026

Plano e relatório em `docs/SECURITY_IMPLEMENTATION_PLAN.md` e `docs/SECURITY_VALIDATION_REPORT.md`. API/jobs: 6 pass e 1 PostgreSQL skip; sessões: 3 pass. Cobertura limita-se à API/painel PIE local, sem SAST/SCA/segredos, pentest, multi-tenant ou conclusão LGPD. T4.3 permanece pendente; próximo passo é matriz rota × identidade × escopo × efeito e testes negativos relacionados.

# Painel de Produto/UX — 17/10/2026

# Isolamento de raízes da API histórica — 17/10/2026

Dois repositórios Git reais na mesma base SQLite reproduziram acesso cruzado: GET autenticado `/v1/graph/:snapshotId` retornava `200` para o segundo projeto. As rotas históricas agora validam snapshot/projeto proprietário antes da resposta; `/v1/projects` filtra e pagina em SQL pela raiz autorizada, sem percorrer dados de outras raízes. Boundary de escopo e API/jobs: 7 testes passaram, 1 PostgreSQL skipped sem `PIE_TEST_DATABASE_URL`. O adapter PostgreSQL implementa ownership, ainda sem ensaio em banco real. SEC-03 segue em validação; próximo incremento deve testar persistência PostgreSQL com a lane de CI configurada e manter o acesso cruzado como regressão permanente.

# CI de browser após o isolamento — 17/10/2026

`PIE integration` 39062375429 falhou na etapa “Verify installed browser and panel”. A causa foi confirmada no teste `pieWeb.test.ts`: esperava navegar projetos de outras raízes e fazia 51 descobertas reais em sequência, estourando o timeout. O teste agora usa um snapshot real e cópias sintéticas válidas no SQLite (Evidence com IDs/hash próprios, conteúdo preservado), verifica o projeto autorizado e mantém a comparação/paginação real do painel. A etapa local passou (6 testes passaram; 1 cenário VERIFY skipped por configuração). A boundary PostgreSQL exercita `project`, paginação de `projectsForRoot` em duas raízes e associação Evidence→snapshot. `PIE integration` 39063676154 passou no SHA `b7f9d53b3`, incluindo jobs PostgreSQL/browser e conjunto full PIE. CI geral 39063676211 estava pendente. Release 39063676287 falhou no passo Release Please; logs públicos retornaram 403 e a causa é desconhecida. Manter T4.3 parcial; próxima prioridade independente é avançar os motores estáticos de segurança/LGPD/receita e acompanhar CI geral.

O painel consome o relatório `product` de forma real, com seleção de módulo e paginação; abre Evidence vinculada e expõe origem/hash/limitações usando o endpoint de leitura existente. Boundary Playwright real do PIE (1/1) passou com login local, Evidence e hash consultados, troca de escopo e viewports 360/1440 sem overflow. Não contém mock nem inventa jornada, fricção ou recomendação. `check:fast`, `pie:build`, typecheck direto de `apps/web`, format check e boundaries CLI/API/MCP passaram. Próximo: obter decisão de escopo de mantenedor para integração de captura Playwright que executa o alvo; enquanto isso, aprofundar motores estáticos de T4 sem marcar jornada observada.

## Revisão estática inicial de credenciais — 17/10/2026

`security-review` integra credenciais, sinks diretos JS/TS, duas configurações literais de TLS desativado (`rejectUnauthorized: false` e `NODE_TLS_REJECT_UNAUTHORIZED=0`) e superfícies de autorização declaradas ao PieService, CLI, API e MCP. Findings incluem condição, impacto potencial, probabilidade não avaliada, reprodução/remediação/regressão propostas e verificação não executada. Credenciais exigem hash atual igual à Evidence e nunca retornam valor; rotas ficam `unverified`. Duas boundaries cobrem canários, paginação, stale digest, limite de findings, AST ignorando comentário/string/sombreamento, detecção de TLS literal desativado sem alertar `true`, endpoint Express, paridade CLI/API/MCP e schema MCP. A boundary local passou nesta revisão; CI remota deste SHA ainda não foi consultada. T4.3 é parcial; taint/authorization runtime, multi-tenant, receita, SCA, LGPD e outros riscos seguem abertos.

# Doctor operacional PIE — 17/10/2026

`doctor` executa sondagens read-only de Node/Git, SQLite existente, daemon Docker e PostgreSQL configurado, sem listar capacidades fixas como se fossem verificações. Boundary `pieDoctor.test.ts`: 2/2; banco válido manteve tamanho e mtime, caminho inexistente não foi criado e URL/credenciais PostgreSQL foram omitidas. PostgreSQL sem `PIE_TEST_DATABASE_URL` não foi exercitado como backend real nesta máquina; a boundary usa endpoint local indisponível somente para provar redação. O resultado PostgreSQL positivo ainda verifica apenas conexão e `pie_projects`. Compose, migrations completas, Windows/Linux/macOS e rollback continuam pendentes; T6.2 segue parcial.

# Plano unificado inicial — 17/10/2026

`PieService.plan`, CLI `plan`, POST `/v1/plan` e MCP `pie_plan_generate` compõem itens paginados dos resultados atuais dos motores funcional, produto, segurança e dados, cada um com referência à Evidence, aceite proposto, owner desconhecido e prioridade não avaliada. A boundary `pieUnifiedPlan.test.ts` passou (1/1), com paridade dos quatro adapters, schema Ajv e digest independente da página. Infra/regressão aparecem como `not_implemented`; nada é aceito, executado ou persistido. T5.1 é parcial: falta persistir alterações de owner/status, contestações fundamentadas e histórico append-only. A cobertura global não foi executada nesta etapa.

Continuação: contestação de item foi implementada em PieService/PiePersistence, SQLite v5 e migration PostgreSQL `202610170002_plan_contestations`. CLI `plan-contest <request.json>`, POST `/v1/plan/contest`, MCP `pie_plan_contest` e consultas paginadas/listagem por digest preservam justificativa, Evidence, snapshot do item, data e hash. Mesmo ID/intenção retorna o evento original; tentativa de substituição falha. A boundary exercita SQLite real e adapters; PostgreSQL real local não verificado por ausência de `PIE_TEST_DATABASE_URL`. Owner/status editáveis e interface web foram implementados em fatias posteriores; motores infra/regressão permanecem pendentes.

Continuação: `plan-triage` v2 preserva owner/status e notas humanas 1–5 de impacto/risco/esforço em eventos append-only com hash; mantém leitura de eventos v1 e usa Evidence do mesmo snapshot. Em 18/10/2026, o usuário confirmou impacto → risco → menor esforço. A ordenação é lexicográfica (impacto desc., risco desc., esforço asc., ID estável); sem avaliação fica depois das notas completas e não há pontuação automática. Testes boundary SQLite validam ordenação/digest/evidence; E2E no Chrome real registra prioridade, owner/status e contestação pela interface, conferindo persistência. O plano continua `unverified`; estado `completed` não comprova funcionamento. PostgreSQL usa migration `202610170003_plan_triage_events`, ainda sem teste real local; motores infra/regressão continuam em aberto.

## Exportação do plano unificado — 17/10/2026

CLI `plan-export`, GET autenticado `/v1/plan/export` e MCP `pie_plan_export` agora exportam JSON/Markdown/HTML a partir da projeção compartilhada do `PieService.plan`, incluindo a ordenação/triagem humana atual e sem alterar `planDigest`. Páginas UTF-8 têm hash/tamanho do documento completo; coleta detecta páginas inconsistentes, duplicadas ou incompletas. `npm.cmd run pie:build` passou; boundary `pieUnifiedPlan.test.ts` passou 2/2 com SQLite/Git reais, paridade de adapters, schema MCP Ajv, API sem token, prioridade humana e JSON paginado em bytes. PostgreSQL não foi executado nesta rodada; exportação de outros registros segue pendente.

Continuação: `plan-item-history-export` integra CLI, GET autenticado `/v1/plan/item-history/export` e MCP `pie_plan_item_history_export`, reunindo triagem v1/v2 e contestações append-only por item após revalidar hashes, Evidence e revisão. JSON/Markdown/HTML têm paginação UTF-8. `pie:build` e boundary `pieUnifiedPlan` passaram; ver relatório para comandos e limites. PostgreSQL não executado localmente.

Continuação: T4.4 tem inventário estático integrado no planejamento e painel. `infrastructure-review` inclui serviços/dependências Compose, imagem, portas, política de reinício, presença de healthcheck e valores declarados de réplicas/CPU/memória/PIDs, além das diretivas Nginx parseadas com Evidence. O comando do healthcheck não é retido; todos os fatos seguem `unverified` e os indicadores de runtime `NOT_MEASURED`. A boundary e o Chrome real passaram. Não declarar análise de VPS completa: aplicação real dos limites, processo/container efetivo, volumes, carga controlada, p95/p99, baseline comparável e rollback operacional aguardam ambiente/prova adequados.

Continuação: `fix-handoff <snapshot> <planDigest> <item>` fornece pacote JSON/Markdown/HTML para agente receptor a partir do item atual do plano, com Evidence preservada, arquivos/relações observados, critérios e limitações. CLI, GET autenticado e MCP usam o mesmo serviço; texto do projeto fica marcado como dado não confiável, nenhum comando é inferido/executado e patch/branch não são criados. T5.2 fica parcial até integração real com agentes, patch isolado, aprovação sensível e ciclo comprovado de correção/reteste.

Continuação T4.3: o adapter YAML agora emite Evidence por linha para `permissions: write-all` literal no topo de workflows GitHub Actions; o scanner usa somente o fato parseado e exige hash atual igual ao snapshot. `read-all`, permissão granular de job e workflow alterado após descoberta não geram esse finding. `pieSecurityReview` + `pieAdapters` passaram 13/13. A suspeita não confirma workflow ativo, token ou escopo efetivo; análise de fluxo, SCA, autorização, LGPD e receita seguem pendentes.

## Continuidade — Result no motor de infraestrutura — 17/10/2026

`reviewInfrastructureResult` acrescenta tags para entrada inválida, snapshot inválido e identidade divergente; apenas falhas esperadas são convertidas. `PieService` usa essa fronteira compartilhada e mantém o wrapper necessário ao plano. Findings seguem `unverified`; runtime/medições continuam explicitamente não observados. `pieInfrastructure` e `pieUnifiedPlan`: 3/3; `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. T1.1 permanece parcial.

Continuidade do T1.1: motor de produto/UX recebeu `assessProductResult`; a fronteira usa tags para entrada/snapshot inválidos e divergência, com tratamento especial para caminho não canônico. `pieProduct`, `pieUnifiedPlan` e `pieAdapters` passaram 14/14. `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. T4.2 continua parcial e não há evidência de jornada observada.

Continuidade T1.1/T4.3: motor de segurança agora expõe `reviewSecurityResult` assíncrono e consome-o pelo `PieService`; falhas de entrada/snapshot/identidade são tags, enquanto falhas internas do scanner não são ocultadas. `pieSecurityReview` e `pieAdapters` passaram 13/13. `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. Findings continuam suspeitos e redigidos conforme o contrato.

Continuidade T1.1/T4.5: `compareVerificationRunsResult` tipa schema inválido, cada histórico inconsistente e recusa por escopo/ordem. A fronteira do serviço preserva a leitura dos mesmos registros persistidos e o comparador não reexecuta runs. `pieRegressionResults` passou 2/2; `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram.

Continuidade T1.1/T3.1: `planRetestsResult` tipa input invalido, snapshot invalido e escopo recusado, mantendo `selectRetestCandidates` compartilhado com a revalidacao do grant. `pieComparison` e `pieRetestAdmission` passaram 4/4; `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. O plano permanece sem autoridade de execucao.

## Continuidade — Result em revisão de dados — 17/10/2026

`reviewDataResult` adiciona tags para input, snapshot e identidade divergentes; somente falhas esperadas são convertidas e erros internos continuam propagando. `PieService` converte as tags para erros do domínio e mantém os contratos CLI/API/MCP. `npm.cmd run test:focused -- tests/boundary/pieDataReview.test.ts tests/boundary/pieUnifiedPlan.test.ts` passou: 2 arquivos, 3 testes. Build PIE, `check:fast`, `format:check` e `docs:check` também passaram. T1.1 segue parcial; não declarar uniformidade global.

Continuation T1.1/T1.2: VERIFY export uses `exportVerificationResult`; invalid input, invalid historical run, and mismatched ID are distinct. `pieRunPersistence` SQLite/adapters passed; PostgreSQL skipped without `PIE_TEST_DATABASE_URL`. Focused test, `pie:build`, `check:fast`, `docs:check`, `format:check`, and `git diff --check` passed.

## Continuidade — doctor do PostgreSQL — 18/10/2026

Doctor e `openPersistence` passaram a exigir a presença das 11 tabelas do schema Prisma por consulta somente leitura a `information_schema`. Teste focado `pieDoctor` passou 3/3; `check:fast`, `format:check`, `docs:check` e `git diff --check` passaram. Sem PostgreSQL de teste nem Docker local, a integração real segue pendente; a sondagem não confirma colunas, índices ou migrations aplicadas. Próxima frente: continuar critérios pendentes de setup/Compose, workers ou motores conforme o plano mestre, sem marcar T6.2 concluída.

## Continuidade — contratos da fila persistente

A fila agora valida de forma idêntica as durações de lease em `claim` e `heartbeat` para SQLite/PostgreSQL: inteiros seguros entre 100 e 300.000 ms. `pieJobs` passou 4 testes e pulou 1 cenário Linux-only; PostgreSQL real segue sem validação local por falta de `PIE_TEST_DATABASE_URL`. Próximo: continuar a matriz de lifecycle e execução isolada dos jobs, distinguindo sempre as regressões SQLite da prova PostgreSQL real.

## Continuidade — facts de UNIQUE no motor de dados

O parser de migrations registra colunas literais de índices/constraints UNIQUE no snapshot e deixa expressões desconhecidas sem lista de colunas. `pieDataReview` + `pieAdapters`: 12/12 passaram. A próxima etapa do motor precisa alinhar esses facts aos seletores Prisma com mappings explícitos, mantendo incompletude para sintaxe desconhecida. Não houve validação de PostgreSQL runtime nem cálculo do estado final de migrations.

## Continuidade — comparação de seletores de dados

Contrato `data-review` schemaVersion 5 compara colunas Prisma únicas/primárias aos facts SQL com Proveniência e mappings literais; distingue alinhado observado, mismatch observado, não observado e inconclusivo. `pieDataReview` + `pieAdapters`: 12/12 passaram com Git/SQLite; inclui PK/UNIQUE composta, `@map`, mismatch e expressão funcional não comparável. Revalidar gates completos após atualização dos documentos; não houve PostgreSQL runtime. Na data desta entrada o painel ainda não apresentava Data Review; a integração consta na continuação seguinte. Migrations seguem sem cálculo de estado final, e T4.5/T1.5 permanecem parciais.

Continuação: Data Review já aparece na investigação web do snapshot, com cobertura, fatos esperados/observados, relações, limitações, paginação e links para Evidence. pie:web:typecheck, pie:web:build e pieWeb passaram; Chrome Windows validou o percurso sobre schema/migration de fixture Git/SQLite. PostgreSQL runtime e estado final de migrations seguem não verificados; T1.5/T4.5 permanecem parciais.

Gates desta integração aprovados: check:fast, format:check, docs:check, pie:web:typecheck, pie:web:build, pieWeb em Chrome (4 passaram/1 Linux-only skipped) e git diff --check. Ledger global segue complete=false; continuar pelas pendências do plano mestre.

Continuação T6.1: export Data Review JSON/Markdown/HTML paginado UTF-8 disponível pelo serviço, CLI, GET autenticado e MCP; agrega páginas, verifica consistência/sha256 e inclui treeDigest e Evidence, mantendo unverified. pie:build e pieDataReview passaram (Git/SQLite; Ajv). PostgreSQL runtime, estado final de migrations, demais exports e CI geral seguem pendentes.

## Próxima frente — cobertura estática de dependências Git — 18/10/2026

`package.json` produz fatos redigidos para dependências Git e `package-lock.json` v2/v3 confirma somente pin direto com spec idêntica e `resolved` em SHA completo. `security-review` exige Evidence/hash atual em ambos os arquivos; divergência e lock stale mantêm finding. A saída estrita usa schemaVersion 2 e anuncia `supplyChainPatterns: partial`. Boundary Git/SQLite testa vínculo, mismatch, stale lock, SHA de 40/64 no manifesto, versão registry, não vazamento da URL e paridade CLI/API/MCP. `pieSecurityReview` + `pieAdapters`: 13/13. `npm audit --offline --json`: 0 findings em 902 dependências segundo cache local, cuja atualidade não foi verificada. Próximo: avaliar integração de npm audit só via workflow VERIFY explicitamente autorizado e resultado com frescor desconhecido; outros lockfiles continuam pendentes. PostgreSQL e consultas remotas não foram envolvidos.

## Próxima frente — actions GitHub sem SHA — 18/10/2026

Parser YAML produz facts para `uses` remoto em job reutilizável e em steps sem SHA completo, mantendo só hash da referência, job e linha. Evidência Git/SQLite via `pieSecurityReview` + `pieAdapters` cobre `@main`/`@v4`, pin SHA, action local, Docker e expressão dinâmica: 13/13. Serviço reporta findings supply-chain com schemaVersion 3, Evidence atual, não execução e não divulgação da referência, em paridade CLI/API/MCP/Ajv. O finding público genérico distingue a condição de workflow reutilizável da action de step. Nenhum workflow/action externo foi consultado ou executado. Próximo: considerar actions Docker e referências dinâmicas somente após definir cobertura/autoridade; SCA remoto permanece sujeito a opt-in explícito em VERIFY.

## Integridade das arestas de import — T2.2/T1.1 — 18/10/2026

`validateSnapshot` exige uma prova AST única por aresta `depends`, Evidence estática derivada, arquivo de origem compatível e, para pacote declarado, prova adicional do manifest. A mesma prova não pode sustentar duas arestas `depends`; uso adicional em `calls` Express é válido. `pieExpressCrossFile`, `pieTrace` e `pieAdapters`: 21/21 passaram com Git/SQLite. Imports omitidos por orçamento permanecem cobertura parcial; sem execução ou alegação de grafo completo.

## Impacto de mudanças — T2.4 — 18/10/2026

`pie_change_impact` schemaVersion 3 separa nó alterado (`changed`) de dependente alcançado e expõe `relationEvidenceIds` das arestas registradas em cada snapshot. Também inclui candidatos a movimento por hash idêntico único quando add/remove é comprovado; não declara rename semântico nem histórico Git. Boundary comparison/API/MCP passou 7/7, incluindo duplicidade ambígua e inventário parcial; `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. Cache por commit e incremental persistente continuam pendentes.

## Candidatos a movimento de declarações — T2.4 — 18/10/2026

`pie_change_impact` schemaVersion 4 acrescenta `declarationMoveCandidates`: fatos unilaterais de snapshots completos são pareados apenas quando adapter, tipo, nome, contexto, hash SHA-256 e linha coincidem e a correspondência é única em ambos os lados. A saída inclui Evidence anterior/posterior; painel permite abrir ambas. Fixture Git/SQLite com rota Express literal valida movimento por caminho e consulta das duas Evidence. O candidato é observacional, não afirma rename Git ou continuidade semântica; declarações ambíguas e ausências em inventários parciais são omitidas. Boundary comparison/API/MCP: 7/7; `pie:web:typecheck`, `check:fast`, `docs:check` (ledger `complete=false`), `format:check` e `git diff --check` passaram. Cache por commit e incremental persistente continuam pendentes.

## Cache de parsing — limite e isolamento — T2.4 — 18/10/2026

`pieIncrementalDiscovery` passou 5/5; cobre Evidence nova em snapshot quente, chaves por conteúdo/orçamento, mutação isolada do retorno, teto por entrada/quantidade e eviction pelo teto global de bytes. Sem mudança de runtime ou medição de ganho nesta rodada.

## Cancelamento antes do despacho do worker - T1.3 - 18/10/2026

Apos claim, o worker agora renova/consulta a lease antes de iniciar discovery ou VERIFY. Se a fila ja recebeu cancelamento, finaliza como `cancelled`; se a lease/token ja nao pertence ao worker, nao inicia workflow. `pieJobs` focused: 5 testes passaram, 1 skipped (cenario Linux-only). A boundary usa fila SQLite e `PieService` reais, persiste cancelamento entre claim e despacho e confirma estado terminal sem resultado nem snapshot.

## Corrida de heartbeat e cancelamento durante publicacao final - T1.3 - 18/10/2026

A checagem pre-dispatch agora tambem respeita AbortSignal ja acionado pelo heartbeat periodico. Boundary real SQLite/Git valida o cancelamento depois da descoberta e antes de publicar o resultado do job: estado `cancelled`, sem resultado de sucesso, com snapshot imutavel retido no historico. O cancelamento tardio nao desfaz discovery ja concluida. `pieJobs`: 6 passaram, 1 skipped Linux-only; PostgreSQL runtime e Linux real continuam pendentes.

## Doctor e abertura fail-closed para migrations PostgreSQL - T1.2/T6.2 - 18/10/2026

A sondagem estrutural le `_prisma_migrations`, exige as oito migrations esperadas desta versao e detecta tentativas incompletas e migrations desconhecidas (banco adiante do binario). `doctor` permanece read-only; `openPersistence` recusa schema incompleto sem fallback SQLite. Testes `pieDoctor` + `piePostgresMigrations`: 5/5 passaram; cobertura compara nomes aos diretorios Prisma reais e classifica historico aplicado, ausente, falho, pendente e futuro. PostgreSQL runtime ainda nao foi validado: `PIE_TEST_DATABASE_URL` ausente e `docker info` falhou porque o daemon Linux nao esta ativo.

## Drift de checksum das migrations - T1.2 - 18/10/2026

O catalogo esperado agora associa cada nome ao SHA-256 do `migration.sql`; a sondagem compara com `checksum` salvo em `_prisma_migrations` e recusa banco cujo script aplicado foi editado. A boundary calcula os hashes dos oito arquivos reais e cobre checksum divergente. O engine Prisma documenta esse campo como SHA-256 do arquivo de migration: https://github.com/prisma/prisma-engines/blob/main/schema-engine/ARCHITECTURE.md. PostgreSQL runtime nao foi exercitado neste host.

## Inspeção de colunas PostgreSQL - T1.2 - 18/10/2026

`inspectSchema` usa o DMMF Prisma gerado como fonte de nomes de tabelas/colunas escalares e compara com `information_schema`; doctor e abertura bloqueiam colunas esperadas ausentes e colunas inesperadas em tabelas PIE presentes. O teste sintético prova tabelas/colunas e ignora tabelas de outros sistemas. `check:fast`, `docs:check`, `format:check` passaram; 8 testes focados passaram e o teste PostgreSQL real foi skipped. Tipos, índices, constraints, dados e execução em PostgreSQL real seguem sem validação; URL de teste ausente e daemon Docker indisponível.

## Migration PostgreSQL falhando na CI - T1.2 - 18/10/2026

As migrations 202610170002 e 202610170003 começavam com BOM UTF-8; removido o BOM, recalculados os SHA-256 e adicionada regressão que rejeita BOM em qualquer migration. CI `39103950984` concluiu o job PostgreSQL com sucesso, incluindo `prisma migrate deploy` e `pieRunPersistence`. A regra de whitespace PostgreSQL em `scan.l` corrobora a causa; o log textual da falha anterior não estava acessível. Banco previamente marcado como aplicado com os bytes antigos pode acusar checksum drift; não há reparo automático nem escrita de dados.

## Cobertura Nginx estática ampliada — 18/10/2026

O parser Nginx adicionou `root`, `alias`, limites de corpo, workers/keepalive, gzip, protocolos e caminhos de certificado TLS, logs e zonas de limitação. `pieAdapters` + `pieInfrastructure`: 13/13 passaram; `check:fast` e `format:check` passaram. Evidence conserva argumentos e linha, mas não são lidos certificados/logs nem testada a configuração efetiva. Dockerfile, atributos Compose adicionais, serviços ativos e métricas continuam pendentes; sem Nginx instalado ou VPS para medição.

## Compose declarativo — 18/10/2026

`infrastructure-review` schemaVersion 2 agora traz `image`, cada porta, `restart` e somente presença de healthcheck por serviço Compose, com Evidence própria por campo; UI abre Evidence de cada item. O teste confirma que o comando de healthcheck (`DO_NOT_RETAIN`) não é retido. `pieAdapters`, `pieInfrastructure` e `mcp/pieMcp`: 15/15 passaram com Git/SQLite; schemas MCP Ajv e paridade CLI/API/MCP passam. `environment`, `secrets`, `build`, volumes, Dockerfile, execução e runtime continuam ausentes/não verificados.

E2E em Chrome real (`pieInfrastructureWeb`): o painel exibe image/port/restart/presença de healthcheck com links para Evidence, não renderiza o comando do healthcheck e mantém viewports 360/1440 sem overflow. O cartão de infraestrutura recebeu nome acessível por serviço/diretiva. Teste: 1/1 passou; `pie:web:typecheck` e `pie:web:build` passaram.

## Limites/reservas Compose — T4.4 — 18/10/2026

`infrastructure-review` schemaVersion 3 agora inclui `deploy.replicas` e valores literais `resources.limits|reservations` para CPU, memória e PIDs, cada um ligado a Evidence/linha. Todos permanecem configurações declaradas e `unverified`; não se afirma que Docker Compose/Swarm as aplica. Boundary adapter/infra/MCP: 15/15. Depois de `npm.cmd run pie:web:build`, `pieInfrastructureWeb`: 1/1 em Chrome real, verificando rótulos de limites e réplicas, Evidence, omissão do comando de healthcheck e viewports. Nginx/Compose reais, runtime e métricas VPS continuam sem validação.

# Continuidade T2.3/T4.4 — análise estática de Dockerfile — 18/10/2026

O Compose mantém contexto, Dockerfile, Evidence e resultado explícito da resolução local. O novo adapter usa `dockerfile-ast@0.7.1` MIT para fatos selecionados de instruções: imagem/stage `FROM`, nomes `ARG`/`ENV`, `WORKDIR`, `USER`, argumentos estruturais `EXPOSE`/`VOLUME` e presença de outras instruções. Corpos de shell/build e valores `ARG`/`ENV` não saem no contrato. Continuação, parser directive de escape e heredoc têm cobertura; conteúdo de heredoc não vira falsa instrução. Limites de fatos são explícitos e não alegam contagem total omitida.

Contrato `infrastructure-review` schemaVersion 5 integra facts ao build por caminho observado e Evidence; CLI, API, MCP e painel compartilham o serviço/schema. Teste de integração usa Git/SQLite reais, MCP testa schemas, Chrome local comprova instruções e Evidence. Nenhum build, registry, container, Nginx ou VPS foi consultado/executado. Compose volume mounts ainda não são analisados.

Validação executada após `npm ci` (Node 24.18.0/npm 11.16.0): `pie:build`; adapters/infrastructure/MCP focused 17/17; `pie:web:build` + `pieInfrastructureWeb` 1/1; `pie:web:typecheck`; `check:fast`; `format:check`; `docs:check`; `npm audit --audit-level=low` com zero reportadas; `licenses:refresh-notices` adicionou três notices MIT sem gaps e `licenses:generate` registrou 905 lockados/368 runtime. Ledger `complete=false` permanece correto.

Medição sintética diagnóstica (274 B/13 linhas): fria 10,133 ms; 1.000 hits quentes 66,921 ms; CPU 94 ms; RSS do processo 50,55→55,48 MiB; heap 13,91 MiB. Não mede process family nem VPS; o PIE não contém Dockerfiles versionados para baseline comparável, token cost não medido. Próxima frente segura: analisar montagens Compose e recursos top-level com contratos/Evidence, mantendo valores de `build.args`/environment e comportamento efetivo desconhecidos. T2.3/T4.4 parciais.

# Continuidade T2.3/T4.4 — mounts Compose — 18/10/2026

Compose agora gera facts para mounts de serviço e componente para volumes top-level. Valores de mount são a declaração curta original ou o objeto longo serializado; definições de volume só expõem external/nome e driver conhecidos. Cada fato mantém Evidence e linha. Não normaliza opções de montagem nem confirma existência ou aplicação pelo Docker.

Validação: adapter/infrastructure 16/16; painel Chrome 1/1 e typecheck passaram. Gates gerais e documentação ainda serão executados nesta continuação. T2.3/T4.4 continuam parciais; volumes externos, interpolação, drivers/opts completos, runtime e métricas seguem sem prova.

# Continuidade T2.3/T4.4 — ambiente Compose — 18/10/2026

O adapter Compose agora retém apenas nomes válidos das chaves de `environment` e caminhos declarados de `env_file` (string, lista ou objeto com `path`). Valores ambientais nunca são incluídos nos facts. Isso é declaração estática: não resolve interpolação, não lê os arquivos e não representa ambiente efetivo dos containers. Teste focused do adapter está sendo executado nesta etapa; resultados finais serão registrados no relatório de validação.

# Continuidade T2.3/T4.4 - secrets e configs Compose - 18/10/2026

O adapter registra referencias de secrets/configs curtas/longas por servico e definicoes top-level. Retem somente source/target/uid/gid/mode de mounts e metadados external/name/file; nao abre file, nao le conteudo secreto e nao confirma runtime. Boundary adapter/infra/MCP passou 18/18 e Chrome `pieInfrastructureWeb` 1/1. Nenhum arquivo de secret/config foi aberto.

# Continuidade T2.3/T4.4 - profiles e depends_on Compose

Adapter adiciona profiles e opcoes conhecidas `condition`, `restart` e `required` de depends_on longo, sem inferir ordem/saude/runtime. Adapter/infra/MCP passou 20 testes focados e Chrome passou 1/1; nenhum estado operacional e inferido.

# Continuidade T2.3/T4.4 - referencias include/extends Compose

Adapter preserva include path/project_directory e extends service/file com Evidence; o servico e o painel apresentam referencias. Os arquivos indicados nao sao abertos e nenhuma configuracao e merged. Boundary adapter/infra: 20/20; E2E Chrome: 1/1. Include/extends efetivos, interpolacao e runtime seguem nao verificados.

## Redes Compose estáticas — T2.3/T4.4 — 18/10/2026

Adapter emite modo de rede, anexos do serviço com aliases/endereço literal selecionado, e definições top-level restritas a nome/driver/external/internal/attachable/IPv6. Valores estruturais retidos não representam conectividade efetiva; IPAM e opções arbitrárias são omitidos. `npm.cmd run pie:build` passou; adapter/infrastructure/MCP/Chrome focused: 23/23. Include/extends continuam sem expansão; rede runtime e Docker/Compose real não foram verificados. `check:fast`, `docs:check`, `format:check` e `pie:web:typecheck` passaram; ap?s o build do painel, Chrome passou 1/1. T2.3/T4.4 permanecem parciais.

## Seguranca de containers Compose - T4.3 - 18/10/2026

`security-review` usa fatos Compose existentes e, quando o arquivo ainda corresponde a Evidence, emite findings para `network_mode: host`, `privileged: true` e cinco capabilities de alto impacto em `cap_add`. Categoria `container_configuration`, severidade alta, probabilidade `unassessed`; não prova ativação ou exposição. Contrato schemaVersion 6 anuncia cobertura parcial. Docker/runtime e permissões efetivas não foram verificados; T4.3 parcial.

### Painel Security Review

O painel pt-BR consulta o schema compartilhado, marca findings como suspeitos/nao verificados, separa superficies de autorizacao unverified, mostra incertezas e links para Evidence. Chrome percorreu o finding Compose network_mode: host, abriu sua Evidence e validou viewports 360/1440; a boundary detectou e levou a correcao de quebra responsiva em titulo longo do plano de triagem.

O adapter também registra `privileged` booleano declarado como `privileged_mode`, sem resolver configuração efetiva. O finding `compose_privileged_container` aparece no painel junto à Evidence atual. Validação desta extensão: `pie:build`, boundaries de adapter/infra/security, `pie:web:typecheck`, build web e Chrome 1/1; Docker/Compose runtime continua não executado.

Compose security schemaVersion 6 tambem registra `capability_add`/`capability_drop` e detecta somente SYS_ADMIN, SYS_MODULE, SYS_RAWIO, SYS_PTRACE e NET_ADMIN. Adapter/infra/security 23/23; Chrome 1/1. Docker/runtime nao validado; T4.3 continua parcial.

Data Review: DDL de migration nao reconhecido em `ALTER TABLE`, operacoes `DROP`/`TRUNCATE`/`RENAME` e nomes qualificados por schema causam estado incompleto, preservando seletores como inconclusivos. Fixtures Git/SQLite confirmam PK removida e rejeitam associacao `other.User` ao modelo Prisma `User`. `pieDataReview` 3/3 e `pieAdapters` 20/20. PostgreSQL runtime indisponivel localmente e ainda pendente; o parser nao calcula estado final completo.

Atualizacao T4.5: nomes SQL qualificados nao geram facts de tabela/constraint e deixam a migration inconclusiva, evitando cruzar schemas homonimos sem search_path/@@schema suportados. Boundary Git/SQLite cobre DROP de PK e other.User versus Prisma User; Data Review 3/3, adapters 20/20. PostgreSQL runtime continua nao verificado.

Data Review tambem trata SET/RESET search_path, SET SCHEMA e set_config como contexto de schema nao resolvido. Boundary real Git/SQLite demonstra que migration com SET search_path TO other nao produz alinhamento do modelo Prisma User. pieDataReview 4/4; adapter 20/20. Nenhum PostgreSQL runtime foi executado.

## Continuidade Data Review — 18/10/2026

Cobertos PK/UNIQUE inline, indice UNIQUE parcial e `CREATE TABLE ... LIKE` fail-closed. Boundary Data Review/adapters passou 27/27; `pie:build`, `check:fast`, `docs:check` e `format:check` passaram. O teste direto valida `Declaration.name` (`primary_key`/`unique`), pois o kind comum e `config_directive`. Prioridade confirmada para triagem: impacto decrescente, risco decrescente, menor esforco; sem calculo automatico de notas. PostgreSQL runtime e estado final/reducer continuam pendentes.

Continuidade: objetos `CREATE TABLE/UNIQUE INDEX IF NOT EXISTS` nao provam que a definicao declarada foi aplicada; facts omitidos e migration incompleta preservam incerteza. A cobertura integrada e do parser foi adicionada. Reexecutar gates gerais e atualizar contagens apos a entrega. PostgreSQL local indisponivel (sem URL/psql; daemon Docker indisponivel). Proximo passo de T4.5: ampliar a semantica de reducao somente com operacoes cujo ordenamento e ownership possam ser preservados em Evidence; nao afirmar estado aplicado.

`PARTITION OF` e `INHERITS` tambem deixam migration inconclusiva; o parser nao trata limites como colunas nem presume constraints herdadas. Boundary focada passou 31/31; gates gerais ainda precisam ser registrados apos esta extensao. DDL PostgreSQL do pai `PARTITION BY` e aceito somente para constraints locais reconhecidas. Referencia primaria: https://www.postgresql.org/docs/current/sql-createtable.html .
Validação geral concluída: `pie:build`, `check:fast`, `docs:check` (ledger `complete=false`), `format:check` e `git diff --check` passaram; focused Data Review/adapters: 31/31. Próximo passo T4.5 permanece reduzir alterações de schema somente após modelar operações ordenadas e Evidence. PostgreSQL runtime segue indisponível aqui.

Continuacao T4.5: TEMP/TEMPORARY (incluindo GLOBAL) e CTAS nao emitem facts; a migration fica incompleta. Parser e Data Review Git/SQLite passaram; focused boundaries 33/33. Gates gerais desta extensao ainda precisam ser executados. PostgreSQL runtime permanece sem URL/psql/daemon local. Docs oficiais consultadas: https://www.postgresql.org/docs/current/sql-createtable.html e https://www.postgresql.org/docs/current/sql-createtableas.html .
Gates gerais TEMP/CTAS passaram: pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check. Boundary Data Review/adapters: 33/33. CTAS e temporarias continuam sem facts; PostgreSQL runtime indisponivel localmente.
Revalidacao CTAS com lista opcional de nomes de coluna concluida: boundaries 33/33; pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check passaram. PostgreSQL runtime continua pendente por indisponibilidade local.

Continuacao T4.5: `SELECT INTO` top-level e em CTE agora e detectado como criacao de tabela nao analisada; INSERT-SELECT e SELECT de leitura permanecem neutros. Boundary combinada 35/35. Gates gerais desta mudanca ainda precisam ser reexecutados. PostgreSQL runtime continua indisponivel localmente. Fonte: https://www.postgresql.org/docs/current/sql-selectinto.html .
Gates gerais SELECT INTO passaram: pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check. Boundaries focadas: 35/35. PostgreSQL runtime permanece indisponivel.

T4.5: `CREATE/ALTER FOREIGN TABLE` agora deixam inventory incompleto; constraints declaradas nao provam enforcement do FDW remoto. Boundaries passaram 37/37. Gates gerais apos esta extensao ainda devem ser reexecutados. Fonte oficial: https://www.postgresql.org/docs/current/sql-createforeigntable.html .
Revalidacao final foreign tables: focused 37/37; pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check passaram. Enforcement remoto/FDW e PostgreSQL runtime nao foram verificados.

T4.5: ALTER TABLE com varias actions em uma instrucao nao produz facts parciais. Virgulas internas de colunas permanecem suportadas. Boundaries passaram 39/39; gates gerais apos esta mudanca ainda precisam ser executados. PostgreSQL runtime indisponivel. Referencia: https://www.postgresql.org/docs/current/sql-altertable.html .
Gates gerais ALTER TABLE composto passaram: pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check. Focused Data Review/adapters: 39/39. PostgreSQL runtime nao executado.

T4.5: CREATE UNIQUE INDEX ON ONLY agora resolve a tabela apos ONLY; nome de indice schema-qualified e fail-closed. UNIQUE nao e confundido com PK Prisma. Boundaries: 41/41; gates gerais apos esta mudanca ainda precisam rodar. Fonte: https://www.postgresql.org/docs/current/sql-createindex.html .
Gates gerais ON ONLY passaram: pie:build, check:fast, docs:check (ledger complete=false), format:check e git diff --check. Focused Data Review/adapters 41/41. PostgreSQL runtime nao executado.

T4.5: NULLS NOT DISTINCT em UNIQUE inline/tabela, indice e ALTER constraint agora e fail-closed; facts de seletor nao sao emitidos e Data Review preserva estado inconclusivo. Focused 43/43; pie:build, check:fast, docs:check passaram (ledger complete=false). PostgreSQL runtime nao executado. Referencias: https://www.postgresql.org/docs/current/sql-createtable.html e https://www.postgresql.org/docs/current/sql-createindex.html .

T4.5: tabela reconhecida como PARTITION BY seguida por CREATE UNIQUE INDEX ON ONLY nao produz fato global de unique; inventory fica incompleto e Prisma @unique inconclusivo. Focused Data Review/adapters 45/45. Referencia: https://www.postgresql.org/docs/current/ddl-partitioning.html . Runtime PostgreSQL continua sem prova local.

T1.3/T3.2: supervisor REA diferencia process exit de output close, preserva stderr tardio e incompleto, limita drenagem/retencao (1 s/64 KiB) e mantem captura durante retry de cleanup. Em Windows, focused process/PIE Docker passou 24 testes; 1 teste real POSIX de pipe herdado ficou skipped por plataforma. Gates gerais passaram. Referencia upstream: https://github.com/morluto/rea/commit/701695139490777ece7a3ccb8508b6215a11c0fe .

T6.3: filtro da lane PIE ampliado para supervisor/processo Windows e fixtures; passo Linux executa boundaries do supervisor REA. Mudanca de fonte compartilhada seleciona a suite PIE completa (teste conformance 2/2). YAML parse e testes locais passaram; pipe POSIX real permanece pendente da lane remota apos push.

## Continuidade T4.1 — seletor exato de caso por binding — schema v5 — 18/10/2026

Grant v3 acrescenta identidade declarada pelo operador via `testFile` + `name` + `nesting`; `verification-diff` v5 expõe resultado exato e Evidence. Estados cobrem observação única, ausência em relatório completo, desconhecido em relatório incompleto e identidade ambígua. A associação segue `declared_unverified`; resultados de runtime não provam semântica de asserção ou relação `covers`. Depois da consolidação em uma passagem, as boundaries focadas passaram 23 testes com 1 skip de plataforma, incluindo 15 schemas Ajv; `check:fast`, `docs:check` e `format:check` passaram. Próximo: revisar diff e registrar commit na main. T4.1 continua parcial.

## Continuidade T6.3 — gate CI estrutural e revisão remota — 18/10/2026

O CI remoto do commit `1e4956560` confirmou `PIE integration` success, mas `check:ci` acusou exports sem consumidor e três chaves NUL sem auditoria. O código foi limpo na origem; `productInput` agora reutiliza `functionalInput`, wrappers redundantes foram removidos após busca de consumidores e duas chaves usam `compositeKey`. O hash de identity do security mantém compatibilidade e tem justificativa de domínio no architecture guard. Regressões focadas: 8/8; guard: 1.589 arquivos; `check:ci`: passou. Próximo: conferir CI geral do push corretivo e retomar lacunas T0/T1/T2/T4/T5/T6; não declarar a matriz concluída. O job Release Please falhou, mas seus logs exigem privilégio admin (API respondeu 403); investigar só com acesso autorizado aos logs. `docs/verification/managed-conformance-ledger.json` continua incompleto.

## Continuação da diligência upstream — 18/10/2026

Refs revalidadas: HEAD/PIE `951755e1f`, upstream `eb2c3b589`, fork REA `d200b8618`; upstream está 113 commits à frente e PIE 239 commits à frente em relação ao outro ref. O fork é ancestral. `merge-tree` continua apontando os quatro caminhos de lifecycle. Leitura do delta confirma que PIE já limita retenção adicional a 64 KiB e drain a 1 s, mantém captura em retry e cobre tail/incompletude; wait sem timeout do upstream não tem chamador de produção PIE. Nenhuma integração foi aplicada. `docs:check` passou (6 tarefas, 5 cache hits; consistência README 5/5); `format:check` passou em 4.160 arquivos; `git diff --check` passou. Próxima validação de T0.1: evidência de processo real Windows/Job Object e regressões de cancelamento na finalização; depois caracterizar o restante do delta upstream sem merge em bloco. T0.1 continua parcial.

## Boundary real Windows de processo — 18/10/2026

Corrigi assertions portáveis em `tests/boundary/process/providerProcess.test.ts`: DACL Windows é verificada pela autoridade nativa; coordenadas do launcher são avaliadas segundo Job Object no Windows e grupo/comando no POSIX. As boundaries `providerProcess`, `providerProcessOutput` e `windowsOutputCapture` passaram: 25 testes, 6 skips POSIX. O processo Windows de captura produziu/reteve 8.454.144 bytes em 493 ms, SHA-256 `cd6b2297b720cc1b868f5479d51ce7e5f2e8259470193f8112dd2df8a73658c`, deadline 30 s. Próximo: gates gerais e CI do commit, depois rodar o teste POSIX em Linux/macOS. Não confundir esse resultado com validação da CI integral nem dos providers externos.

## Estado de CI e matriz após lifecycle Windows — 18/10/2026

HEAD/`origin/main` `cd4e4fac4`. GitHub Actions: CI #252 do commit anterior aparece como `Queued` e CI #253 deste commit como `Pending`, aguardando #252; não há resultado integral para registrar. Local Windows: `pieJobs`/worker tem cobertura anterior, e as novas boundaries do processo passaram 25 testes com 6 skips POSIX; `windowsOwnedCommand.test.ts` passou 6/6. Captura Windows real: 8.454.144 bytes em 493 ms. `wsl --status` retornou código 50; não há runtime Linux/WSL disponível neste host. Próximo: acompanhar #252/#253, validar o hash final após término da fila e obter execução POSIX em runner Linux; não declarar T0.1/T6.3 concluídas.

## T1.3 — causas distintas de interrupção — 18/10/2026

`JobWorker` não colapsa mais timeout, perda de lease/heartbeat e encerramento em `ABORTED_OR_TIMEOUT`; persiste `JOB_TIMEOUT`, `LEASE_LOST`, `HEARTBEAT_FAILED`, `WORKER_SHUTDOWN` ou `ABORTED`. `CANCELLED` da fila preserva precedência. Boundary SQLite real passou 10 testes: deadline, shutdown, perda de lease e erro do heartbeat foram exercitados; 1 caso Linux-only foi skipped. `check:fast`, `format:check` e diff check passaram. Próxima tarefa T1.3: definir/validar retomada idempotente após shutdown sem publicar resultado duplicado, inclusive worker concorrente e PostgreSQL.

## T1.3 - retomada apos shutdown - 18/10/2026

Interrupcao graciosa do worker libera o lease de discovery atomicamente e reencaminha apenas dentro de maxAttempts. Token obsoleto, lease expirada e cancelamento concorrente foram cobertos. Verification nao e repetido automaticamente. Boundary SQLite passou 11 testes com 1 skip Linux-only. A boundary PG tem caso novo, mas foi skipped: PIE_TEST_DATABASE_URL ausente; Docker daemon nao esta rodando. check:fast, docs:check e format:check passaram.

Proximo gate T3.2: revisar docs/proposals/PLAYWRIGHT_SCOPE_DECISION.md. Nao integrar runner ate decisao explicita do mantenedor em issue/discussao, conforme CONTRIBUTING.md. Workflow remoto deste SHA: PIE integration #194 e Release #241 In progress; CI #256 Pending, https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions?query=56efecf38.
