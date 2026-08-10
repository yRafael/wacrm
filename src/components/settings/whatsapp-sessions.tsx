'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Unplug,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatRelative } from '@/lib/automations/trigger-meta';
import type { SessionStatus, WhatsAppSessionRow } from '@/lib/whatsapp/baileys/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip } from './settings-chip';

type BusyAction = 'refresh' | 'disconnect' | 'delete' | null;

/**
 * Status pill metadata. Colour follows the semantic palette used across
 * the settings redesign (emerald ok / amber attention / red error);
 * red is an explicit override because SettingsChip has no red variant.
 */
const STATUS_META: Record<
  SessionStatus,
  { chip: 'ok' | 'warn' | 'muted'; icon: typeof CheckCircle2; className?: string }
> = {
  CONNECTED: { chip: 'ok', icon: CheckCircle2 },
  CONNECTING: { chip: 'warn', icon: Loader2 },
  QR_CODE: { chip: 'warn', icon: QrCode },
  RECONNECTING: { chip: 'warn', icon: RefreshCw },
  DISCONNECTED: { chip: 'muted', icon: Unplug },
  ERROR: {
    chip: 'warn',
    icon: XCircle,
    className: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
  },
  BLOCKED: {
    chip: 'warn',
    icon: AlertTriangle,
    className: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
  },
};

