# Auditoria upstream REA e decisão de derivação PIE

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

| Área | Fonte real | Responsabilidade / limite |
|---|---|---|
| Despacho | scripts/rea.mjs; src/cli.ts:1; src/main.ts:1 | CLI Incur e MCP stdio distintos sobre workflows compartilhados |
| Composição | src/composition/; docs/architecture.mermaid:1 | Factories de provedores/sessões; carregamento opcional independente |
| MCP | src/server/createServer.ts:287; src/server/EvidenceMcpServer.ts:1 | Registro de ferramentas, entrega limitada, SDK MCP e contexto de cancelamento |
| Contratos | src/contracts/toolContracts.ts; src/contracts/toolContractTypes.ts | Contratos nomeados e schemas; catálogo gerado não é fonte manual |
| Exemplo de ferramenta | src/server/registerGoTools.ts:11 | Contrato exato → serviço → EvidenceWriter; não depende da ordem do catálogo |
| Domínio | src/domain/ | Evidência, grafos de aplicação, comparação, erros e Result sem provedores |
| Evidências | src/domain/evidence.ts:127, :171, :342 | Schema estrito; identidade ev_ por digest; validação da identidade, confidence e limitations |
| Ledger | src/application/investigation/EvidenceLedger.ts:44 | Registro e import atômico; rejeita conflito por identidade. Não é banco de histórico multi-projeto |
| Sessões | src/application/; src/composition/binary.ts | Binding de alvo/provedor e snapshots; não equivale a Project/Environment PIE |
| Execução | src/process/; src/windows/; native/windows/ | Ownership, cancelamento, limites, cleanup e Windows Job Objects. Não é sandbox de código hostil |
| Browser/JS | src/browser/; src/javascript/; src/artifacts/javascript/ | CDP/Playwright, parsers e reconstrução; estático não comprova comportamento |
| Nativos | src/hopper/; src/ghidra/; src/ida/; bridge/ | Motores externos, contratos e transportes; indisponibilidade não deve impedir PIE |
| Outros | src/dotnet/, android/, firmware/, sqlite/, pcap/, wasm/, evm/ | Perfis específicos e pré-requisitos; suporte não universal |
| Configuração | src/config/; src/application/Setup* | Env validado, planos de setup e backups; não modificar clientes durante auditoria |
| Testes | tests/; src/**/*.test.ts; vitest.config.ts; docs/testing.md | Vitest por projetos, fronteiras CLI/MCP, aceitação e provedores reais separados |
| CI | .github/workflows/ci.yml:1 e real-*.yml | Gates estáticos, builds, documentação e lanes específicas de provedores |
| Website | website/ | Documentação/marketing REA; não é painel operacional PIE |

`src/domain/evidence.ts:127` inclui subject, provider, analysis_profile, parâmetros, resultados raw/normalizado, confidence, authority, environment, limitations, locations e evidence_links. O PIE precisa acrescentar contexto imutável de projeto, revisão, snapshot, auditRun, timestamp, sensibilidade e retenção; não inventar esses campos no contrato original.

O manifesto raiz usa TypeScript/Node ESM, npm 11.16.0, Turbo 2.11.7, Zod 4.4.3, SDK MCP 2.3.1, Babel parser, Playwright-core e Vitest 5.0.3. A árvore atual não fornece backend PostgreSQL/Prisma nem os seis motores PIE. A versão .nvmrc é Node 24.18.0; o host começou em 22.17.1, incompatível com engines.

## Licenças e redistribuição

`LICENSE:1` é MIT, copyright 2026 morluto, preservado integralmente. `THIRD_PARTY_NOTICES.md:1`, `licenses/README.md:1`, `licenses/npm-dependencies.txt`, `licenses/npm-runtime-notices.txt` e licenças sob third_party permanecem com suas condições. `.gitmodules` declara referências externas; não inicializadas automaticamente.

Hopper, IDA/Hex-Rays e JEB possuem termos comerciais próprios; a licença MIT dos bridges não concede direitos sobre motores. Ghidra tem Apache e qualificações por componente; ferramentas GPL/LGPL e runtime Windows têm notices específicos. Há lacunas de atribuição já documentadas upstream (clean-git-ref, minimisted e Frida); não declarar inventário juridicamente completo. Não foram empacotados motores externos. Novas dependências exigirão atualização do inventário e revisão da distribuição concreta.

## Matriz de reutilização / ADR 001

| Componente | Decisão | Justificativa e manutenção |
|---|---|---|
| Histórico/licenças/notices | reutilizar | Mantém proveniência, atualização via upstream e obrigações |
| Result, semântica de evidência e erros | reutilizar/adaptar | Contratos fortes; envelope PIE sem alterar identidade REA |
| CLI/MCP | adaptar | Serviços PIE compartilhados, namespace pie_; não rebatizar identidade oficial no catálogo original |
| Ledger de investigação | isolar | Semântica vinculada à sessão REA; persistência PIE por projeto é domínio separado |
| Provedores nativos e bridges | isolar | Opcionais, sem aquisição de alvos ou instalação automática |
| Ownership/processos | reutilizar onde aplicável | Não duplicar supervisão; confirmar disponibilidade Windows antes de habilitar execução |
| Grafo JS existente | adaptar posteriormente | Útil como evidência de imports; não supre grafo completo página→banco→teste |
| Website REA | preservar/isolar | Não reutilizar como painel com dados fictícios |
| Núcleo, DB, jobs, seis motores, painel | implementar | Capacidades novas; integração com contratos estáveis e testes por fatia |

Escolha: evoluir o fork sem reescrever módulos upstream. Iniciar o domínio PIE separado e permitir caracterização upstream antes de refatoração. Não afirmar compatibilidade MCP, sandbox, disponibilidade de motores ou funcionamento com base apenas nesta leitura.
