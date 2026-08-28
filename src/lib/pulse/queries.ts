// ============================================================
// Fire Radar — data layer
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
  RadarTimeSeries,
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
 * The four headline numbers + the item-23 metric groups (Atendimento /
 * Clientes / Financeiro). Counts stay `count: 'exact', head: true` so
 * Supabase returns a cheap aggregate row instead of a full dataset; the
 * few metrics that need real values (waiting time, distinct clients,
 * month money) fetch only the columns they reduce over.
 */
export async function loadPulseMetrics(db: DB): Promise<PulseMetrics> {
  const today = boundaryISO(0);
  const tomorrow = boundaryISO(1);
  const dayAfter = boundaryISO(2);
  // 7 days out — the "próximos do vencimento" window (matches expiryStatus).
  const week = boundaryISO(7);
  // Current local month — the window for novos clientes / vendas / renovações.
  const monthStart = startOfLocalDay();
  monthStart.setDate(1);
  const monthStartISO = monthStart.toISOString();
  const nowMs = Date.now();

  const [
    atendimento,
    atendimentoAguardando,
    waitingConvs,
    renovacoesHoje,
    vencendoHoje,
    vencendoAmanha,
    vencendoAtrasadas,
    credsRes,
    incomeRes,
    paidPaymentsRes,
    renovacoesMes,
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
      .from('conversations')
      .select('last_message_at, updated_at, created_at')
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
    // All current credentials — one query feeds the four Clientes buckets
    // (kept per-contact via the same "most recent credential" rule that
    // getClientStats uses, so Pulse and the Cliente badge can't disagree).
    db
      .from('iptv_credentials')
      .select('contact_id, expires_at, created_at')
      .is('deleted_at', null),
    // This month's ledger income — the same revenue definition as Finance.
    db
      .from('financial_transactions')
      .select('amount, occurred_at')
      .eq('type', 'income')
      .gte('occurred_at', monthStartISO),
    // Paid payments (amounts) — valor recebido + ticket médio in one pass.
    db.from('payments').select('amount, paid_at').eq('status', 'paid'),
    db
      .from('renewals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStartISO),
  ]);

  // Tempo médio aguardando (min): average time since the last message on
  // conversations waiting on the customer. Falls back to updated/created
  // when last_message_at is missing, like the queue's recency helper.
  let tempoTotalMs = 0;
  let waitingCount = 0;
  for (const row of (waitingConvs.data ?? []) as Array<{
    last_message_at: string | null;
    updated_at: string;
    created_at: string;
  }>) {
    const ts = row.last_message_at ?? row.updated_at ?? row.created_at;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) continue;
    tempoTotalMs += nowMs - t;
    waitingCount += 1;
  }
  const tempoMedioAguardando =
    waitingCount === 0 ? 0 : Math.round(tempoTotalMs / waitingCount / 60000);

  // Clientes — bucket each contact's most recent credential. A credential
  // is "ativo" while still valid; "próximo" is a subset (within 7 days).
  const latestByContact = new Map<
    string,
    { expires_at: string; created_at: string }
  >();
  for (const row of (credsRes.data ?? []) as Array<{
    contact_id: string;
    expires_at: string;
    created_at: string;
  }>) {
    const prev = latestByContact.get(row.contact_id);
    if (!prev || row.created_at > prev.created_at) {
      latestByContact.set(row.contact_id, {
        expires_at: row.expires_at,
        created_at: row.created_at,
      });
    }
  }
  let clientesAtivos = 0;
  let clientesVencidos = 0;
  let clientesProximos = 0;
  let novosClientes = 0;
  for (const cred of latestByContact.values()) {
    if (cred.expires_at < today) {
      clientesVencidos += 1;
    } else {
      clientesAtivos += 1;
      if (cred.expires_at < week) clientesProximos += 1;
    }
    if (cred.created_at >= monthStartISO) novosClientes += 1;
  }

  // Financeiro — vendas do mês is the ledger income booked this month;
  // valor recebido is paid payments received this month; ticket médio is
  // the mean of all paid payments (identical to FinanceOverview's).
  let vendasDoMes = 0;
  for (const row of (incomeRes.data ?? []) as Array<{ amount: number }>) {
    vendasDoMes += row.amount;
  }
  let valorRecebido = 0;
  let ticketTotal = 0;
  let paidCount = 0;
  for (const row of (paidPaymentsRes.data ?? []) as Array<{
    amount: number;
    paid_at: string | null;
  }>) {
    if (row.paid_at && row.paid_at >= monthStartISO)
      valorRecebido += row.amount;
    ticketTotal += row.amount;
    paidCount += 1;
  }

  return {
    atendimento: atendimento.count ?? 0,
    atendimentoAguardando: atendimentoAguardando.count ?? 0,
    tempoMedioAguardando,
    atendimentosEmAndamento:
      (atendimento.count ?? 0) - (atendimentoAguardando.count ?? 0),
    renovacoesHoje: renovacoesHoje.count ?? 0,
    vencendoHoje: vencendoHoje.count ?? 0,
    vencendoAmanha: vencendoAmanha.count ?? 0,
    vencendoAtrasadas: vencendoAtrasadas.count ?? 0,
    clientesAtivos,
    novosClientes,
    clientesVencidos,
    clientesProximos,
    vendasDoMes,
    valorRecebido,
    renovacoesMes: renovacoesMes.count ?? 0,
    ticketMedio: paidCount === 0 ? 0 : ticketTotal / paidCount,
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
function contactLabel(c: ContactRef | null): {
  contactId: string;
  contactName: string;
} {
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
      single(row.contact as CredentialRow['contact'])
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
      single(row.contact as PaymentRow['contact'])
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
export async function loadPulseActivity(
  db: DB,
  limit = 15
): Promise<PulseActivityItem[]> {
  const [renewalsRes, paymentsRes, notificationsRes, credsRes] =
    await Promise.all([
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
  operators.sort(
    (a, b) => b.pendentes - a.pendentes || b.atendimentos - a.atendimentos
  );

  return { operators, unassigned };
}

/**
 * Time-series data for the line chart: conversations created per day
 * for the last 7 days, plus the count of conversations that have
 * at least one message from the customer (active conversations).
 */
export async function loadRadarTimeSeries(db: DB): Promise<RadarTimeSeries[]> {
  const days = 7;
  const results: RadarTimeSeries[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfLocalDay();
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const startISO = dayStart.toISOString();
    const endISO = dayEnd.toISOString();

    const [totalRes, activeRes] = await Promise.all([
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startISO)
        .lt('created_at', endISO),
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .gt('unread_count', 0),
    ]);

    const label = dayStart.toLocaleDateString('pt-BR', { weekday: 'short' });

    results.push({
      date: dayStart.toISOString().slice(0, 10),
      label,
      total: totalRes.count ?? 0,
      active: activeRes.count ?? 0,
    });
  }

  return results;
}

/**
 * Distribution data for the donut chart: conversation status breakdown
 * (open, closed) and payment status (paid, pending, overdue).
 */
export async function loadRadarDistribution(db: DB): Promise<{
  conversations: { status: string; count: number }[];
  payments: { status: string; count: number }[];
}> {
  const [convsRes, paymentsRes] = await Promise.all([
    db
      .from('conversations')
      .select('status')
      .not('status', 'eq', 'archived'),
    db
      .from('payments')
      .select('status')
      .in('status', ['paid', 'pending', 'late']),
  ]);

  const convMap = new Map<string, number>();
  for (const row of convsRes.data ?? []) {
    const s = (row.status as string) || 'unknown';
    convMap.set(s, (convMap.get(s) ?? 0) + 1);
  }

  const payMap = new Map<string, number>();
  for (const row of paymentsRes.data ?? []) {
    const s = (row.status as string) || 'unknown';
    payMap.set(s, (payMap.get(s) ?? 0) + 1);
  }

  return {
    conversations: Array.from(convMap.entries()).map(([status, count]) => ({
      status,
      count,
    })),
    payments: Array.from(payMap.entries()).map(([status, count]) => ({
      status,
      count,
    })),
  };
}
