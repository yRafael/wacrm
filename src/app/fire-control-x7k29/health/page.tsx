import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import {
  requirePlatformOperator,
} from '@/lib/auth/account';
import { STEP_UP_COOKIE, verifyStepUpToken } from '@/lib/auth/step-up';
import FireControlLayout from '@/components/fire-control/fire-control-layout';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  title: 'Saúde da Plataforma — Fire Control',
};

// ── Types ──────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  last_activity: string | null;
  last_error: string | null;
  disconnect_count_24h: number;
  last_disconnect_at: string | null;
  account_id: string;
  accounts?: { name: string } | null;
}

interface ConnectionEvent {
  id: string;
  session_id: string;
  event: string;
  reason: string | null;
  raw_error: string | null;
  disconnect_count_24h: number;
  created_at: string;
  whatsapp_sessions?: { name: string; phone: string | null } | null;
}

// ── Helpers ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  CONNECTED: 'bg-emerald-500',
  CONNECTING: 'bg-amber-500 animate-pulse',
  QR_CODE: 'bg-amber-500 animate-pulse',
  RECONNECTING: 'bg-amber-500 animate-pulse',
  DISCONNECTED: 'bg-zinc-400',
  ERROR: 'bg-red-500',
  BLOCKED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  QR_CODE: 'Aguardando QR',
  RECONNECTING: 'Reconectando',
  DISCONNECTED: 'Desconectado',
  ERROR: 'Erro',
  BLOCKED: 'Bloqueado',
};

const EVENT_ICONS: Record<string, string> = {
  connected: '🟢',
  disconnected: '🔴',
  error: '❌',
  reconnect_attempt: '🔄',
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min atrás`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h atrás`;
  return `${Math.floor(ms / 86_400_000)}d atrás`;
}

// ── Page ───────────────────────────────────────────────────────

export default async function HealthPage() {
  const cookieStore = await cookies();
  const grant = cookieStore.get(STEP_UP_COOKIE)?.value;
  if (!grant || !(await verifyStepUpToken(grant))) {
    redirect('/fire-control-x7k29/verify');
  }

  const ctx = await requirePlatformOperator();

  // Fetch all sessions across all accounts
  const { data: sessions, error: sessErr } = await ctx.supabase
    .from('whatsapp_sessions')
    .select('id, name, phone, status, last_activity, last_error, disconnect_count_24h, last_disconnect_at, account_id')
    .order('last_activity', { ascending: false });

  // Fetch recent connection events (last 50)
  const { data: events, error: evtErr } = await ctx.supabase
    .from('whatsapp_connection_log')
    .select('id, session_id, event, reason, raw_error, disconnect_count_24h, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch account names for display
  const accountIds = [...new Set((sessions ?? []).map((s) => s.account_id))];
  const { data: accounts } = await ctx.supabase
    .from('accounts')
    .select('id, name')
    .in('id', accountIds);

  const accountMap = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  // Summary stats
  const totalSessions = sessions?.length ?? 0;
  const connectedCount = sessions?.filter((s) => s.status === 'CONNECTED').length ?? 0;
  const errorCount = sessions?.filter((s) => s.status === 'ERROR' || s.status === 'BLOCKED').length ?? 0;
  const flappingCount = sessions?.filter((s) => (s.disconnect_count_24h ?? 0) >= 5).length ?? 0;

  return (
    <FireControlLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Saúde da plataforma
          </h1>
          <p className="text-muted-foreground mt-1">
            Status das sessões WhatsApp e histórico de conexões.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-sm">Total de sessões</p>
            <p className="text-2xl font-bold text-foreground">{totalSessions}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-sm">Conectadas</p>
            <p className="text-2xl font-bold text-emerald-600">{connectedCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-sm">Com erro</p>
            <p className="text-2xl font-bold text-red-600">{errorCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-muted-foreground text-sm">Instáveis (≥5 quedas/24h)</p>
            <p className="text-2xl font-bold text-amber-600">{flappingCount}</p>
          </div>
        </div>

        {/* Error banner */}
        {(sessErr || evtErr) && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600">
            Erro ao carregar dados: {sessErr?.message ?? evtErr?.message}
          </div>
        )}

        {/* Sessions grid */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Sessões WhatsApp
          </h2>
          {sessions && sessions.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${STATUS_COLORS[s.status] ?? 'bg-zinc-400'}`}
                    />
                    <span className="text-foreground text-sm font-semibold">
                      {s.name}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                    <p>Conta: {accountMap.get(s.account_id) ?? '—'}</p>
                    {s.phone && <p>Número: {s.phone}</p>}
                    <p>Status: {STATUS_LABELS[s.status] ?? s.status}</p>
                    {s.last_activity && (
                      <p>Última atividade: {formatRelative(s.last_activity)}</p>
                    )}
                    {s.disconnect_count_24h > 0 && (
                      <p className="text-amber-500">
                        Quedas (24h): {s.disconnect_count_24h}
                      </p>
                    )}
                    {s.last_error && (
                      <p className="text-red-500">Erro: {s.last_error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nenhuma sessão WhatsApp registrada.
            </p>
          )}
        </section>

        {/* Connection event log */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Histórico de conexões (últimas 50)
          </h2>
          {events && events.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b bg-muted/50 text-left">
                    <th className="p-3 font-medium">Quando</th>
                    <th className="p-3 font-medium">Sessão</th>
                    <th className="p-3 font-medium">Evento</th>
                    <th className="p-3 font-medium">Motivo</th>
                    <th className="p-3 font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr
                      key={e.id}
                      className="border-border border-b last:border-0"
                    >
                      <td className="text-muted-foreground p-3 whitespace-nowrap">
                        {formatRelative(e.created_at)}
                      </td>
                      <td className="p-3 font-medium">
                        {e.session_id.slice(0, 8)}…
                      </td>
                      <td className="p-3">
                        {EVENT_ICONS[e.event] ?? '❓'} {e.event}
                      </td>
                      <td className="text-muted-foreground p-3">
                        {e.reason ?? '—'}
                      </td>
                      <td className="text-muted-foreground max-w-[200px] truncate p-3 text-xs">
                        {e.raw_error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nenhum evento de conexão registrado. Os logs começarão a aparecer
              após a próxima reconexão do worker.
            </p>
          )}
        </section>
      </div>
    </FireControlLayout>
  );
}
