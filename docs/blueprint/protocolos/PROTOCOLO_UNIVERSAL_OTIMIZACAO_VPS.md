# PROTOCOLO UNIVERSAL — OTIMIZAÇÃO DE VPS E RECURSOS

> Documento genérico para Claude Code, Codex ou outro agente de desenvolvimento analisar e otimizar qualquer aplicação hospedada em VPS.
>
> Objetivo: reduzir consumo de RAM, CPU, disco, I/O, containers, imagens e custo operacional sem remover funcionalidades, comprometer dados, segurança, persistência, estabilidade ou capacidade real da aplicação.

---

# 1. COMO USAR

Coloque este arquivo na raiz do repositório e envie:

```text
Leia integralmente @PROTOCOLO_UNIVERSAL_OTIMIZACAO_VPS.md e execute o processo completo.

Analise esta aplicação e tudo que influencia seu consumo de VPS. Identifique desperdícios e oportunidades reais de otimização, crie o plano priorizado e implemente automaticamente todas as melhorias seguras.

Analise → meça → planeje → implemente → teste → compare → corrija → valide.

O objetivo é reduzir ao máximo RAM, CPU, disco, I/O, containers, imagens e custo operacional sem remover funcionalidades, comprometer dados, segurança, persistência, estabilidade ou desempenho real.

Não fique apenas na auditoria ou nas recomendações. Execute as otimizações comprovadamente seguras.

Só me consulte se houver um bloqueio real, operação destrutiva, necessidade de acesso externo, mudança de infraestrutura com custo ou decisão que não possa ser determinada tecnicamente.
```

Não existem gates de aprovação entre as etapas.

O agente deve trabalhar continuamente:

**ANALISAR → MEDIR → PLANEJAR → IMPLEMENTAR → TESTAR → COMPARAR → CORRIGIR → VALIDAR**

---

# 2. MISSÃO

Otimize a aplicação para consumir a menor quantidade razoável de recursos da VPS mantendo:

- todas as funcionalidades necessárias;
- persistência;
- integridade dos dados;
- segurança;
- estabilidade;
- desempenho aceitável;
- integrações;
- capacidade de backup;
- capacidade de rollback;
- manutenibilidade;
- compatibilidade com o ambiente real.

Não faça otimização cosmética.

Toda mudança deve possuir uma razão técnica.

---

# 3. PRINCÍPIOS

1. Descubra a stack real antes de recomendar qualquer coisa.
2. Não presuma Node.js, PHP, Laravel, Next.js, React, Python, Java, Prisma, PostgreSQL, MySQL, Redis, Docker ou qualquer tecnologia.
3. Diferencie configuração declarada de comportamento efetivo.
4. Dependência instalada não significa dependência utilizada.
5. Serviço declarado não significa serviço necessário.
6. Ausência em uma busca de código não prova ausência de uso.
7. Limite configurado não significa consumo real.
8. RAM em repouso não representa pico.
9. Tamanho lógico de imagem Docker não representa necessariamente espaço físico recuperável.
10. Cache não é persistência.
11. Swap não é substituto de RAM.
12. Menos containers não significa automaticamente arquitetura melhor.
13. Imagem menor não justifica quebrar runtime, migrations ou rollback.
14. Não troque confiabilidade por alguns megabytes.
15. Não remova funcionalidades para economizar recursos.
16. Não substitua banco real por memória, arquivos temporários ou `localStorage`.
17. Não use mocks em fluxos reais.
18. Não apague dados para produzir ganho artificial.
19. Não execute limpeza destrutiva automaticamente.
20. Não exponha secrets.
21. Não desabilite segurança ou observabilidade apenas para economizar recursos.
22. Preserve alterações existentes do usuário.
23. Prefira mudanças simples, reversíveis e mensuráveis.
24. Otimize primeiro desperdícios comprovados.
25. Meça antes e depois sempre que o ambiente permitir.

---

# 4. SEGURANÇA OPERACIONAL

Nunca execute automaticamente em ambiente real:

