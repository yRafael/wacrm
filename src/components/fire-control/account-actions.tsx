'use client';

import { useRouter } from 'next/navigation';
import { SubscriptionGrant } from '@/components/fire-control/subscription-grant';

interface AccountActionsProps {
  accountId: string;
  subscriptionStatus: string | null;
}

/**
 * Client wrapper for account actions that need router.refresh()
 * after grant/revoke to re-fetch server component data.
 */
export function AccountActions({
  accountId,
  subscriptionStatus,
}: AccountActionsProps) {
  const router = useRouter();

  return (
    <SubscriptionGrant
      accountId={accountId}
      subscriptionStatus={subscriptionStatus}
      onSuccess={() => router.refresh()}
    />
  );
}
