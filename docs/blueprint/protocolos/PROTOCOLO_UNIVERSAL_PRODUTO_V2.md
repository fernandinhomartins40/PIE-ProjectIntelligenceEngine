# PROTOCOLO UNIVERSAL DE PRODUTO V2 — ANALISAR, DESCOBRIR OPORTUNIDADES, PLANEJAR E IMPLEMENTAR

> Documento genérico para usar com Claude Code, Codex ou outro agente de desenvolvimento em qualquer aplicação.
>
> Objetivo: permitir que a IA compreenda o projeto, identifique problemas e oportunidades, crie um plano objetivo, implemente as melhorias e valide o resultado sem gates, burocracia ou pausas desnecessárias.

---

## 1. COMO USAR

1. Coloque este arquivo na raiz do repositório.
2. Abra o projeto no VS Code ou ambiente do agente.
3. Envie apenas:

```text
Leia integralmente PROTOCOLO_UNIVERSAL.md e execute o processo completo.
Analise a aplicação real, crie o plano, implemente as melhorias necessárias e valide o resultado.
Não pare entre análise, planejamento e implementação, exceto se encontrar um bloqueio real que exija minha decisão.
```

A partir daí, o agente deve trabalhar de forma contínua:

**ANALISAR → DESCOBRIR OPORTUNIDADES → PLANEJAR → IMPLEMENTAR → TESTAR → CORRIGIR → VALIDAR**

Não criar gates de aprovação entre essas etapas.

---

# 2. PRINCÍPIO CENTRAL

Trabalhe sobre a aplicação real.

Não presuma stack, arquitetura, funcionalidades, banco, infraestrutura, regras de negócio ou organização do projeto.

Descubra tudo diretamente no repositório e use como evidência:

- código;
- rotas;
- banco e schema;
- migrations;
- APIs;
- componentes;
- páginas;
- documentação;
- configurações;
- testes;
- Docker;
- CI/CD;
- integrações;
- aplicação executando, quando possível.

O objetivo não é apenas corrigir código.

Analise a aplicação como:

- produto;
- experiência do usuário;
- interface;
- arquitetura;
- software;
- banco de dados;
- segurança;
- desempenho;
- infraestrutura;
- operação.

---

# 3. REGRAS GERAIS

Durante todo o trabalho:

1. Não invente funcionalidades ou requisitos sem evidência.
2. Preserve funcionalidades existentes, salvo quando houver erro, duplicidade comprovada ou mudança necessária para melhorar o produto.
3. Não substitua dados reais por mocks.
4. Não use `localStorage`, cache ou dados estáticos como substituto de persistência real quando o sistema possui backend/banco.
5. Não remova integrações, serviços, rotas, tabelas, migrations ou funcionalidades apenas para simplificar.
6. Não faça operações destrutivas sobre dados, volumes, backups, branches ou ambientes reais.
7. Nunca exponha secrets, tokens, senhas ou credenciais.
8. Preserve alterações existentes do usuário.
9. Reutilize componentes, padrões e tecnologias existentes quando forem adequados.
10. Não introduza dependências ou infraestrutura sem necessidade comprovada.
11. Prefira a solução mais simples que resolva corretamente o problema.
12. Evite refatorações sem benefício concreto.
13. Corrija a causa do problema, não apenas sintomas visuais.
14. Mantenha compatibilidade com dados e funcionalidades existentes.
15. Toda alteração relevante deve ser testada.
16. Não declare algo concluído se não tiver sido implementado e verificado.
17. Não altere partes não relacionadas sem necessidade.
18. Se encontrar problema importante fora do objetivo inicial, inclua no plano e trate conforme prioridade.
19. Trabalhe de forma autônoma. Não peça confirmação para decisões técnicas reversíveis e bem fundamentadas.
20. Pare e pergunte somente quando houver uma decisão realmente bloqueadora, risco destrutivo, credencial externa necessária ou escolha de negócio que não possa ser determinada pelo projeto.

---

# 4. ETAPA 1 — ANALISAR

Antes de modificar o código, compreenda a aplicação.

Esta etapa deve ser objetiva. Não transforme a análise em dezenas de documentos.

## 4.1 Repositório e arquitetura

