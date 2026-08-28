// Subscription constants — single source of truth for durations.
// Change via env vars without code edits.

/** Default trial duration in days for new signups */
export const TRIAL_DURATION_DAYS = parseInt(
  process.env.TRIAL_DURATION_DAYS ?? '3',
  10
);

/** Grace period in days after PAST_DUE before subscription is EXPIRED */
export const GRACE_DAYS = 3;

/** Subscription types for manual grants */
export const SUBSCRIPTION_TYPES = [
  'automatic',
  'manual',
  'courtesy',
  'promotional',
] as const;

export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

/** Payment providers */
export const PAYMENT_PROVIDERS = ['mercado_pago', 'stripe'] as const;
export type PaymentProviderType = (typeof PAYMENT_PROVIDERS)[number];
