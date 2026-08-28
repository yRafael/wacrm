'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Flame } from 'lucide-react';

// Step-up gate for the Fire Control (doc §2.3). Even an already
// logged-in operator must re-enter the password; the grant cookie
// is issued by POST /api/platform/step-up and expires in 15 min.
export default function FireControlVerifyPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/platform/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      // Full-page navigation so the browser sends a fresh top-level
      // request carrying the just-set grant cookie to the middleware.
      window.location.href = '/fire-control-x7k29';
      return;
    }

    const data = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    setError(data?.error ?? 'Falha na verificação. Tente novamente.');
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-6 flex flex-col items-center gap-1 text-center">
        <div className="bg-primary/10 mb-1 flex h-12 w-12 items-center justify-center rounded-xl">
          <Flame className="text-primary h-6 w-6" />
        </div>
        <span className="text-foreground text-lg font-bold tracking-wide">
          FIRE CONTROL
        </span>
        <span className="text-muted-foreground text-xs font-semibold tracking-[0.35em] uppercase">
          Verificação adicional
        </span>
      </div>
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-foreground text-xl">
            Confirme sua identidade
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Você está logado, mas o painel exige uma reautenticação.
            Digite sua senha para abrir o Fire Control. O acesso expira
            em 15 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                autoFocus
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Abrir Fire Control'}
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            <Link
              href="/dashboard"
              className="text-primary hover:text-primary/80"
            >
              Voltar ao Workspace
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}