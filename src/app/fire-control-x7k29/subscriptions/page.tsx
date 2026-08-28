import { Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import SubscriptionListClient from '@/components/fire-control/subscription-list-client';
import { requirePlatformOperator } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assinaturas — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function SubscriptionsPage() {
  try {
    await requirePlatformOperator();
    const rateLimitResult = checkRateLimit('platform-subscriptions', RATE_LIMITS.adminAction);
    if (!rateLimitResult.success) {
      rateLimitResponse(rateLimitResult);
    }

    const admin = supabaseAdmin();

    // Fetch subscriptions with account + plan info in a single join
    const { data: subs, error } = await admin
      .from('platform_subscriptions')
      .select(`
        id,
        status,
        started_at,
        expires_at,
        created_at,
        accounts!inner(id, name, account_type, status),
        platform_plans!inner(id, name, code)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[subscriptions] query error:', error);
      return (
        <FireControlLayout>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Falha ao carregar assinaturas.</p>
          </div>
        </FireControlLayout>
      );
    }

    return (
      <FireControlLayout>
        <SubscriptionListClient subscriptions={subs ?? []} />
      </FireControlLayout>
    );
  } catch {
    return (
      <FireControlLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Acesso negado.</p>
        </div>
      </FireControlLayout>
    );
  }
}
