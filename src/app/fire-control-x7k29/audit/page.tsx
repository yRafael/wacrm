import { Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import { requirePlatformOperator } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import AuditListClient from '@/components/fire-control/audit-list-client';
import type { ActivityItem } from '@/lib/platform/activity';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Auditoria — Fire Control',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AuditPage() {
  try {
    await requirePlatformOperator();
    const rateLimitResult = checkRateLimit('platform-audit', RATE_LIMITS.adminAction);
    if (!rateLimitResult.success) {
      rateLimitResponse(rateLimitResult);
    }

    const admin = supabaseAdmin();

    const { data: audit, error } = await admin
      .from('audit_logs')
      .select('id, action, target_account_id, actor_user_id, actor_account_id, metadata, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[audit] query error:', error);
      return (
        <FireControlLayout>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Falha ao carregar auditoria.</p>
          </div>
        </FireControlLayout>
      );
    }

    // Fetch actor names (users) and target account names
    const actorUserIds = Array.from(
      new Set((audit ?? []).map((a) => a.actor_user_id).filter(Boolean))
    ) as string[];
    const targetAccountIds = Array.from(
      new Set((audit ?? []).map((a) => a.target_account_id).filter(Boolean))
    ) as string[];

    const [actorProfiles, targetAccounts] = await Promise.all([
      actorUserIds.length
        ? admin
            .from('profiles')
            .select('user_id, full_name, email')
            .in('user_id', actorUserIds)
        : { data: [] },
      targetAccountIds.length
        ? admin.from('accounts').select('id, name').in('id', targetAccountIds)
        : { data: [] },
    ]);

    const actorNameById = new Map(
      (actorProfiles.data ?? []).map((p) => [
        p.user_id,
        p.full_name ?? p.email ?? 'Sistema',
      ])
    );
    const accountNameById = new Map(
      (targetAccounts.data ?? []).map((a) => [a.id, a.name])
    );

    const activity: ActivityItem[] = (audit ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      metadata: {
        ...a.metadata,
        actor_name: actorNameById.get(a.actor_user_id ?? '') ?? 'Sistema',
        target_name: accountNameById.get(a.target_account_id ?? '') ?? a.target_account_id,
        ip: a.ip,
      },
      created_at: a.created_at,
    }));

    return (
      <FireControlLayout>
        <AuditListClient audit={activity} />
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