- `docker system prune -a`;
- `docker volume prune`;
- exclusão indiscriminada de imagens;
- exclusão de volumes;
- `DROP DATABASE`;
- `DROP TABLE`;
- `TRUNCATE`;
- remoção de backups;
- remoção de uploads;
- exclusão de dados persistentes;
- limpeza de diretórios de uso desconhecido;
- alteração destrutiva de migrations;
- alteração de firewall;
- alteração de kernel;
- alteração crítica de `sysctl`;
- remoção de serviços do host sem comprovação;
- restart de produção que possa causar indisponibilidade não planejada.

Quando uma limpeza for recomendável, documente exatamente:

- o que pode ser removido;
- por que é seguro;
- ganho esperado;
- como verificar antes;
- comando sugerido;
- rollback ou recuperação.

Não execute a ação destrutiva sem autorização explícita.

---

# 5. ANALISAR A APLICAÇÃO

Antes de otimizar, compreenda o projeto inteiro que afeta a VPS.

Identifique:

- aplicações;
- packages;
- frontend;
- backend;
- APIs;
- runtimes;
- versões;
- frameworks;
- package managers;
- banco;
- ORM;
- workers;
- cron;
- filas;
- WebSockets;
- cache;
- Redis;
- storage;
- MinIO/S3;
- proxy;
- Dockerfiles;
- Compose;
- CI/CD;
- scripts;
- migrations;
- seeds;
- uploads;
- logs;
- backups;
- serviços externos;
- healthchecks;
- observabilidade.

Verifique:

- `git status`;
- branch;
- alterações existentes;
- arquivos de infraestrutura;
- scripts de build;
- scripts de deploy;
- processo de startup;
- processo de migration;
- processo de seed;
- processo de rollback.

Não altere trabalho existente do usuário sem necessidade.

---

# 6. CONFIRMAR O QUE REALMENTE É USADO

Para serviços, dependências e infraestrutura relevante, diferencie:

- declarado;
- instalado;
- importado/referenciado;
- utilizado em runtime;
- utilizado em build;
- utilizado no deploy;
- utilizado por jobs;
- utilizado por integração externa;
- observado em execução;
- responsável por persistência;
- aparentemente não utilizado;
- uso ainda não comprovado.

Antes de remover algo, procure:

- imports;
- inicialização;
- conexões;
- consumers;
- producers;
- filas;
- sessões;
- locks;
- cache;
- rate limiting;
- jobs;
- crons;
- webhooks;
- URLs;
- variáveis;
- scripts;
- Compose;
- Dockerfiles;
- CI/CD;
- documentação operacional;
- consumidores externos.

Uma dependência aparentemente sem uso deve ser tratada como candidata à remoção, não como remoção automática.

---

# 7. BASELINE

Quando houver acesso seguro ao ambiente, registre o estado atual antes das mudanças.

Use ferramentas disponíveis e equivalentes a:

```bash
docker ps
docker stats --no-stream
docker system df
df -h
df -i
free -h
uptime
```

Quando apropriado e disponível, observe também:

- processos;
- RSS;
- heap;
- CPU;
- load;
- I/O;
- swap;
- reinícios;
- OOM;
- conexões;
- disco;
- volumes;
- logs;
- duração do deploy;
- tamanho das imagens;
- quantidade de containers;
- jobs permanentes;
- processos filhos.

Nunca imprima secrets ao coletar métricas.

Se não houver acesso à VPS, não invente valores.

Use:

`NOT_MEASURED`

e continue analisando tudo que puder pelo repositório.

---

# 8. CONTAINERS E SERVIÇOS

Analise todos os containers e serviços declarados ou observados.

Para cada um, determine:

- função;
- necessidade;
- consumidores;
- dependências;
- volumes;
- redes;
- portas;
- exposição externa;
- healthcheck;
- restart policy;
- persistência;
- RAM;
- CPU;
- processo executado;
- necessidade de permanecer residente;
- possibilidade de execução sob demanda;
- possibilidade de compartilhamento seguro;
- possibilidade de eliminação;
- risco de remoção.

Procure especialmente:

