// ============================================================
// Search — lógica pura da pesquisa global (palette Cmd/Ctrl+K)
//
// Normaliza a query digitada, resolve o href de destino de cada
// tipo de resultado e escapa o termo para os filtros `ilike` do
// Supabase. Nenhuma dependência de navegador/DB aqui — tudo é
// função pura e determinística, coberta por vitest. O componente
// GlobalSearch chama essas funções e traduz os rótulos com
// next-intl.
// ============================================================

/** Tipos de resultado que a pesquisa global sabe resolver. */
export type SearchKind =
  'contact' | 'conversation' | 'payment' | 'credential' | 'renewal';

/** Um resultado individual renderizado na palette. */
export interface SearchHit {
  id: string;
  kind: SearchKind;
  /** Linha principal (nome do contato, preview da conversa…). */
  title: string;
  /** Contexto secundário (telefone, e-mail, trecho da mensagem…). */
  subtitle?: string;
  /** Rota destino — gerada por {@link buildSearchHref}. */
  href: string;
}

/** Agrupamento de resultados por tipo, na ordem de exibição. */
export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
}

/** Trim + lowercase + colapsa espaços repetidos. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Href de destino por tipo de resultado. Conversas abrem direto no
 * thread (`/inbox?c=<id>`); os demais tipos não têm rota própria de
 * registro, então levam ao módulo correspondente (contatos → lista,
 * pagamentos/renovações → agenda, credencial → clientes).
 */
export function buildSearchHref(kind: SearchKind, id: string): string {
  switch (kind) {
    case 'conversation':
      return `/inbox?c=${encodeURIComponent(id)}`;
    case 'contact':
      return '/contacts';
    case 'payment':
    case 'renewal':
      return '/renewals';
    case 'credential':
      return '/clients';
  }
}

/**
 * Escapa os curingas do padrão LIKE/ilike do Postgres (`%`, `_` e a
 * própria barra de escape) para que o termo digitado seja tratado
 * como literal. Sem isso, digitar `%` retornaria todos os registros.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
