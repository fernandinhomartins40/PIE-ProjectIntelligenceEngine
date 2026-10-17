# Plano mestre — desenvolvimento integral do PIE

## Estratégia

**Construir o produto completo, não um MVP reduzido.** Trabalhar em pacotes e entregas integradas, com critérios de aceite, evitando um único prompt que gere milhares de arquivos sem testes. Uma etapa concluída não significa produto concluído. Manter `docs/PIE_MASTER_PLAN.md` com status real e pendências.

## Trilha 0 — diligência e fork (pré-requisito)

- Validar upstream, criar fork autorizado, registrar SHA/tag, licença e notices.
- Inspecionar arquitetura real, MCP/CLI, evidência, sessões, tests e CI.
- Publicar `UPSTREAM_REA_AUDIT.md`, matriz reutilizar/adaptar/isolar/substituir, ADRs.
- Executar testes upstream e registrar baseline, inclusive falhas existentes.
  **Saída:** decisão técnica fundamentada, fork rastreável, nenhuma falsa alegação de compatibilidade.

## Trilha 1 — plataforma e experiência

- Estrutura de pacotes compatível com upstream; API, CLI, MCP, painel responsivo em pt-BR.
- Configuração de projetos, ambientes, autorização e perfis de execução.
- Persistência, migrations, autenticação local quando necessária, jobs e logs auditáveis.
- Gestão de evidências, snapshots, histórico e exports.
  **Aceite:** usuário cadastra projeto, inicia auditoria, acompanha execução e consulta evidências reais por UI/CLI/MCP.

## Trilha 2 — descoberta e grafo

- Detecção de monorepos e stack; adaptadores iniciais com cobertura declarada.
- Inventário de rotas, componentes, serviços, banco, permissões, integrações e testes.
- Grafo navegável, consulta por funcionalidade, diff por commit e proveniência.
  **Aceite:** fixture multistack com relações conhecidas; sem alucinação de dependências.

## Trilha 3 — verificação real

- Test runners, Playwright, HTTP, banco de teste, jobs, logs e traces.
- Classificador de estado de funcionalidade e rastreabilidade de evidências.
- Execução isolada, timeouts, retries controlados, autorização e cancelamento.
  **Aceite:** detectar falhas sem considerar teste não executado como sucesso.

## Trilha 4 — seis motores

- Funcional; Produto/UX; Segurança/LGPD/Receita; VPS/Performance; Dados/Integrações; Regressão.
- Cada motor com contratos, plugins, testes negativos e telas/CLI correspondentes.
- Integrar os três protocolos fornecidos, sem copiá-los parcialmente ou contrariá-los.
  **Aceite:** suíte de defeitos semeados em fixtures demonstra detecção em cada motor.

## Trilha 5 — planejamento e integração com agentes

- Plano unificado sem duplicação, priorização por impacto/risco/esforço.
- Pacotes de contexto e handoff para Codex/Claude Code; patches em branch.
- Aprovações para mudanças sensíveis; validação pós-correção e rollback.
  **Aceite:** defeito reproduzido, corrigido pelo agente, retestado e historicamente rastreável.

## Trilha 6 — operação, performance e distribuição

- Incremental Git/CI, notificações opcionais, histórico e exportações.
- Instalação CLI/MCP com `doctor`, setup reversível, Docker Compose para painel/API/DB se necessário.
- Guia de desenvolvimento, contribuição, segurança, privacidade, licenças e upgrade upstream.
- Teste em Windows/Linux/macOS conforme matriz de suporte declarada; não prometer suporte sem execução.
  **Aceite:** instalação limpa reproduzível, CI verde, smoke E2E, documentação e limites conhecidos.

## Dependências e paralelismo

Trilha 0 antes de modificar upstream; Trilha 1 e design dos contratos da Trilha 2 em paralelo após diligência; motores podem ser construídos em paralelo após congelar contratos; testes e segurança atravessam todas as trilhas. Não duplicar componentes. Integrar continuamente, nunca deixar seis branches incompatíveis para o final.

## Definition of Done por entrega

Código real + integração real + migrations + testes positivos/negativos + docs + evidências + revisão de segurança + UX responsiva (se houver UI) + medição de recursos quando pertinente + status atualizado. Se qualquer item aplicável faltar, estado `parcial`.

## Prioridades

P0: riscos destrutivos, segurança, isolamento, persistência e contrato MCP. P1: funcionamento e evidências. P2: qualidade UX, desempenho e integração. P3: conveniências. Prioridade **não é remoção de escopo**.

## Instrução de execução contínua

O agente deve avançar automaticamente entre tarefas seguras e independentes, sempre executando testes. Se o contexto da sessão acabar, persistir progresso em `docs/PIE_MASTER_PLAN.md` e `docs/PIE_HANDOFF.md` com próximo passo preciso. Não dizer “finalizado” com pendências bloqueantes.
