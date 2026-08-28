'use client';

// ============================================================
// GlobalSearch — palette de pesquisa global (Cmd/Ctrl+K)
//
// Botão na header + atalho Cmd/Ctrl+K abrem um Dialog com input
// e resultados agrupados (contatos, conversas, pagamentos,
// credenciais e renovações). A digitação é de-bounced em 350ms;
// navegação por setas ↑/↓ + Enter + clique encaminha para a rota
// certa via buildSearchHref.
//
// Dados: buscas paralelas com `ilike` em contacts (fonte de
// verdade) e conversations (por texto da última mensagem ou por
// contato); payments/iptv_credentials/renewals respondem apenas
// quando algum contato casou (filtro `.in('contact_id', ids)`).
//
// Zero dependência nova — palette própria, consistente com o UI
// hand-rolled do app.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { CornerDownLeft, Search } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/currency';
import {
  buildSearchHref,
  escapeLikeTerm,
  normalizeQuery,
  type SearchGroup,
  type SearchKind,
} from '@/lib/search/search';

const SEARCH_DEBOUNCE_MS = 350;
/** Máximo de resultados por grupo — mantém a palette leve e rápida. */
const MAX_HITS_PER_GROUP = 8;

/** Ordem de exibição dos grupos na palette. */
const GROUP_ORDER: SearchKind[] = [
  'contact',
  'conversation',
  'payment',
  'credential',
  'renewal',
];

// ------------------------------------------------------------
// Shapes brutos retornados pelas queries (o client Supabase é
// untyped — tipamos aqui o que realmente usamos).
// ------------------------------------------------------------

interface SearchContactRef {
  id: string;
  name?: string | null;
  phone: string;
}

interface SearchContactRow {
  id: string;
  name?: string | null;
  phone: string;
  email?: string | null;
  company?: string | null;
}

interface SearchConversationRow {
  id: string;
  contact_id: string;
  last_message_text?: string | null;
  contact?: SearchContactRef | SearchContactRef[] | null;
}

interface SearchPaymentRow {
  id: string;
  amount: number;
  contact?: SearchContactRef | SearchContactRef[] | null;
}

interface SearchCredentialRow {
  id: string;
  username: string;
  contact?: SearchContactRef | SearchContactRef[] | null;
}

interface SearchRenewalRow {
  id: string;
  amount: number;
  contact?: SearchContactRef | SearchContactRef[] | null;
}

function contactName(c: { name?: string | null; phone: string }): string {
  return c.name?.trim() || c.phone;
}

/** PostgREST devolve embeds como array mesmo em FKs 1:1 — normaliza. */
function embedRef(
  contact: SearchContactRef | SearchContactRef[] | null | undefined
): SearchContactRef | null {
  if (!contact) return null;
  return Array.isArray(contact) ? (contact[0] ?? null) : contact;
}

