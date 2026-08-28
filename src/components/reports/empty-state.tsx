/**
 * Quiet empty state for the /reports tables — a single muted line in a
 * card, matching the "a silent pulse is a good pulse" tone of the app.
 */
export function ReportEmpty({ label }: { label: string }) {
  return (
    <div className="border-border bg-card text-muted-foreground rounded-xl border p-10 text-center text-sm">
      {label}
    </div>
  );
}
