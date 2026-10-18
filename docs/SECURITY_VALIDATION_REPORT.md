# Relatório de validação de segurança do PIE

Data: 17/10/2026. Escopo: implementação da API/painel local do PIE, conforme código e testes existentes. O trabalho é uma revisão técnica parcial; não declara risco zero, certificação ou conformidade integral com a LGPD.

## Inventário e controles observados

- A API escuta em `127.0.0.1`; confere Host e rejeita Origin incompatível. Rotas exigem bearer token de comparação constante no tempo ou sessão web válida.
- Quando o painel está habilitado, a sessão usa cookie HttpOnly/SameSite Strict, token CSRF em operações de escrita, duração limitada e teto local de sessões. Login tem limite de tentativas por janela.
- O corpo JSON tem limite de 16 KiB; respostas incluem `no-store`, `nosniff` e CSP. A API limita o acesso à raiz configurada; rotas históricas conferem o snapshot/projeto proprietário e `/v1/projects` filtra antes de paginar; jobs usam acesso escopado.
- Grants VERIFY e de sondagem HTTP vinculam snapshot, digest, validade e limites. Isso não comprova isolamento perfeito nem que um endpoint observado pertence ao código do snapshot.
- O modo atual é local-first; o código PIE não apresentou fluxos de usuários/tenants comerciais ou pagamentos no escopo desta revisão. Não aplicar achados SaaS por suposição.

## Validação executada

