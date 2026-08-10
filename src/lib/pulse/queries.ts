// ============================================================
// Fire Pulse — data layer
//
// Same RLS-scoped pattern as src/lib/dashboard/queries.ts: every call
// runs through the signed-in user's client, so RLS already scopes
// every row by is_account_member — no account_id is ever passed.
//
// Day boundaries are computed in the USER'S LOCAL time via
// startOfLocalDay(): a credential expiring at 23:59 today must count
// as "vence hoje" even though UTC has already rolled over.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { startOfLocalDay } from '@/lib/dashboard/date-utils';
import type {
  DueCredential,
  OperatorLoad,
  PendingPayment,
  PulseActivityItem,
  PulseMetrics,
  PulseOperators,
  PulsePriorities,
} from './types';

type DB = SupabaseClient;

/** Local-day boundary `days` days from now, as an ISO string. */
function boundaryISO(days: number): string {
  const d = startOfLocalDay();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Normalise a to-one embedded relation into a single row or null. */
function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

/**
 * The four headline numbers + their supporting counts. Each count is
 * a `count: 'exact', head: true` query so Supabase returns a cheap
 * aggregate row instead of a full dataset.
 */
export async function loadPulseMetrics(db: DB): Promise<PulseMetrics> {
  const today = boundaryISO(0);
  const tomorrow = boundaryISO(1);
  const dayAfter = boundaryISO(2);

  const [
    atendimento,
    atendimentoAguardando,
    renovacoesHoje,
    vencendoHoje,
    vencendoAmanha,
    vencendoAtrasadas,
  ] = await Promise.all([
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gt('unread_count', 0),
    db
      .from('renewals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today),
    db
      .from('iptv_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('expires_at', today)
      .lt('expires_at', tomorrow),
    db
      .from('iptv_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('expires_at', tomorrow)
      .lt('expires_at', dayAfter),
    db
      .from('iptv_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .lt('expires_at', today),
  ]);

  return {
    atendimento: atendimento.count ?? 0,
    atendimentoAguardando: atendimentoAguardando.count ?? 0,
    renovacoesHoje: renovacoesHoje.count ?? 0,
    vencendoHoje: vencendoHoje.count ?? 0,
    vencendoAmanha: vencendoAmanha.count ?? 0,
    vencendoAtrasadas: vencendoAtrasadas.count ?? 0,
  };
}

interface ContactRef {
  id: string;
  name: string | null;
  phone: string | null;
}

// A `contact:contacts(...)` to-one FK join surfaces as either a single
// object or an array depending on how the PostgREST embed is shaped in
// that response. `single()` normalises both; typing the field as the
// union lets the cast stay honest about what supabase-js actually emits.
type ContactRefOrList = ContactRef | ContactRef[] | null;

interface CredentialRow {
  id: string;
  expires_at: string;
  contact: ContactRefOrList;
}

interface PaymentRow {
  id: string;
  amount: number;
  due_at: string;
  status: 'pending' | 'late' | 'partial';
  contact: ContactRefOrList;
}

/** Contact display name — falls back to the phone so anonymous rows
 *  (panels often create contacts with only a phone) still read well. */
function contactLabel(c: ContactRef | null): { contactId: string; contactName: string } {
  return {
    contactId: c?.id ?? '',
    contactName: c?.name || c?.phone || '—',
  };
}

/**
 * The two priority lists: 🔴 active credentials overdue or expiring
 * today, and 🟡 open receivables. Both are capped — "ver todas" links
 * the operator to the full pages.
 */
export async function loadPulsePriorities(db: DB): Promise<PulsePriorities> {
  const today = boundaryISO(0);
  const tomorrow = boundaryISO(1);
  const now = new Date().toISOString();

  const [credsRes, paymentsRes] = await Promise.all([
    db
      .from('iptv_credentials')
      .select('id, expires_at, contact:contacts(id, name, phone)')
      .eq('status', 'active')
      .lt('expires_at', tomorrow)
      .order('expires_at', { ascending: true })
      .limit(12),
    db
      .from('payments')
      .select('id, amount, due_at, status, contact:contacts(id, name, phone)')
      .in('status', ['pending', 'late', 'partial'])
      .order('due_at', { ascending: true })
      .limit(12),
  ]);

  const due: DueCredential[] = (credsRes.data ?? []).map((row) => {
    const { contactId, contactName } = contactLabel(
      single(row.contact as CredentialRow['contact']),
    );
    return {
      id: row.id,
      contactId,
      contactName,
      expiresAt: row.expires_at,
      overdue: row.expires_at < today,
    };
  });

  const payments: PendingPayment[] = (paymentsRes.data ?? []).map((row) => {
    const { contactId, contactName } = contactLabel(
      single(row.contact as PaymentRow['contact']),
    );
    return {
      id: row.id,
      contactId,
      contactName,
      amount: row.amount,
      dueAt: row.due_at,
      status: row.status,
      overdue: row.due_at < now,
    };
  });

  return { due, payments };
}

interface ActivityRow {
  id: string;
  created_at: string;
  amount?: number | null;
  title?: string | null;
  body?: string | null;
  contact: ContactRefOrList;
}

/**
 * A merged, newest-first feed of the events that matter to the
 * operation: completed renewals, opened receivables, alerts
 * (notifications) and saved credentials.
 */
export async function loadPulseActivity(db: DB, limit = 15): Promise<PulseActivityItem[]> {
  const [renewalsRes, paymentsRes, notificationsRes, credsRes] = await Promise.all([
    db
      .from('renewals')
      .select('id, created_at, amount, contact:contacts(id, name, phone)')
      .order('created_at', { ascending: false })
      .limit(12),
    db
      .from('payments')
      .select('id, created_at, amount, contact:contacts(id, name, phone)')
      .order('created_at', { ascending: false })
      .limit(12),
    db
      .from('notifications')
      .select('id, title, body, created_at')
      .order('created_at', { ascending: false })
      .limit(12),
    db
      .from('iptv_credentials')
      .select('id, created_at, contact:contacts(id, name, phone)')
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const items: PulseActivityItem[] = [];

  const activityContact = (row: ActivityRow): string | undefined => {
    const c = single(row.contact);
    return c?.name || c?.phone || undefined;
  };

  for (const row of (renewalsRes.data ?? []) as ActivityRow[]) {
    items.push({
      id: `r-${row.id}`,
      kind: 'renewal',
      at: row.created_at,
      href: '/renewals',
      contactName: activityContact(row),
      amount: row.amount ?? undefined,
    });
  }
  for (const row of (paymentsRes.data ?? []) as ActivityRow[]) {
    items.push({
      id: `p-${row.id}`,
      kind: 'payment',
      at: row.created_at,
      href: '/renewals',
      contactName: activityContact(row),
      amount: row.amount ?? undefined,
    });
  }
  for (const row of (notificationsRes.data ?? []) as ActivityRow[]) {
    items.push({
      id: `n-${row.id}`,
      kind: 'alert',
      at: row.created_at,
      href: '/notifications',
      title: row.title ?? undefined,
      body: row.body ?? undefined,
    });
  }
  for (const row of (credsRes.data ?? []) as ActivityRow[]) {
    items.push({
      id: `c-${row.id}`,
      kind: 'credential',
      at: row.created_at,
      href: '/clients',
      contactName: activityContact(row),
    });
  }

  return items
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/**
 * Per-operator load (open conversations assigned to them, and how many
 * of those are waiting on a reply) plus the unassigned bucket. Presence
 * is merged in the component via usePresence() — the DB doesn't know
 * about "offline".
 */
export async function loadOperators(db: DB): Promise<PulseOperators> {
  const [profilesRes, convsRes] = await Promise.all([
    db
      .from('profiles')
      .select('user_id, full_name, email, avatar_url')
      .order('created_at', { ascending: true }),
    db
      .from('conversations')
      .select('assigned_agent_id, unread_count')
      .eq('status', 'open'),
  ]);

  const load = new Map<string, { atendimentos: number; pendentes: number }>();
  const unassigned = { atendimentos: 0, pendentes: 0 };

  for (const conv of convsRes.data ?? []) {
    const agent = conv.assigned_agent_id as string | null;
    const pending = (conv.unread_count ?? 0) > 0;
    if (!agent) {
      unassigned.atendimentos += 1;
      if (pending) unassigned.pendentes += 1;
      continue;
    }
    const cur = load.get(agent) ?? { atendimentos: 0, pendentes: 0 };
    cur.atendimentos += 1;
    if (pending) cur.pendentes += 1;
    load.set(agent, cur);
  }

  const operators: OperatorLoad[] = (profilesRes.data ?? []).map((p) => {
    const counts = load.get(p.user_id) ?? { atendimentos: 0, pendentes: 0 };
    return {
      userId: p.user_id,
      name: p.full_name || p.email || 'Operador',
      avatarUrl: p.avatar_url,
      ...counts,
    };
  });

  // Busiest first — the operator who most needs help floats to the top.
  operators.sort((a, b) => b.pendentes - a.pendentes || b.atendimentos - a.atendimentos);

  return { operators, unassigned };
}
