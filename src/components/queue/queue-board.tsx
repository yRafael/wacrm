"use client";

// ============================================================
// QueueBoard — fila de atendimento em dois painéis:
//   🔵 Sem responsável — conversas abertas que ninguém assumiu
//   🟡 Aguardando resposta — assumidas, com o cliente esperando
//
// Presentacional: a página cuida do fetch + Realtime e passa as
// conversas já normalizadas (`normalizeConversations`). "Assumir"
// chama `claimConversation` (update direto em `assigned_agent_id`,
// mesmo padrão do thread) e pede um reload à página. Cada linha
// abre o thread em `/inbox?c=<id>`. Empty states são silenciosos
// de propósito — uma fila vazia é uma fila boa (padrão pulse).
//
// Viewers veem a fila inteira; o botão Assumir é gateado por
// `useCan('send-messages')` via GatedButton.
// ============================================================

import Link from "next/link";
import { useCallback, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { enUS, ko, ptBR, type Locale } from "date-fns/locale";
import { Clock3, Headset } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import type { ComponentType } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { buildQueue, type QueueBucketKey } from "@/lib/queue/queue";
import { claimConversation } from "@/lib/queue/actions";
import { GatedButton } from "@/components/ui/gated-button";
import { Skeleton } from "@/components/dashboard/skeleton";
import type { Conversation } from "@/types";

interface QueueBoardProps {
  conversations: Conversation[];
  loading: boolean;
  /** Pedido de refetch — chamado após assumir para a página
   *  recarregar e o item mudar de bucket. */
  onReload: () => void;
}

/** Locale ativo → locale do date-fns para o "há X min". */
function dateFnsLocale(locale: string): Locale {
  switch (locale) {
    case "pt":
    case "pt-BR":
      return ptBR;
    case "ko":
    case "ko-KR":
      return ko;
    default:
      return enUS;
  }
}

const PANEL_META: Record<
  QueueBucketKey,
  { icon: ComponentType<{ className?: string }>; toneClass: string }
> = {
  unassigned: {
    icon: Headset,
    toneClass: "bg-primary/10 text-primary",
  },
  waiting: {
    icon: Clock3,
    toneClass: "bg-amber-500/10 text-amber-400",
  },
};

export function QueueBoard({ conversations, loading, onReload }: QueueBoardProps) {
  const t = useTranslations("Queue");
  const { user } = useAuth();
  const canClaim = useCan("send-messages");
  // Id da conversa sendo assumida — o botão mostra "Assumindo…" e
  // fica desabilitado para evitar double-submit.
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const buckets = buildQueue(conversations);

  const handleClaim = useCallback(
    async (conversationId: string) => {
      if (!user) return;
      setClaimingId(conversationId);
      const db = createClient();
      const ok = await claimConversation(db, conversationId, user.id);
      setClaimingId(null);
      if (ok) {
        toast.success(t("claimed"));
        onReload();
      } else {
        toast.error(t("claimError"));
      }
    },
    [user, onReload, t],
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <QueuePanel
        bucket="unassigned"
        title={t("unassignedTitle")}
        count={loading ? null : buckets.unassigned.length}
        conversations={buckets.unassigned}
        loading={loading}
        canClaim={canClaim}
        claimingId={claimingId}
        onClaim={handleClaim}
        t={t}
      />
      <QueuePanel
        bucket="waiting"
        title={t("waitingTitle")}
        count={loading ? null : buckets.waiting.length}
        conversations={buckets.waiting}
        loading={loading}
        canClaim={canClaim}
        claimingId={claimingId}
        onClaim={handleClaim}
        t={t}
      />
    </div>
  );
}

// ------------------------------------------------------------

function QueuePanel({
  bucket,
  title,
  count,
  conversations,
  loading,
  canClaim,
  claimingId,
  onClaim,
  t,
}: {
  bucket: QueueBucketKey;
  title: string;
  count: number | null;
  conversations: Conversation[];
  loading: boolean;
  canClaim: boolean;
  claimingId: string | null;
  onClaim: (conversationId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = PANEL_META[bucket];
  const Icon = meta.icon;
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md ${meta.toneClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {count !== null && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </header>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t(`${bucket}Empty`)}</p>
          <p className="text-xs text-muted-foreground/70">
            {t(`${bucket}EmptyHint`)}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {conversations.map((c) => (
            <QueueRow
              key={c.id}
              conversation={c}
              bucket={bucket}
              canClaim={canClaim}
              claimingId={claimingId}
              onClaim={onClaim}
              t={t}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({
  conversation: c,
  bucket,
  canClaim,
  claimingId,
  onClaim,
  t,
}: {
  conversation: Conversation;
  bucket: QueueBucketKey;
  canClaim: boolean;
  claimingId: string | null;
  onClaim: (conversationId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const contact = c.contact;
  const name = contact?.name?.trim() || contact?.phone || t("unnamedContact");
  const initial = name.charAt(0).toUpperCase();
  const openHref = `/inbox?c=${c.id}`;
  const preview = c.last_message_text?.trim() || t("noMessages");
  const locale = useLocale();
  const timeAgo = c.last_message_at
    ? formatDistanceToNow(new Date(c.last_message_at), {
        addSuffix: true,
        locale: dateFnsLocale(locale),
      })
    : "";

  return (
    <li>
      <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
        {/* Clique na área principal abre o thread. */}
        <Link
          href={openHref}
          className="flex min-w-0 items-center gap-2.5"
          title={t("open")}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {preview}
            </span>
          </span>
        </Link>

        <span className="flex shrink-0 items-center gap-2">
          {c.unread_count > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
              {c.unread_count}
            </span>
          )}
          {timeAgo && (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {timeAgo}
            </span>
          )}
          {bucket === "unassigned" && (
            <GatedButton
              canAct={canClaim}
              gateReason={t("gateReason")}
              size="sm"
              variant="outline"
              disabled={claimingId === c.id}
              onClick={() => onClaim(c.id)}
            >
              {claimingId === c.id ? t("claiming") : t("claim")}
            </GatedButton>
          )}
        </span>
      </div>
    </li>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 px-4 py-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}
