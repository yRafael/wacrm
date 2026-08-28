// ============================================================
// Mercado Pago payment provider
//
// Implements the PaymentProvider interface for Mercado Pago
// recurring subscriptions (preapproval API).
//
// Uses the Mercado Pago SDK v3 (mercadopago npm package).
// Supports per-account credentials (059_mp_credentials) with
// fallback to global MERCADO_PAGO_ACCESS_TOKEN.
// ============================================================

import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import type { PaymentProvider, CreateCheckoutResult, WebhookResult } from './provider';
import type { SubscriptionStatus } from '@/lib/subscription/gating';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * Resolve the MP access token for a given account.
 * 1. Check `account_mercado_pago_credentials` for per-account token
 * 2. Fall back to global `MERCADO_PAGO_ACCESS_TOKEN`
 *
 * Returns `{ token, webhookSecret }`.
 */
async function resolveCredentials(
  accountId?: string
): Promise<{ token: string; webhookSecret: string | null }> {
  if (accountId) {
    const admin = supabaseAdmin();
    const { data: cred } = await admin
      .from('account_mercado_pago_credentials')
      .select('access_token_encrypted, webhook_secret_encrypted')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .maybeSingle();

    if (cred) {
      try {
        return {
          token: decrypt(cred.access_token_encrypted),
          webhookSecret: cred.webhook_secret_encrypted
            ? decrypt(cred.webhook_secret_encrypted)
            : null,
        };
      } catch {
        console.error(`[mercado-pago] Failed to decrypt credentials for account ${accountId}`);
      }
    }
  }

  // Fallback to global env token
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not configured');
  }
  return { token, webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET ?? null };
}

/**
 * Get a MercadoPagoConfig client for a specific account (or global).
 */
async function getClientForAccount(accountId?: string): Promise<MercadoPagoConfig> {
  const { token } = await resolveCredentials(accountId);
  return new MercadoPagoConfig({
    accessToken: token,
    options: { timeout: 10000 },
  });
}

function getClient(): MercadoPagoConfig {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not configured');
  }
  return new MercadoPagoConfig({
    accessToken: token,
    options: { timeout: 10000 },
  });
}

/**
 * Validate Mercado Pago webhook signature.
 *
 * Mercado Pago sends an `x-signature` header with a HMAC-SHA256
 * of the request body using your webhook secret. If the secret
 * is not configured, validation is skipped (dev mode only).
 */
function validateWebhookSignature(
  rawBody: string,
  headers: Record<string, string>,
  secretOverride?: string | null
): boolean {
  const secret = secretOverride ?? process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — skip validation (dev/sandbox only)
    console.warn('[mercado-pago] No webhook secret configured — skipping signature validation');
    return true;
  }

  const crypto = require('node:crypto');
  const signature = headers['x-signature'];
  if (!signature) return false;

  // Mercado Pago sends: ts=<timestamp>;v1=<hash>
  const parts = Object.fromEntries(
    signature.split(',').map((p: string) => {
      const [k, ...v] = p.split('=');
      return [k, v.join('=')];
    })
  );

  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(v1, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

/**
 * Map Mercado Pago preapproval status to our SubscriptionStatus.
 */
function mapStatus(mpStatus: string): SubscriptionStatus {
  switch (mpStatus) {
    case 'authorized':
    case 'active':
      return 'ACTIVE';
    case 'pending':
      return 'TRIAL'; // Checkout not completed yet — don't grant full access
    case 'paused':
      return 'PAST_DUE';
    case 'cancelled':
      return 'CANCELED';
    case 'expired':
      return 'EXPIRED';
    default:
      return 'PAST_DUE';
  }
}

/**
 * Check if an account has its own Mercado Pago credentials configured.
 * Used by checkout to require resellers to set up their own MP account.
 */
export async function hasAccountCredentials(accountId: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('account_mercado_pago_credentials')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly provider = 'mercado_pago' as const;

  async createSubscription(params: {
    accountId: string;
    planCode: string;
    priceMonthly: number;
    customerEmail: string;
    customerName: string;
    successUrl: string;
    failureUrl: string;
    pendingUrl: string;
  }): Promise<CreateCheckoutResult> {
    const client = await getClientForAccount(params.accountId);
    const preApproval = new PreApproval(client);

    const now = new Date();
    const oneYearFromNow = new Date(now);
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const result = await preApproval.create({
      body: {
        reason: `Fire Play — Plano ${params.planCode}`,
        external_reference: params.accountId,
        payer_email: params.customerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          start_date: now.toISOString(),
          end_date: oneYearFromNow.toISOString(),
          transaction_amount: params.priceMonthly,
          currency_id: 'BRL',
        },
        back_url: params.successUrl,
        status: 'pending',
      },
    });

    return {
      checkoutUrl: result.init_point ?? '',
      providerSubscriptionId: result.id ?? '',
    };
  }

  async cancelSubscription(providerSubscriptionId: string, accountId?: string): Promise<void> {
    const client = await getClientForAccount(accountId);
    const preApproval = new PreApproval(client);

    await preApproval.update({
      id: providerSubscriptionId,
      body: { status: 'cancelled' },
    });
  }

  async handleWebhook(
    rawPayload: unknown,
    headers: Record<string, string>
  ): Promise<WebhookResult & { providerSubscriptionId: string; eventType: string }> {
    const payload = rawPayload as Record<string, unknown>;

    const action = payload.action as string;
    const resource = payload.resource as string;
    const type = payload.type as string;

    // The preapproval ID comes from the resource URL or data
    let providerSubscriptionId = '';
    let mpStatus = '';
    let currentPeriodEnd: string | null = null;
    let accountId: string | null = null;

    if (type === 'preapproval' || type === 'preapproval_payment') {
      // Resolve account from external_reference first (if available in payload)
      accountId = (payload.external_reference as string)
        ?? (payload.data as Record<string, unknown>)?.external_reference as string
        ?? null;

      // Resolve credentials for this account (or global fallback)
      const { token, webhookSecret } = await resolveCredentials(accountId ?? undefined);

      // Validate signature with account-specific or global secret
      const rawBody = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
      if (!validateWebhookSignature(rawBody, headers, webhookSecret)) {
        throw new Error('Invalid webhook signature');
      }

      // Fetch the preapproval details using account-specific credentials
      const client = new MercadoPagoConfig({
        accessToken: token,
        options: { timeout: 10000 },
      });
      const preApproval = new PreApproval(client);

      // Extract ID from resource URL (e.g., "/preapproval/123456")
      const idMatch = resource?.match(/\/(\d+)$/);
      if (idMatch) {
        providerSubscriptionId = idMatch[1];
        const details = await preApproval.get({ id: providerSubscriptionId });
        mpStatus = details.status ?? '';
        // Extract external_reference from the fetched details
        if (!accountId) {
          accountId = (details as unknown as Record<string, unknown>).external_reference as string ?? null;
        }
        // Extract next charge date for renewal tracking
        const nextCharge = (details as unknown as Record<string, unknown>).next_profit_date
          ?? (details as unknown as Record<string, unknown>).date_of_next_charge;
        if (nextCharge && typeof nextCharge === 'string') {
          currentPeriodEnd = new Date(nextCharge).toISOString();
        }
      }
    } else {
      // Non-preapproval events — validate with global secret
      const rawBody = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
      if (!validateWebhookSignature(rawBody, headers)) {
        throw new Error('Invalid webhook signature');
      }
    }

    const newStatus = mapStatus(mpStatus);

    return {
      newStatus,
      providerSubscriptionId,
      eventType: `${type}.${action}`,
      currentPeriodEnd,
    };
  }
}
