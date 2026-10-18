# Auditoria upstream REA e decisão de derivação PIE

## Estado publicado — 17/10/2026

O fork e o projeto PIE foram sincronizados no SHA `9732f293585b4d1ebaed5d3f642e12199331dfe3`; `origin/main` e `rea-fork/main` conferem e `upstream/main` (`926e18b3f`) é ancestral. API confirma `fernandinhomartins40/rea` com `fork=true`, parent `morluto/rea`; `PIE-ProjectIntelligenceEngine` permanece independente (`fork=false`). Apenas `main` local existe. CI do SHA sincronizado está pendente nos dois repositórios; evidências em `PIE_VALIDATION_REPORT.md`.

## Seguimento do upstream corrente — 17/10/2026

O fork e `origin/main` foram primeiro sincronizados em `744c44c1d`, que preservava o upstream no momento da criação. O upstream avançou para `926e18b3f` (54 commits exclusivos sobre o fork); merge-tree não reportou conflitos. Merge `734f5d20c` integrou esse HEAD em `main`; `git merge-base --is-ancestor upstream/main HEAD` passou. O conjunto alterou 268 arquivos (16.796 inserções, 3.083 remoções), sem mudanças em `src/pie`, painel, testes SQLite, manifest/lockfile ou Prisma. `pie:build`, `check:fast`, `docs:check:built`, `format:check` e os testes `ciPortableBuildCache`/`windowsTargetSeparators` passaram (5 pass, 1 skip). O SHA resultante `9732f293585b4d1ebaed5d3f642e12199331dfe3` foi publicado em ambas as mains e confirmado via `git fetch`/`rev-parse`. CI do SHA está pendente nos dois repositórios. O upstream pode avançar novamente; registrar sempre o SHA observado.

## Estado atualizado — fork e sincronização histórica — 17/10/2026

O repositório `fernandinhomartins40/PIE-ProjectIntelligenceEngine` continua independente no GitHub (`fork=false`). Com autorização do usuário, foi criado `fernandinhomartins40/rea` pela API oficial de fork; resposta confirmou `fork=true`, parent `morluto/rea`, default branch `main`. Remotos locais: `origin` para o projeto PIE, `upstream` para `morluto/rea` e `rea-fork` para o fork da conta. Push foi desabilitado localmente em `upstream` e `rea-fork` até completar a integração, evitando escrita acidental.

Na criação do fork, seu HEAD estava 93 commits à frente e 67 atrás do PIE. `main` integrou essa história por merge sem conflitos (`f9da18125`), preservando a ancestralidade e sem criar branch. Esse primeiro merge alterou 391 arquivos upstream, mas não alterou `src/pie`, `apps/web`, manifests ou Prisma; as duas mains foram atualizadas depois dos checks e do boundary SQLite registrados em `PIE_VALIDATION_REPORT.md`.

Data: 16/10/2026. Método: leitura de código local, metadados Git e GitHub; execução somente onde registrada no relatório de validação.

## Identidade e procedência

- Fonte oficial: https://github.com/morluto/rea, branch `main`.
- Commit importado com histórico: `4838f444939677107902549c59b73439e14d3ae9`.
- Versão do manifesto: 6.5.0; não pressupor equivalência entre HEAD e a tag publicada.
- Branch local atual: `main`, renomeada da branch inicial `pie/integration` por solicitação explícita do usuário, sem criar outra branch. Base preservada em `upstream/main`.
- `origin`: https://github.com/fernandinhomartins40/PIE-ProjectIntelligenceEngine.git, vazio ao iniciar.
- API pública GitHub reportou `fork: false` para origin. Portanto existe derivação local autorizada, mas **não foi criado fork remoto na rede GitHub**. CLI gh ausente; autenticação para API de escrita não estabelecida. Não reclassificar o repositório nem publicar alterações remotamente por suposição.
- Documentação fornecida estava na pasta irmã PIE_DOCUMENTACAO_COMPLETA; copiada integralmente para docs/blueprint.