- serviços duplicados;
- serviços de desenvolvimento em produção;
- ferramentas administrativas residentes sem necessidade;
- jobs executando como serviços permanentes;
- containers ociosos;
- serviços replicados por aplicação sem necessidade;
- proxies duplicados;
- bancos desnecessariamente separados quando não há requisito de isolamento;
- Redis sem uso comprovado;
- MinIO sem uso comprovado;
- workers sem tarefas reais.

Não consolide serviços apenas para reduzir a contagem de containers se isso prejudicar:

- isolamento;
- segurança;
- persistência;
- disponibilidade;
- manutenção.

---

# 9. RAM E CPU

Analise consumo por processo e container.

Quando aplicável, avalie:

- RSS;
- heap;
- memória nativa;
- buffers;
- GC;
- threads;
- processos filhos;
- CPU;
- concorrência;
- OOM;
- reinícios;
- picos;
- latência;
- jobs simultâneos.

Separe:

- runtime;
- build;
- deploy;
- migration;
- seed;
- jobs.

Não defina limites de memória apenas multiplicando consumo em repouso.

Considere:

- carga real;
- pico;
- concorrência;
- folga;
- processos auxiliares;
- banco;
- proxy;
- host;
- deploy;
- backup.

Se Node.js existir, avalie versão e comportamento real do runtime antes de recomendar heap ou `NODE_OPTIONS`.

Se PHP existir, avalie quando aplicável:

- PHP-FPM;
- quantidade de workers;
- `pm.max_children`;
- memory limit;
- OPcache;
- processos CLI;
- queues.

Adapte a análise ao runtime real.

---

# 10. DOCKER E IMAGENS

Se Docker existir, analise todos os Dockerfiles e arquivos Compose.

Verifique:

- base images;
- multi-stage builds;
- build context;
- `.dockerignore`;
- dependências de desenvolvimento;
- dependências de runtime;
- arquivos copiados;
- caches;
- camadas;
- package manager;
- artefatos;
- usuário do container;
- permissões;
- healthcheck;
- secrets em build;
- ferramentas presentes na imagem final;
- compatibilidade da arquitetura;
- módulos nativos;
- tamanho das imagens.

Procure:

- `node_modules` copiado indevidamente;
- cache de package manager;
- source desnecessário em runtime;
- compiladores na imagem final;
- dependências dev em produção;
- arquivos temporários;
- imagens base excessivas;
- camadas redundantes;
- builds feitos dentro da VPS sem necessidade.

Não remova ferramentas necessárias para:

- migrations;
- seed;
- startup;
- runtime;
- módulos nativos;
- troubleshooting essencial.

Se Next.js existir, avalie `standalone` e tracing conforme a versão real.

Se Prisma existir, confirme versão, engine/adapter e necessidades de migration/seed antes de remover binários ou CLI.

---

# 11. BANCO DE DADOS

Analise banco e ORM reais.

Verifique:

- tamanho;
- índices;
- queries;
- N+1;
- paginação;
- selects excessivos;
- conexões;
- pools;
- transações;
- locks;
- concorrência;
- I/O;
- manutenção;
- migrations;
- backups;
- restore.

Procure:

- pools grandes demais;
- múltiplas conexões desnecessárias;
- conexões por worker;
- jobs abrindo conexões demais;
- queries repetidas;
- consultas sem índice;
- carregamento de dados desnecessários;
- relatórios pesados;
- ausência de paginação;
- paralelismo que aumenta pressão no banco.

Não crie cache automaticamente para esconder query ruim.

Primeiro avalie se a causa deve ser corrigida no banco ou na aplicação.

Cache deve possuir:

- escopo;
- invalidação;
- limite;
- consistência;
- isolamento entre usuários/tenants.

---

# 12. STORAGE E DISCO

Mapeie:

- volumes;
- bind mounts;
- uploads;
- imagens;
- documentos;
- banco;
- dumps;
- backups;
- snapshots;
- logs;
- caches;
- temporários;
- artefatos de build;
- imagens Docker;
- registries locais.

Para cada item relevante, determine:

- proprietário;
- consumidores;
- tamanho;
- crescimento;
- retenção;
- criticidade;
- possibilidade de reconstrução;
- necessidade de backup.

Classifique candidatos de limpeza como:

