# Desenvolvimento PIE

## Comparar resultados VERIFY

`verification-diff <run-antes-id> <run-depois-id> --limit 50 --offset 0` compara registros Node persistidos. A API autenticada usa `POST /v1/verification-comparison`; o MCP usa `pie_verification_compare`. O serviço compartilha a mesma operação e retorna IDs de execução, snapshots e evidências, cobertura e casos paginados.

`project-verifications <project-id> --limit 50 --offset 0` lista execuções em todos os snapshots do projeto; a API autenticada usa `GET /v1/projects/<project-id>/verifications` e o MCP usa `pie_project_verifications_list`. O painel lista esse histórico paginado e permite escolher as duas execuções, inclusive de snapshots diferentes, antes de solicitar a comparação. Abrir um registro preserva acesso à execução original e sua Evidence.

A identidade usa caminho relativo observado pelo reporter, nome e profundidade. Só compara a interseção dos arquivos registrados nos grants VERIFY v2; casos duplicados/ambíguos, sem contraparte ou fora do escopo não são alinhados por suposição. Imagem divergente torna a conclusão inconclusiva. `regression_observed` descreve um teste antes aprovado que falhou depois, sob a mesma imagem; `no_regression_observed` significa apenas que nenhum caso comparável regrediu quando imagem, seleção, relatórios e limpeza são compatíveis/completos. Nenhum estado aprova o produto. Esta versão não calcula desempenho, coverage de código, screenshot, journeys ou motor de cobertura funcional; cada comparação é derivada novamente dos registros e não fica persistida como artefato separado.

## Execução HTTP local autorizada

Uma sondagem é opt-in por um grant JSON explícito ligado a snapshot completo; o PIE não inicia o servidor do projeto. Somente GET/HEAD para `127.0.0.1` com porta, caminho, timeout, limite de bytes e status/digest esperados declarados. Exemplo: `node scripts/pie.mjs http-probe-run C:/dados/grant-http.json --db C:/dados-pie/pie.sqlite`. Consultar por ID com `node scripts/pie.mjs http-probe UUID --db C:/dados-pie/pie.sqlite` ou listar histórico paginado com `http-probes UUID_DO_SNAPSHOT --limit 50 --offset 0`. MCP anuncia `pie_http_probe_run`, `pie_http_probe_get` e `pie_http_probes_list`; API local usa `POST /v1/http-probes`, `GET /v1/http-probes/UUID` e `GET /v1/http-probes?snapshotId=UUID` com a autenticação existente. Resultado limitado a observação de status/digest; não prova identidade do processo respondente, jornada, autorização ou persistência.

O produto está em desenvolvimento. O escopo integral permanece no plano mestre. A primeira fatia fornece inventário de arquivos rastreados por Git, classificação por nome, evidências com hash, histórico SQLite local, CLI e cinco ferramentas MCP. Não há execução do projeto auditado, análise AST, seis motores, painel ou PostgreSQL nesta fatia.

## Runtime e instalação

Use Node da `.nvmrc` (24.18.0) e o npm indicado no manifesto. O host desta sessão tem Node global antigo; foi obtido Node compatível em cache local, sem substituir a instalação global. Não ignore `engine-strict`.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run pie:build
node scripts/pie.mjs help
node scripts/pie.mjs doctor
node scripts/pie.mjs discover C:/projetos/aplicacao --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs projects --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs graph UUID_DO_SNAPSHOT --db C:/dados-pie/pie.sqlite --limit 50
node scripts/pie.mjs export UUID_DO_SNAPSHOT --db C:/dados-pie/pie.sqlite
```

`--db` padrão: `.pie/pie.sqlite` na pasta do usuário. O estado precisa ficar fora do projeto auditado. `export` retorna o snapshot completo em JSON; consultas de grafo/histórico/projetos são paginadas. Não há dados de demonstração nem seed na aplicação.

## MCP

Comando de servidor: `node scripts/pie.mjs mcp C:/projetos/aplicacao --db C:/dados-pie/pie.sqlite`. A raiz é escolhida pelo operador na inicialização, não por conteúdo externo. Transporte stdio; nenhum endpoint de rede exposto. Não altera configuração de agentes automaticamente.

Ferramentas disponíveis: `pie_project_discover`, `pie_projects_list`, `pie_graph_query`, `pie_evidence_get`, `pie_history_list`. As demais do blueprint serão anunciadas somente quando implementadas. O banco é compartilhado entre CLI/MCP do mesmo operador; não implementa separação de usuários ou tenants do PIE.

## Cobertura e segurança

Somente arquivos Git rastreados; repositório sem commit tem revisão `null`. Estado dirty e digest dos bytes observados são preservados. Arquivos sensíveis conhecidos, links, tipos especiais, arquivos grandes e limites de orçamento reduzem cobertura. Corpos não são persistidos; nomes e hashes são metadados internos. Arquivos omitidos nunca equivalem a aprovação. Classificação por nome é inferência. Relações AST ainda não descobertas permanecem vazias, com limitação explícita.

Leitura não é snapshot atômico nem sandbox contra outro processo que troca arquivos durante análise. Não usar esta fatia contra árvores ativamente hostis/concorrentes. O perfil OBSERVE impede execução pelo produto; VERIFY/CHANGE têm regras de admissão puras, mas runners ainda não estão habilitados. SQLite é modo local opcional; não substitui o backend PostgreSQL de produção previsto.

## Validação

```powershell
npm run pie:build
node node_modules/vitest/vitest.mjs run tests/boundary/pieFoundation.test.ts tests/boundary/mcp/pieMcp.test.ts src/domain/evidence.test.ts src/application/investigation/EvidenceLedger.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Fixtures sintéticas são criadas somente em diretórios temporários de teste. Provedores REA não foram iniciados por estes testes. Consulte PIE_VALIDATION_REPORT.md para resultados executados.