export function GlobalSearch() {
  const t = useTranslations('Search');
  const router = useRouter();
  const { defaultCurrency } = useAuth();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Achata os grupos numa lista única — é nela que a navegação por
  // setas anda (índice global).
  const flatHits = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  // Índice garantido dentro da lista atual (protege contra resultados
  // menores que o índice lembrado após um novo search).
  const safeIndex =
    flatHits.length === 0 ? -1 : Math.min(selectedIndex, flatHits.length - 1);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // Cadeia de .then() (padrão fire-hero/dashboard): os setState ficam
  // nos callbacks, fora do caminho de react-hooks/set-state-in-effect.
  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = normalizeQuery(rawQuery);
      if (!q) {
        setGroups([]);
        setLoading(false);
        setSelectedIndex(0);
        return;
      }

      const db = createClient();
      const like = `%${escapeLikeTerm(q)}%`;

      try {
        // 1. Contatos — fonte de verdade. O match também fornece os ids
        //    que as outras tabelas usam como filtro.
        const contactsRes = await db
          .from('contacts')
          .select('id, name, phone, email, company')
          .or(
            `name.ilike.${like},phone.ilike.${like},email.ilike.${like},company.ilike.${like}`
          )
          .limit(MAX_HITS_PER_GROUP);
        const contacts = (contactsRes.data ?? []) as SearchContactRow[];

        // 2. Conversas — casam por texto da última mensagem OU por contato.
        //    O or-filter é montado dinamicamente: sem contatos casados, só
        //    o texto importa.
        const contactIds = Array.from(new Set(contacts.map((c) => c.id)));
        const contactClause = contactIds.length
          ? `contact_id.in.(${contactIds.join(',')}),`
          : '';
        const conversationsRes = await db
          .from('conversations')
          .select(
            'id, contact_id, last_message_text, contact:contacts(id, name, phone)'
          )
          .or(`${contactClause}last_message_text.ilike.${like}`)
          .order('last_message_at', { ascending: false })
          .limit(MAX_HITS_PER_GROUP);
        const conversations = (conversationsRes.data ??
          []) as unknown as SearchConversationRow[];

        // 3–5. Tabelas que só respondem por contato — puladas quando o
        //      passo 1 não casou ninguém (evita ida ao banco à toa).
        const payments: SearchPaymentRow[] = [];
        const credentials: SearchCredentialRow[] = [];
        const renewals: SearchRenewalRow[] = [];
        if (contactIds.length > 0) {
          const [payRes, credRes, renRes] = await Promise.all([
            db
              .from('payments')
              .select('id, amount, contact:contacts(id, name, phone)')
              .in('contact_id', contactIds)
              .order('due_at', { ascending: false })
              .limit(MAX_HITS_PER_GROUP),
            db
              .from('iptv_credentials')
              .select('id, username, contact:contacts(id, name, phone)')
              .in('contact_id', contactIds)
              .limit(MAX_HITS_PER_GROUP),
            db
              .from('renewals')
              .select('id, amount, contact:contacts(id, name, phone)')
              .in('contact_id', contactIds)
              .order('created_at', { ascending: false })
              .limit(MAX_HITS_PER_GROUP),
          ]);
          payments.push(
            ...((payRes.data ?? []) as unknown as SearchPaymentRow[])
          );
          credentials.push(
            ...((credRes.data ?? []) as unknown as SearchCredentialRow[])
          );
          renewals.push(
            ...((renRes.data ?? []) as unknown as SearchRenewalRow[])
          );
        }

        const groups: SearchGroup[] = [];
        if (contacts.length > 0) {
          groups.push({
            kind: 'contact',
            hits: contacts.map((c) => ({
              id: c.id,
              kind: 'contact' as const,
              title: contactName(c),
              subtitle:
                [c.name ? c.phone : null, c.email, c.company]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              href: buildSearchHref('contact', c.id),
            })),
          });
        }
        if (conversations.length > 0) {
          groups.push({
            kind: 'conversation',
            hits: conversations.map((c) => {
              const ref = embedRef(c.contact);
              return {
                id: c.id,
                kind: 'conversation' as const,
                title: ref ? contactName(ref) : t('unnamedContact'),
                subtitle: c.last_message_text || undefined,
                href: buildSearchHref('conversation', c.id),
              };
            }),
          });
        }
        if (payments.length > 0) {
          groups.push({
            kind: 'payment',
            hits: payments.map((p) => {
              const ref = embedRef(p.contact);
              return {
                id: p.id,
                kind: 'payment' as const,
                title: ref ? contactName(ref) : t('unnamedContact'),
                subtitle: formatCurrency(p.amount, defaultCurrency),
                href: buildSearchHref('payment', p.id),
              };
            }),
          });
        }
        if (credentials.length > 0) {
          groups.push({
            kind: 'credential',
            hits: credentials.map((c) => {
              const ref = embedRef(c.contact);
              return {
                id: c.id,
                kind: 'credential' as const,
                title: ref ? contactName(ref) : t('unnamedContact'),
                subtitle: c.username,
                href: buildSearchHref('credential', c.id),
              };
            }),
          });
        }
        if (renewals.length > 0) {
          groups.push({
            kind: 'renewal',
            hits: renewals.map((r) => {
              const ref = embedRef(r.contact);
              return {
                id: r.id,
                kind: 'renewal' as const,
                title: ref ? contactName(ref) : t('unnamedContact'),
                subtitle: formatCurrency(r.amount, defaultCurrency),
                href: buildSearchHref('renewal', r.id),
              };
            }),
          });
        }

        // Preserva a ordem de exibição definida em GROUP_ORDER.
        groups.sort(
          (a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind)
        );

        setGroups(groups);
        setLoading(false);
        setSelectedIndex(0);
      } catch (err) {
        console.error('[global-search] search failed:', err);
        setGroups([]);
        setLoading(false);
      }
    },
    [t, defaultCurrency]
  );

  // Atalho global Cmd/Ctrl+K — abre a palette em qualquer página.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Limpa o timer de debounce ao desmontar (e ao fechar, para não
  // disparar busca órfã depois que o usuário desistiu).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!normalizeQuery(value)) {
      setGroups([]);
      setLoading(false);
      setSelectedIndex(0);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatHits.length === 0) return;
      setSelectedIndex((i) => (i + 1) % flatHits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatHits.length === 0) return;
      setSelectedIndex((i) => (i - 1 + flatHits.length) % flatHits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flatHits[safeIndex];
      if (hit) navigate(hit.href);
    }
  };

  return (
    <>
      {/* Botão na header — mesmo formato dos demais ícones do header. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('triggerAria')}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-10 items-center justify-center rounded-md transition-colors"
      >
        <Search className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          {/* Título acessível (invisível) — o Base UI liga o
              aria-labelledby do popup ao Title. */}
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>

          {/* Input de busca */}
          <div className="border-border flex items-center gap-2.5 border-b px-4">
            <Search className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              role="combobox"
              aria-expanded={open}
              aria-controls="global-search-results"
              autoComplete="off"
              spellCheck={false}
              className="text-foreground placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
            />
          </div>

          {/* Resultados */}
          <div
            id="global-search-results"
            role="listbox"
            aria-label={t('resultsAria')}
            className="max-h-80 overflow-y-auto"
          >
            {loading ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                {t('loading')}
              </p>
            ) : !query.trim() ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                {t('emptyHint')}
              </p>
            ) : groups.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                {t('empty', { query })}
              </p>
            ) : (
              <div className="py-2">
                {groups.map((group) => (
                  <div key={group.kind}>
                    <p className="text-muted-foreground px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                      {t(`groups.${group.kind}`)}
                    </p>
                    <ul>
                      {group.hits.map((hit) => {
                        const index = flatHits.indexOf(hit);
                        const active = index === safeIndex;
                        return (
                          <li key={`${hit.kind}-${hit.id}`}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={active}
                              onClick={() => navigate(hit.href)}
                              onMouseMove={() => setSelectedIndex(index)}
                              className={cn(
                                'flex w-full items-center justify-between gap-3 px-4 py-2 text-left',
                                active && 'bg-muted'
                              )}
                            >
                              <span className="min-w-0">
                                <span className="text-foreground block truncate text-sm font-medium">
                                  {hit.title}
                                </span>
                                {hit.subtitle ? (
                                  <span className="text-muted-foreground block truncate text-xs">
                                    {hit.subtitle}
                                  </span>
                                ) : null}
                              </span>
                              {active ? (
                                <CornerDownLeft className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dica de teclado */}
          <div className="border-border bg-muted/40 text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-[11px]">
            <span>{t('kbdHint')}</span>
            <kbd className="border-border bg-background rounded border px-1.5 py-0.5 font-mono text-[10px]">
              ESC
            </kbd>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
