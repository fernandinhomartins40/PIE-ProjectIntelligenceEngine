# PROTOCOLO UNIVERSAL — SEGURANÇA, LGPD E PROTEÇÃO DE RECEITA

> Para Codex, Claude Code, Cursor e outros agentes de desenvolvimento. Aplicável a qualquer stack. Versão 1.0.
>
> Missão: identificar e corrigir riscos técnicos, de privacidade e de lógica comercial com evidências, testes e preservação do funcionamento legítimo. Não existe garantia de risco zero nem certificação automática de conformidade com a LGPD.

## 1. Fluxo obrigatório

**DESCOBRIR → MAPEAR AMEAÇAS → VERIFICAR → PRIORIZAR → CORRIGIR → RETESTAR → VALIDAR**.

Execute o fluxo continuamente. Não pare após entregar diagnóstico. Não invente resultados de testes ou acessos. Consulte o responsável apenas em caso de decisão de negócio ou jurídica não inferível, alteração destrutiva, acesso externo necessário, custo novo, operação de risco em produção ou testes invasivos sem autorização.

## 2. Regras de segurança operacional

- Analise o repositório e configurações reais; não presuma linguagem, framework, provedor de pagamento ou infraestrutura.
- Preserve dados, funcionalidades, regras comerciais legítimas, migrações e compatibilidade. Não faça refatorações fora do escopo.
- Não exponha credenciais, tokens, chaves, senhas, dados pessoais ou segredos em relatórios, logs e prompts.
- Nunca execute exploração em sistemas de terceiros, testes destrutivos, varreduras externas não autorizadas, cobranças reais ou alterações sensíveis diretamente em produção.
- Prefira testes locais ou staging, com usuários, tenants, dados e credenciais de teste. Em produção, priorize inspeções passivas e correções com plano de rollback.
- Diferencie fatos comprovados, suspeitas, lacunas sem teste e riscos residuais. Não marque como corrigido algo que não foi validado.
- Use controles nativos da stack e bibliotecas consolidadas. Evite reinventar criptografia ou adicionar ferramentas sem necessidade.
- Documente decisões e evidências sem revelar detalhes exploráveis ou informações sensíveis.

## 3. Descoberta e inventário

Identifique:

1. Arquitetura, ambientes, serviços, rotas, APIs, jobs, workers, webhooks e integrações.
2. Autenticação, autorização, perfis, sessões, cookies, tokens e recuperação de acesso.
3. Modelos de usuários, organizações, tenants e relações de propriedade dos dados.
4. Dados pessoais e sensíveis, finalidades declaradas, retenção, compartilhamento e armazenamento.
5. Assinaturas, planos, pagamentos, licenças, testes grátis, créditos, cotas, limites, descontos, reembolsos e períodos de tolerância.
6. Fluxos de administração, suporte, impersonação, importação/exportação e operações privilegiadas.
7. Segredos, CI/CD, Docker, serviços expostos, permissões, backups, logs e monitoramento.
8. Ferramentas de IA, MCPs, agentes, modelos, dados enviados a terceiros, custos e permissões.

Se não houver determinado recurso, registre como não aplicável; não invente módulos.

## 4. Modelagem de ameaças baseada no produto

Mapeie ativos, atores, fronteiras de confiança, entradas e fluxos críticos. Inclua visitante, usuário autenticado, administrador, operador, usuário de outro tenant, assinante ativo, inadimplente e sem créditos quando existirem.

Priorize ameaças de acesso indevido, vazamento, alteração de dados, indisponibilidade, fraude, abuso de recursos e prejuízo financeiro. Para cada achado, registre arquivo/rota, condição, impacto, evidência, probabilidade, severidade, correção e teste de regressão.

## 5. Autenticação e sessões

Verifique hashing adequado de senhas, proteção contra enumeração e força bruta, MFA quando apropriado, recuperação e troca de senha, invalidação de sessão, expiração, proteção de cookies, CSRF quando aplicável, rotação de tokens, controle de dispositivos e revogação. Nunca confie em atributos do cliente para determinar identidade.

