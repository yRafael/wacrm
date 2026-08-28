'use client';

import { useState } from 'react';
import { ChevronLeft, Clock, User, Shield } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { ActivityItem } from '@/lib/platform/activity';
import { getActionIcon, formatRelativeTime } from '@/lib/platform/activity';

interface AuditListClientProps {
  audit: ActivityItem[];
}

const ACTION_LABEL: Record<string, string> = {
  account_created: 'Conta criada',
  account_activated: 'Conta ativada',
  account_suspended: 'Conta suspensa',
  plan_changed: 'Plano alterado',
  subscription_started: 'Assinatura iniciada',
  login_success: 'Login realizado',
  login_failed: 'Falha no login',
  bulk_import: 'Importação em massa',
  user_invited: 'Usuário convidado',
  user_removed: 'Usuário removido',
};

function getActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export default function AuditListClient({ audit }: AuditListClientProps) {
  const [search, setSearch] = useState('');

  const filtered = audit.filter(
    (a) =>
      a.action.toLowerCase().includes(search.toLowerCase()) ||
      (a.metadata?.actor_name as string | undefined)?.toLowerCase().includes(search.toLowerCase()) ||
      (a.metadata?.target_name as string | undefined)?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Auditoria</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {audit.length} eventos registrados.
          </p>
        </div>
      </div>

      <div className="max-w-md">
        <Input
          placeholder="Filtrar eventos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <div className="divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Nenhum evento encontrado.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="text-2xl mt-0.5">{getActionIcon(item.action)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">
                      {getActionLabel(item.action)}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {item.metadata?.ip as string | undefined ?? '—'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    {item.metadata?.target_name
                      ? `Alvo: ${String(item.metadata.target_name)}`
                      : ''}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatRelativeTime(item.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {String(item.metadata?.actor_name ?? 'Sistema')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
