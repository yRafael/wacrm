import { type Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getCurrentAccount } from '@/lib/auth/account';
import { checkSubscription } from '@/lib/subscription/gating';
import SubscriptionLock from '@/components/subscription/subscription-lock';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Fire Play',
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * DashboardGate — server component wrapper.
 *
 * Resolve the user's account + subscription BEFORE rendering the
 * dashboard. If the subscription is in a blocking state (SUSPENDED,
 * CANCELED, EXPIRED), render the SubscriptionLock screen instead.
 *
 * TRIAL/ACTIVE/PAST_DUE proceed to the actual dashboard content.
 */
export default async function DashboardGate({
  children,
}: {
  children: ReactNode;
}) {
  let account, subscription;

  try {
    account = await getCurrentAccount();
    subscription = await checkSubscription(account.supabase, account.accountId);
  } catch (err) {
    // Not authenticated or account context failed — let the middleware
    // handle the redirect to login. Re-throw to preserve the redirect.
    if (err instanceof Error && err.message.includes('Unauthorized')) {
      redirect('/login');
    }
    redirect('/login');
  }

  if (!subscription.hasAccess) {
    return (
      <SubscriptionLock
        status={subscription.status}
        expiresAt={subscription.expiresAt}
        planName={subscription.planName}
        message={
          subscription.blockReason ??
          'Sua assinatura precisa ser regularizada para continuar usando o Fire Play.'
        }
      />
    );
  }

  return <>{children}</>;
}
