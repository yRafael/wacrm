'use client';

// ============================================================
// QuickActions — the "⚡ Ações" operational panel in the thread
// header.
//
// One dropdown entry point to the manual pipeline actions:
//   👤 Marcar como Lead   🧪 Colocar em teste   💰 Registrar pagamento
//   🔄 Registrar renovação 📺 Alterar servidor   📦 Alterar plano
//   📅 Agendar renovação
//
// Every action writes through RLS (agent+), toasts its outcome and
// asks the thread to refetch the client stats — so the header pills,
// the subscription card and the /pipelines board reflect the change
// without the operator ever leaving the conversation.
//
// User restriction: a lead is only ever created automatically for a
// brand-new contact (wasCreated). Everything in this menu IS the
// manual stage movement the user asked for — nothing here classifies
// by conversation content.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Banknote,
  CalendarClock,
  ChevronDown,
  FlaskConical,
  Loader2,
  Package,
  RefreshCw,
  Server as ServerIcon,
  UserPlus,
  Zap,
} from 'lucide-react';
import { addDays, format } from 'date-fns';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { usePlans } from '@/hooks/use-plans';
import {
  ensureContactLead,
  findStageByName,
  moveDealToStage,
  moveDealToConvertido,
} from '@/lib/pipeline/contact-deal';
import { applyPlanToCredential } from '@/lib/iptv/plans';
import { applyServerToCredential, listServers } from '@/lib/iptv/servers';
import {
  createPayment,
  completeRenewal,
  RENEWAL_DURATIONS,
} from '@/lib/iptv/renewals';
import { formatCurrency } from '@/lib/currency';
import type { ClientStats } from '@/lib/iptv/client-stats';
import type { Contact, Deal, Server } from '@/types';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { DealPaymentDialog } from '@/components/pipelines/deal-payment-dialog';

function dateToIso(dateValue: string): string | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return format(new Date(iso), 'MMM d, yyyy');
}

// ============================================================
// 🔄 Registrar renovação — pays the next open receivable via the
// `complete_renewal` RPC. Requires an active credential AND a
// pending receivable (there's nothing to pay otherwise); the dialog
// explains which one is missing instead of silently failing.
// ============================================================

interface RenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | undefined;
  stats: ClientStats | null;
  currency: string;
  onRenewed: () => void;
}

