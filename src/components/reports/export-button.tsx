"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, type CsvCell } from "@/lib/reports/csv";

interface ExportButtonProps {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  disabled?: boolean;
}

/**
 * Shared CSV export trigger for the four /reports tabs — the same
 * RFC 4180 serializer the broadcast detail uses, wrapped in a button.
 */
export function ExportButton({ filename, headers, rows, disabled }: ExportButtonProps) {
  const t = useTranslations("Reports");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || rows.length === 0}
      onClick={() => downloadCsv(filename, headers, rows)}
    >
      <Download />
      {t("exportCsv")}
    </Button>
  );
}