Licença e atribuições: `LICENSE`, `THIRD_PARTY_NOTICES.md` e `licenses/` preservados do REA. PIE é derivação independente e não sugere afiliação oficial. Não publicar o pacote com a identidade npm/MCP oficial REA; separação de distribuição e atualização dos metadados ainda pendentes.

## Comparação, relatórios e API local

```powershell
node scripts/pie.mjs compare UUID_ANTES UUID_DEPOIS --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs export UUID_DO_SNAPSHOT --format md --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs export UUID_DO_SNAPSHOT --format html --db C:/dados-pie/pie.sqlite
# Defina PIE_API_TOKEN no ambiente com um segredo de no mínimo 32 caracteres.
node scripts/pie.mjs serve C:/projetos/aplicacao --db C:/dados-pie/pie.sqlite --port 0
```

O comando serve imprime somente URL e perfil, sem token. Escuta exclusivamente em 127.0.0.1; toda requisição requer Authorization: Bearer com o token informado. Não aceita Origin de navegador nem CORS. Esta API é para clientes locais; o futuro painel precisará de autenticação de navegador própria, sem afrouxar esse bloqueio indiscriminadamente.

Rotas v1: GET health/projects/graph/:snapshot/evidence/:id/history/:project; POST discover (maxFiles opcional) e compare (beforeId, afterId, offset, limit). Raiz e banco são definidos ao iniciar, não pelo corpo HTTP. Corpo limitado a 16 KiB, até 16 conexões e duas descobertas ativas por serviço. Isso não constitui fila persistente nem sandbox de execução.

Ferramenta MCP adicional: pie_change_impact, com schema explícito e paginação. Todos os outputs MCP agora têm contratos de sucesso e erro explícitos. Comparação usa hashes e ambos os grafos: leitura parcial não confirma adição/exclusão por ausência; igualdade de conteúdo não aprova runtime. Exports HTML escapam conteúdo e usam CSP sem scripts; Markdown escapa links e delimitadores. Exports representam inventário, não relatório de auditoria dos seis motores.

## PostgreSQL e fila persistente

O modo PostgreSQL usa Prisma 7.10.1 e adapter-pg, com contrato de persistência compartilhado com SQLite. Referência: [documentação oficial Prisma PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql). Geração do cliente e validação do schema foram executadas; banco PostgreSQL real ainda depende da execução do teste dedicado/CI.

```powershell
# Defina PIE_POSTGRES_PASSWORD com senha própria no ambiente antes do Compose.
docker compose -f compose.pie.yml up -d postgres
# Defina PIE_DATABASE_URL com a conexão do banco PIE, nunca do projeto auditado.
npm run pie:db:migrate
npm run pie:build
node scripts/pie.mjs discover C:/projetos/aplicacao
```

Sem PIE_DATABASE_URL, continua disponível o modo SQLite por --db. Com essa variável configurada, todos os comandos usam PostgreSQL e falhas de conexão não causam fallback silencioso. Migrações são comando explícito; geração do cliente e schema não aplicam alterações a um banco. Não há URL/senha de conexão padrão. O Compose só provisiona o banco PIE, sem montar socket Docker nem arquivos de aplicações. Preserve o volume nomeado; não execute down -v como limpeza rotineira.

