# PIE — Project Intelligence Engine | Pacote de implementação

**Versão:** 1.0 — especificação de engenharia, 16/10/2026. **Idioma do produto:** pt-BR. **Estado:** projeto proposto, não software implementado.

## Objetivo

Criar uma ferramenta completa, local-first, open source, de inteligência de aplicações que investigue **código, comportamento real, dados, segurança, produto, desempenho e infraestrutura**, produza evidências auditáveis e permita a Codex/Claude Code corrigir e verificar problemas.

**Não é apenas um gerador de relatórios** nem um clone do REA. O PIE deve diferenciar claramente **implementado**, **verificado**, **falhando**, **parcial**, **não localizado** e **não verificável no ambiente**.

## Leia nesta ordem

1. `01_VISAO_PRODUTO_E_ESCOPO.md` — visão e requisitos completos.
2. `02_ESTUDO_REA_E_ESTRATEGIA_DE_FORK.md` — fork, proveniência e inspeção real do upstream.
3. `03_ARQUITETURA_TECNICA.md` — componentes, dados, contratos e segurança.
4. `04_MOTORES_E_CRITERIOS_DE_ACEITE.md` — especificação dos seis motores.
5. `05_EXECUCAO_SEGURA_E_VALIDACAO.md` — execução, testes, métricas e gates de risco.
6. `06_PLANO_MESTRE_IMPLEMENTACAO.md` — plano completo por dependências.
7. `07_PROMPT_MESTRE_CODEX_CLAUDE.md` — prompt de execução para o agente.
8. `08_CHECKLIST_ACEITE_FINAL.md` — critérios objetivos para entrega.
9. `protocolos/` — três protocolos universais já definidos, a integrar como políticas especializadas.

## Como iniciar

1. Crie um repositório de trabalho **PIE**, isolado dos projetos auditados.
2. Copie este pacote para `docs/blueprint/` no repositório PIE.
3. Envie ao Codex/Claude Code o conteúdo de `07_PROMPT_MESTRE_CODEX_CLAUDE.md`.
4. O agente deve primeiro inspecionar o upstream real do REA, registrar commit/licenças e só então decidir como executar o fork, preservando o objetivo de criar o PIE completo.

## Política de qualidade

- **Escopo integral, execução incremental e integrada**: não limitar o produto a um MVP artificial; também não declarar concluído o que não foi testado.
- Dados reais do projeto auditado; fixtures sintéticas apenas em testes isolados. Sem telas demonstrativas com informações inventadas.
- Nenhuma alteração destrutiva, ataque externo, instalação privilegiada ou modificação em produção sem autorização explícita.
- Falta de acesso é `nao_verificado`, não `aprovado`.
- Toda conclusão precisa apontar para fonte verificável e data/versão.

## Fontes principais

- REA oficial: https://github.com/morluto/rea
- Documentação: https://rea.tools
- MCP: https://modelcontextprotocol.io
- OWASP ASVS: https://github.com/OWASP/ASVS
- OWASP Secure Coding with AI: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html
- ANPD: https://www.gov.br/anpd/pt-br

**Nota:** não foi realizado clone nem auditoria local do código do REA neste pacote. A documentação pública foi consultada; o reconhecimento detalhado do upstream é uma etapa obrigatória da implementação.
