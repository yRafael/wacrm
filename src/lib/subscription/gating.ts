// ============================================================
// Subscription gating for workspace access (doc §4)
//
// Decisões de produto (definidas após benchmark do mercado):
//  - Trial: 3 dias automático para novas contas
//  - Grace period: 3 dias em PAST_DUE antes de suspender
//  - Herança: contas criadas por revendedor herdam o status
//    do revendedor pai (modelo GoHighLevel — revendedor paga um
//    valor fixo, sub-cadastra clientes sem cobrança individual)
//
// Estados: TRIAL (liberado) | ACTIVE (liberado) |
// PAST_DUE (liberado + aviso) | SUSPENDED/CANCELED/EXPIRED (bloqueado)
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

// Estados que PERMITEM acesso ao workspace
export const ACCESSIBLE_SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
] as const;

// Estados que BLOQUEIAM o acesso
export const BLOCKED_SUBSCRIPTION_STATUSES = [
  'SUSPENDED',
  'CANCELED',
  'EXPIRED',
] as const;

export type SubscriptionStatus =
  | (typeof ACCESSIBLE_SUBSCRIPTION_STATUSES)[number]
  | (typeof BLOCKED_SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionCheck {
  hasAccess: boolean;
  status: SubscriptionStatus | null;
  /** ISO string or null */
  expiresAt: string | null;
  /** Nome do plano atual */
  planName: string | null;
  /** Motivo do bloqueio, se bloqueado */
  blockReason: string | null;
  /** Indica se é trial para mostrar countdown */
  isTrial: boolean;
}

import { GRACE_DAYS } from './constants';
// TRIAL_DURATION_DAYS is in src/lib/subscription/constants.ts.
// Here we only evaluate existing statuses.

/**
 * Verifica a assinatura de uma conta, considerando herança do revendedor pai.
 *
 * 1. Busca a subscription direta da conta.
 * 2. Se não tiver subscription (conta criada no Fire Control), herda da
 *    subscription do pai mais próximo (modelo de revenda).
 * 3. Avalia o status considerando trial/grace period.
 */
export async function checkSubscription(
  supabase: SupabaseClient,
  accountId: string
): Promise<SubscriptionCheck> {
  // First check direct subscription
  const { data: sub, error: subErr } = await supabase
    .from('platform_subscriptions')
    .select(
      `
      status,
      expires_at,
      started_at,
      plan:platform_plans!inner(name)
    `
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (subErr) {
    console.error('[checkSubscription] query error:', subErr);
  }

  if (sub) {
    return evaluateSubscription(sub);
  }

  // No direct subscription — inherit from parent reseller
  const { data: rel } = await supabase
    .from('account_relationships')
    .select('parent_account_id')
    .eq('child_account_id', accountId)
    .maybeSingle();

  if (!rel?.parent_account_id) {
    // No parent and no subscription. Only the PLATFORM internal
    // account (is_internal_account = true) gets unlimited access.
    // All other accounts without a subscription are blocked.
    const { data: account } = await supabase
      .from('accounts')
      .select('is_internal_account')
      .eq('id', accountId)
      .maybeSingle();

    if (account?.is_internal_account) {
      return {
        hasAccess: true,
        status: 'ACTIVE',
        expiresAt: null,
        planName: null,
        blockReason: null,
        isTrial: false,
      };
    }

    return {
      hasAccess: false,
      status: null,
      expiresAt: null,
      planName: null,
      blockReason: 'Nenhuma assinatura encontrada. Escolha um plano para continuar.',
      isTrial: false,
    };
  }

  // Walk up the tree until we find a subscription (parent is RESELLER+)
  return fetchInheritedSubscription(supabase, rel.parent_account_id);
}

/** Walk up the tree collecting each ancestor's subscription until found */
async function fetchInheritedSubscription(
  supabase: SupabaseClient,
  ancestorId: string
): Promise<SubscriptionCheck> {
  // Check ancestor's direct subscription
  const { data: sub } = await supabase
    .from('platform_subscriptions')
    .select(
      `
      status,
      expires_at,
      started_at,
      plan:platform_plans!inner(name)
    `
    )
    .eq('account_id', ancestorId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (sub) {
    return evaluateSubscription(sub);
  }

  // Go up one more level
  const { data: rel } = await supabase
    .from('account_relationships')
    .select('parent_account_id')
    .eq('child_account_id', ancestorId)
    .maybeSingle();

  if (!rel?.parent_account_id) {
    // Root reached without a subscription — block access.
    // Only the PLATFORM internal account bypasses this (handled in
    // the caller, checkSubscription, which is the only entry point).
    return {
      hasAccess: false,
      status: null,
      expiresAt: null,
      planName: null,
      blockReason: 'Assinatura do revendedor não encontrada.',
      isTrial: false,
    };
  }

  return fetchInheritedSubscription(supabase, rel.parent_account_id);
}

interface RawSubscription {
  status: string;
  expires_at: string | null;
  started_at: string;
  plan: unknown;
}

/**
 * Extracts the plan name from a nested select result.
 * Supabase returns `plan:platform_plans!inner(name)` as an array
 * when using `.maybeSingle()` (due to the join), so we handle both.
 */
function extractPlanName(planRaw: unknown): string | null {
  if (Array.isArray(planRaw) && planRaw.length > 0) {
    return typeof planRaw[0] === 'object' && planRaw[0] !== null
      ? (planRaw[0] as { name?: string }).name ?? null
      : null;
  }
  if (planRaw && typeof planRaw === 'object') {
    return (planRaw as { name?: string }).name ?? null;
  }
  return null;
}

/** Map a raw subscription row + business rules to a check result */
function evaluateSubscription(sub: RawSubscription): SubscriptionCheck {
  const status = sub.status as SubscriptionStatus;
  const isTrial = status === 'TRIAL';

  const blockedSet: readonly string[] = BLOCKED_SUBSCRIPTION_STATUSES;
  const isBlocked = blockedSet.includes(status as string);

  if (isBlocked) {
    let reason = 'Assinatura precisa ser regularizada.';
    if (status === 'CANCELED') reason = 'Assinatura cancelada.';
    if (status === 'EXPIRED') reason = 'Período de teste ou assinatura expirado.';
    if (status === 'SUSPENDED') reason = 'Assinatura suspensa por inadimplência.';

    return {
      hasAccess: false,
      status,
      expiresAt: sub.expires_at,
      planName: extractPlanName(sub.plan),
      blockReason: reason,
      isTrial,
    };
  }

  // ACTIVE or PAST_DUE or TRIAL — check expiry
  if (sub.expires_at) {
    const now = Date.now();
    const expiry = new Date(sub.expires_at).getTime();

    if (expiry <= now) {
      // Past expiry — if PAST_DUE and within grace, still allow
      if (status === 'PAST_DUE') {
        const graceEnd = expiry + GRACE_DAYS * 86400000;
        if (now <= graceEnd) {
          return {
            hasAccess: true,
            status: 'PAST_DUE',
            expiresAt: sub.expires_at,
             planName: extractPlanName(sub.plan),
            blockReason: `Pagamento em atraso. Acesso liberado por ${GRACE_DAYS} dias de carência.`,
            isTrial,
          };
        }
      }
      // Expired
      return {
        hasAccess: false,
        status: status === 'PAST_DUE' ? 'EXPIRED' : status,
        expiresAt: sub.expires_at,
        planName: extractPlanName(sub.plan),
        blockReason: 'Assinatura expirada.',
        isTrial,
      };
    }
  }

  return {
    hasAccess: true,
    status,
    expiresAt: sub.expires_at,
    planName: extractPlanName(sub.plan),
    blockReason: null,
    isTrial,
  };
}

/**
 * Server-side helper for pages that need to gate access.
 * Throws a redirect-able result; the page catches and shows the lock screen.
 */
export async function requireActiveSubscription(accountId: string): Promise<SubscriptionCheck> {
  const supabase = supabaseAdmin();
  return checkSubscription(supabase, accountId);
}