```powershell
node scripts/pie.mjs enqueue C:/projetos/aplicacao --key investigacao-001 --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs work C:/projetos/aplicacao --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs job UUID_DO_JOB --db C:/dados-pie/pie.sqlite
node scripts/pie.mjs cancel-job UUID_DO_JOB --db C:/dados-pie/pie.sqlite
```

`work` processa no máximo um job por invocação e somente da raiz autorizada. Enfileiramento fixa OBSERVE; não executa scripts, testes ou código do alvo. A fila suporta chave idempotente, fencing por token de lease, cancelamento, recuperação de worker perdido e limite de tentativas. Não promete execução exatamente uma vez: uma queda entre publicação do snapshot e recibo do job pode produzir novo snapshot na recuperação. Retenção de evidências preserva os snapshots publicados. Isolamento OS de runners e daemon contínuo ainda são pendentes.

API com `serve`: POST /v1/jobs recebe idempotencyKey e maxFiles, GET /v1/jobs/:id consulta e POST /v1/jobs/:id/cancel solicita cancelamento. O corpo nunca escolhe raiz ou perfil. Consultar/cancelar exige o mesmo Bearer da API local. O processamento ocorre pelo comando work, não pelo servidor HTTP.

Teste PostgreSQL: configure PIE_TEST_DATABASE_URL para um banco dedicado com nome terminado em _test, aplique migrações usando PIE_DATABASE_URL e execute tests/boundary/piePostgres.test.ts. Sem URL, esse teste fica skipped; não conta como aprovação. O workflow .github/workflows/pie.yml provisiona PostgreSQL real no runner e não depende do Docker local. Seu resultado só deve ser marcado verificado após inspeção da execução.

As novas dependências têm arquivos originais de licença coletados de tarballs conferidos pelo hash do lockfile. Sete identidades contêm lacunas explícitas de notice no arquivo de atribuições; revisão antes de distribuição permanece pendente, e o pacote continua privado.

## Declarações de stacks e cobertura

`node scripts/pie.mjs declarations UUID_DO_SNAPSHOT --db C:/dados-pie/pie.sqlite` consulta os fatos descobertos. API GET /v1/declarations/:snapshot e MCP pie_declarations_list oferecem a mesma paginação e as mesmas evidências. O comando discover inclui declarationCount. Snapshots antigos não são reanalisados silenciosamente: seu campo de declarações é vazio até nova descoberta.

| Adaptador         | Sintaxe examinada                                                                                         | Limites                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| node-manifest     | package.json, mapas dependencies/devDependencies/peerDependencies/optionalDependencies e nomes de scripts | Não comprova instalação/uso; não retém comandos/versões                                      |
| composer-manifest | composer.json, require/require-dev e nomes de scripts                                                     | Declaração Laravel não é análise do código PHP                                               |
| compose           | Arquivos compose/docker-compose YAML, services e depends_on lista/mapa                                    | Sem execução/interpolação/include/extends/profiles; valores de secrets não coletados         |
| openapi           | Arquivos openapi/swagger JSON/YAML, versão 3.0.x/3.1.x, operações HTTP literais em paths                  | Sem $ref externo, fetch, servidores, exemplos ou validação runtime                           |
| prisma-schema     | Arquivos .prisma, declarações model e campos em linhas próprias                                           | Lexer limitado, ignora strings/comentários; não valida relações/constraints/migrations/banco |
| sql-migration     | `prisma/migrations/*/migration.sql`: formas suportadas de CREATE TABLE/PRIMARY KEY/UNIQUE/índice único    | Sem cálculo do estado final, SQL dinâmico, mapeamentos Prisma ou prova de aplicação no banco |

Cada fato é estático e unverified, com hash do arquivo, linha, evidência e identidade derivada da declaração. O limite usa o orçamento maxGraphEdges; ausência por falha/limite não equivale a inexistência. coverage.status continua restrito ao inventário de arquivos Git; limitações dos adaptadores devem ser lidas separadamente. Esta matriz não promete suporte universal às stacks.

PostgreSQL real da entrega anterior foi verificado na [CI 38963487480](https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine/actions/runs/38963487480); Docker local continua com erro 500. Não extrapolar esse teste para a certificação de todo o produto.

## Trace de relações registradas

```powershell
node scripts/pie.mjs trace UUID_DO_SNAPSHOT ID_DO_NO --direction dependencies --depth 4 --max-nodes 200 --max-edges 1000 --limit 50 --db C:/dados-pie/pie.sqlite
```

IDs de arquivos vêm de graph; IDs de declarações vêm de declarations. A mesma operação está em POST /v1/trace e MCP pie_graph_trace. Entrada: snapshotId, nodeId, direction (dependencies/dependents/both), maxDepth (0–32), maxNodes (1–1000), maxEdges (1–5000), offset e limit. Paginação de nós/arestas é independente da truncagem da busca; consultar páginas posteriores não amplia o orçamento.