/** "2m 15s" countdown for the QR lifetime. */
function formatQrExpiry(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return 'agora';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/**
 * WhatsApp session management (Baileys / WhatsApp Web transport).
 *
 * Renders the account's `whatsapp_sessions` rows live over Realtime —
 * the worker flips status / writes `qr_data` into the row and the QR
 * appears here without a refresh. Mutations go through the sessions
 * API routes (they own the on-disk auth-dir cleanup); reads use the
 * RLS-scoped client directly.
 */
export function WhatsAppSessions() {
  const t = useTranslations('Settings.whatsappSessions');
  const supabase = createClient();
  const { accountId, loading: authLoading, canEditSettings } = useAuth();

  const [sessions, setSessions] = useState<WhatsAppSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<Record<string, BusyAction>>({});
  // Tick so QR-expiry / "last activity" labels advance without a tight
  // timer.
  const [now, setNow] = useState(() => Date.now());

  // Guards against re-fetching when the load effect re-runs for reasons
  // unrelated to actually switching accounts (Supabase token-refresh
  // churn on tab refocus) — mirrors the whatsapp-config guard.
  const loadedAccountIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load whatsapp sessions:', error);
    }
    setSessions((data as WhatsAppSessionRow[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }

    // Re-fetch when the account actually changes; then subscribe so any
    // worker write (status flip, new QR) refreshes the list live. The
    // channel filter keeps events scoped to our account's rows.
    if (loadedAccountIdRef.current !== accountId) {
      loadedAccountIdRef.current = accountId;
      setLoading(true);
      void load();
    }

    const channel = supabase
      .channel(`whatsapp-sessions-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_sessions',
          filter: `account_id=eq.${accountId}`,
        },
        () => void load(),
      )
      .subscribe();

    const interval = setInterval(() => setNow(Date.now()), 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [accountId, authLoading, load, supabase]);

  const createSession = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/whatsapp/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('createFailed'));
        return;
      }
      toast.success(t('created'));
      setName('');
      setCreateOpen(false);
      await load();
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  }, [name, load, t]);

  const runAction = useCallback(
    async (session: WhatsAppSessionRow, action: Exclude<BusyAction, null>) => {
      if (action === 'delete' && !window.confirm(t('deleteConfirm'))) return;
      setBusy((prev) => ({ ...prev, [session.id]: action }));
      try {
        // refresh → /refresh, disconnect → /disconnect; delete has no
        // action suffix — it's the resource route itself.
        const path =
          action === 'delete'
            ? `/api/whatsapp/sessions/${session.id}`
            : `/api/whatsapp/sessions/${session.id}/${action}`;
        const res = await fetch(path, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? t('actionFailed'));
          return;
        }
        toast.success(
          action === 'refresh' ? t('reconnected') : action === 'disconnect' ? t('disconnected') : t('deleted'),
        );
        await load();
      } catch {
        toast.error(t('actionFailed'));
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[session.id];
          return next;
        });
      }
    },
    [load, t],
  );

  if (authLoading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          canEditSettings ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('newSession')}
            </Button>
          ) : undefined
        }
      />

      {!canEditSettings ? (
        <Alert className="mb-4 bg-card border-border">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-foreground">{t('readOnlyTitle')}</AlertTitle>
          <AlertDescription className="text-muted-foreground">{t('readOnlyDesc')}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <Alert className="bg-card border-border">
          <Smartphone className="size-4" />
          <AlertTitle className="text-foreground">{t('emptyTitle')}</AlertTitle>
          <AlertDescription className="text-muted-foreground">{t('emptyDesc')}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => {
            const meta = STATUS_META[session.status];
            const StatusIcon = meta.icon;
            const sessionBusy = busy[session.id] ?? null;
            // Show the QR while pairing — the worker keeps a never-paired
            // session in QR_CODE and updates qr_data live as Baileys emits
            // new codes. Between QR refresh cycles Baileys flips back to
            // `connecting`, which the worker surfaces as CONNECTING; the QR
            // data survives that flip, so CONNECTING must keep it visible or
            // the code vanishes on every reconnect. Only CONNECTED /
            // DISCONNECTED / ERROR / BLOCKED hide it (no pairing in progress).
            const pairing =
              session.status === 'QR_CODE' ||
              session.status === 'RECONNECTING' ||
              session.status === 'CONNECTING';
            const showQr = pairing && !!session.qr_data;
            const spinning = session.status === 'CONNECTING' || session.status === 'RECONNECTING';
            return (
              <Card key={session.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {session.name}
                      </span>
                      <SettingsChip variant={meta.chip} className={meta.className}>
                        <StatusIcon className={spinning ? 'animate-spin' : undefined} />
                        {t(`status.${session.status}`)}
                      </SettingsChip>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      {session.phone ? <span>{session.phone}</span> : null}
                      <span>
                        {session.last_activity
                          ? t('lastActivity', { time: formatRelative(session.last_activity) })
                          : t('neverActive')}
                      </span>
                    </div>
                    {session.last_error ? (
                      <p className="mt-1 text-xs text-red-500">
                        {t('error', { error: session.last_error })}
                      </p>
                    ) : null}
                  </div>

                  {canEditSettings ? (
                    <div className="flex shrink-0 items-center gap-2">
                      {session.status !== 'CONNECTED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sessionBusy !== null}
                          onClick={() => void runAction(session, 'refresh')}
                        >
                          {sessionBusy === 'refresh' ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : session.status === 'QR_CODE' ? (
                            <QrCode className="size-3.5" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          {session.status === 'QR_CODE' ? t('refreshQr') : t('reconnect')}
                        </Button>
                      ) : null}
                      {session.status === 'CONNECTED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sessionBusy !== null}
                          onClick={() => void runAction(session, 'disconnect')}
                        >
                          {sessionBusy === 'disconnect' ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Unplug className="size-3.5" />
                          )}
                          {t('disconnect')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={sessionBusy !== null}
                        onClick={() => void runAction(session, 'delete')}
                      >
                        {sessionBusy === 'delete' ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        {t('delete')}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {showQr ? (
                  <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4">
                    {/* QR emitted by the worker; re-sent over Realtime on
                        every flip (pairing progresses → new QR). */}
                    <img
                      src={session.qr_data ?? ''}
                      alt="Código QR do WhatsApp"
                      className={cn('size-44', session.status === 'QR_CODE' && 'animate-pulse')}
                    />
                    <p className="text-xs text-muted-foreground">{t('qrHint')}</p>
                    {session.qr_expires_at ? (
                      <p className="text-xs text-muted-foreground">
                        {t('qrExpires', { time: formatQrExpiry(session.qr_expires_at, now) })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="session-name">{t('nameLabel')}</Label>
            <Input
              id="session-name"
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createSession();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button size="sm" disabled={creating} onClick={() => void createSession()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
