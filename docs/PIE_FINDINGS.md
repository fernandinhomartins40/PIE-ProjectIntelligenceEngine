# Findings de validação e desenvolvimento PIE

Registro inicial baseado em evidências do código e dos testes locais/CI já documentados. Findings sobre o próprio PIE não são findings de uma aplicação cliente. Evidência AST permanece estática. Atualize o status somente após reproduzir e retestar na revisão registrada.

## PIE-2026-001 — HEAD com ref inválida podia ser interpretada como ausência de commit

- **Severidade:** média (integridade de identidade do snapshot).
- **Origem:** revisão de código da descoberta Git; inicialmente reproduzido com repositório real sem commit e `HEAD` simbólica apontando a ref corrompida.
- **Observado:** `git rev-parse --verify HEAD` produz erro em ambos os casos; a implementação inicial convertia qualquer falha em `revision: null`, e uma primeira regressão só verificava código `IO_ERROR`, sem identificar a causa.
- **Causa-raiz:** `git symbolic-ref HEAD` falha quando o destino simbólico está inválido, então não serve para distinguir ref ausente de conteúdo malformado. A representação do estado unborn não era comprovada.
- **Correção:** ler `HEAD` e a ref no diretório Git canônico, validar formato/nome pelo Git, inspecionar referências soltas/empacotadas e retornar revisão nula apenas para ref local realmente ausente. O teste exige a mensagem específica da ref malformada.
- **Reprodução/validação:** `node scripts/run-exact-tests.mjs tests/boundary/pieFoundation.test.ts`; 10/10 passaram na revisão `f3e979496`. `pie:build`, `check:fast`, `docs:check:built`, `format:check` também passaram conforme `PIE_VALIDATION_REPORT.md`.
- **Estado:** resolvido no código e publicado na `main` dos dois remotos; sem validação Linux/macOS.
- **Limite residual:** sem teste de concorrência com mutação do diretório `.git` durante leitura; snapshot inteiro não é atômico.

## PIE-2026-002 — lacuna de verificação do pacote Windows

- **Severidade:** informativa (lacuna de validação T0.2/T0.3).
- **Observado:** `npm run verify:package` genérico criou tarball, mas parou com `EPERM` na criação de symlink da fixture. Depois, `npm run verify:package:windows` passou em Node 24.18/npm 11.16, exercitando instalação do tarball, CLI/MCP, setup, uninstall e update exato.
- **Reprodução:** `npm run verify:package` reproduz o bloqueio do caso de symlink; `npm run verify:package:windows`, com Node 24.18.0 e npm 11.16.0, verifica o fluxo de distribuição Windows sem depender daqueles casos.
- **Causa-raiz:** o host não autorizou symlinks no verifier genérico; isso é independente do instalador. O verifier específico Windows comprovou o escopo de distribuição acima.
- **Correção/estado:** lacuna de evidência de instalação/update Windows resolvida pelo verifier específico, sem alterar o verifier genérico nem seus casos de symlink. Resultado publicado em `PIE_VALIDATION_REPORT.md`.
- **Risco residual:** Linux/macOS, casos de symlink, rollback do update e outros cenários do verifier genérico continuam sem validação local neste finding; revisão legal permanece separada.

## PIE-2026-003 — caminho 8.3 contornava a fronteira do workspace no Windows

- **Severidade:** alta (isolamento do ambiente VERIFY).
- **Origem:** regressão de admissão em `pieExecutionAdmission.test.ts`, 17/10/2026.
- **Observado:** o snapshot preservava `C:\Users\Usuário\...`, enquanto o host resolvia `parent` como `C:\Users\USURIO~2\...`. `realpathSync` preservava as representações distintas; `relative()` interpretava o mesmo diretório como externo e permitia criar `pie-verify-*` dentro do repositório.
- **Causa-raiz:** comparação de identidade de diretório dependia da forma textual devolvida por `realpathSync` no Windows, incluindo alias 8.3 versus nome Unicode longo.
- **Correção:** `prepareWorkspace` compara `realpathSync.native` dos dois caminhos antes de criar qualquer recurso. O teste de boundary verifica que preparar a cópia usando a própria raiz do alvo é recusado e não deixa recursos.
- **Reprodução/validação:** antes da correção, `pieExecutionAdmission.test.ts` observou `ok: true` e a pasta criada dentro do repositório. Depois, a boundary passou; também passaram as suítes de execução e comparação, `check:fast`, `pie:build`, catálogo MCP (15/15 schemas), `docs:check:built` e `format:check` nesta revisão local.
- **Estado:** corrigido localmente; aguarda commit/push nesta revisão.
- **Limite residual:** não há validação Linux/macOS deste caso nem execução real do container Docker nesta rodada.

## Findings de aplicações auditadas

Nenhum finding sobre aplicação de usuário foi aberto nesta etapa: não houve alvo cliente autorizado e verificado. Os defeitos semeados exigidos pelo blueprint devem ser criados somente em fixtures isoladas de teste e registrados quando seus motores produzirem resultados reproduzíveis.