O grafo de investigação combina imports já registrados com relações derivadas das declarações: declared_in liga declaração ao arquivo; field_of liga campo Prisma ao model do mesmo arquivo; depends liga serviços Compose quando origem e destino são únicos no mesmo arquivo. Destinos ausentes/ambíguos não são inventados. unresolvedRelations informa lacunas declarativas no snapshot inteiro. Ciclos são visitados uma vez por nó e limites permanecem explícitos em coverage.truncated.

coverage.scope é recorded-relationships; discoveryStatus mantém a cobertura de arquivos do snapshot original, separada da truncagem da busca. Todas as evidências e limitações de origem permanecem acessíveis. Trace estático não comprova execução, teste, autorização, entitlement ou persistência de dados. Esse grafo derivado não substitui o grafo completo página→API→serviço→banco do plano. Ele é calculado a partir do snapshot persistido, sem reler código; carregamento paginado diretamente do backend ainda é pendente.

## Execução VERIFY pela CLI Linux

O runner Node usa Docker local explicitamente escolhido, imagem já instalada e fixada por digest, sem pull, sem rede, sem shell e sem montar o repositório original. Executa uma cópia privada dos arquivos observados cujos hashes ainda coincidam com o snapshot. Requer descoberta completa, autorização local ainda válida e estado privado 0700 fora do alvo. Windows/macOS são recusados neste fluxo até controles e testes equivalentes existirem. Os demais runners e motores continuam pendentes.

Faça discover e use os valores reais de snapshot.id e snapshot.treeDigest no arquivo de autorização. O exemplo abaixo é um modelo com campos a substituir; não representa autorização nem imagem válidas:

```json
{
  "schemaVersion": 1,
  "profile": "VERIFY",
  "allowTargetExecution": true,
  "environment": "local",
  "repositoryRoot": "/caminho/absoluto/do/projeto",
  "snapshotId": "<UUID real do snapshot>",
  "treeDigest": "<SHA-256 real do snapshot>",
  "image": "<imagem já instalada>@sha256:<digest real>",
  "expiresAt": "<data UTC futura em ISO 8601>",
  "testFiles": ["tests/example.test.mjs"],
  "limits": {
    "timeoutMs": 30000,
    "memoryMiB": 256,
    "cpus": 1,
    "pids": 32,
    "workspaceMiB": 64,
    "outputBytes": 65536,
    "sourceBytes": 10000000
  }
}
```

O diretório de estado deve existir, pertencer ao operador e ter modo 0700; a CLI recusa permissões abertas e estado dentro do alvo. Selecione o executável e socket reais do Docker:

```bash
node scripts/pie.mjs verify /dados-pie/autorizacao.json --db /dados-pie/pie.sqlite --state-dir /dados-pie/privado --docker-bin /usr/bin/docker --docker-host unix:///var/run/docker.sock
node scripts/pie.mjs resources --state-dir /dados-pie/privado --limit 50 --offset 0
node scripts/pie.mjs recover UUID_DO_RUN --state-dir /dados-pie/privado --docker-bin /usr/bin/docker --docker-host unix:///var/run/docker.sock
```

VERIFY persiste resultado e evidência antes de retornar. Código de saída 0 exige passed; failed/skipped/blocked/inconclusive saem com código 1. Skips misturados com testes aprovados mantêm resultado inconclusivo. Uma mudança desde a descoberta bloqueia a cópia; não há execução direta no host como fallback. O banco SQLite é pré-lido sem migrações antes de validar a autoridade do snapshot. O painel ainda não inicia VERIFY.

## Execução VERIFY pela API local

`serve` habilita execução somente quando iniciado com `--state-dir`, `--docker-bin` e `--docker-host` explícitos, além da raiz e de PIE_API_TOKEN. Exemplo de parâmetros:

```bash
node scripts/pie.mjs serve /projeto --db /dados-pie/pie.sqlite --state-dir /dados-pie/privado --docker-bin /usr/bin/docker --docker-host unix:///var/run/docker.sock
```

POST /v1/verify recebe o mesmo grant completo em JSON, exige autenticação e mantém as regras de origem/CSRF da API. A raiz do grant e a do snapshot devem corresponder à raiz escolhida na inicialização. Uma execução por coordenador; concorrência ou limpeza pendente responde 429/BUSY. O padrão sem opções VERIFY responde 403/VERIFICATION_DISABLED. GET /v1/context informa verificationEnabled.

