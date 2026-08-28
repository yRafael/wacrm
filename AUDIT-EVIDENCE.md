# AUDIT-EVIDENCE.md — Fire Workspace (wacrm)

**Data da Auditoria:** 14/08/2026  
**Auditor:** IA (opencode/mimo-v2.5-free)  
**Projeto:** `C:\Users\yRafael\Desktop\wacrm`

---

## 1. Autenticação

### 1.1 Middleware auth — Protected pages (line 80-100)

`src/middleware.ts:80-100`

```typescript
const protectedPaths = [
  '/dashboard', '/inbox', '/contacts', '/pipelines',
  '/broadcasts', '/automations', '/settings',
  '/fire-control-x7k29',
];
if (!user && protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return withRefreshedCookies(NextResponse.redirect(url));
}
```

### 1.2 Middleware auth — WhatsApp API routes only (line 122-131)

`src/middleware.ts:122-131`

```typescript
if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') && !request.nextUrl.pathname.includes('/webhook')) {
  return withRefreshedCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
}
```

**Finding:** Only `/api/whatsapp/*` is protected at the middleware level. Other API routes have auth in route handlers.

### 1.3 Step-up auth — HMAC token (line 1-132)

`src/lib/auth/step-up.ts:1-132`

- Token format: `exp.nonce.mac` (HMAC-SHA256)
- TTL: 15 minutes (line 29)
- Cookie: `fc_step_up`, HttpOnly, SameSite=strict, scoped to `/fire-control-x7k29` (line 105-119)
- Constant-time comparison: `safeEqualHex()` (line 49-57)

### 1.4 Step-up gate in middleware (line 102-120)

`src/middleware.ts:102-120`

```typescript
const isFireControl = request.nextUrl.pathname.startsWith('/fire-control-x7k29');
const isFireControlVerify = request.nextUrl.pathname === '/fire-control-x7k29/verify';
if (user && isFireControl && !isFireControlVerify) {
  if (!(await hasValidStepUp(request))) {
    const url = request.nextUrl.clone();
    url.pathname = '/fire-control-x7k29/verify';
    return withRefreshedCookies(NextResponse.redirect(url));
  }
}
```

### 1.5 Supabase SSR client (line 1-28)

`src/lib/supabase/server.ts:1-28`

- Uses `@supabase/ssr` with `next/headers` cookies
- Anonymous key only (service-role in admin client)

### 1.6 getCurrentAccount — session + account + status blocking (line 145-225)

`src/lib/auth/account.ts:145-225`

- Calls `supabase.auth.getUser()` (line 148-154)
- Fetches profile with `account_id` + `account_role` (line 156-160)
- Validates role is valid enum (line 172-177)
- Blocks SUSPENDED/BANNED accounts (line 209-211)
- Returns `AccountContext` with supabase, userId, accountId, role, account

### 1.7 requireRole — role enforcement (line 234-242)

`src/lib/auth/account.ts:234-242`

```typescript
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(`This action requires the '${min}' role or higher`);
  }
  return ctx;
}
```

### 1.8 requirePlatformOperator — Fire Control auth (line 282-309)

`src/lib/auth/account.ts:282-309`

- Calls `getCurrentAccount()` first (line 284)
- Checks `profiles.is_platform_operator` in DB (line 286-290)
- Returns service-role client for whole-tree reads (line 304)

### 1.9 API key auth — Public API (line 84-131)

`src/lib/auth/api-context.ts:84-131`

- Extracts bearer token (line 63-70)
- Hashes with SHA-256 and looks up (line 93)
- Rate-limits per key (line 103-106)
- Blocks SUSPENDED/BANNED accounts (line 112-115)
- Enforces scope check (line 117-119)

---

## 2. Autorização

### 2.1 RBAC roles (line 18-43)

`src/lib/auth/roles.ts:18-43`

```typescript
export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer';
// owner=4, admin=3, agent=2, viewer=1
```

### 2.2 Capability predicates (line 69-109)

