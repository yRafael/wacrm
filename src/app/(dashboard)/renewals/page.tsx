"use client";

import { useTranslations } from "next-intl";
import { RenewalsAgenda } from "@/components/renewals/renewals-agenda";

export default function RenewalsPage() {
  const t = useTranslations("Renewals");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <RenewalsAgenda />
    </div>
  );
}