Resposta 201 significa registro persistido, não aprovação: examine result.state e evidence. Desconexão do cliente ou fechamento do servidor cancela a operação; o coordenador aguarda execução/persistência e retém cleanup pendente. Fechamento incompleto pode ser repetido, mantendo o armazenamento aberto até o verificador encerrar. Não há retry automático de auditoria nem fila VERIFY nesta entrega. Registros v2 incluem authorization e authorizedRoot, selados com o registro; leitura v1 mantém os fatos originais e não fabrica autorização ausente.

resources lista registros do journal sem tokens de controle e informa ownerStatus=not_checked: são fatos persistidos, não estado vivo consultado. recover verifica identidade do dono no momento da ação, nunca toma recurso de dono vivo/unverified, limpa contêiner antes da raiz e preserva recursos diante de incerteza. Não repete auditoria interrompida. Journal é obrigatório nesta CLI, com registro antes de create e conclusão depois de a raiz ser removida. Uma criação incerta ainda ausente pode exigir nova consulta; não descarte o diretório de estado enquanto houver limpeza pendente. Recuperação de clientes Docker órfãos e retomada automática de auditorias ainda não estão completas.

## Execução VERIFY pelo MCP

Em Linux, habilite explicitamente com as mesmas três opções da API:

```bash
node scripts/pie.mjs mcp /projeto --db /dados-pie/pie.sqlite --state-dir /dados-pie/privado --docker-bin /usr/bin/docker --docker-host unix:///var/run/docker.sock
```

O catálogo passa a anunciar pie_test_run. A entrada é o grant completo descrito acima, preso à raiz do servidor. Sem as opções a ferramenta não existe; seleção parcial é recusada. A chamada persiste o registro v2 antes da resposta; examine result.state e evidence. BUSY indica operação ativa ou limpeza pendente. Cancelamento da requisição é encaminhado ao coordenador. Encerramento aguarda execução, persistência e limpeza antes de fechar o banco. Não há fila VERIFY ou retry automático.

## Fila de verificação

Em Linux, enfileire com `enqueue-verify /dados-pie/grant.json --key CHAVE` e as opções `--db`, `--state-dir`, `--docker-bin` e `--docker-host` já descritas. Execute `work-verify /projeto` com as mesmas opções para consumir um job. Os comandos `job UUID` e `cancel-job UUID` consultam/cancelam. O worker comum `work` continua exclusivo de descoberta.

VERIFY não admite retry automático: perda de lease resulta em `EXECUTION_INTERRUPTED`, exigindo inspeção do resultado e recuperação de recursos antes de uma nova autorização deliberada. O ID do job identifica também a execução e o journal. Estado succeeded do job significa workflow concluído e prova persistida; examine result.state para saber se testes passaram. PostgreSQL exige aplicar a migração 202610160004 antes de usar essa fila.

## Enfileiramento pela API e pelo MCP

Com VERIFY explicitamente habilitado, `POST /v1/jobs/verification` recebe `{ "idempotencyKey": "chave", "authorization": <grant completo> }`. Exige a mesma autenticação/CSRF das demais mutações. Retorna 202 com job persistido, sem iniciar testes. Use o worker separado `work-verify` para consumir; GET /v1/jobs/:id consulta e POST /v1/jobs/:id/cancel solicita cancelamento, limitados à raiz do servidor.

No MCP habilitado, `pie_verification_enqueue` usa a mesma entrada; `pie_verification_job_get` e `pie_verification_job_cancel` recebem `{ "id": "UUID" }`. Essas ferramentas aceitam apenas jobs VERIFY da raiz escolhida pelo operador. O catálogo padrão continua sem execução/enfileiramento VERIFY. Chave idempotente repetida preserva o pedido; escolha diferente sob a mesma chave é recusada. succeeded do job não significa testes aprovados: confira result.state e a execução persistida.

## Resultados no painel

Abaixo da investigação estática, Verificações executadas lista resultados persistidos do snapshot selecionado, com páginas de dez registros. Atualizar verificações consulta novamente a API; Abrir verificação mostra prova, limpeza, limitações, casos e autorização preservada. Casos têm páginas de 25. Um resultado aprovado vale para os testes autorizados, não para todo o projeto. Ausência de registro é informada explicitamente. O painel também oferece envio explícito de grant para a fila quando essa capacidade está habilitada.

## Autorizar e acompanhar jobs no painel

A seção Autorizar e acompanhar verificação aceita o grant VERIFY completo em JSON e uma chave idempotente escolhida pelo operador. O grant precisa apontar para o snapshot selecionado; servidor valida política, raiz, imagem, expiração e limites. A capacidade depende das opções VERIFY e da fila habilitadas ao iniciar serve; sem isso o formulário fica indisponível.

