'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/components/auth/auth-layout';

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get('invite');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
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

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthLayout title="Verifique seu e-mail" description="">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-muted-foreground text-sm">
            Enviamos um link de confirmação para{' '}
            <span className="text-foreground">{email}</span>. Verifique sua
            caixa de entrada e clique no link para confirmar sua conta.
          </p>
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : '/login'
            }
          >
            <Button
              variant="outline"
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
            >
              Voltar para o login
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={inviteToken ? 'Criar conta e entrar' : 'Criar conta'}
      description={
        inviteToken
          ? 'Verifique seu e-mail e depois aceite o convite para entrar na sua equipe.'
          : 'Comece com o CRM e automação para WhatsApp.'
      }
    >
      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName" className="text-muted-foreground text-sm font-medium">
            Nome completo
          </Label>
          <Input
            id="fullName"
            type="text"
            placeholder="João da Silva"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground text-sm font-medium">
            E-mail
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-muted-foreground text-sm font-medium">
            Senha
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="Pelo menos 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="confirmPassword"
            className="text-muted-foreground text-sm font-medium"
          >
            Confirmar senha
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repita sua senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="fire-gradient-btn text-white font-semibold mt-1 h-11 w-full rounded-lg text-sm tracking-wide shadow-[0_4px_20px_rgba(255,107,26,0.25)] transition-all hover:shadow-[0_4px_28px_rgba(255,107,26,0.35)] disabled:opacity-50"
        >
          {loading ? 'Criando conta...' : 'Criar conta'}
        </Button>
      </form>

      <p className="text-muted-foreground/70 mt-8 text-center text-sm">
        Já tem uma conta?{' '}
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : '/login'
          }
          className="text-primary hover:text-primary/80 font-medium transition-colors"
        >
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}