## Arquitetura observada

| Área                  | Fonte real                                                         | Responsabilidade / limite                                                                          |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Despacho              | scripts/rea.mjs; src/cli.ts:1; src/main.ts:1                       | CLI Incur e MCP stdio distintos sobre workflows compartilhados                                     |
| Composição            | src/composition/; docs/architecture.mermaid:1                      | Factories de provedores/sessões; carregamento opcional independente                                |
| MCP                   | src/server/createServer.ts:287; src/server/EvidenceMcpServer.ts:1  | Registro de ferramentas, entrega limitada, SDK MCP e contexto de cancelamento                      |
| Contratos             | src/contracts/toolContracts.ts; src/contracts/toolContractTypes.ts | Contratos nomeados e schemas; catálogo gerado não é fonte manual                                   |
| Exemplo de ferramenta | src/server/registerGoTools.ts:11                                   | Contrato exato → serviço → EvidenceWriter; não depende da ordem do catálogo                        |
| Domínio               | src/domain/                                                        | Evidência, grafos de aplicação, comparação, erros e Result sem provedores                          |
| Evidências            | src/domain/evidence.ts:127, :171, :342                             | Schema estrito; identidade ev_ por digest; validação da identidade, confidence e limitations       |
| Ledger                | src/application/investigation/EvidenceLedger.ts:44                 | Registro e import atômico; rejeita conflito por identidade. Não é banco de histórico multi-projeto |
| Sessões               | src/application/; src/composition/binary.ts                        | Binding de alvo/provedor e snapshots; não equivale a Project/Environment PIE                       |
| Execução              | src/process/; src/windows/; native/windows/                        | Ownership, cancelamento, limites, cleanup e Windows Job Objects. Não é sandbox de código hostil    |
| Browser/JS            | src/browser/; src/javascript/; src/artifacts/javascript/           | CDP/Playwright, parsers e reconstrução; estático não comprova comportamento                        |
| Nativos               | src/hopper/; src/ghidra/; src/ida/; bridge/                        | Motores externos, contratos e transportes; indisponibilidade não deve impedir PIE                  |
| Outros                | src/dotnet/, android/, firmware/, sqlite/, pcap/, wasm/, evm/      | Perfis específicos e pré-requisitos; suporte não universal                                         |
| Configuração          | src/config/; src/application/Setup*                                | Env validado, planos de setup e backups; não modificar clientes durante auditoria                  |
| Testes                | tests/; src/**/*.test.ts; vitest.config.ts; docs/testing.md        | Vitest por projetos, fronteiras CLI/MCP, aceitação e provedores reais separados                    |
| CI                    | .github/workflows/ci.yml:1 e real-*.yml                            | Gates estáticos, builds, documentação e lanes específicas de provedores                            |
| Website               | website/                                                           | Documentação/marketing REA; não é painel operacional PIE                                           |

`src/domain/evidence.ts:127` inclui subject, provider, analysis_profile, parâmetros, resultados raw/normalizado, confidence, authority, environment, limitations, locations e evidence_links. O PIE precisa acrescentar contexto imutável de projeto, revisão, snapshot, auditRun, timestamp, sensibilidade e retenção; não inventar esses campos no contrato original.

O manifesto raiz usa TypeScript/Node ESM, npm 11.16.0, Turbo 2.11.7, Zod 4.4.3, SDK MCP 2.3.1, Babel parser, Playwright-core e Vitest 5.0.3. A árvore atual não fornece backend PostgreSQL/Prisma nem os seis motores PIE. A versão .nvmrc é Node 24.18.0; o host começou em 22.17.1, incompatível com engines.

## Licenças e redistribuição

`LICENSE:1` é MIT, copyright 2026 morluto, preservado integralmente. `THIRD_PARTY_NOTICES.md:1`, `licenses/README.md:1`, `licenses/npm-dependencies.txt`, `licenses/npm-runtime-notices.txt` e licenças sob third_party permanecem com suas condições. `.gitmodules` declara referências externas; não inicializadas automaticamente.

