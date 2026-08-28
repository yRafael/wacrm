# Fire Play — Documentação Técnica do Projeto

### Fire Workspace + Fire Control (Painel de Revenda e Administração)

> Documento consolidado a partir do brainstorm de arquitetura, para ser usado como referência por qualquer IA/dev que for implementar o sistema. Consolida a visão de negócio com o guia técnico do repositório.

---

## 1. Visão Geral

O projeto **Fire Play** é dividido em duas grandes partes, que **não se misturam**:

```
                 FIRE PLAY
                     │
        ┌────────────┴────────────┐
        │                         │
  FIRE WORKSPACE             FIRE CONTROL
        │                         │
   Atendimento               Plataforma
        │                         │
   WhatsApp                  Contas/Usuários
   Conversas                 Planos
   Clientes                  Assinaturas
   Tickets                   Revendedores
   CRM                       Árvore de revenda
    Fire Radar                 Cotas
                             Auditoria
```

- **Fire Workspace**: onde o usuário final opera o atendimento via WhatsApp (inbox, fila, CRM, pipeline, campanhas, Fire Radar). Já existe/está em desenvolvimento separadamente.
- **Fire Control**: painel de controle da própria plataforma Fire Play — gerencia contas, planos, assinaturas, revendedores, cotas e auditoria. **Não é um "admin de WhatsApp"**, é o admin do negócio.

**Regra de ouro:** o Fire Control **nunca** deve ter acesso a dados operacionais do Workspace (mensagens, conversas, tokens de WhatsApp, credenciais de IPTV, arquivos enviados, histórico de atendimento). Ele só enxerga metadados de controle da conta.

---

## 2. Segurança de Acesso ao Fire Control

O acesso ao painel é protegido em **camadas**, e nenhuma camada isolada é suficiente:

1. **URL não óbvia** (ex.: `/fire-control-x7k29` em vez de `/admin`, `/admin/login`, `/dashboard/admin`)
   - Reduz ruído de scanners/fuzzers automáticos.
   - **Não é mecanismo de segurança por si só** — é apenas redução de exposição/ruído.
   - Evitar até nomes internos como `platform_admin`, `superuser` (tabelas, rotas, schemas) — ferramentas de enumeração de schema também procuram por esses termos. Nome interno: **Fire Control** (código: `platform`).

2. **Autenticação** — usuário precisa estar logado.

3. **Step-up authentication** — camada extra de verificação para **acessar o painel** (reautenticação/2FA adicional), mesmo já estando logado no sistema normal. Vale também nas **ações destrutivas** (suspender/banir, alterar plano). Sessão do Fire Control curta (15–30 min), cookie `HttpOnly + Secure + SameSite=Strict`.

4. **Autorização no backend** — a decisão de quem pode acessar o Fire Control **nunca** pode estar no frontend nem em uma checagem de URL. Fluxo obrigatório:

```
Usuário autenticado?
        ↓
Possui permissão de plataforma (ex.: PLATFORM_CONTROL)?
        ↓
   Sim → permite acesso
   Não → 403 Forbidden
```

   ❌ Nunca fazer algo como:
   ```
   if URL === "/fire-control" → permitir acesso
   ```
   A permissão precisa existir no usuário/sessão/backend, não na rota.

5. **Auditoria** — toda ação relevante feita no Fire Control gera um registro (ver seção 8).

**Resumo do funil de segurança:**
```
URL não óbvia → Autenticação → Step-up auth → Autorização no backend → Auditoria
```

### 2.1 Nomenclatura

- Evitar a palavra "Admin" tanto na interface quanto nas rotas/tabelas — não para "enganar" scanners, mas por clareza arquitetural (o painel administra a *plataforma*, não o WhatsApp).
- Nome sugerido na interface: **🔥 Fire Control** (alternativa: "Central de Controle").
- Internamente, usar `account_type` (`USER`, `RESELLER`, `PLATFORM`) e permissões nomeadas (`PLATFORM_CONTROL`, `ACCOUNT_MANAGE`, `RESELLER_MANAGE`, `PLAN_MANAGE`, `SUBSCRIPTION_MANAGE`) em vez de um simples flag `is_admin = true`. Isso permite níveis de acesso diferentes no futuro.

