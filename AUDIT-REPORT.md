# AUDIT-REPORT.md — Fire Workspace (wacrm)

**Data da Auditoria:** 14/08/2026  
**Auditor:** IA (opencode/mimo-v2.5-free)  
**Escopo:** Código-fonte completo em `C:\Users\yRafael\Desktop\wacrm` + Documentação em `C:\Users\yRafael\Desktop\DOCUMENTAÇÕES`  
**Versão:** 0.8.0  
**Status:** Auditoria somente leitura — nenhuma alteração foi feita.

---

## 1. Resumo Executivo

O Fire Workspace (wacrm) é um **CRM multi-tenant para WhatsApp** construído com Next.js 16, Supabase (Postgres + Auth + RLS) e Baileys (WhatsApp Web protocol). O projeto está em **estágio avançado de desenvolvimento** (v0.8.0) com implementação sólida da maioria das funcionalidades documentadas.

**Diagnóstico geral:** Este é um projeto **bem arquitetado e seguro**, com defesa em profundidade em todas as camadas. O banco de dados possui RLS em 100% das tabelas, 25+ funções SECURITY DEFINER, e 48 migrations bem documentadas. Existem algumas melhorias recomendadas, mas nenhuma vulnerabilidade crítica que impeça produção.

---

## 2. Estado Geral do Projeto

| Área | Avaliação | Nota |
|------|-----------|------|
| Arquitetura | █████████░ | Excelente — clean architecture, separação de responsabilidades |
| Segurança | ████████░░ | Muito boa — defesa em profundidade, algumas melhorias pendentes |
| Testes | ███████░░░ | 85 arquivos de teste — cobertura boa, faltam testes de componentes |
| UX/UI | ████████░░ | Interface completa e funcional |
| Performance | ████████░░ | Bem otimizado, sem N+1 queries |
| Documentação | █████████░ | Excepcional — comentários detalhados em todo o código |
| Produção | ████████░░ | Próximo de production-ready |

---

## 3. Inventário

### 3.1 Estrutura do Projeto

```
src/
  app/            -- 39 páginas, 62 rotas API
  components/     -- 146 componentes (.tsx)
  hooks/          -- 11 hooks customizados
  lib/            -- 122 arquivos de lógica de negócio
  types/          -- Definições TypeScript
  whatsapp/       -- Worker Baileys (WhatsApp)
  middleware.ts   -- Auth + proteção de rotas
```

### 3.2 Stack Tecnológica

| Componente | Tecnologia | Versão |
|------------|------------|--------|
| Frontend | Next.js (App Router) | 16.2.6 |
| UI | React + Tailwind + shadcn | React 19, Tailwind 4 |
| Backend | Next.js API Routes | - |
| Banco | Supabase (PostgreSQL) | - |
| Auth | Supabase Auth | - |
| WhatsApp | Baileys (WhatsApp Web) | 7.0.0-rc14 |
| i18n | next-intl | 4.13.2 |
| Testes | Vitest | 4.1.10 |
| Tipagem | TypeScript | 6.x |

### 3.3 Módulos Implementados

| Módulo | Status | Detalhes |
|--------|--------|----------|
| Auth/Login | ✅ COMPLETO | Supabase Auth, cookies, forgot-password |
| Multi-tenancy | ✅ COMPLETO | account_id em todas as tabelas, RLS |
| RBAC | ✅ COMPLETO | owner > admin > agent > viewer |
| WhatsApp/Inbox | ✅ COMPLETO | Baileys worker, mensagens, reações, templates |
| Contatos | ✅ COMPLETO | CRUD, tags, campos customizados, importação CSV |
| Pipeline/Kanban | ✅ COMPLETO | Deals, estágios, analytics |
| Broadcasts | ✅ COMPLETO | Wizard 4 passos, tracking |
| Automations | ✅ COMPLETO | 13 tipos de step, 8 triggers |
| Flows | ✅ COMPLETO | Editor visual, execução stateful |
| AI Assistant | ✅ COMPLETO | BYO key, draft reply, auto-reply, knowledge base |
| Fire Control | ✅ COMPLETO | Step-up auth, gestão de contas, planos, subscriptions |
| Sistema Revenda | ✅ COMPLETO | Árvore hierárquica, subtree access |
| IPTV | ✅ COMPLETO | Credenciais, parsers, planos, servidores |
| Financeiro | ✅ COMPLETO | Pagamentos, transações, renovações |
| Dashboard | ✅ COMPLETO | Métricas, charts, activity feed |
| Public API | ✅ COMPLETO | API keys, endpoints REST |
| Webhooks | ✅ COMPLETO | HMAC signing, SSRF protection |
| Branding | ✅ COMPLETO | White-label theming |
| Notificações | ✅ COMPLETO | Real-time notifications |
| Reports | ✅ COMPLETO | Sales, renewals, CSV export |

