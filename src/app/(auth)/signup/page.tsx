'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/components/auth/auth-layout';
import { Loader2, Mail, Lock, User, CheckCircle2 } from 'lucide-react';

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
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="space-y-2">
            <p className="text-foreground text-sm font-medium">
              Conta criada com sucesso!
            </p>
            <p className="text-muted-foreground/60 text-xs leading-relaxed">
              Enviamos um link de confirmação para{' '}
              <span className="text-foreground/80 font-medium">{email}</span>.
              Verifique sua caixa de entrada e clique no link para confirmar sua conta.
            </p>
          </div>
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : '/login'
            }
            className="mt-2 w-full"
          >
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl border-white/[0.06] bg-white/[0.025] text-sm font-medium text-foreground hover:bg-white/[0.05]"
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
      <form onSubmit={handleSignup} className="flex flex-col gap-3.5">
        {error && (
          <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName" className="text-muted-foreground text-xs font-medium">
            Nome completo
          </Label>
          <div className="relative">
            <User className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="fullName"
              type="text"
              placeholder="João da Silva"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-muted-foreground text-xs font-medium">
            E-mail
          </Label>
          <div className="relative">
            <Mail className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="email"
              type="email"
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-muted-foreground text-xs font-medium">
            Senha
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
            Confirmar senha
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
          {loading ? 'Criando conta...' : 'Criar conta'}
        </Button>
      </form>

      <p className="text-muted-foreground/50 mt-6 text-center text-sm">
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