Identifique:

- estrutura do projeto;
- aplicações e packages;
- stack real;
- versões relevantes;
- package manager;
- frontend;
- backend;
- banco;
- ORM;
- autenticação;
- autorização;
- testes;
- Docker;
- deploy;
- CI/CD;
- serviços auxiliares;
- jobs;
- workers;
- crons;
- integrações externas;
- armazenamento;
- filas e cache, se existirem.

Verifique também:

- `git status`;
- branch atual;
- alterações ainda não commitadas;
- scripts disponíveis;
- como executar o projeto;
- como executar testes e build.

Nunca descarte alterações existentes do usuário.

---

## 4.2 Funcionalidades

Mapeie o que realmente existe:

- páginas;
- rotas;
- módulos;
- APIs;
- formulários;
- tabelas;
- listas;
- dashboards;
- relatórios;
- modais;
- drawers;
- configurações;
- permissões;
- fluxos principais;
- integrações;
- funcionalidades públicas;
- funcionalidades administrativas.

Identifique:

- funcionalidades completas;
- funcionalidades incompletas;
- funcionalidades quebradas;
- páginas órfãs;
- código morto aparente;
- duplicações;
- fluxos fragmentados;
- funcionalidades sem acesso pela interface;
- inconsistências frontend/backend;
- inconsistências banco/API/interface.

Não remova nada automaticamente apenas por parecer não utilizado. Confirme antes.

---

## 4.3 Produto e experiência

Entenda:

- qual problema a aplicação resolve;
- quem utiliza;
- quais são os principais fluxos;
- quais ações são mais importantes;
- onde o usuário encontra dificuldade;
- onde existem etapas desnecessárias;
- onde informações estão espalhadas;
- onde páginas poderiam ser consolidadas;
- onde existem ações repetitivas;
- onde a aplicação exige conhecimento técnico desnecessário;
- onde é possível reduzir passos.

Procure oportunidades para:

- simplificar fluxos;
- reduzir cliques;
- melhorar organização;
- tornar ações mais óbvias;
- agrupar funcionalidades relacionadas;
- eliminar redundância;
- melhorar feedback;
- tornar o sistema compreensível para usuários menos experientes.

Quando fizer sentido, aplique o princípio:

**uma tarefa importante deve exigir o menor número razoável de passos.**

Não sacrifique segurança ou clareza apenas para reduzir cliques.

---

## 4.4 UI, UX e responsividade

Analise páginas e componentes relevantes.

Verifique:

- hierarquia visual;
- navegação;
- consistência;
- tipografia;
- cores;
- espaçamento;
- grids;
- cards;
- tabelas;
- formulários;
- filtros;
- busca;
- paginação;
- modais;
- drawers;
- feedback;
- loading;
- skeleton;
- estado vazio;
- erro;
- sucesso;
- confirmação;
- permissões;
- mensagens;
- CTAs;
- densidade de informação.

Responsividade deve considerar, quando aplicável:

- celulares pequenos;
- celulares grandes;
- tablets;
- notebooks compactos;
- notebooks intermediários;
- desktop;
- telas grandes.

Não considere apenas `mobile`, `tablet` e `desktop`.

Preste atenção especial às larguras intermediárias onde sidebars, tabelas, grids e formulários frequentemente quebram.

Preserve a identidade visual existente e a logo oficial, salvo se o objetivo explícito do trabalho for rebranding.

---

## 4.5 Componentes e design system

Verifique:

- componentes duplicados;
- padrões repetidos;
- componentes excessivamente específicos;
- componentes reutilizáveis ausentes;
- tokens;
- breakpoints;
- espaçamentos;
- tipografia;
- botões;
- inputs;
- selects;
- tabelas;
- cards;
- alerts;
- modais;
- drawers;
- estados de interface.

Prefira melhorar o sistema existente.

Não crie um segundo design system paralelo sem necessidade.

---

## 4.6 Banco e backend

Analise quando aplicável:

- entidades;
- relações;
- migrations;
- índices;
- constraints;
- transações;
- validações;
- autorização;
- consistência;
- N+1;
- paginação;
- queries pesadas;
- concorrência;
- idempotência;
- integridade referencial;
- isolamento entre tenants;
- APIs;
- contratos frontend/backend.