Hopper, IDA/Hex-Rays e JEB possuem termos comerciais próprios; a licença MIT dos bridges não concede direitos sobre motores. Ghidra tem Apache e qualificações por componente; ferramentas GPL/LGPL e runtime Windows têm notices específicos. Há lacunas de atribuição já documentadas upstream (clean-git-ref, minimisted e Frida); não declarar inventário juridicamente completo. Não foram empacotados motores externos. Novas dependências exigirão atualização do inventário e revisão da distribuição concreta.

## Matriz de reutilização / ADR 001

| Componente                             | Decisão                   | Justificativa e manutenção                                                                         |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| Histórico/licenças/notices             | reutilizar                | Mantém proveniência, atualização via upstream e obrigações                                         |
| Result, semântica de evidência e erros | reutilizar/adaptar        | Contratos fortes; envelope PIE sem alterar identidade REA                                          |
| CLI/MCP                                | adaptar                   | Serviços PIE compartilhados, namespace pie_; não rebatizar identidade oficial no catálogo original |
| Ledger de investigação                 | isolar                    | Semântica vinculada à sessão REA; persistência PIE por projeto é domínio separado                  |
| Provedores nativos e bridges           | isolar                    | Opcionais, sem aquisição de alvos ou instalação automática                                         |
| Ownership/processos                    | reutilizar onde aplicável | Não duplicar supervisão; confirmar disponibilidade Windows antes de habilitar execução             |
| Grafo JS existente                     | adaptar posteriormente    | Útil como evidência de imports; não supre grafo completo página→banco→teste                        |
| Website REA                            | preservar/isolar          | Não reutilizar como painel com dados fictícios                                                     |
| Núcleo, DB, jobs, seis motores, painel | implementar               | Capacidades novas; integração com contratos estáveis e testes por fatia                            |

Escolha: evoluir o fork sem reescrever módulos upstream. Iniciar o domínio PIE separado e permitir caracterização upstream antes de refatoração. Não afirmar compatibilidade MCP, sandbox, disponibilidade de motores ou funcionamento com base apenas nesta leitura.

## Baseline de runtime e pacote — 17/10/2026

Remotes atuais: `origin` é `fernandinhomartins40/PIE-ProjectIntelligenceEngine`; `upstream` é `morluto/rea`. `upstream/main` e o merge-base continuam em `4838f444939677107902549c59b73439e14d3ae9`. O HEAD PIE preserva essa ancestralidade; o fork remoto na rede GitHub continua não confirmado (`fork: false` na última consulta documentada).

O host foi executado com Node `v24.18.0` de `.nvmrc`; `npm@11.16.0` foi obtido pelo npx no cache. O tarball de mesmo pacote/versão `rea-agents@6.5.0` foi baixado (`shasum 7ea5e6f669bc18c45dbf5dba653edaa1ada07ab3`, SRI `sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==`). Foram extraídos somente `native/windows/build/manifest.json` e `rea-windows-x64.node` para o diretório ignorado previsto pelo projeto. `node scripts/verify-windows-native-artifact.mjs` aprovou versão, plataforma win32/x64, ABI 1, Node-API 8 e SHA-256 `665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed`.

`npx.cmd --yes npm@11.16.0 run build:cached` passou: compilou o runtime e gerou os metadados de skill. `node scripts/pie.mjs --help` e `node scripts/rea.mjs --help` retornaram help. Um cliente MCP stdio real iniciou `scripts/rea.mjs --mcp`, completou `initialize` e `tools/list`: servidor `rea@6.5.0`, protocolo `2025-03-26`, 207 ferramentas; nenhuma ferramenta `pie_*`, pois PIE usa dispatcher/servidor separado. `node_modules/.bin/vitest.cmd run --config vitest.config.ts tests/boundary/mcp/pieMcp.test.ts` passou (1 teste), cobrindo cliente stdio, igualdade CLI/MCP e Ajv sobre o serviço PIE. `vitest ... src/domain/evidence.test.ts src/application/investigation/EvidenceLedger.test.ts` passou 36 testes (27 Evidence, 9 Ledger).

