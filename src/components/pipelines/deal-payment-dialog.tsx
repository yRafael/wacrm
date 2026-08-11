'use client';

// ============================================================
// DealPaymentDialog — "Registrar pagamento" for a pipeline deal.
//
// Reuses the same `createPayment` gateway as the renewals agenda so a
// recorded payment lands in the SAME receivable pool the /renewals
// screen reads from. Opening a receivable (status pending) is the manual
// lead->money step; completing it stays the renewals flow's job.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { createPayment } from '@/lib/iptv/renewals';
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
import type { Deal, PaymentMethod } from '@/types';

const METHODS: PaymentMethod[] = [
  'pix',
  'cash',
  'card',
  'transfer',
  'boleto',
  'credit',
];

function dateToIso(dateValue: string): string | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface DealPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  /** Called after the payment row is saved (moves the deal to Convertido). */
  onPaymentRecorded: (dealId: string) => void | Promise<void>;
}

export function DealPaymentDialog({
  open,
  onOpenChange,
  deal,
  onPaymentRecorded,
}: DealPaymentDialogProps) {
  const t = useTranslations('Pipelines.payment');
  const { accountId } = useAuth();
  const db = createClient();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset the form every time the dialog (re)opens with a deal.
  useEffect(() => {
    if (!open) return;
    setAmount(deal?.value ? String(deal.value) : '');
    setMethod('pix');
    setDueAt(new Date().toISOString().slice(0, 10));
    setNotes('');
  }, [open, deal]);

  const contactLabel =
    deal?.contact?.name || deal?.contact?.phone || t('unknownContact');

  async function handleSave() {
    if (!accountId || !deal?.contact_id || !amount) return;
    setSaving(true);
    try {
      const dueAtIso = dateToIso(dueAt) ?? new Date().toISOString();
      const { error } = await createPayment(db, {
        accountId,
        contactId: deal.contact_id,
        amount: Number(amount),
        method,
        dueAt: dueAtIso,
        notes: notes || undefined,
      });
      if (error) throw error;
      toast.success(t('toastSaved'));
      onOpenChange(false);
      await onPaymentRecorded(deal.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('toastFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Deal context */}
          <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
            <span className="text-foreground min-w-0 truncate text-sm font-medium">
              {deal?.title ?? '-'}
            </span>
            <span className="text-muted-foreground ml-3 shrink-0 text-xs">
              {contactLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('amount')}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('dueAt')}</Label>
              <Input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('methodLabel')}</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="border-border bg-muted text-foreground"
            />
          </div>
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
            disabled={saving || !amount || !deal?.contact_id}
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
