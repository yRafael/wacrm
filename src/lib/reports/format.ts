// ============================================================
// Report date formatting — small locale helper shared by the four
// /reports tab components. Maps the next-intl locale code onto a BCP-47
// tag for `toLocaleDateString` and formats a date-only ISO string for
// CSV exports.
// ============================================================

/** Map a next-intl locale code onto a BCP-47 tag for date formatting. */
export function reportLocale(locale: string): string {
  if (locale === 'ko' || locale === 'ko-KR') return 'ko-KR';
  if (locale === 'pt' || locale === 'pt-BR' || locale === 'pt-PT')
    return 'pt-BR';
  return 'en-US';
}

/** Locale-aware short date, e.g. "12 Aug 2026" / "12 de ago. de 2026". */
export function formatDate(
  iso: string | null | undefined,
  locale = 'en-US'
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(reportLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Stable `YYYY-MM-DD` for CSV columns (date part of an ISO timestamp). */
export function formatDateCsv(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}