---

## 3. Escopo de Dados do Fire Control

**O Fire Control PODE ver/gerenciar:**
- Conta (nome, e-mail, tipo de conta, status)
- Plano contratado
- Assinatura e vencimento
- Limite/cota e utilização
- Quantidade de filhos (estrutura de revenda)
- Data de criação e último acesso
- Auditoria

**O Fire Control NUNCA pode ver/acessar:**
- Mensagens e conversas do WhatsApp
- Contatos do WhatsApp
- Tokens/credenciais (WhatsApp, IPTV, senhas)
- Arquivos enviados
- Histórico de atendimento

Essa separação limita o "dano" em caso de vazamento: se o painel for comprometido, expõe uma "tabela de clientes de controle", nunca a operação inteira.

---

## 4. Modelo de Contas e Hierarquia

### 4.1 Tipos de conta (`account_type`)

| Tipo | Descrição |
|---|---|
| `USER` | Usuário comum, utiliza o sistema normalmente |
| `RESELLER` | Possui autorização para criar/gerenciar contas abaixo dela (e possivelmente sub-revendedores) |
| `PLATFORM` | Você, dono da plataforma — enxerga e controla a árvore inteira |

- O operador da plataforma é uma **conta-raiz** (`account_type = PLATFORM`) no topo da árvore de revenda. É a única conta do tipo `PLATFORM`.
- `account_type` é a classificação **da conta na plataforma**. Ele é **ortogonal** a `profiles.account_role` (`owner/admin/agent/viewer`), que são as roles **internas** da conta (já existem desde a migration 017). Um `RESELLER` ainda tem owner/admin/agent internos.
- Para o login, ainda existe o flag `profiles.is_platform_operator BOOLEAN` — determina **quem** loga como operador (email específico + flag no banco, nunca env var). Ele é o gate de autenticação; `account_type = PLATFORM` é a identidade da conta-raiz.

### 4.2 Estrutura hierárquica (árvore de revenda)

```
Platform
   │
   └── Reseller
          │
          ├── Reseller (sub-revendedor)
          │      └── Customers
          │
          └── Customers
```

- A hierarquia vive em uma tabela própria (`account_relationships` — ver §5.4), que satisfaz o conceito de `parent_id`: cada filho tem exatamente um pai.
- **Regra crítica de autorização (equivalente a IDOR/BOLA multi-tenant, mas hierárquico):**
  > Um revendedor só pode acessar/modificar contas pertencentes à sua própria subárvore — nunca contas acima dele ou em galhos irmãos, mesmo que descubra o ID delas.

  Função conceitual: `pode_gerenciar(conta_origem, conta_alvo) = conta_alvo é descendente de conta_origem?`

- O **Fire Control (Platform)** é a única exceção: enxerga e gerencia a árvore inteira.

```
                    FIRE PLAY
                       │
                  FIRE CONTROL
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Rafael       Carlos        Pedro
                        │
                  ┌─────┴─────┐
                  ↓           ↓
                João        Maria
```

### 4.3 Entidades principais do modelo de dados

| Entidade | Responsabilidade |
|---|---|
| `accounts` | Quem é a conta/usuário |
| `platform_plans` | O que foi contratado (produto) |
| `platform_subscriptions` | Relação entre `Account` e `Plan`, com status e vencimento |
| `account_relationships` | Hierarquia — quem está abaixo de quem (árvore) |
| quota (dimensões do plano + contagem da subárvore) | Quanto aquela conta/revendedor pode distribuir/usar |
| `audit_logs` | Registro de ações administrativas |

**Importante:** não colocar preço/plano/cota diretamente na conta. A assinatura ativa (`platform_subscriptions`) resolve o plano contratado; a cota deriva do plano + a contagem real da subárvore. Isso prepara o sistema para billing futuro sem precisar refazer o modelo:

```
Account → Subscription → Plan → Payment (futuro: Mercado Pago, Stripe, etc.)
```

### 4.4 Status

Separar claramente **status da conta** de **status da assinatura** (conta suspensa ≠ assinatura vencida — evita confusão):

**Status da conta (`accounts.status`)**
- `ACTIVE`
- `SUSPENDED`
- `BANNED`

**Status da assinatura (`platform_subscriptions.status`)**
- `ACTIVE`
- `PAST_DUE`
- `CANCELED`
- `EXPIRED`

---

## 5. Entidades — Especificação Técnica

> **ATENÇÃO — conflito de nome**: já existe a tabela `plans` (migration 043_plans_servers.sql), que são os planos de IPTV **da empresa** (Mensal/Trimestral/Semestral/Anual, com FK `account_id`). Os planos da **plataforma** usam outro nome: `platform_plans`. `subscriptions` também não existe — usamos `platform_subscriptions`. A migration desta etapa é a **046** e deve seguir o padrão idempotente das demais (`IF NOT EXISTS`/`DROP POLICY IF EXISTS`).

### 5.1 `accounts` (extensão aditiva)

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'USER'
    CHECK (account_type IN ('USER', 'RESELLER', 'PLATFORM')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BANNED'));
```

Backfill aditivo: contas existentes viram `USER`/`ACTIVE`. Nenhuma coluna existente muda de shape obrigatório.

### 5.2 `platform_plans`

```sql
CREATE TABLE platform_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,            -- 'fire_user', 'fire_reseller', ...
  name TEXT NOT NULL,                   -- 'Fire User', 'Fire Reseller', ...
  account_type TEXT NOT NULL CHECK (account_type IN ('USER', 'RESELLER')),
  price_monthly NUMERIC(12,2) NOT NULL, -- preço sugerido; cobrança é Fase 4
  -- Limites do plano (seção 6.3):
  quota_accounts INTEGER,               -- NULL = ilimitado
  quota_direct_resellers INTEGER,       -- filhos revendedores diretos
  max_depth INTEGER NOT NULL DEFAULT 0, -- níveis abaixo do contratante
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> `price_monthly` é **sugestão** — nada de cobrança real antes da Fase 4. O frontend nunca decide preço/pagamento/liberação; tudo validado no backend.

### 5.3 `platform_subscriptions`

```sql
CREATE TABLE platform_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES platform_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

A assinatura registra **a contratação** (plano referenciado + estado). O plano atual de uma conta = assinatura `ACTIVE` mais recente.

### 5.4 `account_relationships` (árvore de revenda)

```sql
CREATE TABLE account_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  child_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tree_depth INTEGER NOT NULL,          -- profundidade absoluta do topo
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_account_id, child_account_id),
  UNIQUE (child_account_id)             -- 1 pai por conta
);
```

Exemplo (criado manualmente pelo operador na Fase 1):

```
Rafael (raiz, PLATFORM)
 ├── Carlos   → tree_depth 1
 │    ├── João    → tree_depth 2
 │    └── Maria   → tree_depth 2
 └── Pedro    → tree_depth 1
