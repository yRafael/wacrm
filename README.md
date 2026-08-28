# Fire Workspace — CRM para WhatsApp

> CRM multiempresa para WhatsApp® — inbox compartilhado, contatos,
> funis de vendas, broadcasts e automações sem código. Desenvolvido
> pela Fire Play.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## O que você tem de fábrica

- **Inbox compartilhado** na API oficial do WhatsApp Business —
  vários agentes atendendo um número, atribuição por conversa,
  status e notas.
- **Contatos + tags + campos customizados**, importação CSV,
  deduplicação.
- **Funil de vendas** (Kanban) com negócios ligados a conversas.
- **Broadcasts** com templates aprovados pela Meta, rastreio de
  entrega e leitura, substituição de variáveis por destinatário.
- **Automações sem código** — gatilhos em mensagens recebidas,
  novos contatos, palavras-chave ou agendamento; ramificações
  condicionais, esperas, tags, webhooks. Editor visual.
- **Assistente de IA** — traga sua própria chave OpenAI ou Anthropic
  (armazenada criptografada; sem taxa por assento, seus dados
  continuam seus). Respostas-ralo com um clique no inbox, bot de
  auto-resposta opcional com limite por conversa e handoff limpo
  para o humano. Adicione uma **base de conhecimento** (FAQs,
  políticas, docs de produto) e ele responde com o seu próprio
  conteúdo — recuperação híbrida (full-text do Postgres ou pgvector
  semântico quando uma chave de embeddings está configurada).
- **Dashboard em tempo real** — tempos de resposta, volume diário,
  valor do funil, feed de atividade entre módulos.
- **Contas de equipe** — convide membros por link, acesso baseado em
  papel (owner / admin / agent / viewer), transferência de
  titularidade. Cada instalação é isolada por conta, então um inbox
  compartilhado pode ser atendido por uma equipe inteira. Uso solo
  continua de usuário único sem configuração.
- **Gestão de conta** — e-mail, senha, avatar, sair de todos os
  dispositivos.
- **API REST pública** (`/api/v1`) com chaves de API com escopo e
  revogáveis — crie suas próprias automações em cima do seu CRM.
  Veja [docs/public-api.md](./docs/public-api.md).
- **Servidor MCP** — controle o CRM a partir de Claude, Cursor e
  outros assistentes via [Model Context Protocol](https://modelcontextprotocol.io).
  Somente leitura por padrão, escrita opt-in. Veja
  [docs/mcp.md](./docs/mcp.md) (servidor em [`mcp-server/`](./mcp-server)).

## Segurança

- **Multi-tenant** — isolamento por conta (account_id) em todas as
  tabelas via RLS + autorização explícita no backend.
- **Backend é a autoridade** — nunca confie em IDs, roles ou
  account_id enviados pelo cliente; a identidade vem da sessão.
- **Criptografia de tokens** (AES-256-GCM), webhooks verificados por
  HMAC, CSP, rate limiting, validação server-side.
- **Auditoria de secrets** — nenhuma credencial versionada.

## Início rápido

```bash
git clone https://github.com/yRafael/fire-workspace.git
cd fire-workspace
npm install
cp .env.local.example .env.local   # preencha Supabase + Meta
npm run dev
```

Abra <http://localhost:3000>. Você será redirecionado para `/login`
(ou `/dashboard` se já estiver logado).

## Documentação

- [docs/public-api.md](./docs/public-api.md) — API pública
- [docs/mcp.md](./docs/mcp.md) — servidor MCP
- Supabase migrations em [`supabase/migrations/`](./supabase/migrations)

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Dados** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API + Baileys.

## Contribuindo

Bug reports e issues de segurança são bem-vindos. Detalhes em
[`CONTRIBUTING.md`](./CONTRIBUTING.md) e
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Licença

[MIT](./LICENSE).