## 6. Autorização e isolamento de dados

Verifique autorização no servidor em toda operação, incluindo APIs, jobs, WebSockets, exports, uploads, ações em lote e consultas por ID. Aplique menor privilégio e deny-by-default.

Teste IDOR/BOLA, escalada horizontal/vertical, alteração de identificadores, acesso a registros de outro usuário ou tenant, manipulação de papéis e ausência de escopo de organização nas consultas. Teste com ao menos dois tenants de teste quando a aplicação for multi-tenant.

## 7. PROTEÇÃO DE RECEITA — PRIORIDADE CRÍTICA

**Nunca trate o frontend, uma URL de sucesso ou um campo enviado pelo cliente como prova de pagamento ou direito de uso.**

Identifique a fonte de verdade de assinaturas, pagamentos, planos, créditos, cotas e licenças. Centralize decisões de entitlement no backend, com checagem por usuário/tenant, recurso, estado e período. Respeite regras legítimas de teste, cortesia, tolerância, suspensão, cancelamento, estorno e reembolso; não as altere sem definição comercial.

Audite e teste, quando aplicável:

- Recurso premium chamado diretamente por API, job, fila, GraphQL, WebSocket ou URL conhecida.
- Acesso com assinatura inexistente, pendente, vencida, cancelada, suspensa ou estornada.
- Manipulação de plano, preço, desconto, status, limite ou saldo pelo navegador/API.
- Reutilização de sessão, token, link, licença ou benefício de outro cliente.
- Troca de tenant, compartilhamento de recursos entre organizações e permissões herdadas.
- Webhooks falsificados, sem verificação de assinatura, fora de ordem, repetidos ou atrasados.
- Reconciliação de eventos do provedor e estado local; não conceder benefício por redirecionamento de checkout.
- Idempotência em pagamento, concessão de benefício, estorno, recarga e consumo.
- Concorrência em créditos, cotas e inventário: transações atômicas, bloqueio ou controle equivalente para impedir saldo negativo e duplo gasto.
- Limites de requisição, custos de APIs externas e IA, rate limiting, orçamento, alertas e abuso automatizado.
- Modificação de relógio local, manipulação de armazenamento do navegador e bypass de feature flags.

Crie uma **matriz de direitos comerciais** por perfil, plano, estado de cobrança e funcionalidade, baseada nas regras reais encontradas. Implemente testes negativos e de concorrência em ambiente controlado. Não confunda bloquear acesso com bloquear dados que o cliente legalmente deve poder exportar ou consultar.

## 8. APIs, entradas e lógica de negócio

Verifique validação no servidor, parametrização de queries, autorização por objeto e propriedade, mass assignment, XSS, CSRF, SSRF, upload e download seguros, path traversal, desserialização, CORS, limites de tamanho, paginação, rate limiting e abuso de workflows. Analise operações fora de ordem, estados inválidos e requisições concorrentes. Evite exposição de detalhes internos em mensagens de erro.

## 9. Dados, banco e integridade

Verifique constraints, chaves estrangeiras, transações, consistência entre estados, migrações, rollback, backups, restauração testada, acesso mínimo ao banco, criptografia adequada em trânsito e repouso quando necessária, segregação de ambientes, logs de auditoria e política de retenção. Não exclua registros nem altere esquemas de forma destrutiva sem autorização.

## 10. LGPD e privacidade por padrão

Mapeie categorias de dados pessoais, finalidade, base legal declarada, coleta mínima, transparência, compartilhamento, operadores, transferências, armazenamento, retenção, descarte e mecanismos para direitos do titular. Identifique dados sensíveis, crianças/adolescentes e tratamentos de maior risco quando aplicáveis.

Verifique controles técnicos: acesso por necessidade, logs sem exposição indevida, criptografia quando adequada, pseudonimização, segregação, exportação, correção e eliminação conforme obrigações e exceções legais, retenção de backups e resposta a incidentes.

