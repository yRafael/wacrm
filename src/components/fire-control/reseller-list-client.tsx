'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

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

interface ResellerRow {
  id: string;
  name: string | null;
  status: string;
  created_at: string;
  quota_used: number | null;
  quota_total: number | null;
}

interface SubscriptionRow {
  account_id: string;
  plan_id: string;
  status: string;
  expires_at: string | null;
}

interface ResellerListClientProps {
  resellers: ResellerRow[];
  subs: SubscriptionRow[];
  planNameById: Map<string, string>;
}

const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'destructive' | 'secondary'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
  TRIAL: 'secondary',
  PAST_DUE: 'secondary',
  CANCELED: 'destructive',
  EXPIRED: 'destructive',
};

export default function ResellerListClient({
  resellers,
  subs,
  planNameById,
}: ResellerListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const SEARCH_DEBOUNCE_MS = 300;

  const filteredResellers = useMemo(() => {
    if (!search.trim()) return resellers;
    const term = search.toLowerCase();
    return resellers.filter(
      (r) =>
        r.name?.toLowerCase().includes(term) ||
        r.id.toLowerCase().includes(term)
    );
  }, [search, resellers]);

  const subByAccount = useMemo(
    () =>
      new Map(
        subs.map((s) => [
          s.account_id,
          { status: s.status, expires_at: s.expires_at, plan_name: planNameById.get(s.plan_id) ?? null },
        ])
      ),
    [subs, planNameById]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (search.trim()) {
        params.set('search', search);
      } else {
        params.delete('search');
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search, router]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Revendedores</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {filteredResellers.length} revendedores listados.
          </p>
        </div>
        <Button variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar revendedor..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Revendedor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredResellers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <p className="text-muted-foreground">Nenhum revendedor encontrado.</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredResellers.map((reseller) => {
                const sub = subByAccount.get(reseller.id);
                return (
                  <TableRow key={reseller.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {reseller.name || 'Sem nome'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[sub?.status ?? reseller.status] ?? 'outline'}>
                        {sub?.status ?? reseller.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {sub?.plan_name ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {sub?.expires_at
                        ? new Date(sub.expires_at).toLocaleDateString('pt-BR')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {reseller.quota_total
                        ? `${reseller.quota_used ?? 0}/${reseller.quota_total}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {formatDistanceToNow(new Date(reseller.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/fire-control-x7k29/accounts/${reseller.id}`}>
                        <Button variant="ghost" size="sm">
                          Ver detalhes
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredResellers.length} de {resellers.length} revendedores
        </p>
      </div>
    </div>
  );
}
