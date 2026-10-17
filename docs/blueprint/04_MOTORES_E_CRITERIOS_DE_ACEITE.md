# Especificação dos seis motores PIE

## Contrato comum obrigatório

Cada motor recebe `AuditScope + ProjectSnapshot + Policy + EvidenceAccess`, retorna achados tipados com provas, severidade, cobertura, incerteza, reprodução, proposta e validação. Não declarar aprovado se não houve verificação. Suportar auditoria total e por módulo; histórico e reexecução incremental.

## 1. Motor Funcional (Functional Truth)

**Descobre:** páginas, ações, endpoints, serviços, persistência, eventos, jobs e integrações. **Verifica:** existência, fluxo completo, retorno, gravação, reload, erros, permissões, responsividade básica e testes existentes. **Estados:** verified, failing, partial, unverified, not_found, blocked. **Evidências:** rota/arquivo/linha, resultado de teste, screenshot/trace com dados mascarados. **Aceite:** em aplicação fixture, detectar endpoint ausente, mock indevido em produção, gravação inexistente, permissão incorreta e fluxo que quebra após reload; não marcar verificado se o ambiente estiver indisponível.

## 2. Motor Produto e UX

**Analisa:** tarefas, número de passos, fricção, duplicação de telas, clareza de ação, acessibilidade, componentes, fluxos mobile/desktop. **Heurística:** ELIMINAR → JUNTAR → AUTOMATIZAR → ANTECIPAR → CRIAR. **Aceite:** produzir oportunidades ligadas a jornada concreta, hipótese verificável, impacto, custo, dependências e risco; não redesenhar marca sem solicitação; melhorias aprovadas preservam funções existentes. **Protocolo:** `protocolos/PROTOCOLO_UNIVERSAL_PRODUTO_V2.md`.

## 3. Motor Segurança, LGPD e Receita

**Verifica:** autenticação, sessões, RBAC/ABAC, IDOR/BOLA, tenant, APIs, SSRF, XSS, CSRF, injeções, uploads, segredos, dependências, logs, privacidade, retenção, direitos dos titulares e terceiros. **Receita:** assinatura/plano, módulo contratado, créditos, cotas IA, webhooks assinados e idempotentes, race conditions, downgrade/cancelamento, acesso via API/filas/exportação/websocket. **Aceite:** testes negativos com múltiplos tenants e planos, pagamento falso/duplicado, consumo concorrente, sem ataque a sistemas externos; findings reproduzíveis; LGPD marcada como verificação técnica e não parecer jurídico. **Protocolo:** `protocolos/PROTOCOLO_UNIVERSAL_SEGURANCA_LGPD_E_NEGOCIO.md`.

## 4. Motor Infraestrutura, VPS e Performance

**Descobre:** serviços, processos, Docker, imagens, volumes, banco, Nginx, build, deploy, caches, observabilidade. **Mede:** CPU, RAM, disco, I/O, rede, p95/p99 latência quando dados suficientes, queries, reinícios, saturação. **Aceite:** baseline e pós-mudança comparáveis, controle de carga e ruído, explicação de incerteza; demonstrar redução ou justificar ausência; nunca executar `prune` destrutivo ou remover volumes sem consentimento. **Protocolo:** `protocolos/PROTOCOLO_UNIVERSAL_OTIMIZACAO_VPS.md`.

## 5. Motor Dados e Integrações

**Verifica:** schema, migrations, relacionamentos, constraints, integridade, transações, duplicidade, jobs, filas, contratos REST/eventos, idempotência, compatibilidade de versões, falhas e retry. **Aceite:** detectar incompatibilidade schema/API, ausência de constraint crítica, job duplicado, migração incompatível e inconsistência de evento em fixture; nunca alterar dados reais para testar.

## 6. Motor Regressão e Mudanças

**Verifica:** diff Git, dependências do grafo, testes afetados, contratos, screenshots com tolerâncias, mudanças de métricas e cobertura de segurança. **Aceite:** identificar impacto em rotas e regras conectadas, reexecutar testes pertinentes, comparar versões e evitar falsa aprovação quando testes foram ignorados. Deve permitir full audit, não apenas incremental.

## Critérios cruzados

- Correção de performance não pode violar isolamento multi-tenant.
- Simplificação UX não pode remover verificação de autorização ou assinatura.
- Migração de banco não pode quebrar fluxo funcional nem rollback.
- Correção de segurança não pode alterar regras comerciais legítimas sem decisão humana.
- Toda recomendação tem responsável, estado, evidência e teste de aceite.
- Falsos positivos podem ser contestados com evidência e justificativa, mantendo trilha histórica.
