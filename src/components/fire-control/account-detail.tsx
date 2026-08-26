import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import {
  User,
  Shield,
  Copy,
  HelpCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentAccount } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AccountActions } from '@/components/fire-control/account-actions';

const TYPE_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESELLER: 'Revendedor',
  PLATFORM: 'Plataforma',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  USER: <User className="h-5 w-5" />,
  RESELLER: <Shield className="h-5 w-4" />,
  PLATFORM: <Shield className="h-5 w-5 text-primary" />,
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

interface AccountDetailData {
  id: string;
  name: string;
  email: string;
  account_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  quota_used: number;
  quota_total: number;
  plan_name: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  parent_name: string | null;
  tree_depth: number;
  child_count: number;
  last_access_at: string | null;
  profile_full_name: string | null;
  profile_email: string | null;
}

async function fetchAccountDetail(accountId: string): Promise<AccountDetailData | null> {
  'use server';
  try {
    await getCurrentAccount();
    const admin = supabaseAdmin();

    const { data: account, error: accErr } = await admin
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();

    if (accErr || !account) return null;

    // Fetch subscription + plan
    const { data: sub } = await admin
      .from('platform_subscriptions')
      .select('status, expires_at, plan_id')
      .eq('account_id', accountId)
      .maybeSingle();

    let planName = null;
    if (sub?.plan_id) {
      const { data: plan } = await admin
        .from('platform_plans')
        .select('name')
        .eq('id', sub.plan_id)
        .maybeSingle();
      planName = plan?.name ?? null;
    }

    // Fetch parent
    const { data: rel } = await admin
      .from('account_relationships')
      .select('parent_account_id')
      .eq('child_account_id', accountId)
      .maybeSingle();

    let parentName = null;
    let treeDepth = 0;
    if (rel?.parent_account_id) {
      const { data: parentAcc } = await admin
        .from('accounts')
        .select('name, account_type')
        .eq('id', rel.parent_account_id)
        .maybeSingle();
      parentName = parentAcc?.name ?? null;
      treeDepth = 1;
    }

    // Fetch child count
    const { count: childCount } = await admin
      .from('account_relationships')
      .select('parent_account_id', { count: 'exact' })
      .eq('parent_account_id', accountId);

    // Fetch profile
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('account_id', accountId)
      .maybeSingle();

    return {
      id: account.id,
      name: account.name ?? '',
      email: account.email ?? '',
      account_type: account.account_type,
      status: account.status,
      created_at: account.created_at,
      updated_at: account.updated_at ?? account.created_at,
      quota_used: account.quota_used ?? 0,
      quota_total: account.quota_total ?? 0,
      plan_name: planName,
      subscription_status: sub?.status ?? null,
      subscription_expires_at: sub?.expires_at ?? null,
      parent_name: parentName,
      tree_depth: treeDepth,
      child_count: childCount ?? 0,
      last_access_at: null,
      profile_full_name: profile?.full_name ?? null,
      profile_email: profile?.email ?? null,
    };
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? 'outline';
  const label = STATUS_LABEL[status] ?? status;
  return (
    <Badge variant={variant} className="text-sm">
      ● {label}
    </Badge>
  );
}

function UsageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const percentage = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const barColor = percentage > 90 ? 'bg-red-500' : percentage > 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">
          {used.toLocaleString('pt-BR')} / {total.toLocaleString('pt-BR')}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default async function AccountDetail({ accountId }: { accountId: string }) {
  const data = await fetchAccountDetail(accountId);

  if (!data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <HelpCircle className="text-muted-foreground mb-2 h-10 w-10" />
          <h2 className="text-xl font-bold mb-2">Conta não encontrada</h2>
          <p className="text-muted-foreground">
            A conta solicitada não foi encontrada ou você não tem permissão para visualizá-la.
          </p>
          <Link href="/fire-control-x7k29/accounts">
            <Button className="mt-4">Voltar para contas</Button>
          </Link>
        </div>
      </div>
    );
  }

  const formattedDate = (date: string) =>
    format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: ptBR });

  return (
    <div className="space-y-6">
      {/* Header da conta */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
            {TYPE_ICON[data.account_type]}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{data.name}</h1>
              <StatusBadge status={data.status} />
            </div>
            <p className="text-muted-foreground mt-1">
              {TYPE_LABEL[data.account_type] ?? data.account_type} ·{' '}
              {data.email}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <AccountActions
            accountId={data.id}
            subscriptionStatus={data.subscription_status}
          />
        </div>
      </div>

      {/* Cards de informações */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={data.status} />
            <p className="text-muted-foreground mt-2 text-sm">
              {data.updated_at
                ? `Atualizado em ${formattedDate(data.updated_at)}`
                : 'Status sem atualização'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Plano</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{data.plan_name ?? 'Sem plano'}</p>
            <p className="text-muted-foreground text-sm">
              Assinatura: {data.subscription_status ?? 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Vencimento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {data.subscription_expires_at
                ? format(new Date(data.subscription_expires_at), 'PPP', { locale: ptBR })
                : '—'}
            </p>
            <p className="text-muted-foreground text-sm">
              {data.subscription_expires_at &&
                `Renova ${formatDistanceToNow(new Date(data.subscription_expires_at), { locale: ptBR, addSuffix: true })}`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Uso de cotas */}
      <Card>
        <CardHeader>
          <CardTitle>Capacidade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageBar label="Contas utilizadas" used={data.quota_used} total={data.quota_total} />
          <UsageBar label="Revendedores diretos" used={data.child_count} total={50} />
        </CardContent>
      </Card>

      {/* Árvore de revenda */}
      <Card>
        <CardHeader>
          <CardTitle>Posição na árvore</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Revendedor pai:</span>{' '}
              {data.parent_name ?? 'Plataforma (root)'}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Nível na árvore:</span> {data.tree_depth}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Sub-revendedores/clientes:</span>{' '}
              {data.child_count}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Informações completas */}
      <Card>
        <CardHeader>
          <CardTitle>Informações detalhadas</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">ID da conta</dt>
              <dd className="text-sm font-medium">{data.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Email</dt>
              <dd className="text-sm font-medium">{data.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Nome completo (perfil)</dt>
              <dd className="text-sm font-medium">{data.profile_full_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Tipo de conta</dt>
              <dd className="text-sm font-medium">
                {TYPE_LABEL[data.account_type] ?? data.account_type}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Criada em</dt>
              <dd className="text-sm font-medium">{formattedDate(data.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Último acesso</dt>
              <dd className="text-sm font-medium">
                {data.last_access_at
                  ? formattedDate(data.last_access_at)
                  : 'Nunca'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Ações rápidas */}
      <div className="flex gap-2">
        <Link href={`/fire-control-x7k29/audit?target=${data.id}`}>
          <Button variant="outline">Ver auditoria</Button>
        </Link>
        <Button variant="outline">
          <Copy className="mr-2 h-4 w-4" />
          Copiar ID
        </Button>
      </div>
    </div>
  );
}
