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
import { UsersRound } from 'lucide-react';

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
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
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

    // Server-side login with per-IP rate limiting (brute-force protection).
    // The API route calls supabase.auth.signInWithPassword() and returns
    // a generic error message to avoid leaking whether the email exists.
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

    // Full-page navigation (not router.push) so the browser issues a
    // fresh top-level request that carries the just-written Supabase
    // auth cookies to the middleware gating /dashboard. A soft
    // client-side navigation can reach the protected route before the
    // server observes the new session, so the middleware bounces it
    // back to /login — which looks like the page "just refreshing"
    // instead of signing in (issue #365). Mirrors the deliberate full
    // reload the invite-accept flow already uses in join/[token].
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
        <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
          <UsersRound className="text-primary h-6 w-6" />
        </div>
      )}
      <form onSubmit={handleLogin} className="flex flex-col gap-5">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground text-sm font-medium">
            {t('emailLabel')}
          </Label>
          <Input
            id="email"
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-muted-foreground text-sm font-medium">
              {t('passwordLabel')}
            </Label>
            <Link
              href="/forgot-password"
              className="text-primary/80 hover:text-primary text-xs font-medium transition-colors"
            >
              {t('forgotPassword')}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="border-border/60 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-primary/15 h-11 transition-colors"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="fire-gradient-btn text-white font-semibold mt-1 h-11 w-full rounded-lg text-sm tracking-wide shadow-[0_4px_20px_rgba(255,107,26,0.25)] transition-all hover:shadow-[0_4px_28px_rgba(255,107,26,0.35)] disabled:opacity-50"
        >
          {loading ? t('signingIn') : t('signIn')}
        </Button>
      </form>

      <p className="text-muted-foreground/70 mt-8 text-center text-sm">
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
