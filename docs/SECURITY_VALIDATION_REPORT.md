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
- `pieApiScope.test.ts` reproduziu inicialmente `200` em `/v1/graph/:snapshotId` entre duas raízes na mesma base. Após correção, testes negativos de snapshots, Evidence, projetos, análises, exportações e listas retornam `404` para dados externos; projetos listados ficam limitados à raiz configurada. `pieApiScope`, `pieApi` e `pieJobs`: 7 passaram, 1 PostgreSQL skipped.
- `tests/boundary/pieProductWeb.test.ts` percorreu sessão real do painel local e leitura autenticada de Evidence; é evidência da jornada do painel PIE, não de um projeto-alvo.
- Inventário de licenças roda em `docs:check`; não equivale a scanner de vulnerabilidades.

## Lacunas e limitações

1. A matriz de leituras históricas por raiz foi testada; falta validação PostgreSQL real, revisão final de efeitos de escrita, fuzzing, concorrência e coverage externa.
2. Não foram executados SAST/SCA, scanner de segredos, fuzzing, teste de carga, pentest, varredura externa nem teste multi-tenant. Não alegar que esses controles passaram.
3. Retenção, descarte, backups, finalidade e atendimento a direitos LGPD precisam de inventário próprio; código não substitui decisões do controlador ou avaliação jurídica.
4. O relatório não se aplica a sistemas que o PIE analisa. O motor de segurança universal permanece incompleto e T4.3 não está concluído.

## Próximos passos

Executar `pieApi.test.ts` e boundaries de `scopedJob`; mapear a tabela de rotas e seus efeitos; investigar scanners locais autorizados; depois adicionar regressões negativas para qualquer lacuna reproduzida. Registrar como finding confirmado somente comportamento reproduzido e vinculado à Evidence.