`npx.cmd --yes npm@11.16.0 run verify:package` completou as etapas de skill e geração do tarball, mas falhou ao criar symlink de fixture em `scripts/verify-package-environment.mjs` (`EPERM`, Windows) antes da instalação do pacote. Portanto instalação global, update, MCP do pacote instalado, setup/uninstall e comparativos de startup não estão provados neste host por essa rodada. Nenhum provedor REA externo ou aplicação-alvo foi iniciado. Licenças do tarball são preservadas; esta caracterização não fecha revisão jurídica nem comprova o fork remoto.

## Snapshot upstream 6.7.0 - 18/10/2026

`git fetch` atualizou explicitamente os refs em 18/10/2026. `upstream/main` está em `c12d9eda87aa5a022ee7e18ea96d8d03bfd12e96` (tag `rea-agents-6.7.0` em `27dc42d10`); merge-base com PIE `926e18b3fcb334c21d60685546ba8145d35d344e`. `git rev-list --left-right --count upstream/main...HEAD` retorna `101 215`: 101 commits upstream-only e 215 commits locais-only. O diff da linha upstream desde o ancestral comum altera 510 arquivos, incluindo setup/processos, CLI, CI, manifests/dependências e providers. A simulação `git merge-tree --write-tree HEAD upstream/main` retornou conflito (exit 1) em exatamente quatro caminhos do lifecycle compartilhado: `src/process/ProviderProcess.ts`, `src/process/ProviderProcessOutput.test.ts`, `tests/boundary/process/providerProcessOutput.test.ts` e `tests/fixtures/providerProcess.mjs`; outras mudanças, como `package.json` e `package-lock.json`, foram mescladas textualmente pela simulação. Nenhum merge ou cherry-pick foi aplicado; o worktree permaneceu limpo. O hash de árvore provisória emitido por essa simulação não é um commit nem evidência de compatibilidade.

O ref `rea-fork/main` observado é `d200b8618d85aecffc359d29a908438a7da28749`, ancestral do PIE atual; `git rev-list --left-right --count rea-fork/main...HEAD` retorna `0 118`. `origin/main` e HEAD PIE estão em `80872c6ea0c28d2f835343e5522c754bc4f21404`. O push de `rea-fork` segue desabilitado localmente; nenhum estado remoto foi escrito durante esta diligência. A atualização integral do upstream não foi executada: antes dela é necessário resolver e validar os quatro conflitos no supervisor de processo, conferir dependências/avisos e testar as mudanças selecionadas. Nenhum teste upstream 6.7 foi executado nesta atualização.

### Adaptacao local do lifecycle de output - 18/10/2026

A correção upstream `701695139490777ece7a3ccb8508b6215a11c0fe` retém diagnóstico até fechar pipes, limita saída adicional no cleanup e retries e marca stream perdido como incompleto. O patch direto nao aplicou na base PIE por divergir de commits intermediarios; a mudanca foi adaptada manualmente em `src/process/ProviderProcess.ts`, que o executor Docker PIE realmente utiliza. Verificados `ProviderProcessOutput` e boundaries do processo/Docker PIE: 24 passaram, 1 skipped (pipe herdado POSIX em Windows); `pie:build`, `check:fast`, `docs:check`, `format:check` e `git diff --check` passaram. Sem merge da história upstream 6.7 e sem execução POSIX real neste host.

### Revalidação de refs e simulação de merge - 18/10/2026

Na revisão após `80872c6ea`, a simulação atual mostrou conflitos nos quatro arquivos de lifecycle listados acima, ao contrário da observação anterior que não incluía as alterações locais mais recentes do supervisor. A nova observação substitui aquela conclusão apenas quanto à resolubilidade textual; as medições históricas dos SHAs anteriores permanecem históricas. Nenhum merge foi iniciado no worktree.
