import { Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import PlanListClient from '@/components/fire-control/plan-list-client';
import { requirePlatformOperator } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Planos — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function PlansPage() {
  try {
    await requirePlatformOperator();
    const rateLimitResult = checkRateLimit('platform-plans', RATE_LIMITS.adminAction);
    if (!rateLimitResult.success) {
      rateLimitResponse(rateLimitResult);
    }

    const admin = supabaseAdmin();

    const { data: plans, error } = await admin
      .from('platform_plans')
      .select('id, code, name, account_type, price_monthly, quota_accounts, quota_direct_resellers, max_depth, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[plans] query error:', error);
      return (
        <FireControlLayout>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Falha ao carregar planos.</p>
          </div>
        </FireControlLayout>
      );
    }

    // Count active subscriptions per plan
    const planIds = (plans ?? []).map((p) => p.id);
    const { count: totalSubs } = planIds.length
      ? await admin
          .from('platform_subscriptions')
          .select('id', { count: 'exact' })
          .in('plan_id', planIds)
      : { count: 0 };

    return (
      <FireControlLayout>
        <PlanListClient
          plans={plans ?? []}
          totalSubscriptions={totalSubs ?? 0}
        />
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
