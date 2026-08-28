'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Flame, Check, User, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PlanOption {
  id: string;
  name: string;
  code: string;
}

interface CreateAccountFormProps {
  parentAccountId: string;
  parentName: string;
  accountType: 'USER' | 'RESELLER';
}

export default function CreateAccountForm({
  parentAccountId,
  parentName,
  accountType,
}: CreateAccountFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- State initialized from URL search params (single source of truth) ---
  // The original bug: planId was declared twice — once from getServerSideProps
  // and once from a local useState with the same name. This pattern reads from
  // useSearchParams() once, stores in state, and syncs writes back to the URL.
  const [planId, setPlanId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('plan');
    if (fromUrl && fromUrl !== 'all') {
      return fromUrl;
    }
    return null;
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Sync planId to URL so refresh/navigation preserves state ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (planId && planId !== 'all') {
      params.set('plan', planId);
    } else {
      params.delete('plan');
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [planId, router]);

  // --- Fetch plans filtered by account type ---
  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true);
      try {
        // Plans are fetched from the same API response (the GET endpoint returns
        // all plans for the filter dropdown). For the form, we filter client-side.
        const res = await fetch('/api/platform/accounts');
        if (!res.ok) throw new Error('Failed to load plans');
        const data = await res.json();
        const allPlans: PlanOption[] = (data.plans ?? []).map((p: {
          id: string;
          name: string;
          code?: string;
        }) => ({
          id: p.id,
          name: p.name,
          code: p.code ?? p.id,
        }));
        // In a real implementation, plans would be filtered by account_type on
        // the backend. For now, we filter client-side based on naming convention.
        const typePrefix = accountType === 'USER' ? 'fire_user' : 'fire_reseller';
        const filteredPlans = allPlans.filter((p) => {
          const planType = p.code.toLowerCase();
          if (accountType === 'USER') {
            return planType.includes('user') || planType === typePrefix;
          }
          return planType.includes('reseller') || planType === typePrefix;
        });
        setPlans(filteredPlans.length > 0 ? filteredPlans : allPlans);
      } catch (err) {
        console.error('[CreateAccountForm] Failed fetching plans:', err);
      } finally {
        setLoading(false);
      }
    };
    void fetchPlans();
  }, [accountType, router]);

  const getPlanName = (planId: string | null): string => {
    if (!planId) return '';
    const plan = plans.find((p) => p.id === planId);
    return plan?.name ?? '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!name.trim() || name.trim().length > 120) {
      setError('Informe um nome válido (até 120 caracteres).');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Informe um email válido.');
      return;
    }

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

    if (!planId) {
      setError('Selecione um plano.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/platform/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentAccountId,
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password,
          accountType,
          planId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Navigate to the new account detail page
        router.push(`/fire-control-x7k29/accounts/${data.accountId}`);
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (res.status === 403) {
        // Step-up required — redirect to verify page
        router.push('/fire-control-x7k29/verify');
        return;
      }

      setError(data?.error ?? 'Erro ao criar conta. Tente novamente.');
    } catch (err) {
      setError('Erro ao criar conta. Tente novamente.');
      console.error('[CreateAccountForm] submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          Nova Conta — {accountType === 'USER' ? 'Usuário' : 'Revendedor'}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Criando uma nova conta abaixo de{' '}
          <Badge variant="outline">{parentName}</Badge>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Nome da Conta</Label>
            <Input
              id="name"
              placeholder="Ex: João da Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              className="border-border bg-muted text-foreground focus-visible:border-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email do Usuário</Label>
            <Input
              id="email"
              type="email"
              placeholder="usuario@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-border bg-muted text-foreground focus-visible:border-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Senha Inicial</Label>
            <Input
              id="password"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="border-border bg-muted text-foreground focus-visible:border-primary"
            />
            <p className="text-xs text-muted-foreground">
              A senha será usada para o primeiro acesso do usuário à plataforma.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan">Plano</Label>
            <Select
              value={planId ?? undefined}
              onValueChange={(value: string | null) => (value ? setPlanId(value) : null)}
              disabled={loading || plans.length === 0}
            >
              <SelectTrigger
                id="plan"
                className="border-border bg-muted text-foreground focus:ring-primary"
              >
                <SelectValue placeholder="Selecione um plano" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <div>
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {plan.code}
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {planId && (
              <p className="text-xs text-muted-foreground">
                Plano selecionado: <strong>{getPlanName(planId)}</strong>
              </p>
            )}
          </div>

          <div className="border-border border-t pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Tipo de conta:</span>
              <Badge variant="outline">
                {accountType === 'USER' ? 'Usuário' : 'Revendedor'}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Conta pai: {parentName}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={submitting || loading || !planId}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? 'Criando...' : 'Criar Conta'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={submitting}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