- `SAFE_DISPOSABLE`;
- `RETENTION_EXPIRED`;
- `REQUIRED_FOR_ROLLBACK`;
- `PERSISTENT_DATA`;
- `UNKNOWN_USE`.

Nunca exclua `UNKNOWN_USE`.

Cache nunca deve ser tratado como fonte de verdade.

---

# 13. LOGS

Verifique:

- tamanho;
- crescimento;
- rotação;
- retenção;
- duplicação;
- logs do Docker;
- logs da aplicação;
- logs do proxy;
- logs do banco;
- logs do sistema.

Procure logs sem rotação ou retenção exagerada.

Otimizar logs não significa eliminar observabilidade.

Preserve o necessário para:

- diagnóstico;
- segurança;
- auditoria;
- erros;
- incidentes.

---

# 14. BACKUPS

Analise:

- frequência;
- retenção;
- localização;
- tamanho;
- duplicação;
- dumps antigos;
- snapshots;
- restore;
- dependência de volumes.

Não reduza backups apenas para economizar disco.

Qualquer proposta deve preservar capacidade de recuperação adequada.

Backup sem restore verificável não deve ser tratado como estratégia comprovada.

---

# 15. BUILD

Descubra onde o build acontece.

Avalie:

- RAM;
- CPU;
- disco temporário;
- duração;
- cache;
- downloads;
- dependências;
- artefatos.

Se a VPS compila aplicações pesadas, avalie se é tecnicamente melhor mover build para:

- CI;
- runner;
- pipeline externo;
- máquina de desenvolvimento;
- registry.

Não assuma que CI é gratuito.

Considere:

- custo;
- arquitetura;
- secrets;
- cache;
- disponibilidade;
- rollback;
- registry.

O objetivo é evitar que deploys disputem recursos com aplicações em produção quando houver alternativa adequada.

---

# 16. DEPLOY E CI/CD

Mapeie:

**commit → build → imagem/artefato → registry → pull → migration → seed quando aplicável → start → healthcheck → validação → rollback**

Analise:

- tempo;
- consumo;
- downtime;
- imagens antigas;
- coexistência de releases;
- disco temporário;
- migration;
- seed;
- healthcheck;
- readiness;
- rollback;
- autenticação;
- secrets.

Procure:

- builds repetidos;
- builds dentro de cada container;
- instalações repetidas;
- ausência de cache;
- downloads redundantes;
- imagens sem versionamento;
- releases antigas acumuladas;
- deploy que recria mais do que necessário.

Não faça seed automaticamente se o comportamento não for confirmado como seguro e idempotente.

---

# 17. APLICAÇÃO

Analise código executado e fluxos reais.

Procure:

- polling excessivo;
- timers;
- intervalos;
- consultas repetidas;
- serialização excessiva;
- respostas gigantes;
- ausência de paginação;
- concorrência ilimitada;
- processamento síncrono pesado;
- processamento de imagens;
- geração de PDF;
- browsers headless;
- imports pesados;
- jobs duplicados;
- cron sobreposto;
- retries sem limite;
- WebSockets desnecessários;
- cache sem limite;
- processos órfãos.

Otimize causas comprovadas.

Não faça refatoração geral sem relação com consumo de recursos.

---

# 18. JOBS, CRON, FILAS E WORKERS

Quando existirem, verifique:

- frequência;
- duração;
- sobreposição;
- concorrência;
- retry;
- backoff;
- idempotência;
- memória;
- CPU;
- conexões;
- processos residentes;
- graceful shutdown.

Avalie se um worker permanente realmente precisa permanecer residente.

Alguns jobs podem ser executados sob demanda ou por scheduler sem manter processo dedicado.

Faça isso somente quando preservar confiabilidade e comportamento.

---

# 19. CACHE E REDIS

Se Redis ou outro cache existir, descubra exatamente sua função.

Pode estar sendo usado para:

- cache;
- sessão;
- fila;
- locks;
- rate limiting;
- pub/sub;
- WebSockets;
- jobs;
- estado temporário.

Não remova Redis porque uma busca simples não encontrou `redis`.

Confirme consumidores reais.

Se estiver comprovadamente sem uso, planeje remoção completa:

