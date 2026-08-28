import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { DashboardShell } from './dashboard-shell';
import { getCurrentAccount } from '@/lib/auth/account';
import { checkSubscription } from '@/lib/subscription/gating';
import SubscriptionLock from '@/components/subscription/subscription-lock';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

/**
 * Subscription gate (doc §4).
 *
 * Every protected workspace route flows through this layout. We resolve
 * the caller's account + subscription before rendering any child page.
 * If the subscription is in a blocking state (SUSPENDED, CANCELED,
 * EXPIRED), we render the SubscriptionLock screen instead of the
 * workspace — so no data routes ever respond with content while blocked.
 *
 * TRIAL / ACTIVE / PAST_DUE proceed normally.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { supabase, accountId } = await getCurrentAccount();
  const subscription = await checkSubscription(supabase, accountId);

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

  return <DashboardShell>{children}</DashboardShell>;
}
