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

## PIE-2026-002 — instalação/update do pacote não verificados neste host Windows

- **Severidade:** informativa (lacuna de validação T0.2/T0.3).
- **Observado:** `npm run verify:package` criou tarball, mas a preparação falhou com `EPERM` ao criar symlink de fixture antes da etapa de instalação/update, conforme auditoria upstream registrada.
- **Reprodução:** usar host Windows com a configuração de permissões observada e executar `npm run verify:package`; a evidência disponível não inclui instalação global, atualização, uninstall ou smoke MCP do pacote instalado.
- **Causa-raiz:** o ambiente impediu a criação do symlink da fixture. Não está demonstrado que seja defeito do instalador nem que a instalação funcione.
- **Correção/estado:** não corrigido; bloqueio de verificação do host, não finding de runtime. Seguir por CI Linux/Windows apropriada ou mecanismo de fixture que preserve o teste sem symlink, depois fazer instalação limpa e upgrade.
- **Risco residual:** CLI/MCP distribuídos, setup reversível e rollback permanecem não comprovados.

## Findings de aplicações auditadas

Nenhum finding sobre aplicação de usuário foi aberto nesta etapa: não houve alvo cliente autorizado e verificado. Os defeitos semeados exigidos pelo blueprint devem ser criados somente em fixtures isoladas de teste e registrados quando seus motores produzirem resultados reproduzíveis.
