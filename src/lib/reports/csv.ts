// ============================================================
// CSV export — RFC 4180 quoting for report downloads (CAP 52).
//
// `toCsv` is pure and vitest-covered; `downloadCsv` is the thin DOM
// wrapper that triggers a browser download. Every field is quoted so
// commas/newlines/quotes round-trip cleanly — the same convention as
// the broadcast detail export. No BOM, matching the existing path.
// ============================================================

export type CsvCell = string | number;

/**
 * Serialize a table to CSV. Every field is quoted per RFC 4180
 * (embedded double quotes doubled), so separators and line breaks
 * inside a cell can never break the file.
 */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const line = (cells: CsvCell[]) =>
    cells.map((c) => escape(String(c))).join(',');
  return [headers, ...rows].map(line).join('\n');
}

/** Trigger a browser download of the serialized CSV. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][]
): void {
  const blob = new Blob([toCsv(headers, rows)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