function RenewalDialog({
  open,
  onOpenChange,
  accountId,
  stats,
  currency,
  onRenewed,
}: RenewalDialogProps) {
  const t = useTranslations('Inbox.quickActions');
  const db = createClient();
  const [durationDays, setDurationDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const plans = usePlans(accountId);

  const receivable = stats?.nextDuePayment ?? null;
  const credential = stats?.credential ?? null;

  // Reset the form every time the dialog (re)opens. Duration defaults
  // to the credential's current span (the "same as before" renewal).
  useEffect(() => {
    if (!open) return;
    setNotes('');
    setSaving(false);
    setDurationDays(credential?.duration_days ?? 30);
  }, [open, credential]);

  const durationOptions =
    plans.length > 0
      ? Array.from(new Set(plans.map((p) => p.duration_days)))
      : [...RENEWAL_DURATIONS];

  async function handleSave() {
    if (!receivable) return;
    setSaving(true);
    try {
      await completeRenewal(db, {
        paymentId: receivable.id,
        durationDays,
        notes: notes || undefined,
      });
      toast.success(t('renewSuccess'));
      onOpenChange(false);
      onRenewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('renewFailed'));
    } finally {
      setSaving(false);
    }
  }

  const blocked = !credential || !receivable;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('renewTitle')}
          </DialogTitle>
          <DialogDescription>{t('renewSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {!credential ? (
            <p className="text-muted-foreground text-sm">
              {t('renewNoCredential')}
            </p>
          ) : !receivable ? (
            <p className="text-muted-foreground text-sm">
              {t('renewNoReceivable')}
            </p>
          ) : (
            <>
              <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
                <span className="text-muted-foreground text-sm">
                  {t('renewReceivable')}
                </span>
                <div className="text-right">
                  <p className="text-foreground text-sm font-medium">
                    {formatCurrency(receivable.amount, currency)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {fmtDate(receivable.due_at)}
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('duration')}</Label>
                <Select
                  value={String(durationDays)}
                  onValueChange={(v) => setDurationDays(Number(v))}
                >
                  <SelectTrigger className="border-border bg-muted text-foreground w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {durationOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t('durationDays', { days: d })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('notes')}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || blocked}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('renewAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 📺 Alterar servidor — pick a company server from the catalog and
// assign it to the contact's active credential.
// ============================================================

interface ServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | undefined;
  contactId: string;
  stats: ClientStats | null;
  onChanged: () => void;
}

function ServerDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  stats,
  onChanged,
}: ServerDialogProps) {
  const t = useTranslations('Inbox.quickActions');
  const db = createClient();
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    setSaving(false);
    setServerId(stats?.credential?.server_id ?? '');
    let cancelled = false;
    listServers(db, accountId).then((s) => {
      if (!cancelled) setServers(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId, stats, db]);

  const credential = stats?.credential ?? null;

  async function handleSave() {
    if (!accountId || !serverId) return;
    setSaving(true);
    try {
      const { error } = await applyServerToCredential(db, {
        accountId,
        contactId,
        serverId,
      });
      if (error) throw error;
      toast.success(t('serverSuccess'));
      onOpenChange(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('serverFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('serverTitle')}
          </DialogTitle>
          <DialogDescription>{t('serverSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {!credential ? (
            <p className="text-muted-foreground text-sm">
              {t('renewNoCredential')}
            </p>
          ) : servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('serverEmpty')}</p>
          ) : (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t('serverCurrent')}
              </Label>
              <Select
                value={serverId}
                onValueChange={(v) => {
                  if (v !== null) setServerId(v);
                }}
              >
                <SelectTrigger className="border-border bg-muted text-foreground w-full">
                  <SelectValue placeholder={t('choose')} />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              saving || !credential || servers.length === 0 || !serverId
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 📦 Alterar plano — pick a company plan from the catalog and assign
// it to the active credential, keeping `duration_days` in lockstep
// with the plan's span (the renewal period).
// ============================================================

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | undefined;
  contactId: string;
  stats: ClientStats | null;
  onChanged: () => void;
}

function PlanDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  stats,
  onChanged,
}: PlanDialogProps) {
  const t = useTranslations('Inbox.quickActions');
  const db = createClient();
  const [planId, setPlanId] = useState('');
  const [saving, setSaving] = useState(false);
  const plans = usePlans(accountId);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setPlanId(stats?.credential?.plan_id ?? '');
  }, [open, stats]);

  const credential = stats?.credential ?? null;

  async function handleSave() {
    if (!accountId || !planId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setSaving(true);
    try {
      const { error } = await applyPlanToCredential(db, {
        accountId,
        contactId,
        planId,
        durationDays: plan.duration_days,
      });
      if (error) throw error;
      toast.success(t('planSuccess'));
      onOpenChange(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('planFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('planTitle')}
          </DialogTitle>
          <DialogDescription>{t('planSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {!credential ? (
            <p className="text-muted-foreground text-sm">
              {t('renewNoCredential')}
            </p>
          ) : plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('planEmpty')}</p>
          ) : (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t('planCurrent')}
              </Label>
              <Select
                value={planId}
                onValueChange={(v) => {
                  if (v !== null) setPlanId(v);
                }}
              >
                <SelectTrigger className="border-border bg-muted text-foreground w-full">
                  <SelectValue placeholder={t('choose')} />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {t('durationDays', { days: p.duration_days })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !credential || plans.length === 0 || !planId}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 📅 Agendar renovação — open a receivable (a "conta a receber")
// due at today + the chosen plan's span. Lands in the /renewals
// agenda and the future payment appears in the subscription card.
// ============================================================

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | undefined;
  contactId: string;
  currency: string;
  onScheduled: () => void;
}

function ScheduleDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  currency,
  onScheduled,
}: ScheduleDialogProps) {
  const t = useTranslations('Inbox.quickActions');
  const db = createClient();
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const plans = usePlans(accountId);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setNotes('');
    const first = plans[0];
    if (first) {
      setPlanId(first.id);
      setAmount(first.price ? String(first.price) : '');
      setDueAt(
        addDays(new Date(), first.duration_days).toISOString().slice(0, 10)
      );
    } else {
      setPlanId('');
      setAmount('');
      setDueAt('');
    }
  }, [open, plans]);

  function handlePlanChange(id: string | null) {
    if (!id) return;
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan) {
      setAmount(plan.price ? String(plan.price) : '');
      setDueAt(
        addDays(new Date(), plan.duration_days).toISOString().slice(0, 10)
      );
    }
  }

  async function handleSave() {
    if (!accountId || !planId || !amount || !dueAt) return;
    setSaving(true);
    try {
      const dueAtIso = dateToIso(dueAt) ?? new Date().toISOString();
      const { error } = await createPayment(db, {
        accountId,
        contactId,
        amount: Number(amount),
        method: 'pix',
        dueAt: dueAtIso,
        notes: notes || undefined,
      });
      if (error) throw error;
      toast.success(t('scheduleSuccess'));
      onOpenChange(false);
      onScheduled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('scheduleFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('scheduleTitle')}
          </DialogTitle>
          <DialogDescription>{t('scheduleSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('planEmpty')}</p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('schedulePlan')}
                </Label>
                <Select value={planId} onValueChange={handlePlanChange}>
                  <SelectTrigger className="border-border bg-muted text-foreground w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ·{' '}
                        {t('durationDays', { days: p.duration_days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {t('scheduleAmount')}
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={currency}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {t('scheduleDueAt')}
                  </Label>
                  <Input
                    type="date"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('notes')}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || plans.length === 0 || !amount || !dueAt}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// The dropdown — gates the whole panel on agent+ (same tier that
// can create deals / send messages) and drives the dialogs above.
// ============================================================

interface QuickActionsProps {
  contact: Contact | null;
  stats: ClientStats | null;
  onStatsChanged: () => void;
}

export function QuickActions({
  contact,
  stats,
  onStatsChanged,
}: QuickActionsProps) {
  const t = useTranslations('Inbox.quickActions');
  const { user, accountId, defaultCurrency } = useAuth();
  const canAct = useCan('send-messages');
  const db = createClient();

  const [busy, setBusy] = useState(false);
  const [payingDeal, setPayingDeal] = useState<Deal | null>(null);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // DealPaymentDialog already toasts the receivable save; we then move
  // the deal to Convertido (fires the on_deal_converted trigger).
  const handlePaymentRecorded = useCallback(async () => {
    if (!payingDeal) return;
    const res = await moveDealToConvertido(db, payingDeal);
    onStatsChanged();
    if (res.moved) {
      toast.success(t('payConverted'));
    } else if (res.error === 'no-convertido-stage') {
      toast.warning(t('noConvertidoStage'));
    } else {
      toast.error(res.error || t('convertFailed'));
    }
    setPayingDeal(null);
  }, [payingDeal, onStatsChanged, t, db]);

  // Viewers see the header Plano field (read-only) but not the panel.
  if (!canAct || !contact) return null;

  async function handleMarkLead() {
    if (!accountId || !user?.id || !contact) return;
    setBusy(true);
    try {
      const deal = await ensureContactLead(db, accountId, user.id, contact);
      if (!deal) {
        toast.warning(t('noLeadsPipeline'));
        return;
      }
      toast.success(t('leadSuccess'));
      onStatsChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!accountId || !user?.id || !contact) return;
    setBusy(true);
    try {
      const deal = await ensureContactLead(db, accountId, user.id, contact);
      if (!deal) {
        toast.warning(t('noLeadsPipeline'));
        return;
      }
      const stage = await findStageByName(db, deal.pipeline_id, 'Em Teste');
      if (!stage) {
        toast.warning(t('testNoStage'));
        return;
      }
      const { error } = await moveDealToStage(db, deal.id, stage.id);
      if (error) {
        toast.error(t('testFailed'));
        return;
      }
      toast.success(t('testSuccess'));
      onStatsChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handlePay() {
    if (!accountId || !user?.id || !contact) return;
    setBusy(true);
    try {
      const deal = await ensureContactLead(db, accountId, user.id, contact);
      if (!deal) {
        toast.warning(t('noLeadsPipeline'));
        return;
      }
      setPayingDeal(deal);
      setPayDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const hasCredential = Boolean(stats?.credential);
  const hasReceivable = Boolean(stats?.nextDuePayment);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          className="text-muted-foreground hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs"
        >
          <Zap className="text-primary h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('title')}</span>
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-border bg-popover">
          <DropdownMenuItem onClick={handleMarkLead} disabled={busy}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('lead')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTest} disabled={busy}>
            <FlaskConical className="mr-2 h-4 w-4" />
            {t('test')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePay} disabled={busy}>
            <Banknote className="mr-2 h-4 w-4" />
            {t('pay')}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-border" />

          <DropdownMenuItem
            onClick={() => setRenewOpen(true)}
            disabled={busy || !hasCredential || !hasReceivable}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('renew')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setServerOpen(true)}
            disabled={busy || !hasCredential}
          >
            <ServerIcon className="mr-2 h-4 w-4" />
            {t('server')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setPlanOpen(true)}
            disabled={busy || !hasCredential}
          >
            <Package className="mr-2 h-4 w-4" />
            {t('plan')}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-border" />

          <DropdownMenuItem
            onClick={() => setScheduleOpen(true)}
            disabled={busy}
          >
            <CalendarClock className="mr-2 h-4 w-4" />
            {t('schedule')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DealPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        deal={payingDeal}
        onPaymentRecorded={handlePaymentRecorded}
      />
      <RenewalDialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        accountId={accountId ?? undefined}
        stats={stats}
        currency={defaultCurrency}
        onRenewed={onStatsChanged}
      />
      <ServerDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        accountId={accountId ?? undefined}
        contactId={contact.id}
        stats={stats}
        onChanged={onStatsChanged}
      />
      <PlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        accountId={accountId ?? undefined}
        contactId={contact.id}
        stats={stats}
        onChanged={onStatsChanged}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        accountId={accountId ?? undefined}
        contactId={contact.id}
        currency={defaultCurrency}
        onScheduled={onStatsChanged}
      />
    </>
  );
}
