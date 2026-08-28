import Link from 'next/link';
import { Check, Lock, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { CheckoutButton } from '@/components/subscription/checkout-button';
import { LogoutLink } from '@/components/auth/logout-link';

export const dynamic = 'force-dynamic';

interface Plan {
  id: string;
  code: string;
  name: string;
  account_type: string;
  price_monthly: number;
  quota_accounts: number | null;
  max_depth: number;
}

async function getPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_plans')
    .select('id, code, name, account_type, price_monthly, quota_accounts, max_depth')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  return data ?? [];
}

async function getCurrentSubscription() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.account_id) return null;

  const { data: sub } = await supabase
    .from('platform_subscriptions')
    .select('status, expires_at, plan:platform_plans!inner(name, code)')
    .eq('account_id', profile.account_id)
    .order('created_at', { ascending: false })
    .maybeSingle();

  return sub as {
    status: string;
    expires_at: string | null;
    plan: { name: string; code: string } | null;
  } | null;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(price);
}

export default async function PricingPage() {
  const [plans, currentSub] = await Promise.all([getPlans(), getCurrentSubscription()]);

  const isBlocked =
    !currentSub ||
    ['SUSPENDED', 'CANCELED', 'EXPIRED'].includes(currentSub.status) ||
    (currentSub.status === 'TRIAL' &&
      currentSub.expires_at &&
      new Date(currentSub.expires_at).getTime() <= Date.now());

  return (
    <div className="min-h-screen bg-background">
      {/* Logout link — top right */}
      <div className="absolute top-4 right-4 z-10">
        <LogoutLink className="text-muted-foreground hover:text-foreground text-sm transition-colors" />
      </div>

      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8 text-center">
          {isBlocked && (
            <div className="bg-destructive/10 mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-destructive">
              <Lock className="h-4 w-4" />
              Acesso restrito — assinatura necessária
            </div>
          )}

          <h1 className="text-foreground text-3xl font-bold mb-3">
            Escolha seu plano
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Selecione o plano ideal para começar a usar o Fire Play.
            Todos os planos incluem 3 dias de trial gratuito.
          </p>
        </div>

        {currentSub && (
          <div className="bg-card border-border mb-8 rounded-xl border p-6 text-center">
            <p className="text-muted-foreground text-sm mb-2">Sua assinatura atual</p>
            <div className="flex items-center justify-center gap-3">
              <Badge variant={isBlocked ? 'destructive' : 'secondary'}>
                {currentSub.status}
              </Badge>
              {currentSub.plan && (
                <span className="text-foreground font-medium">
                  {currentSub.plan.name}
                </span>
              )}
              {currentSub.expires_at && (
                <span className="text-muted-foreground text-sm">
                  vence em {new Date(currentSub.expires_at).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="border-border bg-card rounded-xl border p-8 flex flex-col"
            >
              <div className="mb-6">
                <Badge variant="outline" className="mb-3">
                  {plan.account_type === 'RESELLER' ? 'Revendedor' : 'Usuário'}
                </Badge>
                <h2 className="text-foreground text-2xl font-bold">{plan.name}</h2>
                <div className="mt-3">
                  <span className="text-foreground text-4xl font-bold">
                    {formatPrice(plan.price_monthly)}
                  </span>
                  <span className="text-muted-foreground text-sm">/mês</span>
                </div>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                <li className="flex items-start gap-2 text-sm">
                  <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-foreground">3 dias de trial gratuito</span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-foreground">
                    Caixa de entrada e atendimento
                  </span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-foreground">
                    Gestão de contatos e pipelines
                  </span>
                </li>
                {plan.quota_accounts !== null && (
                  <li className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-foreground">
                      Até {plan.quota_accounts} {plan.quota_accounts === 1 ? 'conta' : 'contas'}
                    </span>
                  </li>
                )}
                {plan.max_depth > 0 && (
                  <li className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-foreground">
                      Árvore de revendedores (até {plan.max_depth} {plan.max_depth === 1 ? 'nível' : 'níveis'})
                    </span>
                  </li>
                )}
              </ul>

              <div className="mt-auto">
                <CheckoutButton planId={plan.id} planName={plan.name} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