- `node scripts/run-exact-tests.mjs tests/boundary/pieBrowserSessions.test.ts`: 3 testes passaram, cobrindo cookie sem segredo, leitura versus escrita com CSRF/origin, rejeição de token incorreto, expiração, rate limit e evicção bounded.
- `node scripts/run-exact-tests.mjs tests/boundary/pieApi.test.ts tests/boundary/pieJobs.test.ts`: 6 testes passaram e 1 PostgreSQL foi skipped por configuração ausente. A API verifica ausência de autenticação, Origin externa, VERIFY sem configuração, corpo oversized e paginação inválida; jobs usam fila/worker SQLite real, com um caminho opcional indisponível/skipped. Isso não é teste entre dois tenants.
- `pieApiScope.test.ts` reproduziu inicialmente `200` em `/v1/graph/:snapshotId` entre duas raízes na mesma base. Após correção, testes negativos de snapshots, Evidence, projetos, análises, exportações e listas retornam `404` para dados externos; projetos listados ficam limitados à raiz configurada. `pieApiScope`, `pieApi` e `pieJobs`: 7 passaram localmente, 1 PostgreSQL skipped pela ausência de `PIE_TEST_DATABASE_URL`. Separadamente, `PIE integration` run `39063676154` no GitHub Actions passou no SHA `b7f9d53b3`; essa lane executou o teste PostgreSQL real (ownership e paginação entre duas raízes) e o conjunto full PIE.
- `tests/boundary/pieProductWeb.test.ts` percorreu sessão real do painel local e leitura autenticada de Evidence; é evidência da jornada do painel PIE, não de um projeto-alvo.
- Inventário de licenças roda em `docs:check`; não equivale a scanner de vulnerabilidades.
- O incremento `security-review` procura formatos AWS access key, GitHub token, Slack token, Stripe live secret, Google API key e marcador de chave privada. Relê somente arquivos com Evidence estática e confirma que o hash dos bytes atuais corresponde ao hash selado do snapshot; mudanças desde a descoberta são omitidas e reduzem cobertura. Os valores nunca entram no relatório, que registra tipo, linha, Evidence, suspeita e incerteza.
- Endpoints presentes nas declarações do snapshot são listados separadamente como superfícies de autorização `unverified`, com Evidence e verificações negativas sugeridas. Isso não infere ausência/presença de middleware e não declara a rota segura ou vulnerável.
- O parser Babel AST também identifica chamadas globais diretas a `eval`, `Function()` e `new Function()` em JavaScript/TypeScript, ignorando nomes sombreados, propriedades e texto em comentários/strings. As suspeitas apontam arquivo/linha/Evidence, omitem o código e explicitam que não houve taint analysis, prova de alcançabilidade ou fluxo controlado por usuário.
- O mesmo parser marca como suspeitas duas formas literais de desativar validação TLS: propriedade `rejectUnauthorized: false` e atribuição `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` (string ou número). A boundary integrada também confirma que `rejectUnauthorized: true` não produz finding. A análise não verifica se a configuração alcança uma conexão, e a rejeição runtime de certificados inválidos permanece proposta, não executada.
- O adapter YAML do snapshot agora retém Evidence por linha para `permissions: write-all` somente no nível raiz de workflows sob `.github/workflows/`. Segurança consome esse fato do adapter e exige que o arquivo atual ainda corresponda ao hash do snapshot. Boundary Git/SQLite real verifica linha/Evidence e finding `workflow_privilege`, mantém `contents: write` granular de job fora desse padrão, não alerta `read-all` e omite o finding se o arquivo mudar depois da descoberta. Eventos, token efetivo, condição de disparo e política de fork/org não foram observados; estado do finding continua `suspected`, probabilidade `unassessed` e validação `not_run`.
- Findings carregam condição, impacto potencial, probabilidade `unassessed`, reprodução proposta, remediação, regressões propostas, `verificationStatus: not_run` e responsável desconhecido (`owner: null`), alinhados ao contrato e protocolo universais. Esses campos orientam triagem; não afirmam que a reprodução foi executada nem que a correção foi aplicada.
- `npm run test:focused -- tests/boundary/pieSecurityReview.test.ts`: 2 boundaries passaram após `pie:build`, verificando repositório Git real, valores canário ausentes, paginação, arquivo alterado, teto de 10.000 findings e paridade do mesmo serviço por CLI, API autenticada e MCP com schema validado.
- `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts tests/boundary/pieAdapters.test.ts`: 13/13 passaram na implementação de permissões; inclui parser/facts, Evidence/linha, stale hash, permissão de job granular não alertada, `read-all` não alertado, limite, redaction e paridade de adapters/schema. Não executa workflows GitHub Actions nem consulta token.
- A lane `PIE integration` do GitHub Actions run `39065504175` passou para o SHA `66e2c3b14`, incluindo a implementação e as duas boundaries então vigentes. O inventário separado de endpoints `unverified` foi acrescentado depois desse SHA; depende da CI do próximo commit.

## Lacunas e limitações

1. A matriz de leituras históricas por raiz passou em SQLite local e PostgreSQL real na CI; falta revisão final de efeitos de escrita, fuzzing, concorrência e cobertura externa.
2. Não foram executados SAST/SCA, scanner de segredos, fuzzing, teste de carga, pentest, varredura externa nem teste multi-tenant. Não alegar que esses controles passaram.
3. Retenção, descarte, backups, finalidade e atendimento a direitos LGPD precisam de inventário próprio; código não substitui decisões do controlador ou avaliação jurídica.
4. A revisão cobre somente seis formatos conhecidos de credenciais, construções AST de execução dinâmica, dois padrões literais TLS e `permissions: write-all` literal no nível do workflow GitHub Actions em arquivos rastreados atuais, até 10.000 arquivos, 1 MB por arquivo e 50 MB por execução; não valida credenciais/tokens nem detecta falhas gerais de autorização, SSRF, XSS, dependências vulneráveis, retenção ou lógicas de receita. O motor universal permanece incompleto e T4.3 não está concluído.

## Próximos passos

Executar `pieApi.test.ts` e boundaries de `scopedJob`; mapear a tabela de rotas e seus efeitos; investigar scanners locais autorizados; depois adicionar regressões negativas para qualquer lacuna reproduzida. Registrar como finding confirmado somente comportamento reproduzido e vinculado à Evidence.