Procure diferenças entre:

**interface → API → regra de negócio → banco**

e corrija inconsistências reais.

---

## 4.7 Segurança e privacidade

Verifique conforme a superfície da aplicação:

- autenticação;
- autorização;
- permissões no servidor;
- IDOR;
- isolamento multi-tenant;
- validação de entrada;
- XSS;
- CSRF;
- SSRF;
- SQL injection;
- uploads;
- exposição de arquivos;
- secrets;
- logs;
- rate limiting;
- sessões;
- cookies;
- CORS;
- endpoints administrativos;
- dados pessoais;
- LGPD;
- ações críticas;
- trilha de auditoria.

Não enfraqueça segurança para simplificar implementação.

---

## 4.8 Performance e infraestrutura

Analise apenas o que realmente existe.

Verifique:

- uso de RAM;
- CPU;
- disco;
- imagens Docker;
- containers;
- serviços permanentes;
- processos;
- banco;
- pool de conexões;
- cache;
- Redis;
- filas;
- workers;
- crons;
- bundles;
- imagens e assets;
- consultas;
- N+1;
- paginação;
- lazy loading;
- code splitting;
- volumes;
- logs;
- backups;
- healthchecks;
- deploy.

Não remova Redis, workers, containers ou outros serviços apenas por parecerem pesados.

Primeiro confirme se são utilizados e se podem ser substituídos ou eliminados com segurança.

---

# 5. ETAPA 2 — PLANEJAR

Depois da análise, crie somente:

```text
docs/IMPLEMENTATION_PLAN.md
```

Não crie dezenas de documentos separados, salvo se o projeto realmente exigir documentação adicional.

O plano deve ser prático e executável.

Estrutura:

```text
# Plano de Implementação

## Resumo da aplicação
Breve descrição do que foi confirmado no repositório.

## Principais problemas encontrados
Lista objetiva por prioridade.

## Oportunidades de melhoria
Produto, UX, arquitetura, segurança, desempenho e infraestrutura.

## Plano de execução
ID | PRIORIDADE | PROBLEMA | SOLUÇÃO | ARQUIVOS/ÁREAS | RISCO | TESTE | STATUS

## Ordem de implementação
Sequência recomendada considerando dependências e risco.

## Itens que não serão alterados
Partes preservadas e motivo.

## Bloqueios reais
Somente questões que realmente impedem execução.
```

Use prioridades:

- `P0` — segurança, perda de dados, aplicação quebrada ou risco crítico;
- `P1` — fluxo principal, UX importante, bugs relevantes ou arquitetura que prejudica o produto;
- `P2` — melhoria, simplificação, consistência, desempenho ou manutenção;
- `P3` — refinamentos opcionais.

O plano não é um gate.

Após criá-lo, continue automaticamente para a implementação.

---

# 6. ETAPA 3 — IMPLEMENTAR

Implemente o plano em ordem lógica.

Não aguarde aprovação entre itens.

Para cada item:

1. leia os arquivos afetados;
2. confirme dependências;
3. faça a menor alteração correta;
4. preserve funcionalidades existentes;
5. reutilize componentes e padrões;
6. atualize banco/migrations somente quando necessário;
7. mantenha compatibilidade;
8. implemente estados de interface necessários;
9. trate erros;
10. valide permissões;
11. execute os testes relevantes;
12. corrija regressões causadas pela alteração;
13. atualize o status no `docs/IMPLEMENTATION_PLAN.md`.

Use:

- `TODO`
- `DOING`
- `DONE`
- `BLOCKED`

Marque `DONE` somente depois de testar.

---

# 7. REGRAS PARA ALTERAÇÕES DE UI/UX

Quando alterar interface:

- preserve funcionalidades;
- preserve dados;
- preserve a identidade oficial;
- mantenha mobile-first quando adequado;
- valide larguras intermediárias;
- evite layouts que funcionam apenas em 1440px;
- evite esconder funcionalidades importantes no mobile;
- não transforme tudo em modal;
- reutilize drawers/modais já existentes quando fizer sentido;
- mantenha formulários claros;
- preserve contexto durante auto-refresh;
- auto-refresh não deve fechar formulário, drawer ou modal em uso;
- estados de loading não devem causar saltos desnecessários;
- tabelas devem ter estratégia responsiva adequada;
- ações principais devem permanecer acessíveis;
- textos e CTAs devem explicar a ação.

