'use client';

import { useTranslations } from 'next-intl';
import { ClientsTable } from '@/components/clients/clients-table';

export default function ClientsPage() {
  const t = useTranslations('Clients');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <ClientsTable />
    </div>
  );
}
