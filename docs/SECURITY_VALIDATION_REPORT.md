# Relatório de validação de segurança do PIE

## Auditoria SCA npm — 18/10/2026

- `npm.cmd audit --json`: código 0; 0 vulnerabilidades reportadas (info/low/moderate/high/critical) entre 902 dependências. O registry foi consultado durante a execução; o resultado representa advisories conhecidos naquele momento.
- `.github/workflows/pie.yml` agora executa `npm audit --audit-level=low` no lockfile, depois de `npm ci --ignore-scripts --no-audit --no-fund`. A etapa passou junto com o job PostgreSQL completo na execução CI `39103950984`.
- Essa verificação cobre apenas o grafo npm atual e a base de advisories acessível ao registry. Não cobre segredos, SAST/taint, outros ecossistemas, configuração efetiva ou uma avaliação completa de segurança/LGPD; SEC-07 permanece parcial até execução CI desta mudança.

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
- O adapter YAML do snapshot retém Evidence por linha para `permissions: write-all` literal no workflow e em jobs nomeados sob `.github/workflows/`. O finding inclui job name JSON-quoted; fixture com newline escapado confirma que o conteúdo não injeta linhas no campo. A análise mantém permissões granulares fora da regra e exige o hash atual da Evidence. Eventos, token efetivo, condição de disparo e política de fork/org não foram observados; estado continua `suspected`, `unassessed`, `not_run`.
- Os adapters donos de `package.json` e `package-lock.json` emitem facts sem guardar URLs. O lock npm v2/v3 só suprime finding quando spec raiz é idêntica e resolução Git do pacote direto contém SHA completo; diretório, dependência e hash do spec devem corresponder. A boundary comprova supressão com lock atual, finding quando o spec diverge e quando o lockfile muda depois do snapshot, além de referências registry/Git já fixadas sem alerta e não vazamento da URL `example.invalid`. Lock v1, aliases, workspaces, rede, instalação e CVEs não são verificados.
- O parser YAML do produtor de declarações reconhece ações remotas em `jobs.<id>.uses` e `steps[].uses`; sem SHA completo produz fato com job, linha e hash da referência, não a URL/string completa. Boundary cobre workflow reutilizável `@main`, ação de step `@v4`, SHA completo, caminho `./`, Docker e expressão dinâmica. O finding requer Evidence atual e continua suspeito; não prova execução nem acesso a token. Nenhuma action foi consultada ou executada. O kind público comum distingue workflow reutilizável de action de step pela condição observada.
- A saída estrita de `security-review` é schemaVersion 5, com coberturas parciais para supply chain e configurações de container; isso não representa SCA integral nem validação de runtime.
- `npm.cmd audit --offline --json` executou sem rede e retornou código 0, zero vulnerabilidades reportadas e 902 dependências no inventário local. A idade e completude do cache de advisories não foram verificadas; este resultado não prova ausência de CVEs e não integra npm audit ao motor PIE.
- Findings carregam condição, impacto potencial, probabilidade `unassessed`, reprodução proposta, remediação, regressões propostas, `verificationStatus: not_run` e responsável desconhecido (`owner: null`), alinhados ao contrato e protocolo universais. Esses campos orientam triagem; não afirmam que a reprodução foi executada nem que a correção foi aplicada.
- `npm run test:focused -- tests/boundary/pieSecurityReview.test.ts`: 2 boundaries passaram após `pie:build`, verificando repositório Git real, valores canário ausentes, paginação, arquivo alterado, teto de 10.000 findings e paridade do mesmo serviço por CLI, API autenticada e MCP com schema validado.
- `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts tests/boundary/pieAdapters.test.ts`: 13/13 passaram na implementação de permissões; inclui parser/facts, Evidence/linha, stale hash, permissão de job granular não alertada, `read-all` não alertado, limite, redaction e paridade de adapters/schema. Não executa workflows GitHub Actions nem consulta token.
- `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts tests/boundary/pieAdapters.test.ts`: 13/13 passaram após a regra estática de referência Git sem SHA; cobre workflow/job, segredo, AST, referência `github:` mutável, versão de registry, commit completo, não divulgação da URL, stale Evidence e paridade CLI/API/MCP com Ajv. Não consulta rede nem lockfile.
- A lane `PIE integration` do GitHub Actions run `39065504175` passou para o SHA `66e2c3b14`, incluindo a implementação e as duas boundaries então vigentes. O inventário separado de endpoints `unverified` foi acrescentado depois desse SHA; depende da CI do próximo commit.

