"use client";

// ============================================================
// Subscription card — 💰 ASSINATURA (doc Cap. 7).
//
// The account summary rendered inside the conversation area. Feeds
// off `getClientStats()` (src/lib/iptv/client-stats.ts), the same
// aggregated object the Perfil 360° tab uses, so this card and the
// contacts sheet can never disagree about a customer's state.
//
// Pure presentational: no DB access, no state. The parent fetches
// stats and passes the object down (plus the account currency).
// ============================================================

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import type { ClientStats } from "@/lib/iptv/client-stats";

interface SubscriptionCardProps {
  stats: ClientStats | null;
  /** Account currency code (accounts.default_currency). */
  currency: string | undefined;
}

// Mapeia `duration_days` da credencial para o rótulo do plano. A
// duração é gravada na renovação (30/90/180/365); sem ela, o plano
// fica "—". Fail-open: um valor fora do mapa cai em "—".
const PLAN_LABEL_BY_DAYS: Record<number, string> = {
  30: "Mensal",
  90: "Trimestral",
  120: "Quadrimestral",
  180: "Semestral",
  365: "Anual",
};

// Tonalidade do status de vencimento — compartilhada com a lista de
// conversas e com o Perfil 360°, para o mesmo estado ter sempre a
// mesma cor em qualquer lugar.
const EXPIRY_STYLE: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  expiring_soon: "bg-amber-500/10 text-amber-500",
  expired: "bg-red-500/10 text-red-500",
  none: "bg-muted text-muted-foreground",
};

const EXPIRY_LABEL: Record<string, string> = {
  active: "statusActive",
  expiring_soon: "statusExpiringSoon",
  expired: "statusExpired",
  none: "statusNone",
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function planLabel(durationDays: number | null | undefined): string {
  if (!durationDays) return "—";
  return PLAN_LABEL_BY_DAYS[durationDays] ?? "—";
}

export function SubscriptionCard({ stats, currency }: SubscriptionCardProps) {
  const t = useTranslations("Inbox.subscription");

  if (!stats) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">{t("none")}</p>
      </div>
    );
  }

  const { credential, lastPayment, nextDuePayment, status } = stats;

  // Valor da assinatura: último pagamento recebido; sem um, o próximo
  // débito em aberto. Ambos vêm do mesmo dono (o contato), então o
  // valor mostrado é sempre o mais recente que temos.
  const valueAmount =
    lastPayment?.amount ?? nextDuePayment?.amount ?? undefined;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3 w-3" />
          {t("title")}
        </p>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            EXPIRY_STYLE[status]
          }`}
        >
          {t(EXPIRY_LABEL[status])}
        </span>
      </div>

      <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{t("product")}</span>
          <span className="font-medium text-foreground">IPTV</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("plan")}</span>
          <span className="font-medium text-foreground">
            {planLabel(credential?.duration_days)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("value")}</span>
          <span className="font-medium text-foreground">
            {valueAmount !== undefined
              ? formatCurrency(valueAmount, currency)
              : "—"}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("lastPayment")}</span>
          <span className="font-medium text-foreground">
            {lastPayment
              ? `${formatCurrencyShort(lastPayment.amount, currency)} · ${fmtDate(
                  lastPayment.paid_at ?? lastPayment.due_at,
                )}`
              : "—"}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("expiry")}</span>
          <span className="font-medium text-foreground">
            {credential ? fmtDate(credential.expires_at) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}