'use client';

import { parseISO, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CreditCard, Calendar, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useState, useMemo } from 'react';

interface SubscriptionRow {
  id: string;
  status: string;
  started_at: string;
  expires_at: string | null;
  created_at: string;
  accounts: {
    id: string;
    name: string;
    account_type: string;
    status: string;
  }[];
  platform_plans: {
    id: string;
    name: string;
    code: string;
  }[];
}

interface SubscriptionListClientProps {
  subscriptions: SubscriptionRow[];
}

const STATUS_VARIANT: Record<
  string,
  'default' | 'outline' | 'destructive' | 'secondary'
> = {
  TRIAL: 'secondary',
  ACTIVE: 'default',
  PAST_DUE: 'secondary',
  SUSPENDED: 'secondary',
  CANCELED: 'destructive',
  EXPIRED: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
};

const TYPE_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESELLER: 'Revendedor',
  PLATFORM: 'Plataforma',
};

export default function SubscriptionListClient({
  subscriptions,
}: SubscriptionListClientProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return subscriptions;
    const term = search.toLowerCase();
    return subscriptions.filter(
      (s) =>
        s.accounts?.[0]?.name?.toLowerCase().includes(term) ||
        s.platform_plans?.[0]?.name?.toLowerCase().includes(term) ||
        s.platform_plans?.[0]?.code?.toLowerCase().includes(term)
    );
  }, [search, subscriptions]);

  // Summary stats
  const summary = useMemo(
    () => ({
      total: subscriptions.length,
      active: subscriptions.filter((s) => s.status === 'ACTIVE').length,
      trial: subscriptions.filter((s) => s.status === 'TRIAL').length,
      pastDue: subscriptions.filter((s) => s.status === 'PAST_DUE').length,
      blocked: subscriptions.filter((s) =>
        ['SUSPENDED', 'CANCELED', 'EXPIRED'].includes(s.status)
      ).length,
      expiringSoon: subscriptions.filter(
        (s) =>
          s.expires_at &&
          new Date(s.expires_at).getTime() - Date.now() < 7 * 86400000
      ).length,
    }),
    [subscriptions]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Assinaturas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {summary.total} assinaturas no total. {summary.active} ativas,{' '}
            {summary.trial} em trial.
          </p>
        </div>
        <Button variant="outline">
          <TrendingUp className="h-4 w-4 mr-2" />
          {summary.expiringSoon} vencendo em 7 dias
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 rounded-lg p-2">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{summary.active}</p>
              <p className="text-xs text-muted-foreground">Ativas</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <div className="bg-secondary/20 rounded-lg p-2">
              <Calendar className="h-5 w-5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{summary.trial}</p>
              <p className="text-xs text-muted-foreground">Em trial</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <div className="bg-amber-500/10 rounded-lg p-2">
              <Calendar className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">{summary.pastDue}</p>
              <p className="text-xs text-muted-foreground">Em atraso</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <div className="bg-red-500/10 rounded-lg p-2">
              <CreditCard className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{summary.blocked}</p>
              <p className="text-xs text-muted-foreground">Bloqueadas</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <Input
          placeholder="Buscar por conta, plano ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-border bg-muted"
        />
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Iniciada em</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <p className="text-muted-foreground">Nenhuma assinatura encontrada.</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium text-foreground">
                        {sub.accounts?.[0]?.name ?? 'Conta desconhecida'}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABEL[sub.accounts?.[0]?.account_type ?? ''] ??
                          sub.accounts?.[0]?.account_type ?? '—'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium text-foreground">
                        {sub.platform_plans?.[0]?.name ?? '—'}
                      </div>
                      <code className="text-xs text-muted-foreground">
                        {sub.platform_plans?.[0]?.code ?? '—'}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[sub.status] ?? 'outline'}>
                      {STATUS_LABEL[sub.status] ?? sub.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(parseISO(sub.started_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </TableCell>
                  <TableCell>
                    {sub.expires_at
                      ? new Date(sub.expires_at).toLocaleDateString('pt-BR')
                      : '—'}
                  </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/fire-control-x7k29/accounts/${sub.accounts?.[0]?.id ?? ''}`}>
                        <Button variant="ghost" size="sm">
                          Ver conta
                        </Button>
                      </Link>
                    </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