```

### 5.5 `audit_logs` (append-only)

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL, -- opcional
  action TEXT NOT NULL,                -- 'ACCOUNT_SUSPENDED', 'PLAN_CHANGED', ...
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- motivo, plano antigo/novo...
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Append-only**: só SELECT (operador) + INSERT (servidor). **Sem** UPDATE e **sem** DELETE — nem para o operador. Mesmo padrão da `financial_transactions` (040).
- Exemplo:
  `12/08/2026 19:42 — Rafael alterou plano de Carlos Silva: Fire Basic → Fire Reseller`
  `12/08/2026 19:45 — Rafael suspendeu João Silva. Motivo: Inadimplência`

### 5.6 Enforcement da regra de subárvore (anti-IDOR/BOLA)

Duas camadas, sempre:

1. **RLS**: policy usando helper `is_account_in_subtree(ancestor, target)` — função `SECURITY DEFINER` com CTE recursiva sobre `account_relationships` (mesmo padrão do `is_account_member`, migration 017). O banco barra sozinho, sem depender de a rota lembrar da checagem.
2. **Código**: helper `requireSubtreeAccess(targetAccountId)` no servidor, para os caminhos com `service_role` (Fire Control e Workspace quando operam em nome do revendedor).

Matriz obrigatória de testes (IDs inventados pelo atacante):

| Cenário | Resultado esperado |
|---|---|
| Carlos lê/edita João (filho) | 200 |
| Carlos lê/edita Maria (filha) | 200 |
| Carlos lê/edita Pedro (irmão) | 403 |
| Carlos lê/edita Ana (filha de Pedro) | 403 |
| Carlos lê/edita Rafael (ancestral) | 403 |
| Pedro lê/edita Carlos | 403 |

### 5.7 Pontos de bloqueio de status (SUSPENDED/BANNED)

Bloqueio em **todos** os pontos de entrada, no ato da mudança:

1. `getCurrentAccount()` (`src/lib/auth/account.ts`) — sessão do dashboard.
2. `requireApiKey()` (`src/lib/auth/api-context.ts`) — API pública `/api/v1`; conta suspensa/banida não funciona nem por API key.
3. Middleware de login / sessão ativa — **invalidar no ato do ban**, não esperar o próximo request.
4. Fire Control: `requirePlatformOperator()` (usa `toErrorResponse`, `src/lib/auth/account.ts`).

`BANNED` é reversível pelo operador (a ação reverte o status; **nunca** se destrói dado pelo painel).

---

## 6. Sistema de Cotas (Quota) — Modelo de Carteira

Em vez de pensar em "acessos", pensar em **capacidade**:

> "Ele possui uma capacidade de 1000 contas." em vez de "Ele tem 1000 acessos."

Exemplo:
```
Revendedor
Limite: 1000
Utilizadas: 350
Disponíveis: 650
```

### 6.1 Regra de alocação entre pai e filho (modelo de carteira)

Quando um revendedor cria um sub-revendedor, a cota vem alocada da cota do pai — **nunca criada do zero**:

```
Rafael
1000 total
├── 200 alocados para Revendedor A
└── 800 disponíveis

Revendedor A
200 total
├── 50 alocados para Revendedor B
└── 150 disponíveis

Revendedor B
50 total
```

**Regra de backend obrigatória:** o backend precisa impedir que um revendedor aloque mais do que tem disponível. Exemplo: se Carlos tem 500 disponíveis e tenta criar Pedro com cota de 600 → **negado**. O frontend nunca decide/valida isso — apenas o backend.

### 6.2 Atomicidade (race condition)

Criar subconta **não** pode ser "ler disponível → verificar → inserir" em passos: dois requests simultâneos estouram a cota. Segue o padrão do `complete_renewal` (040): um RPC `SECURITY DEFINER` que, **na mesma transação**:

1. dá `FOR UPDATE` na linha da assinatura/plano do pai (trava o cálculo);
2. calcula `disponível` (contagem real via CTE sobre a subárvore);
3. valida cota, profundidade (`child.tree_depth − parent.tree_depth ≤ max_depth`) e o limite de filhos diretos;
4. insere em `account_relationships`, cria a conta filha;
5. grava `audit_logs`.

### 6.3 Limites que compõem um plano de revenda

Um plano de revenda não deveria ter só "quantidade de contas". Recomenda-se 3 dimensões:

1. **Quantidade de contas/clientes** — quantos usuários finais podem entrar na rede (`quota_accounts`).
2. **Quantidade de revendedores diretos** — quantos revendedores ele pode criar (`quota_direct_resellers`).
3. **Profundidade da rede (níveis)** — quantos níveis abaixo dele são permitidos, evitando cadeias infinitas (`max_depth`).

Exemplo:
```
Plano
├── 100 contas
├── 10 revendedores
└── 2 níveis
```

### 6.4 Cotas granulares (evolução futura)

Hoje: uma cota geral de contas. No futuro, pode-se separar em cotas específicas:
```
quota_accounts
quota_sub_resellers
quota_whatsapp_connections
```

---

## 7. Fire Control — Telas e Funcionalidades

### 7.1 Dashboard (visão geral)

```
🔥 FIRE CONTROL

