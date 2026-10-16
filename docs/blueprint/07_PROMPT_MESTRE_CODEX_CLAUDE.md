# Prompt mestre para Codex / Claude Code

> Cole o texto abaixo no agente, com a pasta deste pacote dentro do workspace. Não executar antes de revisar permissões e ter acesso ao repositório.

---

Atue como uma equipe sênior de engenharia de produto, arquitetura de software, segurança, observabilidade, infraestrutura, UX e testes. Vamos construir **PIE — Project Intelligence Engine**, uma plataforma completa e open source para investigar aplicações reais, comprovar funcionamento, identificar oportunidades e riscos, orientar correções e validar resultados.

**Leia integralmente e siga** todos os documentos em `docs/blueprint/`, começando por `00_LEIA_PRIMEIRO.md` e `06_PLANO_MESTRE_IMPLEMENTACAO.md`, incluindo os três protocolos em `docs/blueprint/protocolos/`. Os documentos são a especificação de referência; se houver contradição técnica com o código upstream, registre a evidência e proponha solução consistente sem inventar capacidades.

**Repositório upstream oficial:** https://github.com/morluto/rea. Quero **fazer um fork legítimo do REA e evoluí-lo para o PIE**. Antes de alterar qualquer código, investigue o upstream real: arquitetura, MCP, CLI, contratos, evidências, sessões, testes, dependências, licenças e pontos de extensão. Registre commit SHA e uma matriz de reutilização. Se o fork remoto exigir minha autenticação, peça apenas essa autorização; não afirme que o fork foi criado sem confirmação. Preserve atribuições e notices de terceiros.

**Produto completo, sem MVP artificial:** implemente CLI, MCP, painel web responsivo em pt-BR, motor de descoberta, grafo de relações, evidências versionadas, execução segura, seis motores (Funcionalidades; Produto/UX; Segurança/LGPD/Receita; VPS/Performance; Dados/Integrações; Regressões), histórico, análise incremental, planejamento, integração com agentes e validação independente. Organize o trabalho por dependências, com entregas reais integradas e testes. Não considere o projeto concluído por ter criado somente estrutura, telas, endpoints vazios, mocks ou relatórios.

**Princípio fundamental:** não confunda código existente com comportamento comprovado. Cada conclusão deve indicar evidência, revisão, ambiente, método e limites. O que não foi executado deve aparecer como **não verificado**. Dados reais do projeto auditado, nunca simulações disfarçadas; fixtures sintéticas são permitidas apenas em testes isolados.

**Fluxo obrigatório:** INSPECIONAR REA → PLANEJAR ARQUITETURA → IMPLEMENTAR POR MÓDULOS INTEGRADOS → TESTAR → CORRIGIR → VALIDAR → REGISTRAR EVIDÊNCIAS → CONTINUAR. Crie e mantenha `docs/PIE_MASTER_PLAN.md`, `docs/UPSTREAM_REA_AUDIT.md`, `docs/PIE_VALIDATION_REPORT.md` e `docs/PIE_HANDOFF.md`.

**Segurança operacional:** produção somente leitura por padrão; não faça ataques a alvos externos, mudanças destrutivas, migrações perigosas, uso de credenciais não autorizadas, instalação de ferramentas privilegiadas nem operações com custos sem autorização. Em caso de bloqueio real, registre e continue tarefas independentes. Não modifique repositórios de aplicações auditadas fora de branches autorizadas.

**Tecnologia:** aproveite arquitetura e bibliotecas existentes do REA onde fizer sentido; TypeScript/Node, MCP, React, PostgreSQL/Prisma, Playwright, parsers e Docker são propostas, não desculpa para reescrever upstream sem análise. Adapte à realidade do código e mantenha extensibilidade para qualquer stack auditada.

**Critério de conclusão:** todas as capacidades previstas integradas, testes positivos e negativos executados, falhas corrigidas, documentação de instalação e atualização, licenças preservadas, UI responsiva, testes de regressão e evidências auditáveis. Informe claramente cobertura, limitações e riscos residuais. Não pare apenas em recomendações; implemente tudo que for seguro e possível no ambiente.

Comece agora pela inspeção real do REA, criação do plano mestre e preparação do fork autorizado; depois avance de forma contínua pelas entregas integradas.
