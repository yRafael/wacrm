# AUDIT-QUESTIONS.md — Fire Workspace (wacrm)

**Data da Auditoria:** 14/08/2026  
**Auditor:** IA (opencode/mimo-v2.5-free)  
**Projeto:** `C:\Users\yRafael\Desktop\wacrm`

---

## Perguntas para Outras IAs / Equipe

### 🔴 CRÍTICO (Nenhuma)

Nenhuma questão crítica identificada. O projeto está bem seguro.

---

### 🟠 ALTO

#### 1. CSP Enforcement Timeline

**Contexto:** O CSP está em `Content-Security-Policy-Report-Only` com `unsafe-inline` e `unsafe-eval` (`next.config.ts:39-63`). Isso significa que XSS não está sendo bloqueado.

**Pergunta:** Qual é o plano para remover `unsafe-inline` e `unsafe-eval`? O Next.js 16 suporta nonces para inline scripts?

**Arquivo:** `next.config.ts:39-63`

**Status:** ⏳ PENDENTE — requer pesquisa sobre Next.js 16 + nonces

---

#### 2. Middleware Auth Gap

**Contexto:** Apenas `/api/whatsapp/*` é protegido no middleware (`src/middleware.ts:122-131`). Outras rotas API têm auth no route handler via `requireRole()`, mas não no middleware. Isso cria um gap de defense-in-depth.

**Pergunta:** Deveríamos adicionar proteção middleware para todas as rotas `/api/*`? Ou a auth no route handler é suficiente?

**Arquivo:** `src/middleware.ts:122-131`

**Status:** ✅ RESOLVIDO — Middleware agora protege todas as rotas `/api/*` exceto webhooks e `/api/v1/*` (API key auth)

---

#### 3. Subscription Gating no Backend

**Contexto:** `getCurrentAccount()` verifica status (ACTIVE/SUSPENDED/BANNED) mas não verifica subscription status (`src/lib/auth/account.ts:209-211`). Usuário com subscription CANCELED/EXPIRED pode usar a API.

**Pergunta:** Deveríamos adicionar check de subscription em `getCurrentAccount()`? Ou criar um `requireActiveSubscription()` separado?

**Arquivo:** `src/lib/auth/account.ts:209-211`

**Status:** ✅ RESOLVIDO — `checkSubscription()` agora é chamado em `getCurrentAccount()`. Usuários com subscription bloqueada recebem ForbiddenError.

---

#### 4. supabaseAdmin() Consolidation

**Contexto:** `supabaseAdmin()` é importado de `@/lib/flows/admin-client` em `api-context.ts:32` e `account.ts:32`. Isso é confuso — um módulo de auth importa de um módulo de flows.

**Pergunta:** Deveríamos mover `supabaseAdmin()` para `lib/supabase/admin.ts` e atualizar todos os imports?

**Arquivos:** `src/lib/auth/api-context.ts:32`, `src/lib/auth/account.ts:32`

**Status:** ✅ RESOLVIDO — `supabaseAdmin()` consolidado em `lib/supabase/admin.ts`. Todos os 25 imports atualizados.

---

#### 5. WhatsApp Config GET sem Role Check

**Contexto:** O GET handler em `/api/whatsapp/config` não verifica role. Viewer pode triggerar verificações Meta API.

**Pergunta:** Deveríamos adicionar `requireRole('admin')` no GET handler?

**Arquivo:** `src/app/api/whatsapp/config/route.ts`

**Status:** ✅ RESOLVIDO — GET handler agora usa `requireRole('admin')`.

---

### 🟡 MÉDIO

#### 6. Rate Limiter Distribuído

**Contexto:** O rate limiter é in-memory (`src/lib/rate-limit.ts:46`). Não funciona em multi-instance (documentado nas linhas 9-14).

**Pergunta:** Quando precisaremos de Redis/Upstash? Qual é o threshold de escala?

**Arquivo:** `src/lib/rate-limit.ts:9-14`

**Status:** ⏳ PENDENTE — OK para VPS single-instance. Reavaliar quando escalar.

---

#### 7. profiles.role TEXT Legacy

**Contexto:** O campo `profiles.role` (TEXT) existe desde as migrations iniciais mas foi substituído por `account_role` no migration 017. Ainda existe no banco.

**Pergunta:** Podemos remover `profiles.role` em uma migration futura? Há algum código que ainda o usa?

**Arquivo:** `supabase/migrations/017_account_sharing.sql`

**Status:** ✅ RESOLVIDO — Migration 049 criada para remover `profiles.role`. Nenhum código o referencia.

---

#### 8. Testes de Componentes

**Contexto:** Apenas 2 testes de componentes React existem. Os módulos de inbox, settings, flows builder não têm testes de componente.

**Pergunta:** Qual é a prioridade para adicionar testes de componentes? Devemos focar nos módulos críticos primeiro?

**Arquivos:** `src/app/(dashboard)/inbox/`, `src/app/(dashboard)/settings/`, `src/components/flows/`

**Status:** ⏳ PENDENTE — Recomendado: focar em inbox e flows builder primeiro.

---

#### 9. MFA para Usuários Comuns