O envio cria um job, consumido somente pelo worker separado work-verify. O UUID retornado permite consultar e solicitar cancelamento, inclusive após reabrir o painel. Não há polling, retry automático, armazenamento de grants no navegador nem autorização inferida de arquivos. Uma resposta de envio incerta pode ser repetida com a mesma chave e grant. Dados enviados ficam preservados na fila do serviço. Job concluído exige consultar o histórico para interpretar o resultado dos testes.

## Workers em modo contínuo

`work /projeto --db /dados-pie/pie.sqlite --continuous --poll-ms 1000` consome descoberta sequencialmente. `work-verify /projeto --continuous` exige também --db e as três opções explícitas Docker/estado já descritas. O intervalo ocioso aceita 100–30000 ms e exige continuous; sem essa opção cada comando processa um job.

O processo publica uma linha JSON listening e continua em primeiro plano; SIGINT/SIGTERM encerram espera e cancelam/drenam operação ativa antes de liberar recursos. Ao concluir, publica a contagem de jobs processados, que não significa testes aprovados. Falha operacional encerra o processo, sem laço de retry silencioso. Não há instalação automática de serviço do sistema nem repetição de VERIFY interrompido; recuperação continua sendo ação explícita pelo journal.

## Rotas estáticas Next App Router

A descoberta usa uma única AST por arquivo TS/JS/JSX para imports e exports. Arquivos convencionais page geram declarações page com export default de valor; Route Handlers JS/TS geram endpoint para métodos HTTP explicitamente exportados. Os fatos aparecem em declarations e trace pela CLI/MCP/API/painel, com linha e evidência. A convenção usa a [referência oficial de Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route).

Grupos de rota não compõem o padrão; parâmetros dinâmicos são preservados como [id], sem fabricar uma URL concreta. Rotas paralelas/interceptadas/privadas permanecem sem conversão pública. A análise não resolve wildcard, configurações, métodos automáticos, instalação do framework, conflitos ou valor de handler; não confirma rota acessível, autorização, integração com banco ou funcionamento em runtime.

No modo continuous, stdout usa NDJSON: um objeto JSON por linha para a abertura e o resumo final. Comandos de um job mantêm JSON indentado. Uma linha de resumo conta workflows, não testes aprovados.

## Endpoints Express por AST

