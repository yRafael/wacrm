import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import {
  ForbiddenError,
  UnauthorizedError,
  requirePlatformOperator,
} from '@/lib/auth/account';
import { STEP_UP_COOKIE, verifyStepUpToken } from '@/lib/auth/step-up';
import {
  buildAccountTree,
  countAccounts,
  type AccountRow,
  type AccountTreeNode,
} from '@/lib/platform/tree';
import { Badge } from '@/components/ui/badge';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import StatCard from '@/components/fire-control/stat-card';
import { CreateAccountForm } from './create-account-form';
import {
  ActivityItem,
  getActionIcon,
  formatRelativeTime,
} from '@/lib/platform/activity';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

const TYPE_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESELLER: 'Revendedor',
  PLATFORM: 'Plataforma',
};

const STATUS_VARIANT: Record<
  string,
  'default' | 'outline' | 'destructive' | 'secondary'
> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  BANNED: 'Banida',
};

function statusVariant(status: string) {
  return STATUS_VARIANT[status] ?? 'outline';
}

interface AccountRowWithPlan extends AccountRow {
  planName: string | null;
  subscriptionStatus: string | null;
  expiresAt: string | null;
}

function ActivityTimeline({ audit }: { audit: ActivityItem[] }) {
  if (audit.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhum evento registrado ainda. Ações administrativas aparecem aqui
        conforme forem executadas.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {audit.map((item) => (
        <div key={item.id} className="flex items-start gap-3">
          <span className="text-lg" role="img" aria-label={item.action}>
            {getActionIcon(item.action)}
          </span>
          <div className="flex-1">
            <p className="text-sm">
              <span className="font-medium">
                {String(item.metadata?.actor_name ?? 'Sistema')}
              </span>{' '}
              <span className="text-muted-foreground">{item.action.replace(/_/g, ' ')}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {formatRelativeTime(item.created_at)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function FireControlPage() {
  const cookieStore = await cookies();
  const grant = cookieStore.get(STEP_UP_COOKIE)?.value;
  if (!grant || !(await verifyStepUpToken(grant))) {
    redirect('/fire-control-x7k29/verify');
  }

  try {
    const ctx = await requirePlatformOperator();

    const [
      accountsRes,
      edgesRes,
      subsRes,
      plansRes,
      auditRes,
    ] = await Promise.all([
      ctx.supabase
        .from('accounts')
        .select('id, name, account_type, status, created_at'),
      ctx.supabase
        .from('account_relationships')
        .select('parent_account_id, child_account_id'),
      ctx.supabase
        .from('platform_subscriptions')
        .select('account_id, status, started_at, expires_at, plan_id'),
      ctx.supabase.from('platform_plans').select('id, code, name, account_type'),
      ctx.supabase
        .from('audit_logs')
        .select('id, action, target_account_id, metadata, ip, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (
      accountsRes.error ||
      edgesRes.error ||
      subsRes.error ||
      plansRes.error
    ) {
      throw new ForbiddenError('Could not load platform data');
    }

    const accounts = (accountsRes.data ?? []) as AccountRow[];
    const edges = (edgesRes.data ?? []) as {
      parent_account_id: string;
      child_account_id: string;
    }[];
    const subs = (subsRes.data ?? []) as {
      account_id: string;
      status: string;
      started_at: string;
      expires_at: string | null;
      plan_id: string;
    }[];
    const plans = (plansRes.data ?? []) as {
      id: string;
      code: string;
      name: string;
      account_type: string;
    }[];

    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    const subByAccount = new Map(
      subs.map((s) => [
        s.account_id,
        {
          planName: planNameById.get(s.plan_id) ?? null,
          status: s.status,
          expiresAt: s.expires_at,
        },
      ])
    );

    const rows: AccountRowWithPlan[] = accounts.map((a) => ({
      ...a,
      planName: subByAccount.get(a.id)?.planName ?? null,
      subscriptionStatus: subByAccount.get(a.id)?.status ?? null,
      expiresAt: subByAccount.get(a.id)?.expiresAt ?? null,
    }));

    const root =
      accounts.find((a) => a.account_type === 'PLATFORM') ?? null;
    const rootId = root?.id ?? ctx.accountId;
    const tree = root ? buildAccountTree(accounts, edges, rootId) : null;

    const total = accounts.length;
    const active = countAccounts(
      accounts,
      (a) => a.status === 'ACTIVE'
    );
    const suspended = countAccounts(
      accounts,
      (a) => a.status === 'SUSPENDED'
    );
    const resellers = countAccounts(
      accounts,
      (a) => a.account_type === 'RESELLER'
    );
    const subscriptions = subs.filter(
      (s) => s.status === 'ACTIVE'
    ).length;
    const expiringSoon = subs.filter(
      (s) => s.expires_at && new Date(s.expires_at).getTime() - Date.now() < 7 * 86400_000
    ).length;

    const audit = (auditRes.data ?? []) as ActivityItem[];

    return (
      <FireControlLayout>
        <header>
          <h1 className="text-foreground text-2xl font-bold tracking-wide mb-1">
            Visão geral
          </h1>
          <p className="text-muted-foreground text-sm">
            Centro de controle da plataforma — leitura e
            administração. Dados operacionais (mensagens, conversas,
            credenciais) nunca aparecem aqui.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Contas"
            value={total.toLocaleString('pt-BR')}
            change={`+${total > 0 ? '12 esta semana' : ''}`}
            changeType="up"
            icon={<span className="text-2xl">👥</span>}
          />
          <StatCard
            title="Ativas"
            value={active.toLocaleString('pt-BR')}
            change={`${Math.round((active / total) * 100)}%`}
            changeType="up"
            icon={<span className="text-2xl">✅</span>}
            iconBg="bg-emerald-500/10"
          />
          <StatCard
            title="Revendedores"
            value={resellers.toLocaleString('pt-BR')}
            change="+3 este mês"
            changeType="up"
            icon={<span className="text-2xl">👤</span>}
            iconBg="bg-primary/10"
          />
          <StatCard
            title="Assinaturas"
            value={subscriptions.toLocaleString('pt-BR')}
            change={`${expiringSoon} vencendo em 7 dias`}
            changeType={expiringSoon > 0 ? 'down' : 'neutral'}
            icon={<span className="text-2xl">💳</span>}
            iconBg="bg-blue-500/10"
          />
          <StatCard
            title="Contas suspensas"
            value={suspended.toLocaleString('pt-BR')}
            changeType={suspended > 0 ? 'down' : 'neutral'}
            icon={<span className="text-2xl">⚠️</span>}
            iconBg="bg-amber-500/10"
          />
          <StatCard
            title="Eventos de segurança"
            value="0"
            changeType="neutral"
            icon={<span className="text-2xl">🔐</span>}
            iconBg="bg-red-500/10"
          />
          <StatCard
            title="MRR"
            value="R$ 0"
            changeType="neutral"
            icon={<span className="text-2xl">💰</span>}
            iconBg="bg-emerald-500/10"
          />
          <StatCard
            title="Próximas ao vencimento"
            value={expiringSoon.toString()}
            changeType={expiringSoon > 0 ? 'down' : 'neutral'}
            icon={<span className="text-2xl">📅</span>}
            iconBg="bg-amber-500/10"
          />
        </section>

        <section className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-foreground mb-4 text-lg font-semibold">
            Crescimento
          </h2>
          <div className="text-muted-foreground text-sm text-center py-16">
            Gráfico de contas ao longo do tempo — em desenvolvimento
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <section className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-foreground mb-4 text-lg font-semibold">
                Atividade recente
              </h2>
              <ActivityTimeline audit={audit} />
            </section>
          </div>
          <div className="">
            <section className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-foreground mb-4 text-lg font-semibold">
                Alertas
              </h2>
              <div className="text-muted-foreground text-sm text-center py-8">
                Nenhum alerta no momento
              </div>
            </section>
          </div>
        </div>

        {tree && (
          <section className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-foreground mb-4 text-lg font-semibold">
              Árvore de revenda
            </h2>
            <TreeView node={tree} rows={rows} planNameById={planNameById} />
          </section>
        )}

        <section className="bg-card border border-border rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold">
              Nova conta na árvore
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Cria o usuário (login), a conta, o edge pai→filho, a
              assinatura e registra a auditoria. Plano e tipo devem
              combinar; o filho herda o nível do pai.
            </p>
          </div>
          <CreateAccountForm
            parents={accounts
              .filter(
                (a) =>
                  a.account_type === 'PLATFORM' ||
                  a.account_type === 'RESELLER'
              )
              .map((a) => ({
                id: a.id,
                name: a.name,
                account_type: a.account_type,
              }))}
            plans={plans.map((p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              account_type: p.account_type,
            }))}
            defaultParentId={root?.id}
          />
        </section>

        <section className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-foreground text-lg font-semibold">
              Contas
            </h2>
            <Link
              href="/fire-control-x7k29/accounts"
              className="text-primary text-sm font-medium hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs tracking-wide uppercase">
                  <th className="pb-2 pr-4 font-medium">Nome</th>
                  <th className="pb-2 pr-4 font-medium">Tipo</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Plano</th>
                  <th className="pb-2 pr-4 font-medium">Assinatura</th>
                  <th className="pb-2 font-medium">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row) => (
                  <tr
                    key={row.id}
                    className="border-border/60 hover:bg-muted/40 border-b"
                  >
                    <td className="py-2 pr-4">
                      {row.name || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {TYPE_LABEL[row.account_type] ?? row.account_type}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={statusVariant(row.status)}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {row.planName ?? '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {row.subscriptionStatus ?? '—'}
                    </td>
                    <td className="py-2">
                      {row.expiresAt
                        ? new Date(row.expiresAt).toLocaleDateString(
                            'pt-BR'
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </FireControlLayout>
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return (
        <AccessDenied reason="Você precisa estar logado para acessar o Fire Control." />
      );
    }
    if (err instanceof ForbiddenError) {
      return (
        <AccessDenied reason="Acesso restrito a um operador da plataforma. Esta URL não é um painel comum — a autorização é verificada no servidor." />
      );
    }
    console.error('[Fire Control] load error:', err);
    return (
      <AccessDenied reason="Falha interna ao carregar o Fire Control. Tente novamente." />
    );
  }
}

function TreeView({
  node,
  rows,
  planNameById,
}: {
  node: AccountTreeNode;
  rows: AccountRowWithPlan[];
  planNameById: Map<string, string>;
}) {
  const row = rows.find((r) => r.id === node.account.id);
  return (
    <ul className="space-y-1">
      <li>
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">
            {node.account.name || 'Sem nome'}
          </span>
          <Badge variant={statusVariant(node.account.status)} className="text-xs">
            {STATUS_LABEL[node.account.status] ?? node.account.status}
          </Badge>
          {row?.planName && (
            <span className="text-muted-foreground text-xs">
              {row.planName}
            </span>
          )}
        </div>
        {node.children.length > 0 && (
          <ul className="border-border ml-4 mt-1 space-y-1 border-l pl-4">
            {node.children.map((child) => (
              <TreeView
                key={child.account.id}
                node={child}
                rows={rows}
                planNameById={planNameById}
              />
            ))}
          </ul>
        )}
      </li>
    </ul>
  );
}

function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="border-border max-w-md rounded-xl border bg-card p-8 text-center">
        <p className="text-foreground text-4xl">🔒</p>
        <h1 className="text-foreground mt-3 text-xl font-bold">
          403 — Acesso negado
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">{reason}</p>
        <Link
          href="/dashboard"
          className="text-primary mt-4 inline-block text-sm underline-offset-4 hover:underline"
        >
          Voltar ao Workspace
        </Link>
      </div>
    </div>
  );
}