Se o projeto já possui um padrão de UX consistente, evolua esse padrão em vez de criar outro.

---

# 8. REGRAS PARA DADOS

Sempre que possível:

- use banco real da aplicação;
- preserve relacionamentos;
- preserve IDs e referências;
- use migrations seguras;
- evite alterações destrutivas;
- valide rollback quando aplicável;
- não invente registros apenas para fazer uma tela funcionar;
- seeds devem ser usados para desenvolvimento/teste, não como substituto de funcionalidade;
- não use dados pessoais reais em testes.

---

# 9. REGRAS PARA NOVAS DEPENDÊNCIAS

Antes de instalar uma nova biblioteca, framework, serviço ou container:

1. verifique se a stack atual já resolve;
2. confirme a necessidade;
3. avalie manutenção;
4. avalie tamanho;
5. avalie impacto de RAM/CPU;
6. avalie licença;
7. avalie segurança;
8. prefira solução consolidada e compatível com o projeto.

Não introduza tecnologia apenas porque é moderna.

---

# 10. TESTAR

Após cada conjunto coerente de alterações, execute tudo que for aplicável ao projeto:

- lint;
- typecheck;
- testes unitários;
- testes de integração;
- testes E2E;
- build;
- migrations em ambiente seguro;
- seed em ambiente de desenvolvimento/teste;
- fluxo real no navegador;
- responsividade;
- acessibilidade essencial;
- autenticação;
- autorização;
- isolamento de dados;
- integrações afetadas.

Não desabilite regras ou testes para obter resultado verde.

Se existir falha anterior à implementação, diferencie claramente:

- falha preexistente;
- falha introduzida;
- falha corrigida.

---

# 11. CORRIGIR

Se testes, build ou validação encontrarem problema:

**não pare imediatamente.**

Investigue e corrija automaticamente quando:

- a causa estiver dentro do escopo;
- a correção for segura;
- não exigir decisão de negócio;
- não envolver operação destrutiva;
- não depender de credencial externa indisponível.

Repita:

**IMPLEMENTAR → TESTAR → CORRIGIR**

até atingir um estado estável.

---

# 12. VALIDAR

Ao terminar a implementação, faça uma revisão final da aplicação.

Confirme:

- funcionalidades principais continuam funcionando;
- problemas planejados foram tratados;
- não houve regressões aparentes;
- frontend e backend continuam compatíveis;
- banco continua consistente;
- permissões continuam corretas;
- responsividade foi preservada;
- estados de erro/loading/vazio funcionam;
- build funciona;
- testes relevantes passam;
- novas dependências são justificadas;
- infraestrutura não ficou desnecessariamente mais pesada;
- nenhuma funcionalidade foi removida acidentalmente;
- nenhuma credencial foi exposta.

Revise também o próprio `IMPLEMENTATION_PLAN.md`.

Tudo que estiver `DONE` deve possuir evidência de implementação e validação.

---

# 13. RELATÓRIO FINAL

Crie:

```text
docs/IMPLEMENTATION_REPORT.md
```

Estrutura:

```text
# Relatório Final

## Resumo
O que foi analisado e implementado.

## Melhorias realizadas
Principais mudanças.

## Arquivos e áreas alteradas
Resumo objetivo.

## Problemas corrigidos
Lista por prioridade.

## UX/UI
Mudanças relevantes.

## Backend e banco
Mudanças relevantes.

## Segurança
Mudanças relevantes.

## Performance e infraestrutura
Mudanças relevantes.

## Testes executados
Comandos e resultados.

## Itens bloqueados
Somente o que realmente não pôde ser concluído.

## Riscos restantes
Se existirem.

## Próximas melhorias recomendadas
Somente melhorias que ficaram conscientemente fora do escopo.
```

Não gere um relatório enorme apenas para parecer completo.

Seja objetivo e baseado no trabalho realmente realizado.

---

# 14. QUANDO PARAR E PERGUNTAR

