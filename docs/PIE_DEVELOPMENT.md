# Desenvolvimento PIE

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
