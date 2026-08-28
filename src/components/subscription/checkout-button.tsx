'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CheckoutButtonProps {
  planId: string;
  planName: string;
}

export function CheckoutButton({ planId, planName }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Erro ao iniciar pagamento');
        setLoading(false);
        return;
      }

      // Redirect to Mercado Pago checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setError('URL de pagamento não recebida');
        setLoading(false);
      }
    } catch {
      setError('Erro de conexão');
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <Button
        className="w-full"
        size="lg"
        onClick={handleCheckout}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redirecionando...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            Assinar {planName}
          </>
        )}
      </Button>
      {error && (
        <p className="text-destructive mt-2 text-center text-sm">{error}</p>
      )}
    </div>
  );
}
