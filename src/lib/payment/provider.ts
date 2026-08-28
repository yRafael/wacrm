// ============================================================
// Payment Provider abstraction
//
// Defines a unified interface for payment gateways (Mercado Pago,
// Stripe, etc.). The rest of the system (gating, Fire Control)
// works only with Subscription.status — it never knows which
// gateway is behind the subscription.
// ============================================================

import type { SubscriptionStatus } from '@/lib/subscription/gating';

export interface CreateCheckoutResult {
  /** URL to redirect the user for payment */
  checkoutUrl: string;
  /** ID of the subscription in the payment provider */
  providerSubscriptionId: string;
}

export interface WebhookResult {
  /** New subscription status after processing the event */
  newStatus: SubscriptionStatus;
  /** When the current billing period ends (if applicable) */
  currentPeriodEnd?: string | null;
}

export interface PaymentProvider {
  /** Identifier for this provider */
  readonly provider: 'mercado_pago' | 'stripe';

  /**
   * Create a checkout/preapproval session.
   * Returns a URL where the user completes payment.
   */
  createSubscription(params: {
    accountId: string;
    planCode: string;
    priceMonthly: number;
    customerEmail: string;
    customerName: string;
    successUrl: string;
    failureUrl: string;
    pendingUrl: string;
  }): Promise<CreateCheckoutResult>;

  /**
   * Cancel an active subscription in the provider.
   * @param accountId - Optional account ID for per-account credentials
   */
  cancelSubscription(providerSubscriptionId: string, accountId?: string): Promise<void>;

  /**
   * Process a raw webhook payload from the provider.
   * Validates the signature, extracts the event, and returns
   * the subscription status update.
   */
  handleWebhook(
    rawPayload: unknown,
    headers: Record<string, string>
  ): Promise<WebhookResult & { providerSubscriptionId: string; eventType: string }>;
}
