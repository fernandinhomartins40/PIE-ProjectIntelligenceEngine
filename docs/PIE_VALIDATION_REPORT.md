# PIE — Registro de validação contínua

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

| Verificação executada | Resultado | Limite |
|---|---|---|
| git status e remote -v iniciais | Repositório vazio, sem commits e origin configurado | Não havia código PIE anterior |
| Leitura dos 12 documentos | Realizada integralmente, com releitura em blocos após saída truncada | Documentos descrevem requisitos, não implementação |
| git fetch upstream main --tags | Histórico e refs obtidos | Comando composto terminou 1 por descoberta de gh ausente; fetch confirmado por branch e SHA |
| git switch -c pie/integration upstream/main | Sucesso | Sem push |
| API GitHub origin fork | false | Fork remoto não criado |
| npm ci --ignore-scripts --no-audit --no-fund | EBADENGINE | Node 22.17.1 não satisfaz engines; não desativar requisito |

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
