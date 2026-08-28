'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { parseISO, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  User,
  Shield,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const TYPE_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESELLER: 'Revendedor',
  PLATFORM: 'Plataforma',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  USER: <User className="h-4 w-4" />,
  RESELLER: <Shield className="h-4 w-4" />,
  PLATFORM: <Shield className="h-4 w-4 text-primary" />,
};

const STATUS_VARIANT: Record<
  string,
  'default' | 'outline' | 'destructive' | 'secondary'
> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  BANNED: 'Banida',
};

interface AccountRow {
  id: string;
  name: string;
  email: string;
  account_type: string;
  status: string;
  plan_name: string | null;
  subscription_status: string | null;
  expires_at: string | null;
  created_at: string;
  last_access_at: string | null;
  parent_name: string | null;
  tree_depth: number;
  quota_used: number;
  quota_total: number;
}

interface AccountListResponse {
  accounts: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  plans: { id: string; name: string }[];
}

async function fetchAccounts(
  page: number,
  pageSize: number,
  search: string,
  statusFilter: string,
  typeFilter: string,
  planFilter: string
): Promise<AccountListResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    search,
    status: statusFilter,
    type: typeFilter,
    plan: planFilter,
  });

  const res = await fetch(`/api/platform/accounts?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch accounts');
  }
  return res.json();
}

const statusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'SUSPENDED', label: 'Suspensas' },
  { value: 'BANNED', label: 'Banidas' },
];

const typeOptions = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'USER', label: 'Usuário' },
  { value: 'RESELLER', label: 'Revendedor' },
  { value: 'PLATFORM', label: 'Plataforma' },
];

export default function AccountListClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<AccountListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const page = Number(searchParams.get('page') ?? 1);
  const pageSize = 20;

  const query = useMemo(
    () => ({
      search: searchParams.get('search') ?? '',
      status: searchParams.get('status') ?? 'all',
      type: searchParams.get('type') ?? 'all',
      plan: searchParams.get('plan') ?? 'all',
    }),
    [searchParams]
  );

  const updateURL = (params: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(params).forEach(([k, v]) => {
      if (v && v !== 'all') {
        newParams.set(k, v);
      } else {
        newParams.delete(k);
      }
    });
    router.replace(`?${newParams.toString()}`);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchAccounts(
          page,
          pageSize,
          query.search,
          query.status,
          query.type,
          query.plan
        );
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        console.error('[AccountList] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, query, router]);

  if (loading || !data) {
    return <div>Carregando...</div>;
  }

  const { accounts, total, totalPages, plans } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total} contas encontradas. Gerencie todas as contas da plataforma.
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou email..."
              className="pl-10"
              defaultValue={query.search}
              onChange={(e) => {
                const value = e.target.value;
                const timeout = setTimeout(() => {
                  updateURL({ search: value });
                }, 300);
                return () => clearTimeout(timeout);
              }}
            />
          </div>

          <Select
            value={query.status}
            onValueChange={(v: string | null) =>
              updateURL({ status: v ?? 'all' })
            }
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

<Select
            value={query.type}
            onValueChange={(v: string | null) =>
              updateURL({ type: v ?? 'all' })
            }
          >            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

<Select
            value={query.plan}
            onValueChange={(v: string | null) =>
              updateURL({ plan: v ?? 'all' })
            }
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Plano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os planos</SelectItem>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Uso</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell>
                  <div>
                    <div className="font-medium text-foreground">
                      {account.name}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {account.email}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {TYPE_ICON[account.account_type]}
                    {TYPE_LABEL[account.account_type] ?? account.account_type}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[account.status] ?? 'outline'}>
                    {STATUS_LABEL[account.status] ?? account.status}
                  </Badge>
                </TableCell>
                <TableCell>{account.plan_name ?? '—'}</TableCell>
                <TableCell>
                  {account.expires_at
                    ? new Date(account.expires_at).toLocaleDateString('pt-BR')
                    : '—'}
                </TableCell>
                <TableCell>
                  {account.quota_total > 0
                    ? `${account.quota_used}/${account.quota_total}`
                    : '—'}
                </TableCell>
                <TableCell>
                  {formatDistanceToNow(parseISO(account.created_at), {
                    addSuffix: true,
                    locale: ptBR,
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/fire-control-x7k29/accounts/${account.id}`}>
                    <Button variant="ghost" size="sm">
                      Ver detalhes
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {total} contas encontradas
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => updateURL({ page: (page - 1).toString() })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Página {page} de {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || totalPages === 0}
            onClick={() => updateURL({ page: (page + 1).toString() })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
