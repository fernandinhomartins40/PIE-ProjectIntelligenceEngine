# Proposta pendente: escopo do runner Playwright do PIE

**Estado:** rascunho para decisão explícita do mantenedor. Não autoriza implementação ou distribuição do runner.

## Pergunta do analista

Para um snapshot identificado do projeto, quais jornadas de navegador o operador autorizou a executar, em qual aplicação e ambiente, e quais falhas observadas podem ser relacionadas a essas jornadas?

O HTTP VERIFY atual observa uma requisição GET/HEAD escolhida e não identifica a aplicação como bytes do snapshot. O runner Node atual executa apenas arquivos de teste Node dentro do fluxo VERIFY existente. Nenhum dos dois observa navegação, interação, console, erros de página, requisições secundárias ou artefatos de browser.

## Limite proposto para primeira integração

- Uma execução é vinculada a project, snapshot, treeDigest e grant VERIFY imutável, com expiração, timeout e limites de memória, CPU, processos, bytes e artefatos.
- O operador escolhe explicitamente base URL e testes/projeto Playwright. O PIE não descobre URLs a partir de configuração e não visita hosts fora do escopo aprovado.
- A execução usa workspace temporário derivado do snapshot e um browser/runner com versão declarada. Não compartilha Docker socket, perfil pessoal, cookies do navegador do host ou diretório de estado do usuário.
- Acesso de rede é negado por padrão e limitado ao destino aprovado e aos recursos locais estritamente necessários para o teste. O destino, portas e comportamento de redirects precisam de decisão do mantenedor antes de fixar a allowlist.
- A execução não cria servidores do projeto nem executa comandos arbitrários de setup por inferência. Se iniciar a aplicação fizer parte do escopo aprovado, o comando, variáveis de ambiente, serviços e efeitos de cleanup serão declarados no grant.
- O workflow não usa credenciais nem storage state preexistente por padrão. Qualquer suporte futuro a autenticação precisa definir formato, armazenamento, redação, acesso e expiração sem persistir segredos no Evidence.
- Casos de teste podem alterar estado da aplicação. O modo inicial deve usar fixture própria descartável; execução contra dados ou serviços compartilhados exige autorização explícita e fica fora do escopo até decisão específica.
- Persistir estado por teste (passed/failed/skipped/blocked/incomplete), identidade do caso, console/page errors e falhas de rede com proveniência do run. Screenshot, video, trace e DOM podem conter dados pessoais; ficam desativados por padrão até política de retenção, redação, acesso e TTL aprovada.

## Efeitos e riscos a decidir

O runner executa código de teste e browser dentro de um ambiente temporário; pode iniciar processos/containers, ler o snapshot, criar artefatos e enviar requisições ao destino aprovado. Ações do teste podem modificar o estado do destino. O isolamento de filesystem, rede, processo e recursos precisa ser verificado na plataforma de execução real; uma flag de grant ou um container, isoladamente, não prova contenção.

## Decisões necessárias antes de integrar

1. **Alvo:** somente servidor local iniciado pelo PIE em fixture descartável, servidor local previamente iniciado pelo operador, ou ambos? Quais hostnames e portas são permitidos?
2. **Rede:** o browser pode acessar dependências externas? Como redirects, DNS, loopback, WebSockets e conexões iniciadas por scripts serão limitados?
3. **Mutação:** testes podem executar ações que criam, alteram ou removem dados? Em quais ambientes isso é permitido e como a fixture é restaurada?
4. **Autenticação:** suporte inicial exclui credenciais e storage state, ou aceita um mecanismo dedicado? Como proteger, mascarar e expirar esse material?
5. **Captura:** quais artefatos são necessários, onde ficam, quem pode lê-los, qual redação é garantida e qual TTL se aplica?
6. **Plataformas e sandbox:** qual combinação de host/runner/container é suportada inicialmente e qual evidência de isolamento cada plataforma deve fornecer?
7. **Admissão e lifecycle:** um grant VERIFY específico de browser será separado do grant Node/HTTP? Quais estados de cleanup incompleto bloqueiam novos jobs e como ocorre recovery?

## Verificação proposta

Usar aplicações e dados de teste próprios. Provar CLI, MCP, API e UI sobre o mesmo serviço; grants ausentes, expirados, divergentes ou alterados devem falhar antes de iniciar processos. Testes reais devem demonstrar destino autorizado e bloqueio de destinos não autorizados, limites, cancelamento durante execução e finalização, cleanup com retry, rejeição de resultados de lease antiga, retenção/expiração de artefatos e redação de valores marcados sensíveis. Skipped, blocked, report incompleto ou falha de cleanup nunca contam como sucesso.

## Alternativas existentes

Para uma observação sem navegação, usar HTTP VERIFY, que captura GET/HEAD e limita bytes/tempo. Para testes de backend já escritos em Node, usar o grant Node VERIFY existente. A suíte Playwright em `tests/` valida o próprio PIE e não é evidência de execução Playwright contra projetos auditados.

## Estado

Pendente de decisão explícita do mantenedor em discussão de escopo vinculada. Até essa decisão, não adicionar pacote, comando, tool MCP/API, grant, runner, imagem/container ou caminho de execução Playwright à aplicação ou à distribuição.
