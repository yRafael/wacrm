"use client";

// ============================================================
// PulseOperations — "quem está de plantão agora?" roster.
//
// Loader gives us the profile list + per-agent open-conversation
// counts (atendimentos) and how many of those are waiting on a
// reply (pendentes), plus the unassigned bucket. Presence is
// merged here via usePresence() — the DB never stores "offline".
//
// Ordering: online/away/offline first, then busiest operator
// first (most pendentes), so the person who most needs help
// floats to the top. Tooltips are PT-native (presenceLabel() in
// lib/presence.ts is English and used elsewhere as-is).
// ============================================================

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { PRESENCE_DOT_CLASS } from '@/components/presence/presence-dot';
import { Skeleton } from '@/components/dashboard/skeleton';
import type { PresenceStatus } from '@/lib/presence';
import type { OperatorLoad, PulseOperators } from '@/lib/pulse/types';

interface PulseOperationsProps {
  operators: PulseOperators | null;
  loading: boolean;
}

const PRESENCE_ORDER: Record<PresenceStatus, number> = {
  online: 0,
  away: 1,
  offline: 2,
};

export function PulseOperations({ operators, loading }: PulseOperationsProps) {
  const t = useTranslations('Pulse.operations');
  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();

  const list = operators?.operators ?? [];
  const unassigned = operators?.unassigned;

  const sorted = [...list].sort((a, b) => {
    const pa = PRESENCE_ORDER[getPresence(a.userId)];
    const pb = PRESENCE_ORDER[getPresence(b.userId)];
    if (pa !== pb) return pa - pb;
    return b.pendentes - a.pendentes || b.atendimentos - a.atendimentos;
  });

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        </div>
        {!loading && list.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {list.length}
          </span>
        )}
      </header>

      {loading || !operators ? (
        <div className="space-y-4 px-4 py-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <p className="text-xs text-muted-foreground/70">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {/* Unassigned conversations bucket, when there are any. */}
          {unassigned && unassigned.atendimentos > 0 && (
            <li className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Inbox className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {t('unassigned')}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {t('atendimentos', { count: unassigned.atendimentos })}
                </span>
                {unassigned.pendentes > 0 && (
                  <span className="block text-[11px] font-medium tabular-nums text-amber-500">
                    {t('pendentes', { count: unassigned.pendentes })}
                  </span>
                )}
              </span>
            </li>
          )}

          {sorted.map((op) => (
            <OperatorRow
              key={op.userId}
              op={op}
              isSelf={op.userId === user?.id}
              presence={getPresence(op.userId)}
              lastSeen={getRow(op.userId)?.last_seen_at ?? null}
              now={now}
              t={t}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------

function OperatorRow({
  op,
  isSelf,
  presence,
  lastSeen,
  now,
  t,
}: {
  op: OperatorLoad;
  isSelf: boolean;
  presence: PresenceStatus;
  lastSeen: string | null;
  now: number;
  t: ReturnType<typeof useTranslations<'Pulse.operations'>>;
}) {
  const tip = presenceTooltip(presence, lastSeen, now, t);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <Avatar className="size-8 shrink-0">
              {op.avatarUrl ? (
                <AvatarImage src={op.avatarUrl} alt={op.name} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {op.name.charAt(0).toUpperCase()}
              </AvatarFallback>
              <AvatarBadge
                role="img"
                aria-label={tip}
                className={PRESENCE_DOT_CLASS[presence]}
              />
            </Avatar>
          }
        />
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {op.name}
          {isSelf && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('you')}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t('atendimentos', { count: op.atendimentos })}
        </span>
      </span>

      {op.pendentes > 0 && (
        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500">
          {t('pendentes', { count: op.pendentes })}
        </span>
      )}
    </li>
  );
}

/** PT presence tooltip, mirroring lib/presence.ts presenceLabel(). */
function presenceTooltip(
  status: PresenceStatus,
  lastSeen: string | null,
  now: number,
  t: ReturnType<typeof useTranslations<'Pulse.operations'>>,
): string {
  switch (status) {
    case 'online':
      return t('online');
    case 'away':
      return t('away');
    case 'offline':
      return `${t('offline')} — ${t('lastSeen', { time: lastSeenPT(lastSeen, now, t) })}`;
  }
}

function lastSeenPT(
  lastSeen: string | null,
  now: number,
  t: ReturnType<typeof useTranslations<'Pulse.operations'>>,
): string {
  if (!lastSeen) return t('longAgo');
  const last = new Date(lastSeen).getTime();
  if (Number.isNaN(last)) return t('longAgo');

  const diff = Math.max(0, now - last);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  return t('daysAgo', { count: Math.floor(hours / 24) });
}
