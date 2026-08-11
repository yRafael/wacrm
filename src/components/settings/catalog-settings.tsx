'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Boxes, Loader2, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { FALLBACK_PLAN_LABEL_BY_DAYS, listPlans } from '@/lib/iptv/plans';
import { listServers } from '@/lib/iptv/servers';
import { formatCurrency } from '@/lib/currency';
import type { Plan, Server } from '@/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

// The renewal spans a plan can carry — mirrors RENEWAL_DURATIONS so the
// catalog and the complete_renewal RPC agree on what "one span" means.
const DURATION_CHOICES = [30, 90, 180, 365] as const;

const fieldClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Catalog settings — the company's plans and servers (migration 043).
 *
 * The multi-tenant catalogs behind the conversation header's "Plano
 * [Mensal ▼]" selector and ⚡ Ações → 📺/📦. Every row is scoped by
 * account_id and RLS (is_account_member), so each company edits only its
 * own catalog. Writes are settings-tier (is_account_member(account_id,
 * 'admin')), gated here by canEditSettings; reads go through
 * listPlans/listServers with includeInactive so admins can re-enable a
 * row. Following the deals-settings.tsx pattern: Cards + direct table
 * writes + reload after each mutation.
 */
export function CatalogSettings() {
  const t = useTranslations('Settings.catalog');
  const { accountId, defaultCurrency, canEditSettings } = useAuth();
  const supabase = createClient();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingServer, setSavingServer] = useState(false);

  // Add-plan form state
  const [planName, setPlanName] = useState('');
  const [planDays, setPlanDays] = useState<number>(30);
  const [planPrice, setPlanPrice] = useState('');
  // Add-server form state
  const [serverName, setServerName] = useState('');

  // Cadeia de .then() (não async/await): o setState fica dentro dos
  // callbacks, fora do caminho da regra react-hooks/set-state-in-effect
  // (mesmo padrão do fire-hero/dashboard page). O retorno continua uma
  // Promise, então os chamadores seguem usando await/void normalmente.
  const reload = useCallback(() => {
    if (!accountId) return Promise.resolve();
    return Promise.all([
      listPlans(supabase, accountId, { includeInactive: true }),
      listServers(supabase, accountId, { includeInactive: true }),
    ]).then(([p, s]) => {
      setPlans(p);
      setServers(s);
      setLoading(false);
    });
  }, [accountId, supabase]);

  // Load on mount.
  useEffect(() => {
    void reload();
  }, [reload]);

  // ---- Plans ----

  async function handleAddPlan(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !planName.trim()) return;
    setSavingPlan(true);
    const raw = planPrice.trim();
    const price = raw === '' ? null : Number(raw);
    const sortOrder =
      plans.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
    const { error } = await supabase.from('plans').insert({
      account_id: accountId,
      name: planName.trim(),
      duration_days: planDays,
      price: price !== null && !Number.isNaN(price) ? price : null,
      sort_order: sortOrder,
    });
    if (error) {
      toast.error(t('addFailed'));
    } else {
      toast.success(t('planAdded'));
      setPlanName('');
      setPlanPrice('');
      await reload();
    }
    setSavingPlan(false);
  }

  async function togglePlan(p: Plan) {
    const { error } = await supabase
      .from('plans')
      .update({
        is_active: !p.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id);
    if (error) toast.error(t('saveFailed'));
    else await reload();
  }

  async function deletePlan(p: Plan) {
    if (!window.confirm(t('deleteConfirm'))) return;
    const { error } = await supabase.from('plans').delete().eq('id', p.id);
    if (error) toast.error(t('deleteFailed'));
    else {
      toast.success(t('deleted'));
      await reload();
    }
  }

  // ---- Servers ----

  async function handleAddServer(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !serverName.trim()) return;
    setSavingServer(true);
    const sortOrder =
      servers.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1;
    const { error } = await supabase.from('servers').insert({
      account_id: accountId,
      name: serverName.trim(),
      sort_order: sortOrder,
    });
    if (error) {
      toast.error(t('addFailed'));
    } else {
      toast.success(t('serverAdded'));
      setServerName('');
      await reload();
    }
    setSavingServer(false);
  }

  async function toggleServer(s: Server) {
    const { error } = await supabase
      .from('servers')
      .update({
        is_active: !s.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', s.id);
    if (error) toast.error(t('saveFailed'));
    else await reload();
  }

  async function deleteServer(s: Server) {
    if (!window.confirm(t('deleteConfirm'))) return;
    const { error } = await supabase.from('servers').delete().eq('id', s.id);
    if (error) toast.error(t('deleteFailed'));
    else {
      toast.success(t('deleted'));
      await reload();
    }
  }

  const canWrite = canEditSettings && !loading;

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEditSettings && (
        <p className="text-muted-foreground mb-4 text-xs">
          {t('adminOnlyHint')}
        </p>
      )}

      {/* Plans */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Boxes className="text-primary size-4" />
            {t('plans')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('plansDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t('loading')}
            </div>
          ) : plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noPlans')}</p>
          ) : (
            <ul className="divide-border divide-y">
              {plans.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">
                      {p.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {FALLBACK_PLAN_LABEL_BY_DAYS[p.duration_days] ??
                        `${p.duration_days} ${t('days')}`}
                      {p.price != null
                        ? ` · ${formatCurrency(p.price, defaultCurrency)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={p.is_active}
                      onCheckedChange={() => togglePlan(p)}
                      disabled={!canWrite}
                      aria-label={p.is_active ? t('active') : t('inactive')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deletePlan(p)}
                      disabled={!canWrite}
                      aria-label={t('delete')}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEditSettings && (
            <form
              onSubmit={handleAddPlan}
              className="border-border mt-2 space-y-3 rounded-lg border border-dashed p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                <input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder={t('planNamePlaceholder')}
                  className={fieldClass}
                  disabled={savingPlan}
                />
                <select
                  value={planDays}
                  onChange={(e) => setPlanDays(Number(e.target.value))}
                  className={fieldClass}
                  disabled={savingPlan}
                  aria-label={t('duration')}
                >
                  {DURATION_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {FALLBACK_PLAN_LABEL_BY_DAYS[d]} · {d} {t('days')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  placeholder={t('pricePlaceholder')}
                  className={fieldClass}
                  disabled={savingPlan}
                />
                <Button
                  type="submit"
                  disabled={savingPlan || !planName.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                >
                  {savingPlan ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {t('addPlan')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Servers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Boxes className="text-primary size-4" />
            {t('servers')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('serversDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t('loading')}
            </div>
          ) : servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noServers')}</p>
          ) : (
            <ul className="divide-border divide-y">
              {servers.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <p className="text-foreground min-w-0 text-sm font-medium">
                    {s.name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={s.is_active}
                      onCheckedChange={() => toggleServer(s)}
                      disabled={!canWrite}
                      aria-label={s.is_active ? t('active') : t('inactive')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteServer(s)}
                      disabled={!canWrite}
                      aria-label={t('delete')}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEditSettings && (
            <form
              onSubmit={handleAddServer}
              className="border-border mt-2 flex items-center gap-2 rounded-lg border border-dashed p-3"
            >
              <input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder={t('serverNamePlaceholder')}
                className={fieldClass}
                disabled={savingServer}
              />
              <Button
                type="submit"
                disabled={savingServer || !serverName.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                {savingServer ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t('addServer')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