Não peça aprovação por rotina.

Pare somente quando ocorrer pelo menos uma destas situações:

### Decisão de negócio
Existem duas ou mais opções válidas e o repositório não permite determinar qual corresponde à intenção do produto.

### Operação destrutiva
A solução exige apagar ou alterar irreversivelmente dados, volumes, backups ou infraestrutura real.

### Credencial externa
A tarefa depende de token, senha, chave, conta ou acesso que não está disponível.

### Mudança incompatível
A solução exige quebrar contrato público, API externa, banco ou compatibilidade importante e não existe migração segura evidente.

### Custo externo
A implementação exige contratar serviço, aumentar infraestrutura ou gerar custo recorrente relevante.

### Informação impossível de inferir
Um requisito essencial não existe no código, documentação ou comportamento atual.

Nesses casos:

1. explique o bloqueio em poucas linhas;
2. apresente as opções;
3. recomende tecnicamente uma abordagem;
4. pergunte somente o necessário;
5. continue automaticamente o restante que não estiver bloqueado.

---

# 15. O QUE NÃO DEVE ACONTECER

Não:

- criar gates artificiais;
- pedir aprovação a cada etapa;
- parar depois da análise;
- parar depois do plano;
- gerar dezenas de documentos;
- transformar o processo em consultoria teórica;
- analisar apenas uma amostra e dizer que analisou tudo;
- implementar sem conhecer o projeto;
- redesenhar sem entender os fluxos;
- criar componentes duplicados;
- criar infraestrutura desnecessária;
- instalar dependências por conveniência;
- remover funcionalidades para simplificar;
- trocar dados reais por mocks;
- esconder falhas;
- ignorar mobile;
- ignorar notebooks e larguras intermediárias;
- ignorar segurança;
- ignorar impacto na VPS;
- fazer refatoração geral sem necessidade;
- alterar código não relacionado apenas porque encontrou oportunidade;
- declarar 100% concluído sem validação.

---

# 16. DEFINIÇÃO DE CONCLUÍDO

O trabalho está concluído quando:

- a aplicação foi analisada de forma suficiente para executar o objetivo;
- `docs/IMPLEMENTATION_PLAN.md` foi criado;
- os itens executáveis do plano foram implementados;
- alterações foram testadas;
- regressões causadas pelo trabalho foram corrigidas;
- build e verificações aplicáveis foram executados;
- funcionalidades existentes foram preservadas;
- segurança não foi enfraquecida;
- dados não foram substituídos por mocks;
- responsividade foi verificada quando houver interface;
- itens bloqueados estão claramente documentados;
- `docs/IMPLEMENTATION_REPORT.md` foi criado;
- o estado final corresponde ao código real.

---

# 17. PROMPT MESTRE

Use este prompt para iniciar qualquer projeto:

```text
Leia integralmente PROTOCOLO_UNIVERSAL.md e siga-o como instrução operacional deste repositório.

Trabalhe de forma autônoma e contínua seguindo:

ANALISAR → PLANEJAR → IMPLEMENTAR → TESTAR → CORRIGIR → VALIDAR.

Primeiro compreenda a aplicação real, sua arquitetura, funcionalidades, banco, fluxos, UI/UX, segurança, desempenho e infraestrutura.

Depois crie docs/IMPLEMENTATION_PLAN.md com os problemas e melhorias priorizados.

Na sequência, sem aguardar minha aprovação, implemente o plano em ordem lógica, fazendo alterações seguras, pequenas e coerentes. Preserve funcionalidades, dados, identidade visual, integrações e padrões existentes.

Após cada conjunto de alterações, execute os testes aplicáveis, investigue falhas e corrija regressões.

Ao final, revalide a aplicação e crie docs/IMPLEMENTATION_REPORT.md com o que realmente foi feito, testes executados, bloqueios e riscos restantes.

NÃO crie gates de aprovação.
NÃO pare entre análise, plano e implementação.
NÃO crie documentação excessiva.
NÃO invente requisitos.
NÃO use mocks como substituto de funcionalidades ou dados reais.
NÃO remova funcionalidades para simplificar.
NÃO faça operações destrutivas.
NÃO exponha secrets.
NÃO altere além do necessário sem justificativa.

Só interrompa e me pergunte quando houver um bloqueio real: decisão de negócio impossível de inferir, operação destrutiva, credencial externa, mudança incompatível relevante ou custo externo.

Em qualquer outro caso, decida tecnicamente, documente de forma objetiva e continue até concluir.
```

