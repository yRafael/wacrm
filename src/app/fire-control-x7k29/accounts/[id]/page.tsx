import { type Metadata } from 'next';
import FireControlLayout from '@/components/fire-control/fire-control-layout';
import AccountDetail from '@/components/fire-control/account-detail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Detalhes da Conta — Fire Control',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <FireControlLayout>
      <AccountDetail accountId={id} />
    </FireControlLayout>
  );
}