`src/lib/auth/roles.ts:69-109`

- `canManageMembers(role)` — admin+ (line 70-72)
- `canEditSettings(role)` — admin+ (line 79-81)
- `canSendMessages(role)` — agent+ (line 88-90)
- `canDeleteAccount(role)` — owner only (line 102-104)
- `canTransferOwnership(role)` — owner only (line 107-109)

### 2.3 Subtree access — anti-IDOR/BOLA (line 1-128)

`src/lib/auth/subtree.ts:1-128`

- `isDescendant()` — DFS traversal of account tree (line 54-75)
- `requireSubtreeAccess()` — throws ForbiddenError if target not in subtree (line 109-128)
- Used on service-role paths where RLS is bypassed

---

## 3. Multi-tenancy

### 3.1 RLS policies

All tables have RLS enabled with `is_account_member()` policy. Example from migrations:

`supabase/migrations/004_rls_policies.sql` — initial RLS setup  
`supabase/migrations/017_account_sharing.sql` — updated RLS with roles

### 3.2 account_id in all queries

Every API route filters by `account_id`:

```typescript
const { data } = await supabase
  .from('contacts')
  .select('*')
  .eq('account_id', ctx.accountId);  // Always scoped
```

---

## 4. Proteção de Dados

### 4.1 AES-256-GCM encryption

`src/lib/whatsapp/encryption.ts` — encrypt/decrypt for WhatsApp tokens  
`src/lib/iptv/credentials.ts` — encrypt/decrypt for IPTV credentials

### 4.2 Token hashing

`src/lib/api-keys/keys.ts` — SHA-256 hashing for API keys  
`src/lib/auth/invitations.ts` — SHA-256 hashing for invite tokens

### 4.3 API keys never re-emitted

`src/lib/api-keys/store.ts` — `createApiKey()` returns plaintext once, stores hash only

---

## 5. Webhooks

### 5.1 SSRF protection (line 1-88)

`src/lib/webhooks/ssrf.ts:1-88`

- `isPrivateOrReservedIp()` — blocks loopback, private, link-local, CGNAT (line 25-53)
- `isDeliverableUrl()` — DNS resolution + private IP check (line 61-88)
- Blocks `localhost`, `.local`, `.internal` domains (line 71-79)

### 5.2 HMAC signing (line 1-69)

`src/lib/webhooks/sign.ts:1-69`

- Stripe-style: `X-Fire-Signature: t=<unix>,v1=<hex>` (line 8)
- `buildSignatureHeader()` — signs `${t}.${rawBody}` (line 24-33)
- `verifySignatureHeader()` — constant-time comparison via `timingSafeEqual` (line 41-69)
- Replay protection: 300s tolerance (line 46, 60)

---

## 6. Rate Limiting

### 6.1 In-memory rate limiter (line 1-194)

`src/lib/rate-limit.ts:1-194`

- Fixed-window counter per key (line 3-4)
- 12 preconfigured budgets (line 124-187):
  - `send: 60/min` — individual messages
  - `broadcast: 5/min` — campaign dispatch
  - `react: 120/min` — reactions
  - `invitationPeek: 30/min` — public invite lookup
  - `invitationRedeem: 10/min` — invite redemption
  - `adminAction: 30/min` — member management
  - `stepUp: 5/min` — Fire Control re-auth
  - `publicApi: 120/min` — API key endpoints
  - `aiDraft: 20/min` — AI per user
  - `parser: 30/min` — IPTV parser
  - `aiDraftAccount: 60/min` — AI per account
  - `aiAutoReplyAccount: 30/min` — AI auto-reply per account

**Finding:** In-memory only — doesn't work in multi-instance (line 9-14 documents this)

---

## 7. Headers de Segurança

### 7.1 Security headers (line 22-64)

`next.config.ts:22-64`