- dependência;
- código;
- ENV;
- Compose;
- container;
- volumes descartáveis relacionados;
- documentação;
- deploy.

Teste a aplicação depois.

---

# 20. VPS E HOST

Quando houver acesso autorizado, avalie:

- RAM total;
- memória disponível;
- cache;
- swap;
- pressão de memória;
- CPU;
- load;
- iowait;
- steal;
- disco;
- inodes;
- processos;
- Docker;
- proxy;
- TLS;
- serviços do host;
- banco;
- aplicações vizinhas.

Diferencie:

- problema da aplicação;
- problema agregado das aplicações;
- contenção do host;
- limitação do provedor.

Não atribua causa a um único snapshot.

---

# 21. CAPACIDADE COMPARTILHADA

Se a VPS hospedar várias aplicações, considere o conjunto.

Calcule qualitativamente ou quantitativamente, quando houver dados:

- consumo base;
- picos;
- banco;
- proxy;
- jobs;
- deploy;
- backups;
- margem operacional.

O objetivo não é apenas fazer cada aplicação consumir menos isoladamente.

É evitar que a soma das aplicações derrube a VPS.

---

# 22. PLANEJAR

Após a análise, crie apenas:

```text
docs/VPS_OPTIMIZATION_PLAN.md
```

Não crie uma coleção de auditorias separadas sem necessidade.

Estrutura:

```text
# Plano de Otimização da VPS

## Estado atual
Arquitetura e infraestrutura confirmadas.

## Baseline
Métricas disponíveis antes da otimização.

## Desperdícios encontrados
Itens comprovados ou fortemente evidenciados.

## Plano

ID | PRIORIDADE | ÁREA | PROBLEMA | EVIDÊNCIA | SOLUÇÃO | GANHO ESPERADO | RISCO | TESTE | ROLLBACK | STATUS

## Ordem de execução
Sequência considerando dependências e risco.

## Limpezas recomendadas que exigem autorização
Ações destrutivas ou de produção que não serão executadas automaticamente.

## Métricas para comparação
RAM, CPU, disco, imagens, containers, deploy, banco e outras aplicáveis.

## Bloqueios reais
Somente impedimentos reais.
```

Prioridades:

- `P0` — risco de indisponibilidade, perda de dados, OOM, disco crítico ou segurança;
- `P1` — grande desperdício ou problema estrutural relevante;
- `P2` — otimização significativa;
- `P3` — refinamento de baixo impacto.

Status:

- `TODO`;
- `DOING`;
- `DONE`;
- `BLOCKED`;
- `REQUIRES_AUTHORIZATION`.

Depois de criar o plano, continue automaticamente para a implementação dos itens seguros.

---

# 23. IMPLEMENTAR

Implemente automaticamente as otimizações que forem:

- tecnicamente comprovadas;
- reversíveis;
- seguras;
- testáveis;
- dentro do repositório/ambiente autorizado;
- sem destruição de dados;
- sem custo externo não aprovado.

Ordem preferencial:

1. desperdícios claros e baixo risco;
2. dependências não utilizadas comprovadas;
3. Docker/build;
4. runtime;
5. queries/pools;
6. logs/cache;
7. jobs/workers;
8. deploy;
9. mudanças arquiteturais justificadas.

Para cada alteração:

1. registre baseline aplicável;
2. implemente;
3. teste;
4. compare;
5. corrija regressões;
6. atualize o plano.

Não espere aprovação entre alterações seguras.

---

# 24. TESTAR

Execute os testes adequados à stack.

Quando aplicável:

- lint;
- typecheck;
- unit;
- integration;
- E2E;
- build;
- startup;
- healthcheck;
- conexão ao banco;
- migrations em ambiente seguro;
- seed em ambiente seguro;
- upload/download;
- autenticação;
- autorização;
- jobs;
- filas;
- WebSockets;
- persistência após recriação de container;
- rollback.

Não desabilite testes para concluir a otimização.

---

# 25. MEDIR DEPOIS

Compare condições equivalentes sempre que possível.

Registre:

- ambiente;
- versão;
- carga;
- duração;
- dataset;
- cache frio/quente;
- concorrência.