Declarações express-ast reconhecem chamadas diretas no escopo superior a receptores const originados de import/default/Router ou require express. Método/padrão literal, receptor local, linha e prova são preservados em declarations e trace. Para imports relativos que resolvem a um export local único ou a uma cadeia única de reexports ESM até router comprovado, o prefixo literal do mount compõe o caminho, incluindo mounts locais do router exportado. O grafo conserva `calls` ao relay importado e `depends` por cada reexport até o arquivo das rotas; Evidence de reexport liga a specifier à dependência observada. Ciclos, ambiguidades e arquivos fora do inventário não são compostos. O campo de proveniência `sourcePath` identifica o arquivo de cada derivação cross-file. Isso é uma derivação estática e não prova carregamento, registro ou resposta HTTP em runtime. Referência: [roteamento Express](https://expressjs.com/en/guide/routing/).

Somente caminhos literais começando com / ou * são examinados. Escopos aninhados, aliases mutáveis, cadeias route(), templates dinâmicos, arrays/regex, resolução de handlers e efeitos de código chamado permanecem desconhecidos. Binding require sombreado não é tratado como carregador CommonJS. Imports sem export único comprovado e prefixos não literais não são compostos. Essa observação estática não confirma framework instalado, servidor ouvindo, autenticação nem funcionamento HTTP.

## Rotas Laravel/PHP por AST

Arquivos rastreados `routes/**/*.php` sÃ£o analisados por AST usando [php-parser 3.7.0](https://github.com/glayzzle/php-parser) (BSD-3-Clause), sem executar PHP ou iniciar Laravel. O adapter reconhece a facade `Illuminate\Support\Facades\Route` importada, inclusive alias Ãºnico por namespace, ou explicitamente qualificada. Detecta chamadas diretas `get/head/post/put/patch/delete/options/any`, `match` com mÃ©todos literais e grupos de closure com prefixos literais, inclusive aninhados e opÃ§Ã£o `['prefix' => ...]`. Rotas recebem Evidence estÃ¡tica com arquivo/linha e estado `unverified`.

O parser estÃ¡ configurado para gramÃ¡tica PHP 8.4: rejeiÃ§Ã£o sintÃ¡tica nÃ£o prova invalidade em outras versÃµes e nÃ£o gera declaraÃ§Ãµes. MÃ©todos/caminhos dinÃ¢micos, `resource`/`apiResource`, prefixo dinÃ¢mico, imports ambÃ­guos, chamadas fluentes fora de groups, funÃ§Ãµes/classes, branches/loops, includes/providers e efeitos de middleware nÃ£o sÃ£o resolvidos. Nada disso prova framework instalado, registro real, autorizaÃ§Ã£o, handler ou resposta HTTP.

## Configuração Nginx estática

A descoberta reconhece nginx.conf, nginx.*.conf e arquivos .conf sob diretório nginx. location e diretivas selecionadas listen, server_name, proxy_pass, fastcgi_pass, grpc_pass e include geram fatos nginx-config com linha e evidência. O nome é um array JSON [diretiva, ...argumentos], preservando limites entre argumentos; parent descreve blocos ancestrais por nome de diretiva e linha.

O lexer não expande includes/variáveis nem acessa destinos externos. Comentários, aspas, escapes e blocos são interpretados estaticamente, com profundidade máxima 128. Sintaxe incompleta deixa limitação explícita. A leitura não substitui nginx -t nem comprova configuração efetiva, precedência, TLS ou funcionamento de proxy. Referências: [guia Nginx](https://nginx.org/en/docs/beginners_guide.html) e [lexer oficial](https://github.com/nginx/nginx/blob/master/src/core/ngx_conf_file.c).
Userinfo de autenticação em URI de transporte é substituído por [REDACTED]; caminho, destino e parâmetros restantes permanecem preservados. Outros valores não são redigidos por inferência de nomes.

## Conteúdo dos relatórios de snapshot

export <snapshot-id> --format md/html inclui arquivos com IDs, declarações com contexto/linha, relações do grafo registrado, evidências e seus hashes/metadados, cobertura e limitações. O export valida a integridade antes de serializar e não relê nem executa as fontes. O JSON preserva o snapshot completo. O HTML escapa conteúdo externo e usa CSP sem scripts.

São relatórios de observação estática. Resultados VERIFY persistidos separadamente ainda não são incorporados a esse artefato; consulte verification/verifications para interpretá-los. Ausência de relação ou declaração não comprova ausência de comportamento.

## Análise funcional OBSERVE

`functional <snapshot-id> --module src/app --limit 50 --offset 0` apresenta lacunas de verificação das páginas/endpoints declarados. O módulo é opcional e deve ser caminho relativo canônico. MCP `pie_functional_review` e POST /v1/functional recebem snapshotId, modulePath opcional e paginação; todos usam o mesmo serviço. A API mantém autenticação/origem/CSRF.

O resultado informa evidência, incerteza, passos de reprodução propostos, proposta e critérios de aceite. São achados informativos unverified, não defeitos comprovados. Não executa código, não infere autoridade de URLs e não aprova rota com base em testes sem vínculo. owner null significa responsável ainda não definido. A análise é derivada do snapshot, sem persistência própria de auditoria; motor funcional completo, cenários executáveis e histórico de findings permanecem em desenvolvimento.

## Lacunas funcionais no painel

A seção Lacunas de verificação funcional consulta a análise OBSERVE do snapshot selecionado. Informe módulo relativo opcional e clique Analisar lacunas funcionais; navegue pelas páginas e abra a prova da declaração ou os critérios de validação propostos. O estado permanece não verificado/informativo. A análise não executa cenários, comprova defeitos nem aprova o projeto. Ao trocar módulo ou snapshot, a prova selecionada é limpa; ausência de declarações é informada sem concluir ausência de funcionalidades.

## Preservar análise funcional

functional-retain <snapshot-id> --module <caminho> --limit <n> --offset <n> salva explicitamente a página analisada como registro imutável. functional-record <id> lê e verifica o registro. MCP usa pie_functional_retain e pie_functional_record_get; API usa POST /v1/functional-records (mesma entrada da análise) e GET /v1/functional-records/:id. Salvar é operação distinta da consulta funcional, que continua sem gravar.

Registros preservam pedido, resultado paginado, data, snapshot e hash canônico; validam fatos/evidências contra o snapshot. Não são prova runtime e não representam páginas omitidas. Mesmo ID não pode substituir conteúdo histórico. PostgreSQL exige migration 202610160005 antes destas operações. Listagem paginada de análises, contestação e interface de retenção ainda estão pendentes.

## Listar análises preservadas

functional-records <snapshot-id> --limit 50 --offset 0 lista o histórico pelo snapshot. MCP pie_functional_records_list recebe snapshotId e paginação; HTTP GET /v1/functional-records usa snapshotId, limit e offset na query. Ordenação é por data e ID, limite máximo 200. Cada resumo indica módulo e offset/quantidade/total da página analisada, ID e hash do registro completo. O estado unverified não representa aprovação; a leitura por ID recupera a página original preservada.

## Histórico funcional no painel

Depois de analisar, Salvar página analisada preserva a página corrente no serviço. Análises funcionais preservadas lista registros por snapshot com paginação, módulo e cobertura da página. Abrir análise recupera o registro original e seu SHA-256, inclusive após reload. Achados e prova da declaração continuam disponíveis; o histórico não recalcula o texto com o motor atual.

Cada salvamento explícito cria um novo registro. Se houver resposta incerta, consulte/atualize o histórico antes de decidir salvar novamente; o painel não repete gravações automaticamente. Registros persistidos não aprovam funcionalidade e não autorizam execução. Contestação e reteste vinculado ainda estão pendentes.

A comparação de snapshots inclui declarationChanges com paginação independente: observações antes/depois e provas preservadas. source_changed indica alteração de bytes da fonte; observed_only_before/after não comprovam remoção/adição de comportamento; ambiguous preserva ocorrências sem inventar alinhamento. Não comprova regressão runtime.

No painel, Comparar versões mostra declarações antes/depois e abre a prova de cada versão. A paginação alcança todos os arquivos e declarações da comparação. Texto traduzido mantém limitações: ausência de observação não comprova remoção, bytes alterados não comprovam mudança de comportamento e ocorrências ambíguas não são alinhadas por suposição.

## Planejamento de retestes

retest-plan <antes-id> <depois-id> --mode affected|full --limit 50 --offset 0 lista candidatos no snapshot posterior. A saída schema v2 contém `planDigest`, identidade determinística da seleção completa independente de página. MCP pie_retest_plan recebe beforeId/afterId/mode e paginação; API POST /v1/retest-plan usa o mesmo JSON autenticado. affected seleciona testes alcançados pelo impacto registrado nas duas versões; full lista todos os arquivos classificados como teste observados na versão posterior.

Plano não autoriza execução nem produz grant automaticamente. Para vincular uma escolha explícita, inclua no grant VERIFY `retestPlan: { beforeSnapshotId, mode, planDigest }` retornado para esses snapshots e escolha em `testFiles` somente candidatos daquele plano. O coordenador recalcula o digest e a seleção usando os snapshots persistidos na admissão e novamente antes da execução; grant fora do plano é recusado. A autorização/registro imutável preserva o vínculo. A classificação por nome e imports não comprovam cobertura; compatibilidade do runner permanece `not_probed`. Dependências não resolvidas/dinâmicas podem omitir candidatos. Nenhum candidato não equivale a aprovação. Testes removidos/não observados são contados, não executados como se ainda existissem.

## Candidatos a reteste no painel

Após Comparar snapshots, Planejamento de retestes permite selecionar Impacto registrado nas duas versões ou Todos os testes observados na versão posterior. Planejar retestes consulta o serviço; tabelas paginadas mostram motivo e prova de cada candidato. Modo consultado é exibido para distinguir o resultado dos controles ainda não submetidos. Seleção não autoriza nem executa código. Arquivos classificados como teste podem exigir outro runner; compatibilidade fica não verificada. Nenhum candidato não comprova ausência de regressão.

A evidência derivada de uma diretiva com userinfo de transporte removido recebe redactionStatus=redacted e uma limitação descrevendo a transformação. O inventário sem conteúdo coletado mantém not_collected. Metadados são definidos pelo parser/coletor produtor, sem inferência posterior pelo nome da declaração; registros históricos não são reescritos.

## Desenvolvimento do runner HTTP

httpTransport.ts e httpProbe.ts são módulos internos em integração, sem comando público. Teste real: tests/boundary/pieHttpTransport.test.ts. Transporte permite GET/HEAD a endereço literal 127.0.0.1, porta explícita e caminho ASCII codificado; não usa DNS/proxy/cookies nem segue redirects. O workflow exige grant VERIFY separado para requisição local, snapshot, raiz autorizada, prazo/limites, status esperado, digest opcional e TTL.

Resultado passed se refere apenas à asserção status/digest de resposta completa. Não prova que o processo responde pela revisão do snapshot, nem jornada/persistência/permissões. Capturas parciais nunca aprovam; corpo e headers não são retidos. Falhas preservam status/bytes/digest parcial e tag. Persistência, habilitação explícita em adaptadores públicos e isolamento/identidade do serviço alvo ainda precisam ser integrados antes de anunciar o runner completo.
