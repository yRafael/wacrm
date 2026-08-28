'use client';

import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Package, ToggleLeft, ToggleRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  price_monthly: number | null;
  quota_accounts: number | null;
  quota_direct_resellers: number | null;
  max_depth: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

interface PlanListClientProps {
  plans: PlanRow[];
  totalSubscriptions: number;
}

export default function PlanListClient({ plans, totalSubscriptions }: PlanListClientProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Planos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Catálogo de planos da plataforma. {totalSubscriptions} assinaturas ativas no total.
          </p>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plano</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Profundidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <p className="text-muted-foreground">Nenhum plano cadastrado.</p>
                </TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">{plan.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground">{plan.code}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {plan.account_type === 'USER' ? 'Usuário' : 'Revendedor'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {plan.price_monthly
                      ? `R$ ${plan.price_monthly.toFixed(2)}`
                      : 'Gratuito'}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div>
                        <span className="text-muted-foreground">Contas: </span>
                        {plan.quota_accounts === null ? 'Ilimitado' : plan.quota_accounts}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Revendedores diretos: </span>
                        {plan.quota_direct_resellers === null ? 'Ilimitado' : plan.quota_direct_resellers}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{plan.max_depth} nível(veis)</TableCell>
                  <TableCell>
                    <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                      {plan.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(plan.created_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      {plan.is_active ? 'Desativar' : 'Ativar'}
                    </Button>
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