Compare:

- RAM/RSS;
- pico de memória;
- heap quando aplicável;
- CPU;
- I/O;
- disco;
- inodes;
- tamanho de imagens;
- espaço recuperável;
- volumes;
- logs;
- conexões;
- containers;
- processos;
- tempo de build;
- tempo de deploy;
- downtime;
- latência;
- erros;
- throughput;
- OOM;
- reinícios.

Não declare ganho percentual quando os dados não forem comparáveis.

Use:

- `MEASURED`;
- `ESTIMATED`;
- `NOT_MEASURED`.

---

# 26. CORRIGIR REGRESSÕES

Se uma otimização causar:

- erro;
- aumento relevante de latência;
- perda de funcionalidade;
- falha de migration;
- falha de seed;
- perda de persistência;
- aumento de OOM;
- instabilidade;
- falha de integração;

investigue automaticamente.

Se puder corrigir com segurança, corrija.

Caso contrário, reverta a mudança quando o rollback for seguro e documente o item como `BLOCKED`.

Não mantenha uma otimização apenas porque reduziu RAM.

---

# 27. VALIDAR

Ao final, faça uma revisão independente do estado real.

Reconfirme:

- containers;
- processos;
- dependências;
- volumes;
- Dockerfiles;
- banco;
- pools;
- cache;
- Redis;
- workers;
- cron;
- filas;
- storage;
- logs;
- backups;
- build;
- deploy;
- runtime;
- persistência;
- segurança;
- integrações;
- healthchecks.

Confirme que nenhuma funcionalidade necessária desapareceu.

Confirme que nenhuma otimização depende de comportamento não testado.

---

# 28. RELATÓRIO FINAL

Crie:

```text
docs/VPS_OPTIMIZATION_REPORT.md
```

Estrutura:

```text
# Relatório Final de Otimização

## Resumo
O que foi analisado e otimizado.

## Antes
Baseline disponível.

## Alterações realizadas
Mudanças implementadas.

## Serviços removidos
Somente os comprovadamente desnecessários.

## Docker e imagens
Melhorias.

## RAM e CPU
Melhorias.

## Banco
Melhorias.

## Storage e disco
Melhorias.

## Build e deploy
Melhorias.

## Jobs e processos
Melhorias.

## Depois
Métricas finais.

## Comparação
Antes x Depois.

## Testes
Testes executados e resultados.

## Ações que exigem autorização
Limpezas ou mudanças de produção não executadas.

## Bloqueios
Itens que não puderam ser concluídos.

## Riscos restantes
Se existirem.

## Recomendações futuras
Somente itens que realmente ficaram fora do escopo.
```

Seja objetivo.

Não produza um relatório enorme para compensar falta de medição.

---

# 29. QUANDO PARAR E PERGUNTAR

Não peça aprovação por rotina.

Interrompa somente se houver:

### Operação destrutiva
Exclusão de dados, volumes, backups, imagens necessárias ao rollback ou infraestrutura real.

### Acesso externo
SSH, painel, registry, provedor, banco remoto ou credencial necessária e indisponível.

### Mudança com custo
Nova VPS, serviço pago, storage externo, CI pago ou infraestrutura adicional.

### Decisão arquitetural irreversível
Mudança relevante sem caminho seguro de compatibilidade ou rollback.

### Produção
Alteração que necessariamente precisa ser aplicada diretamente em produção e possa causar indisponibilidade ou perda.

### Uso não determinável
Um serviço parece removível, mas seu uso externo não pode ser confirmado.

Nesses casos:

1. documente o item;
2. continue tudo que for independente;
3. apresente a pergunta mínima necessária;
4. não bloqueie o restante do trabalho.

---

# 30. O QUE NÃO FAZER

Não:

