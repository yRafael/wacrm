import { Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import ResellerListClient from '@/components/fire-control/reseller-list-client';
import { requirePlatformOperator } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Revendedores — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function ResellersPage() {
  try {
    await requirePlatformOperator();
    const rateLimitResult = checkRateLimit(
      'platform-resellers',
      RATE_LIMITS.adminAction
    );
    if (!rateLimitResult.success) {
      rateLimitResponse(rateLimitResult);
    }

    const admin = supabaseAdmin();

    const { data: resellers, error } = await admin
      .from('accounts')
      .select('id, name, status, created_at, quota_used, quota_total')
      .eq('account_type', 'RESELLER')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[resellers] query error:', error);
      return (
        <FireControlLayout>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Falha ao carregar revendedores.</p>
          </div>
        </FireControlLayout>
      );
    }

    // Batch load subscription info for each reseller
    const resellerIds = (resellers ?? []).map((r) => r.id);
    const { data: subs } = resellerIds.length
      ? await admin
          .from('platform_subscriptions')
          .select('account_id, plan_id, status, expires_at')
          .in('account_id', resellerIds)
      : { data: [] };

    const { data: plans } = await admin.from('platform_plans').select('id, name');
    const planNameById = new Map(
      (plans ?? []).map((p) => [p.id, p.name])
    );

    const subByAccount = new Map(
      (subs ?? []).map((s) => [s.account_id, { status: s.status, expires_at: s.expires_at, plan_id: s.plan_id }])
    );

    return (
      <FireControlLayout>
        <ResellerListClient
          resellers={resellers ?? []}
          subs={subs ?? []}
          planNameById={planNameById}
        />
      </FireControlLayout>
    );
  } catch (err) {
    return (
      <FireControlLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Acesso negado.</p>
        </div>
      </FireControlLayout>
    );
  }
}
