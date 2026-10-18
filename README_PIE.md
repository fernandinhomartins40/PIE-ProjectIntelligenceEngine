# PIE — Project Intelligence Engine

Execução MCP opcional: `mcp <raiz>` aceita `--state-dir`, `--docker-bin` e `--docker-host` juntos para habilitar `pie_test_run` em Linux. Cada chamada exige autorização VERIFY completa; sem essas opções o catálogo não oferece execução. Veja [desenvolvimento](docs/PIE_DEVELOPMENT.md).

Projeto em desenvolvimento nesta pasta, derivado do REA com histórico e licenças preservados. O escopo integral e os critérios de aceite estão em [docs/PIE_MASTER_PLAN.md](docs/PIE_MASTER_PLAN.md) e [docs/blueprint/](docs/blueprint/).

Implementação atual: inventário Git e declarações de stacks, imports AST TS/JS, comparação de snapshots e impacto, evidências com SHA-256, persistência SQLite/PostgreSQL, fila de descoberta, CLI, MCP stdio, API local autenticada e exportação JSON/Markdown/HTML. A revisão de infraestrutura apresenta fatos estáticos selecionados de Compose, Nginx e Dockerfile; eles não executam builds nem comprovam containers, configuração efetiva ou métricas de runtime. As capacidades pendentes estão explícitas no plano; o produto completo ainda não está concluído.

Instruções de execução: [docs/PIE_DEVELOPMENT.md](docs/PIE_DEVELOPMENT.md). Evidências de testes: [docs/PIE_VALIDATION_REPORT.md](docs/PIE_VALIDATION_REPORT.md).

O painel React local acompanha `npm run pie:build`. Inicie `node scripts/pie.mjs serve CAMINHO_DO_PROJETO --db CAMINHO_DO_BANCO_FORA_DO_PROJETO` com `PIE_API_TOKEN` definido (32–512 caracteres) e abra a URL loopback impressa. A conexão usa sessão HttpOnly e CSRF; a credencial não vai para armazenamento do navegador. `--api-only` mantém apenas a API Bearer. O painel consulta descobertas reais, evidências, relações e comparação de snapshots; correções/retestes e os seis motores ainda estão pendentes.

O [README original REA](README.md), a [licença MIT](LICENSE) e os [notices de terceiros](THIRD_PARTY_NOTICES.md) permanecem preservados. PIE é um projeto independente, sem afiliação oficial com REA. O pacote está privado para impedir publicação acidental sob a identidade npm upstream.

O desenvolvimento e a publicação Git deste projeto usam a branch `main`, conforme orientação do responsável.

Resultados de verificação persistidos podem ser lidos por `verification <run-id>` e `verifications <snapshot-id>`, pelas ferramentas MCP `pie_verification_get`/`pie_verifications_list` e pela API autenticada `GET /v1/verification/:id`/`GET /v1/verifications/:snapshotId`. A consulta verifica a evidência e não inicia testes. A CLI Linux oferece `verify` com arquivo de autorização explícito e journal obrigatório, `resources` e `recover`; requisitos e limites estão em [execução VERIFY](docs/PIE_DEVELOPMENT.md#execução-verify-pela-cli-linux).

O servidor pode habilitar `POST /v1/verify` com as mesmas opções explícitas de estado/Docker na inicialização. O padrão mantém execução desabilitada. CLI e API compartilham o coordenador; novos registros v2 preservam a autorização completa, enquanto registros v1 continuam legíveis sem dados inventados.
