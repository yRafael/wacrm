'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/components/auth/auth-layout';
import { Loader2, Lock, CheckCircle2 } from 'lucide-react';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validating, setValidating] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const supabase = createClient();

  // Verify the user has a valid recovery session
  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setValidating(false);
      return;
    }

    // The auth callback already exchanged the code for a session.
    // Check if we're authenticated.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setValidSession(!!session);
      setValidating(false);
    });
  }, [searchParams, supabase]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (validating) {
    return (
      <AuthLayout title="Redefinir senha" description="Verificando...">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (!validSession) {
    return (
      <AuthLayout
        title="Link inválido ou expirado"
        description="Solicite um novo link de redefinição de senha."
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
            <Lock className="h-7 w-7 text-red-400" />
          </div>
          <p className="text-muted-foreground/60 text-sm leading-relaxed">
            O link de redefinição de senha é válido por tempo limitado.
            Solicite um novo link para continuar.
          </p>
          <Link href="/forgot-password" className="mt-2 w-full">
            <Button
              type="button"
              className="fire-gradient-btn text-white font-semibold h-11 w-full rounded-xl text-sm tracking-wide shadow-[0_4px_24px_rgba(255,107,26,0.2)] transition-all hover:shadow-[0_4px_32px_rgba(255,107,26,0.3)]"
            >
              Solicitar novo link
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Senha redefinida" description="">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="space-y-2">
            <p className="text-foreground text-sm font-medium">
              Senha atualizada com sucesso!
            </p>
            <p className="text-muted-foreground/60 text-xs leading-relaxed">
              Agora você pode fazer login com sua nova senha.
            </p>
          </div>
          <Link href="/login" className="mt-2 w-full">
            <Button
              type="button"
              className="fire-gradient-btn text-white font-semibold h-11 w-full rounded-xl text-sm tracking-wide shadow-[0_4px_24px_rgba(255,107,26,0.2)] transition-all hover:shadow-[0_4px_32px_rgba(255,107,26,0.3)]"
            >
              Ir para o login
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Redefinir senha"
      description="Digite sua nova senha abaixo."
    >
      <form onSubmit={handleReset} className="flex flex-col gap-3.5">
        {error && (
          <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="password"
            className="text-muted-foreground text-xs font-medium"
          >
            Nova senha
          </Label>
          <div className="relative">
            <Lock className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="password"
              type="password"
              placeholder="Pelo menos 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="confirmPassword"
            className="text-muted-foreground text-xs font-medium"
          >
            Confirmar nova senha
          </Label>
          <div className="relative">
            <Lock className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Repita sua senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="fire-gradient-btn text-white font-semibold mt-1 h-11 w-full rounded-xl text-sm tracking-wide shadow-[0_4px_24px_rgba(255,107,26,0.2)] transition-all hover:shadow-[0_4px_32px_rgba(255,107,26,0.3)] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {loading ? 'Redefinindo...' : 'Redefinir senha'}
        </Button>
      </form>

      <p className="text-muted-foreground/50 mt-6 text-center text-sm">
        Lembrou sua senha?{' '}
        <Link
          href="/login"
          className="text-primary hover:text-primary/80 font-medium transition-colors"
        >
          Voltar para o login
        </Link>
      </p>
    </AuthLayout>
  );
}
