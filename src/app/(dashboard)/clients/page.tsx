"use client";

import { useTranslations } from "next-intl";
import { ClientsTable } from "@/components/clients/clients-table";

export default function ClientsPage() {
  const t = useTranslations("Clients");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ClientsTable />
    </div>
  );
}
