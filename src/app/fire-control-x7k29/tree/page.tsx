import { Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import TreeListView from '@/components/fire-control/tree-list-view';
import { requirePlatformOperator } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildAccountTree, type AccountRow, type AccountTreeNode } from '@/lib/platform/tree';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Árvore de Rede — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function TreePage() {
  try {
    await requirePlatformOperator();
    const rateLimitResult = checkRateLimit('platform-tree', RATE_LIMITS.adminAction);
    if (!rateLimitResult.success) {
      rateLimitResponse(rateLimitResult);
    }

    const admin = supabaseAdmin();

    const [accountsRes, edgesRes, subsRes, plansRes] = await Promise.all([
      admin.from('accounts').select('id, name, account_type, status, created_at, quota_used, quota_total'),
      admin.from('account_relationships').select('parent_account_id, child_account_id, tree_depth'),
      admin.from('platform_subscriptions').select('account_id, plan_id, status, expires_at'),
      admin.from('platform_plans').select('id, name, code, account_type'),
    ]);

    if (accountsRes.error || edgesRes.error || subsRes.error || plansRes.error) {
      return (
        <FireControlLayout>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Falha ao carregar dados da árvore.</p>
          </div>
        </FireControlLayout>
      );
    }

    const accounts = (accountsRes.data ?? []) as AccountRow[];
    const edges = (edgesRes.data ?? []) as Array<{
      parent_account_id: string;
      child_account_id: string;
      tree_depth: number;
    }>;
    const subs = (subsRes.data ?? []) as Array<{
      account_id: string;
      plan_id: string;
      status: string;
      expires_at: string | null;
    }>;
    const plans = (plansRes.data ?? []) as Array<{
      id: string;
      name: string;
      code: string;
      account_type: string;
    }>;

    // Find the PLATFORM root
    const root = accounts.find((a) => a.account_type === 'PLATFORM') ?? null;
    const rootId = root?.id ?? '';
    const tree = root ? buildAccountTree(accounts, edges, rootId) : null;

    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    const subByAccount = new Map(
      subs.map((s) => [s.account_id, { status: s.status, plan_name: planNameById.get(s.plan_id) ?? null, expires_at: s.expires_at }])
    );

    // Flatten the tree for tabular view
    const flatten = (node: AccountTreeNode, depth: number): Array<{
      account: AccountRow;
      depth: number;
      subscription?: { status: string; plan_name: string | null; expires_at: string | null };
    }> => {
      const children: Array<{
        account: AccountRow;
        depth: number;
        subscription?: { status: string; plan_name: string | null; expires_at: string | null };
      }> = [];
      const current = {
        account: node.account,
        depth,
        subscription: subByAccount.get(node.account.id),
      };
      for (const child of node.children) {
        children.push(...flatten(child, depth + 1));
      }
      return [current, ...children];
    };

    const flatNodes = tree ? flatten(tree, 0) : [];

    return (
      <FireControlLayout>
        <TreeListView nodes={flatNodes} />
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
