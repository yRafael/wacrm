'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/components/auth/auth-layout';
import { UsersRound, Loader2, Mail, Lock } from 'lucide-react';

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const t = useTranslations('LoginPage');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Login failed');
      setLoading(false);
      return;
    }

    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : '/dashboard';
    window.location.href = destination;
  };

  return (
    <AuthLayout
      title={inviteToken ? t('titleAccept') : t('titleWelcome')}
      description={inviteToken ? t('descAccept') : t('descWelcome')}
    >
      {inviteToken && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/10 bg-primary/5 px-4 py-3">
          <div className="bg-primary/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <UsersRound className="text-primary h-4 w-4" />
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Você foi convidado para uma equipe. Faça login para aceitar o convite.
          </p>
        </div>
      )}

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-muted-foreground text-xs font-medium">
            {t('emailLabel')}
          </Label>
          <div className="relative">
            <Mail className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-muted-foreground text-xs font-medium">
              {t('passwordLabel')}
            </Label>
            <Link
              href="/forgot-password"
              className="text-primary/70 hover:text-primary text-xs font-medium transition-colors"
            >
              {t('forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <Lock className="text-muted-foreground/40 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="password"
              type="password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 border-white/[0.06] bg-white/[0.025] pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="fire-gradient-btn text-white font-semibold mt-2 h-11 w-full rounded-xl text-sm tracking-wide shadow-[0_4px_24px_rgba(255,107,26,0.2)] transition-all hover:shadow-[0_4px_32px_rgba(255,107,26,0.3)] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {loading ? t('signingIn') : t('signIn')}
        </Button>
      </form>

      <p className="text-muted-foreground/50 mt-6 text-center text-sm">
        {t('noAccount')}{' '}
        <Link
          href={
            inviteToken
              ? `/signup?invite=${encodeURIComponent(inviteToken)}`
              : '/signup'
          }
          className="text-primary hover:text-primary/80 font-medium transition-colors"
        >
          {t('createAccount')}
        </Link>
      </p>
    </AuthLayout>
  );
}
