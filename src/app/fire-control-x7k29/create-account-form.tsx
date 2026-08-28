'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus } from 'lucide-react';

export interface ParentOption {
  id: string;
  name: string;
  account_type: string;
}

export interface PlanOption {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

const TYPE_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESELLER: 'Revendedor',
  PLATFORM: 'Plataforma',
};

export function CreateAccountForm({
  parents,
  plans,
  defaultParentId,
}: {
  parents: ParentOption[];
  plans: PlanOption[];
  defaultParentId?: string;
}) {
  const [parentId, setParentId] = useState(defaultParentId ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState<'USER' | 'RESELLER'>(
    'RESELLER'
  );
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Plans available for the chosen type; reset the plan when the type
  // changes and the selection no longer matches.
  const availablePlans = useMemo(
    () => plans.filter((p) => p.account_type === accountType),
    [plans, accountType]
  );

  // Derived validity: if the current planId is no longer among availablePlans,
  // effectivePlanId is empty so the form correctly disables submission.
  const selectedPlanIsValid =
    planId === '' || availablePlans.some((p) => p.id === planId);
  const effectivePlanId = selectedPlanIsValid ? planId : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setSuccess(null);

    if (!parentId) {
      setError('Selecione uma conta pai.');
      return;
    }
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
    if (!effectivePlanId) {
      setError('Selecione um plano.');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/platform/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentAccountId: parentId,
        name,
        email,
        password,
        accountType,
        planId: effectivePlanId,
      }),
    });

    const data = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!res.ok) {
      setError(data?.error ?? 'Falha ao criar a conta. Tente novamente.');
      setLoading(false);
      return;
    }

    setSuccess('Conta criada! Recarregando a árvore…');
    setLoading(false);
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="parent" className="text-muted-foreground">
            Conta pai
          </Label>
          <Select value={parentId} onValueChange={(v) => v && setParentId(v)}>
            <SelectTrigger className="border-border bg-muted text-foreground w-full">
              <SelectValue placeholder="Selecione o pai" />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {parents.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name || 'Sem nome'} · {TYPE_LABEL[p.account_type] ?? p.account_type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="accountType" className="text-muted-foreground">
            Tipo da nova conta
          </Label>
          <Select
            value={accountType}
            onValueChange={(v) => setAccountType(v as 'USER' | 'RESELLER')}
          >
            <SelectTrigger className="border-border bg-muted text-foreground w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="RESELLER">Revendedor</SelectItem>
              <SelectItem value="USER">Usuário</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="name" className="text-muted-foreground">
            Nome
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground">
            Email (login)
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-muted-foreground">
            Senha
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="plan" className="text-muted-foreground">
            Plano
          </Label>
           <Select value={effectivePlanId} onValueChange={(v: string | null) => setPlanId(v ?? '')}>
             <SelectTrigger className="border-border bg-muted text-foreground w-full">
               <SelectValue placeholder="Selecione o plano" />
             </SelectTrigger>
             <SelectContent className="border-border bg-popover">
               {availablePlans.map((p) => (
                 <SelectItem key={p.id} value={p.id}>
                   {p.name}
                 </SelectItem>
               ))}
             </SelectContent>
           </Select>
         </div>
       </div>

      <Button
        type="submit"
        disabled={loading || !parentId || !effectivePlanId}
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 h-10 disabled:opacity-50"
      >
        <UserPlus className="size-4" />
        {loading ? 'Criando…' : 'Criar conta'}
      </Button>
    </form>
  );
}