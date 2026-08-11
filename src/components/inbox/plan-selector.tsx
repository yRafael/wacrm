'use client';

// ============================================================
// PlanSelector — the "Plano [Mensal ▼]" field in the thread header.
//
// Compact dropdown next to ⚡ Ações, styled like the status/assign
// dropdowns. Reads the account's plan catalog (usePlans — cached, and
// fires ensure_default_plans on first load) and shows the credential's
// current plan resolved through resolvePlanName (catalog match wins;
// duration fallback for pre-catalog rows).
//
// Changing the plan writes plan_id + duration_days on the active
// credential via RLS (agent+), then asks the thread to refetch stats
// so the header, the subscription card and the sidebar agree. Viewers
// (no send-messages) see the current plan as a read-only pill.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ChevronDown, Loader2, Package } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { usePlans } from '@/hooks/use-plans';
import { applyPlanToCredential, resolvePlanName } from '@/lib/iptv/plans';
import { cn } from '@/lib/utils';
import type { ClientStats } from '@/lib/iptv/client-stats';
import type { Contact, Plan } from '@/types';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PlanSelectorProps {
  contact: Contact | null;
  stats: ClientStats | null;
  onStatsChanged: () => void;
}

export function PlanSelector({
  contact,
  stats,
  onStatsChanged,
}: PlanSelectorProps) {
  const t = useTranslations('Inbox.quickActions');
  const { accountId } = useAuth();
  const canAct = useCan('send-messages');
  const plans = usePlans(accountId ?? undefined);
  const db = createClient();
  const [saving, setSaving] = useState(false);

  const credential = stats?.credential ?? null;
  const currentPlanId = credential?.plan_id ?? null;
  const planName = resolvePlanName(credential, plans);
  const hasCredential = Boolean(credential);

  async function handleChange(plan: Plan) {
    if (!accountId || !contact || !hasCredential) return;
    setSaving(true);
    try {
      const { error } = await applyPlanToCredential(db, {
        accountId,
        contactId: contact.id,
        planId: plan.id,
        durationDays: plan.duration_days,
      });
      if (error) throw error;
      toast.success(t('planSuccess'));
      onStatsChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('planFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Viewers get a read-only pill — same visual weight as the agents'
  // trigger so the header doesn't jump between roles.
  if (!canAct) {
    return (
      <span
        title={t('planTitle')}
        className={cn(
          'text-muted-foreground inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs',
          hasCredential && 'text-primary'
        )}
      >
        <Package className="h-3 w-3" />
        <span className="hidden sm:inline">{planName ?? t('none')}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={saving || !hasCredential}
        title={t('planTitle')}
        className={cn(
          'text-muted-foreground hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs disabled:opacity-60',
          hasCredential && 'text-primary'
        )}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Package className="h-3 w-3" />
        )}
        <span className="hidden sm:inline">{planName ?? t('none')}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {plans.length === 0 ? (
          <DropdownMenuItem disabled className="text-muted-foreground text-sm">
            {t('none')}
          </DropdownMenuItem>
        ) : (
          plans.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => handleChange(p)}
              disabled={saving}
              className={cn(
                'text-sm',
                p.id === currentPlanId
                  ? 'text-primary'
                  : 'text-popover-foreground'
              )}
            >
              <span className="flex-1">{p.name}</span>
              {p.id === currentPlanId && <Check className="ml-2 h-3 w-3" />}
            </DropdownMenuItem>
          ))
        )}
        {plans.length > 0 && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              disabled
              className="text-muted-foreground text-xs"
            >
              {t('planSubtitle')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
