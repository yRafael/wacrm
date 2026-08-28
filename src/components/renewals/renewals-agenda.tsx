'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertCircle as AlertCircleIcon,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Send,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrency } from '@/lib/currency';
import {
  completeRenewal,
  createPayment,
  listDuePayments,
  listRecentRenewals,
  RENEWAL_DURATIONS,
} from '@/lib/iptv/renewals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import type { Payment, PaymentMethod, Renewal } from '@/types';

interface ContactOption {
  id: string;
  name: string | null;
  phone: string | null;
}

const METHODS: PaymentMethod[] = [
  'pix',
  'cash',
  'card',
  'transfer',
  'boleto',
  'credit',
];

/** Whole days from today to `iso` (floor; negative when past). */
function daysFromToday(iso: string, now: Date): number {
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const target = new Date(iso).getTime();
  return Math.floor((target - today) / (24 * 60 * 60 * 1000));
}

/** `YYYY-MM-DD` (date input) → ISO timestamp at local noon (avoids TZ drift). */
function dateToIso(dateValue: string): string | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type AgendaKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'month';

const AGENDA_KEYS: AgendaKey[] = [
  'overdue',
  'today',
  'tomorrow',
  'week',
  'month',
];

export function RenewalsAgenda() {
  const t = useTranslations('Renewals');
  const { accountId, defaultCurrency } = useAuth();
  const canAct = useCan('send-messages');
  const db = createClient();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- "Registrar pagamento" form -----------------------------------------
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [newContactId, setNewContactId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newMethod, setNewMethod] = useState<PaymentMethod>('pix');
  const [newDueDate, setNewDueDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  // ---- "Confirmar pagamento" form -----------------------------------------
  const [confirmTarget, setConfirmTarget] = useState<Payment | null>(null);
  const [confirmDuration, setConfirmDuration] = useState<string>('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [confirming, setConfirming] = useState(false);

  // ---- Batch reminder selection -------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [due, hist] = await Promise.all([
      listDuePayments(db, accountId),
      listRecentRenewals(db, accountId, 30),
    ]);
    setPayments(due);
    setRenewals(hist);
    setLoading(false);
  }, [accountId, db]);

  useEffect(() => {
    let cancelled = false;
    load();
    db.from('contacts')
      .select('id, name, phone')
      .order('name')
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setContacts((data as ContactOption[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [load, db]);

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts.slice(0, 50);
    return contacts
      .filter(
        (c) =>
          (c.name?.toLowerCase().includes(q) ?? false) ||
          (c.phone?.includes(q) ?? false)
      )
      .slice(0, 50);
  }, [contacts, contactQuery]);

  // ---- agenda buckets -----------------------------------------------------
  const buckets = useMemo(() => {
    const now = new Date();
    const b: Record<AgendaKey, Payment[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      month: [],
    };
    for (const p of payments) {
      const d = daysFromToday(p.due_at, now);
      if (d < 0) b.overdue.push(p);
      else if (d === 0) b.today.push(p);
      else if (d === 1) b.tomorrow.push(p);
      else if (d <= 7) b.week.push(p);
      else if (d <= 30) b.month.push(p);
    }
    return b;
  }, [payments]);

  // ---- actions ------------------------------------------------------------
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allIds = payments.map((p) => p.id);
    setSelected((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  }

  async function handleBatchReminders() {
    if (selected.size === 0) return;
    setSendingBatch(true);
    try {
      const res = await fetch('/api/renewals/reminders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_ids: Array.from(selected),
          interval_minutes: 5,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast.success(
        t('batchQueued', {
          count: data.queued,
          fallback: `${data.queued} lembrete(s) enfileirado(s)`,
        })
      );
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSendingBatch(false);
    }
  }

  async function handleCreatePayment() {
    if (!accountId || !newContactId || !newAmount) return;
    const dueAt = dateToIso(newDueDate) ?? new Date().toISOString();
    setSavingNew(true);
    try {
      const { error } = await createPayment(db, {
        accountId,
        contactId: newContactId,
        amount: Number(newAmount),
        method: newMethod,
        dueAt,
        notes: newNotes || undefined,
      });
      if (error) throw error;
      toast.success(t('paymentCreated'));
      setShowNewPayment(false);
      resetNewForm();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSavingNew(false);
    }
  }

  function resetNewForm() {
    setNewContactId('');
    setNewAmount('');
    setNewMethod('pix');
    setNewDueDate('');
    setNewNotes('');
    setContactQuery('');
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    setConfirming(true);
    try {
      const duration = confirmDuration ? Number(confirmDuration) : undefined;
      await completeRenewal(db, {
        paymentId: confirmTarget.id,
        durationDays: duration,
        notes: confirmNotes || undefined,
      });
      toast.success(t('renewalCompleted'));
      setConfirmTarget(null);
      setConfirmDuration('');
      setConfirmNotes('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setConfirming(false);
    }
  }

  // ---- render helpers -----------------------------------------------------
  function renderAgendaRow(p: Payment) {
    return (
      <li
        key={p.id}
        className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={selected.has(p.id)}
            onChange={() => toggleSelected(p.id)}
            className="border-border size-4 rounded accent-primary"
          />
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-medium">
              {p.contact?.name || p.contact?.phone || t('noContact')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('dueAt')} {formatDue(p.due_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant={p.status === 'late' ? 'destructive' : 'outline'}>
            {t(`status.${p.status}`)}
          </Badge>
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {formatCurrency(p.amount, defaultCurrency)}
          </span>
          <GatedButton
            canAct={canAct}
            gateReason={t('noPermission')}
            size="sm"
            variant="outline"
            onClick={() => {
              setConfirmTarget(p);
              setConfirmDuration('');
              setConfirmNotes('');
            }}
          >
            <CheckCircle2 className="size-4" />
            {t('confirmBtn')}
          </GatedButton>
        </div>
      </li>
    );
  }

  function renderAgenda(key: AgendaKey, icon: React.ReactNode) {
    const items = buckets[key];
    return (
      <section key={key} className="space-y-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-foreground text-sm font-semibold">
            {t(`agenda.${key}`)}
          </h3>
          <Badge variant="secondary" className="ml-auto">
            {items.length}
          </Badge>
        </div>
        {items.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
            {t('emptyBucket')}
          </p>
        ) : (
          <ul className="space-y-2">{items.map(renderAgendaRow)}</ul>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            {t('agendaTitle')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('agendaSub')}</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <GatedButton
              canAct={canAct}
              gateReason={t('noPermission')}
              onClick={handleBatchReminders}
              disabled={sendingBatch}
              variant="outline"
            >
              {sendingBatch ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t('sendReminders', {
                count: selected.size,
                fallback: `Enviar ${selected.size} lembrete(s)`,
              })}
            </GatedButton>
          )}
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            {selected.size === payments.length
              ? t('deselectAll', { fallback: 'Desmarcar todos' })
              : t('selectAll', { fallback: 'Selecionar todos' })}
          </button>
          <GatedButton
            canAct={canAct}
            gateReason={t('noPermission')}
            onClick={() => setShowNewPayment(true)}
          >
            <Plus className="size-4" />
            {t('registerPayment')}
          </GatedButton>
        </div>
      </div>

      {AGENDA_KEYS.map((key) =>
        renderAgenda(
          key,
          key === 'overdue' ? (
            <AlertCircleIcon className="text-destructive size-4" />
          ) : (
            <CalendarClock className="text-muted-foreground size-4" />
          )
        )
      )}

      {/* History */}
      <section className="space-y-2">
        <h3 className="text-foreground text-sm font-semibold">
          {t('history')}
        </h3>
        {renewals.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
            {t('emptyHistory')}
          </p>
        ) : (
          <ul className="space-y-2">
            {renewals.map((r) => (
              <li
                key={r.id}
                className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm font-medium">
                    {r.contact?.name || r.contact?.phone || t('noContact')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDue(r.created_at)} · {t('expiresAt')}{' '}
                    {formatDue(r.new_expires_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline">
                    {t(`renewalType.${r.renewal_type}`)}
                  </Badge>
                  <span className="text-foreground text-sm font-semibold tabular-nums">
                    {formatCurrency(r.amount, defaultCurrency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* New payment dialog */}
      <Dialog open={showNewPayment} onOpenChange={setShowNewPayment}>
        <DialogContent className="border-border bg-popover text-popover-foreground max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('registerPayment')}
            </DialogTitle>
            <DialogDescription>{t('registerPaymentSub')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('contact')}</Label>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder={t('searchContact')}
                  className="border-border bg-muted text-foreground pl-8"
                />
              </div>
              <div className="border-border max-h-40 space-y-1 overflow-y-auto rounded-lg border p-1">
                {filteredContacts.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-1 text-sm">
                    {t('noContacts')}
                  </p>
                ) : (
                  filteredContacts.map((c) => {
                    const active = c.id === newContactId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setNewContactId(c.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="truncate">
                          {c.name || c.phone || '—'}
                        </span>
                        {c.phone ? (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {c.phone}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('amount')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="0,00"
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('dueAt')}</Label>
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t('methodLabel')}
              </Label>
              <Select
                value={newMethod}
                onValueChange={(v) => setNewMethod(v as PaymentMethod)}
              >
                <SelectTrigger className="border-border bg-muted text-foreground w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`method.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('notes')}</Label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowNewPayment(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreatePayment}
              disabled={savingNew || !newContactId || !newAmount}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingNew ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm payment dialog */}
      <Dialog
        open={!!confirmTarget}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('confirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('confirmSub')}</DialogDescription>
          </DialogHeader>

          {confirmTarget ? (
            <div className="grid gap-4 py-2">
              <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
                <span className="text-muted-foreground text-sm">
                  {confirmTarget.contact?.name ||
                    confirmTarget.contact?.phone ||
                    t('noContact')}
                </span>
                <span className="text-foreground text-base font-bold tabular-nums">
                  {formatCurrency(confirmTarget.amount, defaultCurrency)}
                </span>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('duration')}</Label>
                <Select
                  value={confirmDuration}
                  onValueChange={(v) => setConfirmDuration(v ?? '')}
                >
                  <SelectTrigger className="border-border bg-muted text-foreground w-full">
                    <SelectValue placeholder={t('durationDefault')} />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {RENEWAL_DURATIONS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t('durationDays', { count: d })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {t('durationHint')}
                </p>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('notes')}</Label>
                <Textarea
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  rows={2}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmTarget(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={confirming}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {confirming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {t('confirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}
