'use client';

import { useState } from 'react';
import { Gift, Ban, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SubscriptionGrantProps {
  accountId: string;
  subscriptionStatus: string | null;
  onSuccess: () => void;
}

type GrantType = 'manual' | 'courtesy' | 'promotional';

const GRANT_TYPE_LABELS: Record<GrantType, string> = {
  manual: 'Manual',
  courtesy: 'Cortesia',
  promotional: 'Promocional',
};

export function SubscriptionGrant({
  accountId,
  subscriptionStatus,
  onSuccess,
}: SubscriptionGrantProps) {
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Grant form state
  const [grantType, setGrantType] = useState<GrantType>('courtesy');
  const [durationMode, setDurationMode] = useState<'period' | 'indefinite'>('period');
  const [durationDays, setDurationDays] = useState(30);
  const [grantReason, setGrantReason] = useState('');

  // Revoke form state
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeStatus, setRevokeStatus] = useState<'EXPIRED' | 'CANCELED'>('EXPIRED');

  const handleGrant = async () => {
    if (!grantReason.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/fire-control/subscriptions/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          subscription_type: grantType,
          duration_days: durationMode === 'period' ? durationDays : null,
          reason: grantReason.trim(),
        }),
      });
      if (res.ok) {
        setGrantOpen(false);
        setGrantReason('');
        onSuccess();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeReason.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/fire-control/subscriptions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          reason: revokeReason.trim(),
          status: revokeStatus,
        }),
      });
      if (res.ok) {
        setRevokeOpen(false);
        setRevokeReason('');
        onSuccess();
      }
    } finally {
      setLoading(false);
    }
  };

  const hasActiveSub = subscriptionStatus && !['EXPIRED', 'CANCELED'].includes(subscriptionStatus);

  return (
    <>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setGrantOpen(true)}>
          <Gift className="mr-2 h-4 w-4" />
          Conceder acesso
        </Button>
        {hasActiveSub && (
          <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
            <Ban className="mr-2 h-4 w-4" />
            Revogar acesso
          </Button>
        )}
      </div>

      {/* Grant Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conceder Acesso Manual</DialogTitle>
            <DialogDescription>
              Conceda acesso a esta conta. Uma entrada será gerada em auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <RadioGroup
                value={grantType}
                onValueChange={(v) => setGrantType(v as GrantType)}
                className="flex gap-4"
              >
                {(Object.keys(GRANT_TYPE_LABELS) as GrantType[]).map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <RadioGroupItem value={type} id={`grant-${type}`} />
                    <Label htmlFor={`grant-${type}`} className="font-normal">
                      {GRANT_TYPE_LABELS[type]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Duração</Label>
              <RadioGroup
                value={durationMode}
                onValueChange={(v) => setDurationMode(v as 'period' | 'indefinite')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="period" id="dur-period" />
                  <Label htmlFor="dur-period" className="font-normal">
                    Por período
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="indefinite" id="dur-indefinite" />
                  <Label htmlFor="dur-indefinite" className="font-normal">
                    Indeterminado
                  </Label>
                </div>
              </RadioGroup>
              {durationMode === 'period' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    className="border-input bg-background h-9 w-20 rounded-md border px-3 text-sm"
                  />
                  <span className="text-muted-foreground text-sm">dias</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="grant-reason">Motivo (obrigatório)</Label>
              <Textarea
                id="grant-reason"
                placeholder="Ex: Parceria, cortesia para demo, pagamento via PIX..."
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleGrant}
              disabled={loading || !grantReason.trim()}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Gift className="mr-2 h-4 w-4" />
              )}
              Confirmar concessão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Dialog */}
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revogar Acesso</DialogTitle>
            <DialogDescription>
              Revogar o acesso desta conta. Uma entrada será gerada em auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de revogação</Label>
              <RadioGroup
                value={revokeStatus}
                onValueChange={(v) => setRevokeStatus(v as 'EXPIRED' | 'CANCELED')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="EXPIRED" id="revoke-expired" />
                  <Label htmlFor="revoke-expired" className="font-normal">
                    Expirar
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="CANCELED" id="revoke-canceled" />
                  <Label htmlFor="revoke-canceled" className="font-normal">
                    Cancelar
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="revoke-reason">Motivo (obrigatório)</Label>
              <Textarea
                id="revoke-reason"
                placeholder="Ex: Violação dos termos, cancelamento solicitado..."
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={loading || !revokeReason.trim()}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Ban className="mr-2 h-4 w-4" />
              )}
              Confirmar revogação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
