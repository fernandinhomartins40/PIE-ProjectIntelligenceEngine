# Checklist de aceite — PIE completo

> Não marcar itens por impressão ou porque a IA disse que fez. Anexar teste, screenshot, log, commit ou relatório correspondente.

## Fork, governança e licenças

- [ ] Fork remoto realmente criado na conta autorizada e `upstream` configurado.
- [ ] SHA/tag upstream registrados; arquitetura real auditada e matriz de reutilização produzida.
- [ ] Licença MIT e notices de terceiros preservados; ferramentas comerciais opcionais e legalmente licenciadas.
- [ ] Testes upstream aplicáveis continuam executando ou divergências são justificadas.

## Núcleo e experiência

- [ ] CLI com help, doctor, projetos, auditorias e relatórios funcionais.
- [ ] MCP com contratos versionados, validação, paginação, erros e permissões.
- [ ] Painel responsivo desktop/tablet/mobile em pt-BR, acessível por teclado.
- [ ] API, DB, migrations, workers, histórico e recuperação de jobs funcionando.
- [ ] Perfis OBSERVE/VERIFY/CHANGE e aprovações efetivas.

## Descoberta e evidências

- [ ] Descoberta multi-stack com matriz de cobertura explícita.
- [ ] Grafo página→API→serviço→banco→permissão→teste com proveniência.
- [ ] Evidência versionada por commit/ambiente; dados sensíveis redigidos.
- [ ] `unverified`, `blocked`, `skipped` jamais tratados como `passed`.

## Motores

- [ ] Funcional: detecta fluxo incompleto e comprova fluxos reais.
- [ ] Produto: recomenda simplificações com evidências e critérios de impacto.
- [ ] Segurança/LGPD/Receita: detecta falhas de autorização, isolamento e pagamento em fixtures.
- [ ] VPS: mede baseline e comparação, sem prejudicar dados/serviços.
- [ ] Dados: detecta migrações/contratos inconsistentes e falhas de idempotência.
- [ ] Regressão: identifica impacto do diff e retesta componentes afetados.

## Operação e distribuição

- [ ] Auditoria completa e seletiva com histórico, filtros e exportação.
- [ ] Handoff de correção ao agente com arquivos, evidências e testes.
- [ ] Correção demonstrada em branch, reteste e diff antes/depois.
- [ ] CI com lint, typecheck, unit, integração, E2E, segurança e contratos.
- [ ] Instalação e atualização documentadas; `doctor` identifica pré-requisitos ausentes.
- [ ] Testes de limites CPU/RAM/timeouts/cancelamento.
- [ ] Relatório final explicita itens pendentes, bloqueios e riscos residuais.

## Demonstração obrigatória

Executar uma aplicação fixture autorizada com falhas propositalmente inseridas: rota quebrada, autorização cross-tenant, uso premium sem entitlement, consumo duplo de créditos, query lenta, migração incompatível e regressão funcional. Comprovar detecção, localização, plano, correção isolada e reteste. Demonstrar também que a ausência de credenciais não vira aprovação falsa.
