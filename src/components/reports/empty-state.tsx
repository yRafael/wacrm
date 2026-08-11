/**
 * Quiet empty state for the /reports tables — a single muted line in a
 * card, matching the "a silent pulse is a good pulse" tone of the app.
 */
export function ReportEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