Registre lacunas que dependam de avaliação do controlador, jurídico ou encarregado. **Não declare conformidade integral à LGPD a partir de auditoria de código.** Consulte orientações atuais da ANPD para prazos, comunicações e obrigações aplicáveis.

## 11. Infraestrutura, dependências e supply chain

Analise configurações de produção, HTTPS/TLS, cabeçalhos, exposição de portas, firewalls, permissões de arquivos e containers, usuários privilegiados, segredos, CI/CD, ações de terceiros, lockfiles, bibliotecas abandonadas, vulnerabilidades conhecidas, imagens base, backups e monitoramento.

Execute, quando disponíveis e seguros, ferramentas adequadas à stack: análise estática (SAST), análise de dependências (SCA), detecção de segredos, lint e testes. Trate resultados de scanners como indícios que exigem triagem, não como prova de segurança total.

## 12. IA, agentes e desenvolvimento assistido

Verifique permissões dos agentes, arquivos de instrução, ferramentas/MCPs, prompts vindos de fontes não confiáveis, execução de comandos, instalação de pacotes, vazamento de contexto, chaves de modelos, dados enviados a provedores, isolamento de ferramentas, prompt injection, saída de modelos usada como comando, abuso de tokens e limites de gasto.

Não permita que conteúdo externo se torne instrução privilegiada. Exija revisão humana de mudanças de alto impacto. Quando possível, valide controles críticos com testes independentes da implementação gerada pelo próprio agente.

## 13. Monitoramento e incidentes

Verifique trilhas de auditoria de ações críticas, alertas de falhas de login, mudanças de privilégios, acessos entre tenants, tentativas de bypass de pagamento, uso anômalo de créditos, picos de custo, falhas de webhook e erros de integração. Preserve privacidade nos logs e estabeleça mecanismos de investigação, contenção e recuperação.

## 14. Priorização e implementação

Crie `docs/SECURITY_IMPLEMENTATION_PLAN.md` com tabela:

| ID | ÁREA | EVIDÊNCIA | RISCO | SEVERIDADE | CORREÇÃO | TESTE | STATUS |
|---|---|---|---|---|---|---|---|

Priorize falhas exploráveis de acesso a dados, isolamento, autenticação, autorização, bypass de pagamento e exposição de segredos. Implemente correções seguras automaticamente e na menor alteração suficiente, preservando UX e regras comerciais legítimas. Para mudanças sensíveis, registre plano de rollback.

## 15. Validação obrigatória

Execute testes existentes e acrescente testes negativos de autorização, multi-tenant, entitlement, webhooks, concorrência, créditos, rate limiting e privacidade conforme o projeto. Teste regressões dos fluxos legítimos. Registre comandos, resultados e limitações. Se não houver acesso a ambiente ou integração, descreva exatamente o que não foi verificado.

Crie `docs/SECURITY_VALIDATION_REPORT.md` com:

- inventário e escopo auditado;
- achados por severidade e evidências redigidas sem segredos;
- correções feitas e arquivos alterados;
- testes executados e resultados;
- matriz de acesso e direitos comerciais validada;
- riscos residuais e pendências;
- recomendações de monitoramento e recorrência;
- decisões que dependem do responsável, jurídico ou operação.

Não declare "seguro", "imune a ataques" ou "100% LGPD". Informe o nível de evidência realmente obtido.

## 16. Referências de base

- OWASP ASVS: https://github.com/OWASP/ASVS
- OWASP API Security Top 10: https://owasp.org/API-Security/
- OWASP Secure Coding with AI: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html
- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- ANPD: https://www.gov.br/anpd/pt-br
- Comunidade (inspiração, não padrão): https://github.com/benavlabs/vibe-check

## 17. Critério de conclusão

O trabalho só está concluído quando o plano, as correções viáveis, os testes e o relatório refletirem fielmente o que foi executado. Continue automaticamente nas etapas seguras; não confunda falta de achados com ausência de riscos.