---

## 4. Matriz de Implementação

| Funcionalidade | Documento de Origem | Status | Arquivos Envolvidos |
|---|---|---|---|
| **Auth/Login** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/middleware.ts`, `src/lib/auth/` |
| **Multi-tenancy** | REGRAS, DOCUMENTAÇÃO PARA ORGANIZAR | ✅ IMPLEMENTADO | `supabase/migrations/017_account_sharing.sql` |
| **RBAC** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/auth/roles.ts` |
| **WhatsApp/Inbox** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/whatsapp/worker.ts`, `src/lib/whatsapp/` |
| **Contatos** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/contacts/`, `src/app/api/contacts/` |
| **Pipeline/Leads** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/pipeline/`, `src/app/(dashboard)/pipelines/` |
| **Broadcasts** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/hooks/use-broadcast-sending.ts` |
| **Automations** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/automations/engine.ts` |
| **Flows** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/flows/engine.ts` |
| **AI Assistant** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/ai/` |
| **Fire Control** | FIRE-PAINELADM | ✅ IMPLEMENTADO | `src/app/fire-control-x7k29/`, `src/lib/platform/` |
| **Sistema Revenda** | painelerevenda | ✅ IMPLEMENTADO | `src/lib/auth/subtree.ts`, `src/lib/platform/tree.ts` |
| **IPTV** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/iptv/` |
| **Financeiro** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/iptv/finance.ts` |
| **Dashboard** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/app/(dashboard)/` |
| **Public API** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/app/api/v1/`, `src/lib/api-keys/` |
| **Webhooks** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/webhooks/` |
| **Branding** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/branding/` |
| **Notificações** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/hooks/use-unread-notifications.ts` |
| **Relatórios** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/reports/` |
| **Renovações** | documentação WORKSPACE | ✅ IMPLEMENTADO | `src/lib/iptv/renewals.ts` |
| **Testes** | Boa prática | 🟡 PARCIAL | 85 arquivos de teste |
| **Subscription Gating** | TELADECADASTRO | ✅ IMPLEMENTADO | `src/lib/subscription/gating.ts` |
| **Step-up Auth** | FIRE-PAINELADM | ✅ IMPLEMENTADO | `src/lib/auth/step-up.ts` |
| **Auditoria (Logs)** | documentação WORKSPACE | ✅ IMPLEMENTADO | `audit_logs` table |

---

## 5. Arquitetura

### 5.1 Frontend

| Aspecto | Avaliação | Detalhes |
|---------|-----------|----------|
| Organização de componentes | ✅ EXCELENTE | 28 diretórios, 146 componentes |
| Gerenciamento de estado | ✅ BOM | React Context (3 providers) + state local |
| Chamadas à API | ✅ EXCELENTE | Server components + client hooks |
| Validações | ✅ BOM | Server-side validation em todas as rotas |
| Tratamento de erros | ✅ BOM | Typed errors, toErrorResponse, console logging |
| Loading states | ✅ BOM | Skeletons, spinners, optimistic updates |
| Permissões | ✅ EXCELENTE | useCan() hook, role gating server-side |
| Componentes compartilhados | ✅ EXCELENTE | 25 primitivos shadcn/ui |

### 5.2 Backend (API Routes)

| Aspecto | Avaliação | Detalhes |
|---------|-----------|----------|
| Autenticação | ✅ EXCELENTE | Supabase Auth + cookies + step-up |
| Autorização | ✅ EXCELENTE | requireRole(), requirePlatformOperator(), requireApiKey() |
| Validação | ✅ BOM | Server-side em todas as rotas |
| Isolamento entre contas | ✅ EXCELENTE | account_id em toda query, RLS |
| Tratamento de exceções | ✅ BOM | Typed errors, toErrorResponse |
| Logs | ✅ BOM | Console logging com prefixes |
| Auditoria | ✅ BOM | audit_logs table |

### 5.3 Banco de Dados

| Aspecto | Avaliação | Detalhes |
|---------|-----------|----------|
| Tabelas | ✅ EXCELENTE | ~40 tabelas, todas com account_id |
| RLS | ✅ EXCELENTE | 100% das tabelas com RLS |
| SECURITY DEFINER | ✅ EXCELENTE | 25+ funções protegidas |
| Foreign Keys | ✅ BOM | 60+ FKs com CASCADE/SET NULL apropriados |
| CHECK constraints | ✅ BOM | 30+ constraints em colunas de status/tipo |
| Índices | ✅ EXCELENTE | 80+ índices, incluindo parciais e compostos |
| Migrations | ✅ EXCELENTE | 48 migrations idempotentes e documentadas |
| Soft deletes | 🟡 PARCIAL | Apenas em iptv_credentials |
| Audit trails | ✅ BOM | audit_logs, automation_logs, parser_logs |

---

## 6. Segurança

### 6.1 Autenticação

| Item | Status | Detalhes |
|------|--------|----------|
| Supabase Auth | ✅ SEGURO | Cookies HttpOnly, auto-refresh |
| Middleware auth | ✅ SEGURO | Protected routes, cookie refresh |
| Step-up auth | ✅ SEGURO | Fire Control requer re-autenticação |
| Token refresh | ✅ SEGURO | Transparente, com fix do issue #288 |
| API key auth | ✅ SEGURO | SHA-256 hashed, scoped, rate-limited |

### 6.2 Autorização

| Item | Status | Detalhes |
|------|--------|----------|
| RBAC | ✅ SEGURO | owner > admin > agent > viewer |
| Platform operator | ✅ SEGURO | DB flag + step-up auth |
| Subtree access | ✅ SEGURO | Anti-IDOR/BOLA via recursive CTE |
| Account status blocking | ✅ SEGURO | SUSPENDED/BANNED bloqueados |

### 6.3 Multi-tenancy

| Item | Status | Detalhes |
|------|--------|----------|
| account_id como boundary | ✅ SEGURO | Em todas as tabelas |
| RLS policies | ✅ SEGURO | is_account_member() em todas |
| Service-role isolation | ✅ SEGURO | Queries sempre filtram account_id |
| Cross-tenant access | ✅ BLOQUEADO | RLS + backend checks |

### 6.4 Proteção de Dados

| Item | Status | Detalhes |
|------|--------|----------|
| Criptografia at rest | ✅ SEGURO | AES-256-GCM para tokens/chaves |
| Token hashing | ✅ SEGURO | SHA-256 para invites e API keys |
| API keys nunca re-emitted | ✅ SEGURO | Retornadas uma vez apenas |
| Webhook secrets | ✅ SEGURO | AES-256-GCM, retornados uma vez |

### 6.5 Proteção de Webhooks

| Item | Status | Detalhes |
|------|--------|----------|
| SSRF protection | ✅ SEGURO | DNS resolution + private IP blocking |
| HMAC signing | ✅ SEGURO | Stripe-style, constant-time comparison |
| HTTPS-only | ✅ SEGURO | Rejeita http:// endpoints |
| Auto-disable | ✅ SEGURO | Após 15 falhas consecutivas |

### 6.6 Rate Limiting

| Item | Status | Detalhes |
|------|--------|----------|
| In-memory rate limiter | ✅ FUNCIONAL | 12 buckets pré-configurados |
| Limitação | ⚠️ CONHECIDA | Não funciona em multi-instance |

### 6.7 Headers de Segurança

| Header | Status | Valor |
|--------|--------|-------|
| HSTS | ✅ ATIVO | max-age=63072000; includeSubDomains; preload |
| X-Content-Type-Options | ✅ ATIVO | nosniff |
| X-Frame-Options | ✅ ATIVO | DENY |
| Referrer-Policy | ✅ ATIVO | strict-origin-when-cross-origin |
| Permissions-Policy | ✅ ATIVO | camera=(), microphone=(self) |
| CSP | ⚠️ REPORT-ONLY | Content-Security-Policy-Report-Only |

---

## 7. Fire Control

**Status: IMPLEMENTADO**

O Fire Control está completo com:
- Step-up auth (re-autenticação + HMAC token de 15 min)
- URL não-óbvia (`/fire-control-x7k29`)
- Gestão de contas (criar, suspender, banir)
- Árvore visual de revendedores
- Planos e subscriptions
- Audit logs append-only
- Platform operator flag no banco (não env var)

---

## 8. Sistema de Revenda

**Status: IMPLEMENTADO**

- Hierarquia: Platform → Reseller → Sub-Reseller → Customer
- `account_relationships` com parent/child
- `is_account_in_subtree()` — recursive CTE anti-IDOR/BOLA
- `requireSubtreeAccess()` — verificação no código
- account_type: USER, RESELLER, PLATFORM

---

## 9. WhatsApp / Inbox

**Status: IMPLEMENTADO**

| Componente | Status |
|------------|--------|
| Baileys worker | ✅ 837 linhas, processamento async |
| Outbox pattern | ✅ Mensagens enfileiradas, worker processa |
| Envio de mensagens | ✅ Texto, imagem, vídeo, documento, áudio, template |
| Reações | ✅ Adicionar/trocar/remover |
| Mensagens interativas | ✅ Botões e list messages |
| Templates Meta | ✅ Gestão completa |
| Broadcasts | ✅ Wizard 4 passos, tracking |
| Webhook Meta | ⚠️ DESABILITADO (410 Gone) — intencional |

---

## 10. Fire Radar

**Status: IMPLEMENTADO**

- Dashboard com métricas em tempo real
- Response time charts
- Activity feed
- Pipeline donut
- Priorities (renewals due, WhatsApp disconnected)

---

## 11. Sistema Financeiro

**Status: IMPLEMENTADO**

| Funcionalidade | Status |
|----------------|--------|
| Pagamentos (contas a receber) | ✅ |
| Transações financeiras (cash ledger) | ✅ Append-only |
| Renovações | ✅ complete_renewal() RPC atômico |
| Planos IPTV | ✅ ensure_default_plans() |
| Servidores | ✅ |
| Credenciais IPTV | ✅ Criptografadas, soft delete |

---

## 12. Banco de Dados

### 12.1 Tabelas (~40)

**Core CRM:** profiles, accounts, contacts, tags, contact_tags, custom_fields, contact_custom_values, contact_notes

**Mensagens:** conversations, messages, message_reactions, message_templates, quick_replies, notifications

**Broadcasts:** broadcasts, broadcast_recipients

**Pipeline:** pipelines, pipeline_stages, deals

**Automações:** automations, automation_steps, automation_logs, automation_pending_executions

**Flows:** flows, flow_nodes, flow_runs, flow_run_events

**WhatsApp:** whatsapp_config, whatsapp_sessions, whatsapp_outbox

**IPTV/Financeiro:** iptv_credentials, parser_logs, plans, servers, payments, financial_transactions, renewals

**AI:** ai_configs, ai_knowledge_documents, ai_knowledge_chunks

**Platform:** platform_plans, platform_subscriptions, account_relationships, audit_logs

**API/Webhooks:** api_keys, webhook_endpoints, account_invitations

**Outros:** member_presence, account_branding

### 12.2 Funções SECURITY DEFINER (25+)

- `handle_new_user()` — Trigger on signup
- `is_account_member()` — RLS helper
- `is_platform_operator()` — Platform gate
- `is_account_in_subtree()` — Anti-IDOR/BOLA
- `set_member_role()` — RBAC management
- `remove_account_member()` — Member removal
- `transfer_account_ownership()` — Ownership transfer
- `complete_renewal()` — Atomic renewal
- `claim_ai_reply_slot()` — Atomic AI cap
- `record_webhook_failure()` — Atomic failure counter
- E mais 15+ funções

### 12.3 Índices (80+)

- Composite indexes em account_id para todas as tabelas
- Partial indexes para hot paths (automations active, flows active, notifications unread)
- HNSW index para pgvector (AI knowledge)
- GIN index para FTS
- Unique indexes para data integrity

---

## 13. Testes

**Cobertura: ~85 arquivos de teste**

| Área | Status |
|------|--------|
| WhatsApp (encryption, sending, inbound) | ✅ 19 testes |
| Flows (engine, validate) | ✅ 5 testes |
| Automations | ✅ 2 testes |
| AI (auto-reply, config, knowledge) | ✅ 9 testes |
| Webhooks (SSRF, sign, deliver) | ✅ 5 testes |
| Auth (step-up, roles, API keys) | ✅ 6 testes |
| Contacts (dedup, tags) | ✅ 4 testes |
| API routes | ✅ 7 testes |
| Componentes | ⚠️ 2 testes (faltam mais) |
| Rate limiting | ✅ 1 teste |
| Currency | ✅ 1 teste |
| Broadcast status | ✅ 1 teste |
| Presence | ✅ 1 teste |

**Áreas sem testes:** Componentes React (inbox, settings, automations builder), páginas, hooks complexos.

---

## 14. Performance

| Aspecto | Avaliação | Detalhes |
|---------|-----------|----------|
| N+1 queries | ✅ RESOLVIDO | Promise.all + embedded selects |
| Dashboard queries | ✅ OTIMIZADO | 8 queries paralelas |
| Pulse queries | ✅ OTIMIZADO | 11 queries paralelas |
| Broadcast sending | ✅ OTIMIZADO | Batch processing |
| Worker WhatsApp | ✅ OTIMIZADO | Async, outbox pattern |

---

## 15. UX/UI

| Aspecto | Avaliação |
|---------|-----------|
| Design system | ✅ shadcn/ui + Tailwind |
| Dark/Light mode | ✅ Implementado |
| Responsividade | ✅ Implementado |
| i18n | ✅ 3 idiomas (en, pt-BR, ko) |
| Loading states | ✅ Skeletons |
| Error states | ✅ Error boundaries |
| Empty states | ✅ Implementados |
| Notificações | ✅ Real-time |

---

## 16. Infraestrutura

| Componente | Status |
|------------|--------|
| Next.js 16 | ✅ App Router |
| Supabase | ✅ Auth + Postgres + Storage + RLS |
| Baileys | ✅ WhatsApp Web protocol |
| Docker | ❌ Não utilizado |
| Redis | ❌ Não utilizado (rate limiter in-memory) |
| CI/CD | ❌ Não configurado |
| Monitoring | ❌ Sentry não configurado |
| HTTPS | ✅ HSTS headers |

---

## 17. Pontos Fortes

1. **Defesa em profundidade** — Auth no middleware + route + RLS + SQL functions
2. **RLS em 100% das tabelas** — "o banco barra sozinho"
3. **25+ funções SECURITY DEFINER** — Todas com auth check + account resolve + role validate
4. **Criptografia AES-256-GCM** — Tokens e chaves protegidos at rest
5. **SSRF protection** — DNS resolution + private IP blocking + redirect=manual
6. **HMAC webhook signing** — Stripe-style com constant-time comparison
7. **Subtree authorization** — Anti-IDOR/BOLA via recursive CTE
8. **Outbox pattern** — WhatsApp messages survive app restarts
9. **48 migrations idempotentes** — Todas documentadas e re-rounáveis
10. **85 arquivos de teste** — Cobertura razoável
11. **Código excepcionalmente limpo** — 1 TODO no todo o src/
12. **Comentários detalhados** — Cada módulo tem header explicativo

---

## 18. Problemas Encontrados

### 🔴 CRÍTICO (Nenhum)

Nenhuma vulnerabilidade crítica encontrada.

### 🟠 ALTO

1. **`.env.local` com credenciais reais em disco** — Se a máquina for comprometida, todas as chaves são expostas. Recomendação: usar secrets manager em produção.

2. **CSP em report-only** — Não está bloqueando XSS. Recomendação: planejar timeline para enforcement.

3. **`unsafe-inline` e `unsafe-eval` no CSP** — enfraquece qualquer enforcement futuro. Recomendação: usar nonces.

### 🟡 MÉDIO

4. **Rate limiter in-memory** — Não funciona em multi-instance. Recomendação: Redis/Upstash se escalar.

5. **Middleware auth gap** — Apenas `/api/whatsapp/*` protegido no middleware. Outras rotas API têm auth no route handler (defense-in-depth gap).

6. **GET /api/whatsapp/config sem role check** — Viewer pode triggerar verificações Meta API. Recomendação: adicionar `requireRole('admin')`.

7. **Supabase admin client duplicado** — 4 implementações diferentes. Recomendação: consolidar em `lib/supabase/admin.ts`.

8. **GET /api/automations sem role check** — Inconsistente com outras rotas. Recomendação: adicionar `requireRole('viewer')`.

9. **Subscription gating não enforceado no middleware/API** — Usuário com subscription CANCELED/EXPIRED pode usar a API. Recomendação: adicionar check em `getCurrentAccount()`.

### 🔵 BAIXO

10. **DNS rebinding SSRF** — Risco documentado mas não mitigado. Baixa probabilidade.

11. **Step-up token `secure` flag desabilitado em dev** — Aceitável para localhost.

12. **`timingSafeHexEqual` é dead code** — Nunca usado (DB lookup é o caminho correto).

13. **`profiles.role TEXT` é legacy** — Documentado para remoção, ainda presente.

---

## 19. Possíveis Vulnerabilidades

| ID | Título | Severidade | Local |
|----|--------|------------|-------|
| VULN-001 | Credenciais reais em .env.local | ALTA | `.env.local` |
| VULN-002 | CSP report-only (sem enforcement) | ALTA | `next.config.ts` |
| VULN-003 | unsafe-inline/eval no CSP | ALTA | `next.config.ts` |
| VULN-004 | Rate limiter in-memory | MÉDIA | `src/lib/rate-limit.ts` |
| VULN-005 | Middleware auth gap | MÉDIA | `src/middleware.ts` |
| VULN-006 | WhatsApp config GET sem role check | MÉDIA | `src/app/api/whatsapp/config/route.ts` |
| VULN-007 | Subscription gating não enforced | MÉDIA | `src/lib/subscription/gating.ts` |
| VULN-008 | DNS rebinding SSRF | BAIXA | `src/lib/webhooks/ssrf.ts` |

---

## 20. Dados e Privacidade

| Verificação | Status |
|-------------|--------|
| Dados pessoais armazenados | name, email, phone, cpf |
| Criptografia at rest | ✅ AES-256-GCM |
| Quem pode acessar | ✅ account_id + RLS |
| Retenção | ✅ Soft delete em iptv_credentials |
| Logs | ✅ audit_logs, automation_logs |
| Exportação | ✅ CSV export em reports |
| Exclusão | ✅ CASCADE deletes |
| LGPD | ⚠️ Parcial — sem política de privacidade visível |

---

## 21. Backup e Exportação

| Mecanismo | Status |
|-----------|--------|
| Exportar contatos | ✅ CSV |
| Exportar reports | ✅ CSV |
| Backup do banco | ⚠️ Dependente do Supabase |
| Restauração | ⚠️ Dependente do Supabase |

---

## 22. Estado Geral — Visão Consolidada

```
ESTADO GERAL DO PROJETO

Arquitetura:        █████████░  (9/10)
Seguranca:          ████████░░  (8/10)
Testes:             ███████░░░  (7/10)
UX/UI:              ████████░░  (8/10)
Performance:        ████████░░  (8/10)
Documentacao:       █████████░  (9/10)
Producao:           ████████░░  (8/10)
```

---

## 23. Backlog Recomendado

### 🟠 Alta Prioridade

1. Planejar timeline para CSP enforcement (remover unsafe-inline/eval)
2. Adicionar middleware auth para todas as rotas `/api/*`
3. Enforce subscription status em `getCurrentAccount()`
4. Adicionar `requireRole('admin')` em GET /api/whatsapp/config
5. Consolidar supabaseAdmin() em um único local

### 🟡 Média Prioridade

6. Adicionar testes de componentes React (inbox, settings, flows)
7. Substituir rate limiter in-memory por Redis/Upstash (quando escalar)
8. Adicionar `requireRole('viewer')` em GET /api/automations
9. Implementar MFA para usuários comuns
10. Adicionar session management UI

### 🔵 Baixa Prioridade

11. Remover profiles.role TEXT (legacy)
12. Remover timingSafeHexEqual (dead code)
13. Adicionar error boundaries nos módulos principais
14. Decompor automation-builder.tsx (1.788 linhas)
15. Mover supabaseAdmin() de lib/flows/ para lib/supabase/

---

## 24. Roadmap Sugerido

### FASE 1: Segurança (1 semana)
- CSP enforcement
- Middleware auth para todas as rotas API
- Subscription gating no backend

### FASE 2: Testes (2 semanas)
- Testes de componentes (inbox, settings, flows)
- Testes E2E críticos

### FASE 3: Infraestrutura (1 semana)
- CI/CD pipeline
- Sentry para error tracking
- Rate limiter distribuído (quando necessário)

### FASE 4: Melhorias de Código (2 semanas)
- Decompor automation-builder.tsx
- Consolidar admin clients
- Adicionar MFA

### FASE 5: Preparação para Produção (1 semana)
- Load testing
- Security audit final
- Monitoring setup

---

## 25. Conclusão

O Fire Workspace (wacrm) é um projeto **maduro e bem arquitetado**. A segurança é notavelmente forte para um CRM open-source, com defesa em profundidade em todas as camadas. O banco de dados é exceptionalmente bem projetado com RLS em 100% das tabelas e 25+ funções SECURITY DEFINER.

As principais melhorias recomendadas são:
1. CSP enforcement (o mais impactante para segurança)
2. Middleware auth para todas as rotas API
3. Subscription gating no backend
4. Mais testes de componentes

**O projeto está próximo de production-ready** e pode ser implantado com as ressalvas acima.

---

*Relatório gerado em 14/08/2026.*  
*Nenhuma alteração foi feita no código. Apenas análise e recomendações.*