## Lacunas e limitações

1. A matriz de leituras históricas por raiz passou em SQLite local e PostgreSQL real na CI; falta revisão final de efeitos de escrita, fuzzing, concorrência e cobertura externa.
2. Não foram executados SAST, scanner de segredos, fuzzing, teste de carga, pentest, varredura externa nem teste multi-tenant. `npm audit --offline` retornou zero findings com advisories locais, cuja atualidade é desconhecida; isso não substitui SCA atualizado nem integração ao motor.
3. Retenção, descarte, backups, finalidade e atendimento a direitos LGPD precisam de inventário próprio; código não substitui decisões do controlador ou avaliação jurídica.
4. A revisão cobre somente seis formatos conhecidos de credenciais, construções AST de execução dinâmica, dois padrões TLS literais, permissões `write-all`, `uses` GitHub remoto sem SHA e referências Git de `package.json` correlacionadas a um subconjunto de package-lock npm v2/v3, dentro dos limites atuais de arquivos/bytes. Não valida credenciais/tokens, demais lockfiles, advisories/CVEs, autorização geral, SSRF, XSS, retenção ou lógicas de receita. O motor universal permanece incompleto e T4.3 não está concluído.

## Próximos passos

Executar `pieApi.test.ts` e boundaries de `scopedJob`; mapear a tabela de rotas e seus efeitos; investigar scanners locais autorizados; depois adicionar regressões negativas para qualquer lacuna reproduzida. Registrar como finding confirmado somente comportamento reproduzido e vinculado à Evidence.

## Finding estatico de host networking Compose — 18/10/2026

O engine de seguranca agora reconhece somente `network_mode: host` literal quando o arquivo Compose continua igual ao hash da Evidence do snapshot. O resultado e `suspected`, severidade alta e probabilidade `unassessed`; nao afirma que o servico foi ativado, que a rede suporta o modo ou que o host esta exposto. A regra nao reinterpreta YAML e nao le includes/extends.

Validacao: `npm.cmd run pie:build`; `npm.cmd run test:focused -- tests/boundary/pieSecurityReview.test.ts` passou 2/2. O teste integrado percorreu Git/SQLite, CLI, API autenticada, MCP stdio/Ajv e invalidacao ao editar `compose.yaml`. Docker real, overrides, rede efetiva e runtime nao foram verificados.

## Painel Security Review do PIE - 18/10/2026

A investigação web local agora consulta o contrato comum do motor de segurança e mostra findings suspeitos, superfícies de autorização não verificadas e Evidence acessível. E2E Chrome percorreu finding Compose network_mode: host, abriu Evidence e validou larguras 360/1440 sem overflow após correção de título longo na triagem. Isso valida a UI do PIE, não a segurança runtime de um alvo nem conformidade LGPD.

### Compose privileged declarado

SchemaVersion 5 inclui `compose_privileged_container` quando o adapter observa `privileged: true` literal em serviço Compose e o hash do arquivo continua atual. A boundary exercita Evidence/linha, categoria, CLI/API/MCP e schema; quando a configuração muda para `network_mode: bridge`, ambos findings de container deixam de aparecer. Adapter e painel exibem também `privileged_mode` como fato declarado. Não foram executados Docker/Compose nem verificados overrides, capacidades efetivas ou runtime. `pieSecurityReview`: 2/2; adapter, infraestrutura, UI e gates gerais são reportados pela execução desta entrega.