- criar gates;
- usar 10 ou 15 prompts separados;
- parar após inventário;
- parar após auditoria;
- parar após criar o plano;
- pedir autorização para cada mudança de código;
- gerar documentação excessiva;
- otimizar apenas por “boa prática”;
- remover serviço por suposição;
- remover funcionalidades;
- trocar persistência por memória;
- usar mocks;
- apagar volumes;
- limpar Docker indiscriminadamente;
- reduzir backups sem análise;
- remover logs essenciais;
- reduzir limites até causar throttling/OOM;
- confundir limite com consumo;
- confundir RAM idle com pico;
- confundir imagem lógica com disco recuperável;
- adicionar Redis/cache para esconder problema;
- criar microsserviços para otimizar VPS;
- introduzir infraestrutura desnecessária;
- declarar ganho sem medição ou evidência;
- declarar 100% otimizado quando existirem itens relevantes não verificados.

---

# 31. DEFINIÇÃO DE CONCLUÍDO

A otimização está concluída quando:

- a arquitetura real foi compreendida;
- serviços e processos relevantes foram analisados;
- baseline disponível foi registrada;
- `docs/VPS_OPTIMIZATION_PLAN.md` foi criado;
- otimizações seguras foram implementadas;
- funcionalidades foram preservadas;
- persistência foi preservada;
- segurança não foi reduzida;
- testes aplicáveis passaram;
- regressões introduzidas foram corrigidas ou revertidas;
- métricas foram comparadas quando possível;
- ações destrutivas ficaram apenas documentadas;
- bloqueios reais foram registrados;
- `docs/VPS_OPTIMIZATION_REPORT.md` foi criado;
- o relatório corresponde ao estado real.

---

# 32. PROMPT MESTRE

```text
Leia integralmente @PROTOCOLO_UNIVERSAL_OTIMIZACAO_VPS.md e siga-o como protocolo desta aplicação.

Analise profundamente tudo que influencia o consumo da VPS e otimize a aplicação para utilizar a menor quantidade razoável de RAM, CPU, disco, I/O, containers, imagens e recursos operacionais, sem remover funcionalidades, comprometer dados, persistência, segurança, estabilidade ou desempenho real.

Trabalhe continuamente:

ANALISAR → MEDIR → PLANEJAR → IMPLEMENTAR → TESTAR → COMPARAR → CORRIGIR → VALIDAR.

Descubra a stack e a arquitetura reais. Não presuma tecnologias.

Analise aplicação, containers, processos, runtime, Docker, banco, ORM, conexões, pools, storage, volumes, logs, backups, cache, Redis, workers, cron, filas, WebSockets, build, deploy, CI/CD, proxy e a VPS quando houver acesso.

Confirme uso real antes de remover qualquer serviço ou dependência.

Crie docs/VPS_OPTIMIZATION_PLAN.md e, sem aguardar minha aprovação, implemente automaticamente todas as otimizações seguras, reversíveis e comprovadas.

Teste cada conjunto de alterações e compare métricas antes/depois quando houver dados disponíveis. Se uma otimização causar regressão, corrija ou reverta.

Ao final, faça uma nova validação do estado real e crie docs/VPS_OPTIMIZATION_REPORT.md.

NÃO crie gates.
NÃO pare entre auditoria, plano e implementação.
NÃO use mocks.
NÃO remova funcionalidades.
NÃO substitua persistência real.
NÃO exponha secrets.
NÃO execute limpeza destrutiva.
NÃO remova volumes, backups ou dados.
NÃO remova serviços por suposição.
NÃO declare ganhos que não foram medidos ou sustentados por evidência.

Só me consulte quando houver bloqueio real: operação destrutiva, acesso externo indisponível, custo adicional, alteração obrigatória de produção, decisão irreversível ou uso externo impossível de confirmar.

Em todos os outros casos, decida tecnicamente, implemente, teste e continue até concluir.
```

---

# 33. FLUXO

```text
REPOSITÓRIO / VPS
       ↓
    ANALISAR
       ↓
     MEDIR
       ↓
VPS_OPTIMIZATION_PLAN.md
       ↓
  IMPLEMENTAR
       ↓
    TESTAR
       ↓
   COMPARAR
       ↓
   CORRIGIR
       ↓
   VALIDAR
       ↓
VPS_OPTIMIZATION_REPORT.md
```

**Sem gates. Sem 13 prompts. Sem burocracia.**

O objetivo é simples:

**encontrar desperdícios reais → otimizar com segurança → provar que continua funcionando → medir o resultado.**
