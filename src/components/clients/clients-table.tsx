"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link as LinkIcon, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  daysUntil,
  expiryStatus,
  type ExpiryStatus,
} from "@/lib/iptv/client-stats";
import { Badge } from "@/components/ui/badge";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import type { Contact, IptvCredential } from "@/types";

type ClientFilter = "all" | "active" | "expiring" | "expired";

interface ClientRow {
  contact: Contact;
  credential: IptvCredential | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  status: ExpiryStatus;
}

const STATUS_BADGE: Record<ExpiryStatus, { variant: string; labelKey: string }> = {
  active: { variant: "default", labelKey: "statusActive" },
  expiring_soon: { variant: "outline", labelKey: "statusExpiring" },
  expired: { variant: "destructive", labelKey: "statusExpired" },
  none: { variant: "secondary", labelKey: "statusNone" },
};

export function ClientsTable() {
  const t = useTranslations("Clients");
  const db = createClient();

  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ClientFilter>("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [contactRes, credRes] = await Promise.all([
        db.from("contacts").select("*").order("created_at", { ascending: false }),
        db
          .from("iptv_credentials")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const contacts = (contactRes.data as Contact[]) ?? [];
      const creds = (credRes.data as IptvCredential[]) ?? [];

      // A contact may hold several credentials over time; we only keep the
      // most recent active one (soft-deletes excluded above).
      const latestByContact = new Map<string, IptvCredential>();
      for (const c of creds) {
        if (!latestByContact.has(c.contact_id)) latestByContact.set(c.contact_id, c);
      }

      const now = new Date();
      const mapped: ClientRow[] = contacts.map((contact) => {
        const credential = latestByContact.get(contact.id) ?? null;
        const expiresAt = credential?.expires_at ?? null;
        return {
          contact,
          credential,
          expiresAt,
          daysUntilExpiry: expiresAt ? daysUntil(expiresAt, now) : null,
          status: expiryStatus(expiresAt, now),
        };
      });
      setRows(mapped);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "active":
        return rows.filter((r) => r.status === "active");
      case "expiring":
        return rows.filter((r) => r.status === "expiring_soon");
      case "expired":
        return rows.filter((r) => r.status === "expired");
      default:
        return rows;
    }
  }, [rows, filter]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const counts: Record<ClientFilter, number> = {
    all: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    expiring: rows.filter((r) => r.status === "expiring_soon").length,
    expired: rows.filter((r) => r.status === "expired").length,
  };

  const filters: { key: ClientFilter; labelKey: string }[] = [
    { key: "all", labelKey: "filterAll" },
    { key: "active", labelKey: "filterActive" },
    { key: "expiring", labelKey: "filterExpiring" },
    { key: "expired", labelKey: "filterExpired" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
              filter === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {t(f.labelKey)}
            <span className="text-xs tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <UserCheck className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t("colContact")}</th>
                  <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
                  <th className="px-4 py-3 font-medium">{t("colUser")}</th>
                  <th className="px-4 py-3 font-medium">{t("colExpiry")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <tr
                      key={r.contact.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <LinkIcon className="size-3.5 text-muted-foreground" />
                          {r.contact.name || r.contact.phone || t("noName")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.contact.phone || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.credential?.username || "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {r.expiresAt ? formatDate(r.expiresAt) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={badge.variant as "default" | "destructive" | "outline" | "secondary"}>
                          {t(badge.labelKey)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
