import { Suspense } from 'react';
import { type Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import AccountListClient from '@/components/fire-control/account-list-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contas — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function AccountsPage() {
  return (
    <FireControlLayout>
      <header>
        <h1 className="text-foreground text-2xl font-bold tracking-wide mb-1">
          Contas
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerencie todas as contas da plataforma — visualize status, planos e
          assinaturas, navegue pela árvore de revenda.
        </p>
      </header>

      <Suspense fallback={<div>Carregando contas...</div>}>
        <AccountListClient />
      </Suspense>
    </FireControlLayout>
  );
}