- HSTS: `max-age=63072000; includeSubDomains; preload` (line 24-26)
- X-Content-Type-Options: `nosniff` (line 27)
- X-Frame-Options: `DENY` (line 28)
- Referrer-Policy: `strict-origin-when-cross-origin` (line 29)
- Permissions-Policy: `camera=(), microphone=(self)` (line 35-37)
- CSP: `Content-Security-Policy-Report-Only` with `unsafe-inline` + `unsafe-eval` (line 39-63)

**Finding:** CSP is report-only, not enforced (line 39)

---

## 8. Banco de Dados

### 8.1 Migrations (48 files)

`supabase/migrations/` — 48 migration files, all idempotent

Key migrations:
- `001_initial_schema.sql` — base tables
- `004_rls_policies.sql` — RLS setup
- `017_account_sharing.sql` — multi-tenancy + RBAC
- `023_whatsapp_session_encryption.sql` — AES-256-GCM
- `036_automations_v2.sql` — automation engine
- `042_flows.sql` — flow engine
- `046_platform_operator.sql` — Fire Control

### 8.2 SECURITY DEFINER functions (25+)

Key functions:
- `handle_new_user()` — trigger on signup
- `is_account_member()` — RLS helper
- `is_platform_operator()` — platform gate
- `is_account_in_subtree()` — anti-IDOR/BOLA
- `set_member_role()` — RBAC management
- `complete_renewal()` — atomic renewal
- `claim_ai_reply_slot()` — atomic AI cap

### 8.3 Indexes (80+)

- Composite: `account_id` + frequently queried columns
- Partial: active automations, active flows, unread notifications
- HNSW: pgvector for AI knowledge
- GIN: FTS for contact search

---

## 9. Testes

### 9.1 Test files (85+)

Key test areas:
- `src/lib/whatsapp/*.test.ts` — 19 tests (encryption, sending, inbound)
- `src/lib/flows/*.test.ts` — 5 tests (engine, validate)
- `src/lib/automations/*.test.ts` — 2 tests
- `src/lib/ai/*.test.ts` — 9 tests (auto-reply, config, knowledge)
- `src/lib/webhooks/*.test.ts` — 5 tests (SSRF, sign, deliver)
- `src/lib/auth/*.test.ts` — 6 tests (step-up, roles, API keys)
- `src/lib/contacts/*.test.ts` — 4 tests (dedup, tags)
- `src/app/api/**/*.test.ts` — 7 tests (route handlers)

---

## 10. Problemas Encontrados

### 10.1 `.env.local` com credenciais reais

`.env.local` contém:
- `ENCRYPTION_KEY=<64-char hex>`
- `SUPABASE_SERVICE_ROLE_KEY=<jwt>`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<jwt>`

**Risco:** Se a máquina for comprometida, todas as chaves são expostas.

### 10.2 Middleware auth gap

`src/middleware.ts:122-131` — Apenas `/api/whatsapp/*` protegido no middleware. Outras rotas API (`/api/contacts`, `/api/pipelines`, etc.) têm auth no route handler via `requireRole()`, mas não no middleware.

### 10.3 WhatsApp config GET sem role check

`src/app/api/whatsapp/config/route.ts` — GET handler não verifica role. Viewer pode triggerar verificações Meta API.

### 10.4 Subscription gating não enforceado

`src/lib/auth/account.ts:209-211` — `getCurrentAccount()` verifica status (ACTIVE/SUSPENDED/BANNED) mas não verifica subscription status. Usuário com subscription CANCELED/EXPIRED pode usar a API.

### 10.5 supabaseAdmin() duplicado

Múltiplas implementações:
- `src/lib/flows/admin-client.ts` — usado por `api-context.ts` e `account.ts`
- `src/lib/supabase/admin.ts` — não existe (import falhou)
- `src/lib/auth/api-context.ts:32` — importa de `@/lib/flows/admin-client`

### 10.6 CSP unsafe-inline/unsafe-eval

`next.config.ts:45` — `script-src 'self' 'unsafe-inline' 'unsafe-eval'` enfraquece CSP enforcement.

---

*Evidência coletada em 14/08/2026. Nenhuma alteração foi feita no código.*
