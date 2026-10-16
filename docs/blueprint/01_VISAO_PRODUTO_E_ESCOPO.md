# PIE — Visão de produto e requisitos integrais

## 1. Problema
Agentes de programação conseguem produzir muito código, mas frequentemente confundem presença de arquivos com implementação correta, ignoram dependências entre módulos, duplicam fluxos, presumem que uma API funciona e propõem otimizações sem métricas. O PIE cria uma **fonte verificável de entendimento da aplicação**.

## 2. Promessa verificável
Para qualquer projeto autorizado, o PIE deve responder: (a) o que existe? (b) como as partes se conectam? (c) o que foi executado e funcionou? (d) o que falha ou está incompleto? (e) quais riscos e oportunidades têm evidência? (f) o que mudou após a correção?

## 3. Público e casos de uso
- Desenvolvedor com Codex/Claude Code investigando um monorepo grande.
- Agência auditando várias aplicações próprias ou de clientes com autorização.
- Equipe SaaS verificando isolamento multi-tenant, faturamento e módulos premium.
- Operador de VPS verificando desperdícios reais sem derrubar serviços.
- Engenheiro de produto reduzindo complexidade sem perder funcionalidades.

## 4. Produto final, não MVP reduzido
O escopo contratado pelo blueprint inclui **CLI, servidor MCP, painel web responsivo, API local, motor de evidências, grafo de dependências, seis motores, adaptadores multi-stack, execução de testes, observabilidade, histórico, integração com agentes, análise incremental e relatórios exportáveis**. Implementar em fatias verticais integradas com testes, mas **não eliminar motores nem declarar o projeto entregue apenas com um protótipo**.

## 5. Experiência do usuário — regra dos três passos
1. **Conectar** projeto/repositório/ambiente com permissões claras.
2. **Investigar** (auditoria completa ou motor específico), acompanhando progresso e limitações.
3. **Resolver e validar**: ver evidências, priorizar, enviar correções ao agente e comparar resultados.

Evitar modais excessivos, telas fragmentadas, painéis cheios de texto, ações ambíguas. Desktop/tablet/mobile responsivos; pt-BR; modo acessível por teclado; estados de carregamento, erro e vazio úteis.

## 6. Capacidades obrigatórias
### A. Inventário e descoberta
- Identificar monorepos, serviços, linguagens, frameworks, containers, banco, rotas, jobs, integrações, módulos, testes, CI e documentação.
- Resolver relações entre página, ação, rota, serviço, regra, entidade, permissão, integração e teste.
- Detectar artefatos órfãos, implementações duplicadas e rotas sem consumidores.
- Manter procedência e cobertura da descoberta; não prometer suporte universal irrestrito.

### B. Verificação funcional
- Executar testes existentes; inspecionar APIs e fluxos de navegador com Playwright quando disponível.
- Verificar escrita/leitura, estado após reload, autorização, eventos assíncronos, falhas e regressões.
- Detectar mocks, TODOs e stubs em produção, sem classificar automaticamente todo TODO como defeito.
- Distinguir observação real de inferência.

### C. Produto e UX
- Avaliar tarefas reais, esforço, redundâncias, acessibilidade, responsividade, clareza e consistência.
- Usar heurísticas ELIMINAR → JUNTAR → AUTOMATIZAR → ANTECIPAR → CRIAR, com risco, custo e benefício.
- Propor melhorias realizáveis, sem inventar requisitos ou alterar o negócio sem confirmação.

### D. Segurança, LGPD e receita
- Analisar autenticação, sessões, autorização, IDOR/BOLA, multi-tenancy, segredos, APIs, dependências, supply chain, IA, logs e tratamento de dados.
- Testar bloqueio de módulos pagos, assinaturas, créditos, webhooks, limites e corrida de transações em ambiente autorizado.
- Registrar riscos e lacunas LGPD; não emitir certificação jurídica.

### E. VPS, performance e infraestrutura
- Ler Docker/Compose/Nginx/CI, métricas CPU/RAM/I/O/disco, consultas e latências.
- Associar achados à aplicação correta, especialmente em VPS com múltiplos projetos.
- Exigir baseline, intervenção, medição pós-mudança e rollback.

### F. Dados, integrações e regressões
- Schema, migrations, integridade referencial, contratos, idempotência, jobs, filas e integrações.
- Detecção de mudanças por Git e reteste do grafo afetado; auditoria completa sob demanda.

## 7. Não objetivos
- Não substituir Codex/Claude Code por um novo LLM proprietário.
- Não prometer zero vulnerabilidades, cobertura de todas as linguagens ou certificação LGPD.
- Não invadir serviços, contornar licenças, copiar código de terceiros ou testar alvos sem autorização.
- Não executar mudanças em produção por padrão.

## 8. Métricas de sucesso
- Percentual de funcionalidades com cadeia rastreada e evidência; cobertura por stack.
- Taxa de achados reproduzíveis e falsos positivos revisados.
- Testes de regressão que detectam defeitos reais introduzidos propositalmente em fixtures.
- Tempo de auditoria, uso de CPU/RAM do PIE e taxa de reuso de evidências.
- Redução de falhas recorrentes e comparação de latência/recursos antes/depois.

## 9. Entregáveis de UX
Mapa de aplicações; visão de auditoria; matriz de funcionalidades; investigação por funcionalidade; evidências; problemas e oportunidades; execução e aprovação; segurança/receita; infraestrutura; histórico/diff; configurações de agentes e ambientes. A UI não deve ser bloqueio para uso por CLI/MCP.
