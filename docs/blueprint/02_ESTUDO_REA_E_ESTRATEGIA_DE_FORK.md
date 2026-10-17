# REA upstream — diligência, fork e evolução para PIE

## Fonte confirmada

Projeto oficial: https://github.com/morluto/rea. O README público descreve um servidor MCP e CLI de investigação de aplicações/binários, evidências com limitações e análise local; o projeto informa licença MIT para código de autoria REA, ressalvando materiais de terceiros e licenças de ferramentas externas. **Isso não significa que todos os arquivos e dependências possam ser relicenciados livremente.**

## Decisão arquitetural

O usuário deseja **fazer fork e criar PIE**. A execução deve começar por um fork legítimo do upstream, mas **não impor reutilização artificial de subsistemas de engenharia reversa**. Reutilizar o que demonstrar valor (MCP, CLI, evidências, sessões, provedores); adicionar os motores PIE como domínio novo e independente. Caso a estrutura do REA inviabilize o núcleo, preservar o fork como repositório de proveniência/adaptador e desenvolver pacotes PIE separados no mesmo projeto/organização, documentando a decisão.

## Procedimento obrigatório antes de alterar código

1. Abrir repositório oficial e validar URL, owner, branch padrão e origem. Não confiar em forks de nome semelhante.
2. Criar fork na conta/organização autorizada pelo usuário. Se não houver credenciais ou permissão para criar fork remoto, preparar clone local e instruir usuário a autorizar; **não afirmar fork remoto criado**.
3. Clonar fork com `upstream` apontando para `https://github.com/morluto/rea.git`; registrar `git rev-parse HEAD`, tag, data e alterações locais.
4. Ler `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `SECURITY.md`, `package.json`, workspace, diretórios `src/`, `bridge/`, `docs/`, `tests/`, pipelines CI, manifests e notices.
5. Gerar `docs/UPSTREAM_REA_AUDIT.md`: mapa real de pacotes, ferramentas MCP, CLI, contratos, sessions/evidence, dependências, testes, limites, licenças, superfícies de segurança e pontos de extensão **com caminhos/linhas reais**.
6. Registrar matriz de decisão por componente: **reutilizar / adaptar / isolar / substituir**, justificativa e custo de manutenção.
7. Confirmar condições de licença por arquivo, notices, dependências e ferramentas comerciais; manter atribuições e MIT originais conforme exigido.
8. Criar testes de caracterização para fluxos do REA antes de refatorar. Manter os testes upstream funcionando quando os recursos forem mantidos.
9. Definir namespace e marca PIE sem sugerir afiliação oficial com REA. Preservar `upstream` para acompanhar atualizações e registrar conflitos.
10. Criar branch de integração e iniciar evolução incremental dos componentes com contratos estáveis.

## Comandos de referência (executar somente no ambiente autorizado)

```bash
git clone https://github.com/SEU_USUARIO_OU_ORG/rea.git pie
cd pie
git remote add upstream https://github.com/morluto/rea.git
git fetch upstream --tags
git rev-parse HEAD
git remote -v
```

**Atenção:** substitua URL somente depois de criar o fork real. Não execute comandos destrutivos sobre repositórios existentes. Nunca instalar ferramentas externas com `curl | bash` sem revisão e consentimento.

## Regras de atualização upstream

- Branch de integração separada; atualizações via PR revisado, nunca merge cego.
- Compatibilidade do MCP original quando possível; namespace PIE para novos métodos.
- Testes de contrato e regressão antes/depois da atualização.
- Atribuição, changelog e inventário de componentes terceiros preservados.

## Critérios para decidir sobre o fork

**Prosseguir reutilizando** se os contratos MCP/CLI/evidência forem modularizáveis, testes forem executáveis e licenças estiverem claras. **Isolar** se componentes nativos introduzirem dependências ou privilégios desnecessários. **Não bloquear o PIE** se algum provedor REA não existir no SO alvo: torná-lo opcional e reportar disponibilidade.

## Lacunas que só a inspeção do código resolverá

Não afirmar neste documento que o REA já possui API pública para o grafo PIE, engine de auditoria de projetos, controle de credenciais, multi-tenancy ou workers. Essas são funcionalidades a criar; os caminhos e contratos exatos serão definidos após inspeção real.
