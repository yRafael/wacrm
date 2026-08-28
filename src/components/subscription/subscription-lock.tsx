import Link from 'next/link';
import { Lock, Calendar, CreditCard, HelpCircle } from 'lucide-react';
import type { SubscriptionStatus } from '@/lib/subscription/gating';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SubscriptionLockProps {
  status: SubscriptionStatus | null;
  expiresAt: string | null;
  planName: string | null;
  message: string;
}

export default function SubscriptionLock({
  status,
  expiresAt,
  planName,
  message,
}: SubscriptionLockProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg">
        <div className="border-border bg-card rounded-xl border p-10 text-center">
          <div className="bg-primary/10 mb-6 flex h-16 w-16 items-center justify-center rounded-full mx-auto">
            <Lock className="h-8 w-8 text-primary" />
          </div>

          <h1 className="text-foreground text-2xl font-bold mb-3">
            Acesso restrito
          </h1>

          <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
            {message}
          </p>

          {status && (
            <div className="border-border border-t border-b py-4 mb-6 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status da assinatura</span>
                <Badge variant="secondary">{status}</Badge>
              </div>
              {planName && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Plano atual</span>
                  <span className="text-foreground">{planName}</span>
                </div>
              )}
              {expiresAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Vencimento</span>
                  <span className="text-foreground">
                    {new Date(expiresAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 h-10">
              <Link
                href="/pricing"
                className="flex items-center justify-center gap-2 w-full text-primary-foreground no-underline"
              >
                <CreditCard className="h-4 w-4" />
                Regularizar assinatura
              </Link>
            </Button>

            {expiresAt && (
              <Button variant="outline" size="sm">
                <Link
                  href="/billing/portal"
                  className="flex items-center justify-center gap-2 w-full text-muted-foreground no-underline"
                >
                  <Calendar className="h-4 w-4" />
                  Gerenciar pagamento
                </Link>
              </Button>
            )}

            <Button variant="link" size="sm">
              <Link
                href="/support"
                className="flex items-center justify-center gap-2 w-full text-muted-foreground no-underline"
              >
                <HelpCircle className="h-4 w-4" />
                Fale com o suporte
              </Link>
            </Button>
          </div>

          <p className="text-muted-foreground mt-6 text-center text-xs">
            Precisa de ajuda? Entre em contato: support@fireplay.com
          </p>
        </div>
      </div>
    </div>
  );
}