---

# 18. FLUXO RESUMIDO

```text
REPOSITÓRIO
    ↓
ANALISAR
    ↓
docs/IMPLEMENTATION_PLAN.md
    ↓
IMPLEMENTAR
    ↓
TESTAR
    ↓
CORRIGIR
    ↓
VALIDAR
    ↓
docs/IMPLEMENTATION_REPORT.md
```

**Sem gates. Sem prompts em sequência. Sem aprovação a cada etapa.**

A IA deve analisar, pensar, executar e validar — perguntando ao usuário somente quando uma decisão realmente depender dele.

---

# CAMADA OBRIGATÓRIA — INTELIGÊNCIA DE PRODUTO E OPORTUNIDADES FUNCIONAIS

Esta camada faz parte da análise normal da aplicação. Não é uma auditoria separada, não cria um gate e não deve interromper o fluxo de execução.

O objetivo é impedir uma análise superficial limitada a bugs, layout, arquitetura ou funcionalidades já existentes.

## Princípio central

**O sistema deve trabalhar mais para que o usuário trabalhe menos.**

Não trate a implementação atual como a melhor definição possível do produto.

O código representa o que existe hoje. Ele não prova que o fluxo, a organização ou a funcionalidade atual sejam a melhor forma de resolver a necessidade do usuário.

Para cada fluxo importante, entenda primeiro qual resultado a pessoa realmente deseja alcançar.

Depois questione se a aplicação está exigindo trabalho desnecessário para chegar a esse resultado.

## Princípio do menor esforço do usuário

O objetivo não é ensinar o usuário a operar a complexidade interna do software.

O objetivo é esconder complexidade desnecessária e permitir que pessoas com diferentes níveis de conhecimento consigam concluir tarefas com segurança, clareza e o mínimo razoável de esforço.

Procure reduzir:

- quantidade de passos;
- cliques;
- páginas percorridas;
- campos preenchidos;
- decisões desnecessárias;
- conhecimento técnico exigido;
- repetição;
- navegação de ida e volta;
- procura manual por informações;
- conferências manuais;
- acompanhamento manual;
- memorização;
- retrabalho;
- necessidade de copiar dados entre áreas;
- tarefas previsíveis que o sistema poderia executar.

Não reduza passos sacrificando segurança, entendimento, controle ou confirmação necessária.

## Regra dos 3 Passos

Para cada objetivo importante do usuário, investigue se a experiência pode ser organizada em até três ações principais:

1. iniciar ou informar o objetivo;
2. revisar/complementar apenas o necessário;
3. concluir.

Três passos é uma heurística, não uma obrigação artificial.

Se a tarefa realmente exigir mais etapas, preserve as necessárias.

A pergunta é sempre:

**há complexidade real ou estamos apenas expondo ao usuário a complexidade interna do sistema?**

## Pergunta de inversão

Para cada fluxo relevante, pergunte obrigatoriamente:

**O que o usuário está fazendo para o sistema que o sistema poderia estar fazendo para o usuário?**

Investigue se a aplicação pode:

- recuperar dados já existentes;
- preencher automaticamente;
- calcular;
- classificar;
- validar;
- cruzar informações;
- sugerir;
- agrupar;
- ordenar;
- detectar;
- lembrar;
- acompanhar;
- notificar;
- preparar;
- gerar;
- executar;
- antecipar a próxima ação.

## Pergunta de reconstrução

Para funcionalidades relevantes, pergunte:

**Se essa funcionalidade fosse criada hoje, do zero, com os dados, integrações e tecnologias atualmente disponíveis, ainda faria sentido construí-la dessa maneira?**

Não use essa pergunta como justificativa para reescrever a aplicação inteira.

Use-a para identificar oportunidades concretas.

## Os cinco movimentos

Ao analisar cada módulo ou fluxo importante, procure oportunidades em cinco movimentos:

### ELIMINAR

Descubra trabalho que não deveria existir.

Exemplos:

- campo cujo valor já existe;
- confirmação redundante;
- página intermediária sem função;
- etapa técnica exposta ao usuário;
- cadastro duplicado;
- escolha que pode ser inferida com segurança;
- repetição de informação.

### JUNTAR

Identifique ações e informações que pertencem ao mesmo objetivo, mas estão fragmentadas.

Considere:

- reunir funções relacionadas;
- combinar páginas quando isso melhora a tarefa;
- trazer contexto para onde a decisão acontece;
- permitir ação sem abandonar o fluxo atual;
- consolidar operações repetidas;
- eliminar navegação desnecessária.

Não junte funcionalidades apenas para reduzir páginas. Preserve separação quando ela melhora clareza, permissão, segurança ou contexto.

### AUTOMATIZAR

Procure tarefas repetitivas, determinísticas ou previsíveis.

Considere:

- preenchimento automático;
- cálculos;
- atualizações de status;
- geração de documentos;
- classificação;
- processamento em lote;
- sincronização;
- notificações;
- validações;
- importações;
- rotinas;
- ações disparadas por eventos.

Automação deve possuir regras claras, tratamento de erro e possibilidade adequada de revisão quando necessário.

### ANTECIPAR

Use contexto para preparar o próximo passo antes que o usuário precise procurar por ele.

Considere:

- próxima ação provável;
- alertas relevantes;
- pendências;
- vencimentos;
- sugestões contextuais;
- dados relacionados;
- atalhos;
- pré-seleções seguras;
- acompanhamento automático;
- informações necessárias para uma decisão.

Não transforme antecipação em excesso de notificações ou decisões automáticas sem controle.

### CRIAR

Identifique novas funcionalidades somente quando surgirem de uma necessidade concreta observada.

Uma nova função pode nascer de:

- dados que já existem e não são aproveitados;
- combinação de funcionalidades existentes;
- tarefa manual recorrente;
- informação que o usuário precisa produzir fora do sistema;
- integração que elimina trabalho;
- capacidade tecnológica que torna possível uma solução significativamente melhor.

Não proponha uma função apenas porque outros sistemas possuem.

## Tecnologia como meio, não como objetivo

Não proponha:

- IA;
- chatbot;
- agente;
- gamificação;
- notificações;
- dashboards;
- automações;
- reconhecimento;
- visão computacional;
- voz;
- geolocalização;
- geração de conteúdo;

apenas porque a tecnologia existe.

Primeiro identifique a necessidade ou oportunidade.

Depois avalie se alguma tecnologia resolve o problema melhor que uma solução convencional.

Sempre prefira a solução mais simples que produza o benefício desejado.

## Aproveitamento dos dados existentes

Analise entidades, relações, histórico, eventos e informações já persistidas.

Pergunte:

- quais informações o sistema já sabe?
- quais o usuário está digitando novamente?
- quais dados poderiam ser relacionados?
- quais padrões poderiam ser identificados?
- quais informações poderiam ser calculadas?
- quais pendências poderiam ser detectadas?
- quais ações poderiam ser preparadas?
- quais informações poderiam aparecer no momento da decisão?
- quais dados hoje armazenados poderiam gerar uma função realmente útil?

Não crie uso secundário de dados pessoais incompatível com finalidade, autorização, segurança ou privacidade.

## Usuário leigo como referência de clareza

Analise os fluxos considerando também alguém que:

- nunca utilizou a aplicação;
- não conhece termos técnicos;
- não conhece a estrutura interna da organização;
- não sabe qual módulo deve procurar;
- não sabe qual é o próximo passo.

A aplicação deve comunicar objetivos e ações em linguagem compreensível.

Evite exigir que o usuário conheça a arquitetura do sistema para concluir uma tarefa.

## Análise obrigatória por fluxo

Para cada fluxo principal, responda internamente:

1. Qual é o objetivo real do usuário?
2. Quantas ações principais são necessárias hoje?
3. Quais ações existem apenas por causa da implementação atual?
4. O sistema já possui informações que o usuário está fornecendo novamente?
5. Existem páginas ou funções fragmentadas?
6. Existe trabalho repetitivo?
7. Existe decisão que pode ser preparada pelo sistema?
8. Existe acompanhamento manual que pode ser automatizado?
9. É possível aproximar o fluxo da Regra dos 3 Passos?
10. O que pode ser eliminado?
11. O que pode ser juntado?
12. O que pode ser automatizado?
13. O que pode ser antecipado?
14. Existe uma nova função que resolveria uma necessidade real?
15. Qual benefício concreto isso gera?

## Teste da oportunidade

Antes de adicionar uma oportunidade ao plano, valide:

**Problema real**
Qual fricção, repetição, demora, confusão ou trabalho foi observado?

**Usuário**
Quem se beneficia?

**Situação atual**
Como o objetivo é realizado hoje?

**Oportunidade**
O que pode mudar?

**Esforço eliminado**
O que o usuário deixará de fazer?

**Benefício**
Por que ficará mais simples, rápido, seguro ou útil?

**Evidência**
Qual código, fluxo, página, dado, regra ou comportamento sustenta a oportunidade?

**Viabilidade**
A stack e os dados atuais permitem implementar?

**Risco**
Pode causar erro, automação indevida, confusão, quebra de regra ou problema de segurança?

Uma ideia sem ligação concreta com a aplicação não deve entrar no plano como oportunidade confirmada.

## Evitar brainstorm superficial

Não produza listas genéricas como:

- adicionar chatbot;
- adicionar IA;
- adicionar dashboard;
- adicionar gamificação;
- adicionar notificações;
- criar aplicativo;
- criar recomendação inteligente.

Se uma proposta desse tipo fizer sentido, demonstre exatamente:

**problema → fluxo atual → oportunidade → benefício → dados necessários → solução → implementação.**

## Sacada de produto

Para cada módulo importante, faça uma última pergunta:

**Existe uma forma significativamente mais simples ou útil de resolver isso que ainda não está sendo aproveitada pela aplicação?**

Procure a chamada “sacada de produto”:

uma mudança funcional relativamente clara que faça o usuário perceber que o sistema entendeu sua necessidade e eliminou trabalho desnecessário.

Não force uma sacada quando não houver evidência.

Qualidade é mais importante que quantidade.

## Registro no plano

As oportunidades funcionais devem entrar no mesmo `docs/IMPLEMENTATION_PLAN.md`.

Use IDs `OP-XX` quando for útil diferenciá-las.

Inclua, quando aplicável:

| ID | TIPO | SITUAÇÃO ATUAL | OPORTUNIDADE | ESFORÇO ELIMINADO | BENEFÍCIO | SOLUÇÃO | PRIORIDADE | RISCO | TESTE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|

Tipos sugeridos:

- `ELIMINAR`;
- `JUNTAR`;
- `AUTOMATIZAR`;
- `ANTECIPAR`;
- `CRIAR`.

Não crie outro documento apenas para oportunidades.

## Implementação

Oportunidades claras, seguras, coerentes com o produto e tecnicamente sustentadas podem seguir o mesmo fluxo normal de implementação do protocolo.

Não crie gate específico para oportunidades.

Porém, não implemente automaticamente uma nova funcionalidade quando ela:

- muda substancialmente regra de negócio;
- depende de decisão comercial;
- gera custo externo;
- exige nova coleta ou uso relevante de dados pessoais;
- altera permissões de forma sensível;
- depende de integração/credencial inexistente;
- possui várias interpretações de negócio igualmente válidas.

Nesses casos, registre a oportunidade e trate como bloqueio real conforme as regras gerais do protocolo.

## Resultado esperado

Ao terminar a análise, a aplicação não deve ter sido observada apenas como código que precisa ser corrigido.

Ela deve ter sido observada como uma ferramenta usada por pessoas para atingir objetivos.

O agente deve conseguir demonstrar:

- quais trabalhos desnecessários foram encontrados;
- quais fluxos podem ser simplificados;
- quais informações podem ser reaproveitadas;
- quais tarefas podem ser automatizadas;
- quais necessidades podem ser antecipadas;
- quais novas funções possuem justificativa real;
- quais oportunidades foram implementadas;
- como essas mudanças reduzem esforço do usuário.

---

