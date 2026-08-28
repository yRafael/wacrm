'use client';

import { ChevronDown, ChevronRight, User, Shield } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AccountRow } from '@/lib/platform/tree';

interface FlatNode {
  account: AccountRow;
  depth: number;
  subscription?: {
    status: string;
    plan_name: string | null;
    expires_at: string | null;
  };
}

interface TreeListViewProps {
  nodes: FlatNode[];
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  USER: <User className="h-4 w-4" />,
  RESELLER: <Shield className="h-4 w-4" />,
  PLATFORM: <Shield className="h-4 w-4 text-primary" />,
};

const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'destructive' | 'secondary'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
  TRIAL: 'secondary',
  PAST_DUE: 'secondary',
  CANCELED: 'destructive',
  EXPIRED: 'destructive',
};

export default function TreeListView({ nodes }: TreeListViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Árvore de Rede</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {nodes.length} contas na árvore de revenda.
          </p>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Nível</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <p className="text-muted-foreground">Nenhuma conta na árvore.</p>
                </TableCell>
              </TableRow>
            ) : (
              nodes.map((node) => (
                <TableRow key={node.account.id}>
                  <TableCell>
                    <div
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${node.depth * 1.5}rem` }}
                    >
                      {node.depth > 0 && (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                      {TYPE_ICON[node.account.account_type] ?? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="font-medium text-foreground">
                        {node.account.name || 'Sem nome'}
                      </span>
                      {node.depth === 0 && (
                        <Badge variant="outline" className="text-xs">
                          ROOT
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {node.account.account_type === 'USER'
                      ? 'Usuário'
                      : node.account.account_type === 'RESELLER'
                      ? 'Revendedor'
                      : 'Plataforma'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[node.subscription?.status ?? node.account.status] ?? 'outline'}>
                      {node.subscription?.status ?? node.account.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {node.subscription?.plan_name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {node.subscription?.expires_at
                      ? new Date(node.subscription.expires_at).toLocaleDateString('pt-BR')
                      : '—'}
                  </TableCell>
                  <TableCell>{node.depth}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/fire-control-x7k29/accounts/${node.account.id}`}>
                        <Button size="sm" variant="ghost">
                          Detalhes
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