┌────────────┐ ┌────────────┐ ┌────────────┐
│ 👥 Contas  │ │ 🟢 Ativos  │ │ 🔴 Suspensos│
└────────────┘ └────────────┘ └────────────┘

┌────────────┐ ┌────────────┐ ┌────────────┐
│ 💼 Revend. │ │ 💰 Receita │ │ 📊 Utilização│
└────────────┘ └────────────┘ └────────────┘

Últimas atividades (feed de auditoria resumido)
```

### 7.2 Menu / módulos

- Visão geral
- Contas (usuários)
- Revendedores
- Planos
- Assinaturas
- Árvore de revenda
- Auditoria
- Configurações da plataforma

### 7.3 Ações permitidas por módulo

**Usuários**
- Visualizar, pesquisar
- Ativar, suspender, banir
- Alterar plano
- Visualizar assinatura

**Revendedores**
- Visualizar
- Visualizar árvore, capacidade, utilização
- Visualizar sub-revendedores e clientes

**Planos**
- Criar, editar
- Ativar/desativar
- Definir preço e limites

**Assinaturas**
- Visualizar
- Ativar, suspender, cancelar
- Visualizar vencimento

### 7.4 Tela de usuário (exemplo de campos exibidos)

```
João Silva
Status: 🟢 Ativo
Plano: Fire Basic
Tipo: Usuário
Assinatura: até 10/09/2026
Criado em: 10/08/2026
```
(Nada de dados de WhatsApp.)

### 7.5 Tela de revendedor (exemplo)

```
Carlos Silva
Plano: Fire Reseller | Status: 🟢 Ativo | Assinatura até 10/09/2026

CAPACIDADE
1000 contas — 427 utilizadas — 573 disponíveis
████████░░░░░░

