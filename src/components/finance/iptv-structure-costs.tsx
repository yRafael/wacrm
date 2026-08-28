'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Server,
  Trash2,
  Monitor,
  HelpCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrency } from '@/lib/currency';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  type StructureCost,
  type StructureCostType,
  monthlyEquivalent,
  totalMonthlyCost,
  costByType,
} from '@/lib/iptv/finance';

const TYPE_ICONS: Record<StructureCostType, React.ReactNode> = {
  server: <Server className="size-4" />,
  panel: <Monitor className="size-4" />,
  other: <HelpCircle className="size-4" />,
};

const TYPE_LABELS: Record<StructureCostType, string> = {
  server: 'Servidor',
  panel: 'Painel',
  other: 'Outro',
};

export function IptvStructureCosts() {
  const t = useTranslations('Finance.structure');
  const { accountId, defaultCurrency } = useAuth();
  const canManage = useCan('edit-settings');
  const db = createClient();

  const [costs, setCosts] = useState<StructureCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Add form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<StructureCostType>('server');
  const [newAmount, setNewAmount] = useState('');
  const [newCycle, setNewCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [newCapacity, setNewCapacity] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await db
      .from('iptv_structure_costs')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[iptv-costs] load failed:', error.message);
    }
    setCosts((data as StructureCost[]) ?? []);
    setLoading(false);
  }, [accountId, db]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const total = totalMonthlyCost(costs);
    const byType = costByType(costs);
    return { total, byType };
  }, [costs]);

  async function handleAdd() {
    if (!accountId || !newName.trim() || !newAmount) return;
    setSaving(true);
    try {
      const { error } = await db.from('iptv_structure_costs').insert({
        account_id: accountId,
        name: newName.trim(),
        type: newType,
        amount: Number(newAmount),
        billing_cycle: newCycle,
        capacity: newCapacity ? Number(newCapacity) : null,
        notes: newNotes.trim() || null,
      });
      if (error) throw error;
      toast.success(t('created'));
      setShowAdd(false);
      resetForm();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const { error } = await db
      .from('iptv_structure_costs')
      .delete()
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCosts((prev) => prev.filter((c) => c.id !== id));
    toast.success(t('deleted'));
  }

  function resetForm() {
    setNewName('');
    setNewType('server');
    setNewAmount('');
    setNewCycle('monthly');
    setNewCapacity('');
    setNewNotes('');
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('totalMonthlyCost')}
          value={formatCurrency(summary.total, defaultCurrency)}
          icon={Server}
        />
        <MetricCard
          title={t('servers')}
          value={formatCurrency(summary.byType.server, defaultCurrency)}
          icon={Server}
        />
        <MetricCard
          title={t('panels')}
          value={formatCurrency(summary.byType.panel, defaultCurrency)}
          icon={Monitor}
        />
        <MetricCard
          title={t('others')}
          value={formatCurrency(summary.byType.other, defaultCurrency)}
          icon={HelpCircle}
        />
      </div>

      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {t('costsTitle')}
          </h3>
          <p className="text-muted-foreground text-xs">{t('costsSub')}</p>
        </div>
        <GatedButton
          canAct={canManage}
          gateReason={t('noPermission')}
          onClick={() => setShowAdd(true)}
          size="sm"
        >
          <Plus className="size-4" />
          {t('addCost')}
        </GatedButton>
      </div>

      {/* Costs list */}
      {costs.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs tracking-wider uppercase">
                  <th className="px-4 py-3 font-medium">{t('colName')}</th>
                  <th className="px-4 py-3 font-medium">{t('colType')}</th>
                  <th className="px-4 py-3 font-medium">{t('colCost')}</th>
                  <th className="px-4 py-3 font-medium">{t('colCycle')}</th>
                  <th className="px-4 py-3 font-medium">{t('colMonthly')}</th>
                  <th className="px-4 py-3 font-medium">{t('colCapacity')}</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr
                    key={c.id}
                    className="border-border/60 hover:bg-muted/40 border-b last:border-0"
                  >
                    <td className="px-4 py-3">
                      <span className="text-foreground flex items-center gap-2 font-medium">
                        {TYPE_ICONS[c.type]}
                        {c.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{TYPE_LABELS[c.type]}</Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {formatCurrency(c.amount, defaultCurrency)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {c.billing_cycle === 'monthly' ? 'Mensal' : 'Anual'}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {formatCurrency(monthlyEquivalent(c), defaultCurrency)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {c.capacity != null ? `${c.capacity} créditos` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && (
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('addCost')}
            </DialogTitle>
            <DialogDescription>{t('addCostSub')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('colName')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Servidor A"
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('colType')}</Label>
                <Select
                  value={newType}
                  onValueChange={(v) => setNewType(v as StructureCostType)}
                >
                  <SelectTrigger className="bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="server">Servidor</SelectItem>
                    <SelectItem value="panel">Painel</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t('colCycle')}</Label>
                <Select
                  value={newCycle}
                  onValueChange={(v) =>
                    setNewCycle(v as 'monthly' | 'yearly')
                  }
                >
                  <SelectTrigger className="bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('colCost')} (R$)
                </Label>
                <Input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="300"
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t('colCapacity')}
                </Label>
                <Input
                  type="number"
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(e.target.value)}
                  placeholder="500"
                  className="bg-muted border-border text-foreground"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t('notes', { fallback: 'Notas' })}
              </Label>
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder={t('notesPlaceholder', {
                  fallback: 'Opcional',
                })}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAdd(false)}
              className="border-border"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!newName.trim() || !newAmount || saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t('addCost')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