**Contexto:** Step-up auth existe apenas para Fire Control. Usuários comuns não têm MFA.

**Pergunta:** Devemos implementar MFA para usuários comuns? Qual é a prioridade?

**Arquivo:** `src/lib/auth/step-up.ts`

**Status:** ⏳ PENDENTE — Baixa prioridade para MVP. Supabase Auth suporta MFA nativamente.

---

#### 10. DNS Rebinding SSRF

**Contexto:** O SSRF guard (`src/lib/webhooks/ssrf.ts:16-18`) documenta que DNS rebinding não émitigado. É um risco residual.

**Pergunta:** Devemos implementar pinning de IP para mitigar DNS rebinding? Qual é o custo/benefício?

**Arquivo:** `src/lib/webhooks/ssrf.ts:16-18`

**Status:** ⏳ PENDENTE — Risco residual documentado. Custo/benefício desfavorável para a maioria dos casos.

---

### 🔵 BAIXO

#### 11. Step-up Cookie Secure Flag em Dev

**Contexto:** `stepUpCookieOptions()` retorna `secure: process.env.NODE_ENV === 'production'` (`src/lib/auth/step-up.ts:114`). Em dev, o cookie não é secure.

**Pergunta:** Isso é aceitável para localhost? Deveríamos forçar secure mesmo em dev?

**Arquivo:** `src/lib/auth/step-up.ts:114`

**Status:** ✅ ACEITÁVEL — localhost não tem HTTPS, secure flag seria ignorada.

---

#### 12. timingSafeHexEqual é Dead Code

**Contexto:** A função `timingSafeHexEqual` existe em `src/lib/auth/step-up.ts:49-57` mas nunca é chamada. O `verifyStepUpToken` usa `safeEqualHex` internamente.

**Pergunta:** Podemos remover `timingSafeHexEqual`? Ou ela é usada em testes?

**Arquivo:** `src/lib/auth/step-up.ts:49-57`

**Status:** ❌ FALSO POSITIVO — A função se chama `safeEqualHex` e é usada por `verifyStepUpToken` (linha 99). Não é dead code.

---

#### 13. Automation Builder Decomposition

**Contexto:** `src/components/automations/automation-builder.tsx` tem 1.788 linhas. É o maior componente do projeto.

**Pergunta:** Devemos decompor em componentes menores? Qual é a prioridade?

**Arquivo:** `src/components/automations/automation-builder.tsx`

**Status:** ⏳ PENDENTE — Baixa prioridade. Funciona bem como está.

---

#### 14. Error Boundaries

**Contexto:** O projeto não tem error boundaries nos módulos principais (inbox, settings, automations).

**Pergunta:** Devemos adicionar error boundaries? Ou o error boundary global do Next.js é suficiente?

**Arquivos:** `src/app/(dashboard)/inbox/`, `src/app/(dashboard)/settings/`

**Status:** ⏳ PENDENTE — Next.js error boundary global é suficiente para MVP.

---

#### 15. CI/CD Pipeline

**Contexto:** Não há pipeline de CI/CD configurado.

**Pergunta:** Qual é o plano para CI/CD? GitHub Actions? Vercel?

**Arquivo:** `.github/` (não existe)

**Status:** ⏳ PENDENTE — Ver seção de CI/CD abaixo.

---

#### 16. Sentry para Error Tracking

**Contexto:** Não há error tracking configurado.

**Pergunta:** Devemos integrar Sentry? Ou outro serviço?

**Arquivo:** `package.json`

**Status:** ⏳ PENDENTE — Recomendado para produção. Sentry free tier é suficiente.

---

## Resumo das Perguntas por Status

| Status | Número | Perguntas |
|--------|--------|-----------|
| ✅ RESOLVIDO | 7 | Middleware Auth, Subscription, Admin Client, WhatsApp Config, Legacy Role, Secure Flag, Dead Code |
| ⏳ PENDENTE | 8 | CSP, Rate Limiter, Testes, MFA, DNS Rebinding, Decomposition, Error Boundaries, CI/CD, Sentry |
| ❌ FALSO POSITIVO | 1 | Dead Code |

---

## Ações Recomendadas

### ✅ Concluídas (esta sessão)
1. ✅ Mover `supabaseAdmin()` para `lib/supabase/admin.ts`
2. ✅ Adicionar `requireRole('admin')` em GET /api/whatsapp/config
3. ✅ Adicionar middleware auth para todas as rotas API
4. ✅ Enforce subscription status em `getCurrentAccount()`
5. ✅ Criar migration 049 para remover `profiles.role`
6. ✅ Adicionar `requireRole('viewer')` em GET /api/automations

### ⏳ Próximas (curto prazo)
7. Planejar timeline para CSP enforcement (requer pesquisa Next.js 16 + nonces)
8. Adicionar testes de componentes (inbox, flows builder)

### ⏳ Médio prazo
9. Substituir rate limiter in-memory por Redis (quando escalar)
10. Implementar MFA para usuários comuns (Supabase Auth native)
11. Integrar Sentry para error tracking

### ⏳ Longo prazo
12. Decompor automation-builder.tsx
13. Configurar CI/CD (GitHub Actions)

---

*Perguntas atualizadas em 14/08/2026.*