ESTRUTURA
Revendedores abaixo: 3
Clientes diretos: 87
Contas totais na árvore: 427
```

### 7.6 Árvore de revenda (tela dedicada)

Visualização em árvore navegável, com busca por qualquer ponto da estrutura:
```
Rafael
├── Carlos
│   ├── João
│   ├── Maria
│   └── Pedro
├── Lucas
│   ├── Ana
│   └── Bruno
└── Marcos
```

---

## 8. Auditoria (AuditLog)

Toda ação administrativa relevante deve gerar um registro (especificação em §5.5). Isso será essencial para testes de segurança e rastreabilidade futura.

Exemplos de entrada:
```
12/08/2026 19:42 — Rafael alterou plano de Carlos Silva: Fire Basic → Fire Reseller
12/08/2026 19:45 — Rafael suspendeu João Silva. Motivo: Inadimplência
```

---

## 9. Modelo de Negócio — Planos e Monetização

### 9.1 Princípio central

> O usuário compra **acesso à plataforma**. O revendedor compra **capacidade de construir uma rede**.

Não vender apenas "10 revendas" como número solto — vender a possibilidade de:
```
CRIAR → GERENCIAR → REVENDER → CRIAR SUB-REVENDEDORES → CONSTRUIR UMA REDE
```

### 9.2 Estrutura de um plano de revenda

Cada plano define três limites (seção 6.3): contas/clientes, revendedores diretos, profundidade da rede.

### 9.3 Exemplo de escada de planos (valores fictícios, apenas para modelar a economia — **não implementar preços reais ainda**)

| Plano | Preço (exemplo) | Contas | Revendedores | Níveis | Extra |
|---|---|---|---|---|---|
| Starter | R$ 99/mês | 100 | 5 | 1 | — |
| Pro | R$ 199/mês | 500 | 20 | 2 | — |
| Business | R$ 399/mês | 2.000 | 100 | 3 | — |
| White Label | R$ 799+/mês | 5.000+ | personalizado | 3–5 | Marca própria, domínio próprio, recursos premium |

Recomendação de ponto de partida (evitar lançar muitos planos de uma vez):
1. **Fire User** — para quem quer usar.
2. **Fire Reseller** — para quem quer revender.
3. **Fire Reseller Pro** — para quem já cresceu (evolução futura).

### 9.4 Como comunicar o valor sem prometer retorno financeiro

⚠️ **Nunca comunicar como**: "Pague R$199 e ganhe R$5.000" (isso é promessa de retorno — problema regulatório/ético).

✅ **Comunicar como**: "Tenha infraestrutura para gerenciar até 500 contas e construa sua própria rede de revenda." A rentabilidade depende de quanto o revendedor cobra dos próprios clientes — isso é decisão dele, não uma promessa da plataforma.

### 9.5 Modelos de como a plataforma (você) ganha dinheiro

| Modelo | Descrição |
|---|---|
| A — Mensalidade fixa | Preço fixo por plano (Starter/Pro/Business). Simples, previsível. |
| B — Cobrança por capacidade | Preço base + incremento por bloco de contas (ex.: base R$99 + R$30 a cada 100 contas). |
| C — Mensalidade + excedente | Plano inclui X contas; ultrapassar gera cobrança adicional. |
| D — Receita pela rede | Você cobra do revendedor de topo (ex.: Carlos), que por sua vez cobra dos que estão abaixo dele. Você não precisa cobrar diretamente de toda a árvore — sua receita principal é o "direito de operar" uma capacidade dentro da plataforma. |

### 9.6 Como o revendedor lucra (exemplo ilustrativo)

```
Carlos: Plano Pro — R$199/mês, com 20 revendedores permitidos
Carlos cria 10 sub-revendedores cobrando R$49/mês cada
Receita de Carlos: 10 × R$49 = R$490
Custo de Carlos: R$199
Margem de Carlos: R$291 (antes de outros custos)
```
Esse tipo de exemplo serve apenas para desenhar o incentivo — **não deve ser usado como promessa de ganho para o usuário final**.

### 9.7 Limite de profundidade como diferencial de plano

A profundidade de níveis permitida deve crescer com o plano, para criar um upgrade path claro:
```
Starter  → 1 nível
Pro      → 2 níveis
Business → 3 níveis
```

### 9.8 White Label (funcionalidade premium)

Planos mais altos podem permitir personalização de marca: nome do painel próprio, logo própria, cor própria, domínio próprio. O cliente do revendedor White Label acessa "Minha Plataforma" sem necessariamente ver a identidade "Fire Play". (A estrutura `branding` por empresa já existe no Workspace — não desenhar nada novo agora.)

### 9.9 Antes de definir preços reais

É necessário fazer uma **simulação econômica** cobrindo:
- Custo de manter uma conta
- Custo de conexão (WhatsApp)
- **Custo por conversa da Meta (WhatsApp Business Cloud — o maior custo variável)**
- Custo de banco de dados / armazenamento
- Custo de infraestrutura
- Margem desejada da plataforma
- Quanto o revendedor consegue cobrar dos clientes dele

Só depois disso definir os números reais de cota por plano (100, 500, 2.000, 10.000 contas etc.) e os preços.

---

## 10. Roadmap de Implementação (Fases)

### Fase 1 — Fundação
- Criar as entidades: `accounts.account_type/status`, `platform_plans`, `platform_subscriptions`, `account_relationships`, `audit_logs`, `profiles.is_platform_operator`.
- Tipos de conta (`USER`, `RESELLER`, `PLATFORM`).
- Relacionamento pai/filho na árvore (criado manualmente pela Platform inicialmente).
- Cotas básicas.
- Fire Control acessível **somente pela Platform** (você), rota `/fire-control-x7k29` + `requirePlatformOperator()`.
- Visualização da árvore (read-only).
- Auditoria básica.
- Autenticação/autorização (incluindo **step-up auth para acessar o Fire Control**).
- Bloqueio de status nos 3 pontos de entrada (§5.7).

> A estrutura de dados já nasce pronta para hierarquia, mesmo que as funcionalidades sejam liberadas aos poucos — evita ter que refazer o banco depois.

### Fase 2 — Ações administrativas
- Suspender/banir contas (com step-up auth + auditoria).
- Alterar plano de uma conta.
- Gerenciamento de cotas.
- Revendedor passa a poder criar contas dentro da própria subárvore (respeitando cota disponível, via RPC atômico — §6.2).
- `platform_permissions` granular, se fizer sentido.

### Fase 3 — Revenda funcional
- Sub-revendedores (revendedor cria outros revendedores, dentro do limite de profundidade do plano).
- Regras de distribuição de cotas entre pai e filhos (modelo de carteira, seção 6.1).
- Dashboard do próprio revendedor (visão da sua subárvore, capacidade e utilização).

### Fase 4 — Cobrança
- Integração com gateway de pagamento (Mercado Pago, Stripe, etc.).
- Renovação automática de assinatura.
- Comissões/repasse entre níveis da árvore (se decidido implementar).
- Inadimplência.

**Regra geral do projeto:** primeiro fazer funcionar localmente → depois implementar as alterações → depois testes → depois varredura de segurança → só então considerar produção.

---

## 11. Regras Arquiteturais que Não Podem Ser Quebradas

1. O frontend **nunca** decide autorização, preço, pagamento ou liberação de acesso — tudo validado no backend.
2. Um revendedor só acessa/gerencia sua própria subárvore (nunca contas acima ou em galhos irmãos), mesmo sabendo o ID.
3. Cotas são alocadas em modelo de carteira: um filho nunca pode ter mais cota do que o pai tem disponível (validação atômica no backend).
4. O Fire Control nunca acessa dados operacionais do WhatsApp/atendimento (mensagens, tokens, credenciais).
5. Toda ação administrativa relevante gera registro de auditoria (append-only).
6. Nenhuma promessa de retorno financeiro é feita ao revendedor na comunicação de planos — apenas capacidade/infraestrutura.
7. URL não óbvia do painel é redução de exposição, não substitui autenticação/autorização.
8. `platform_plans`/`platform_subscriptions` são nomes reservados (não confundir com `plans` da migration 043, que são planos de IPTV da empresa).

---

## 12. Pontos em Aberto (decisões pendentes antes de codificar)

- [ ] Definir se, na primeira versão, o revendedor já pode criar subcontas sozinho ou se isso fica manual (feito por você) até a Fase 2/3.
- [ ] Definir os números reais de cota por plano (após simulação econômica — seção 9.9).
- [ ] Definir o modelo de monetização entre os 4 listados na seção 9.5 (ou combinação deles).
- [ ] Definir se/quando implementar cobrança entre revendedores (comissão/repasse) — provavelmente Fase 4.
- [ ] Definir mecanismo exato de step-up authentication (2FA adicional, reautenticação por senha, etc.).
- [ ] Definir estrutura de permissões (`PLATFORM_CONTROL`, `ACCOUNT_MANAGE` etc.) com granularidade final.

---

## 13. Checklist de Implementação (por camada)

- [ ] Migration 046 (tabelas §5 + helper `is_account_in_subtree` + RLS + backfill).
- [ ] `accounts.account_type`/`status` + bloqueio nos 3 pontos de entrada (§5.7).
- [ ] `requirePlatformOperator()` em `src/lib/auth/` (reaproveita `toErrorResponse`).
- [ ] RPC atômico `create_reseller_child` (padrão `complete_renewal`, §6.2).
- [ ] Rota do Fire Control atrás do segmento não-obvio + guard de operador.
- [ ] Matriz de testes IDOR/BOLA (§5.6) como teste automatizado obrigatório.
