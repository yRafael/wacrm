'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  UserCog,
  FileText,
  CreditCard,
  Network,
  ClipboardList,
  Monitor,
  ShieldAlert,
  HeartPulse,
  Settings,
  Plug,
  ScrollText,
  Package,
  HardDrive,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: 'OVERVIEW',
    items: [{ href: '/fire-control-x7k29', label: 'Visão geral', icon: LayoutDashboard }],
  },
  {
    label: 'PLATAFORMA',
    items: [
      { href: '/fire-control-x7k29/accounts', label: 'Contas', icon: Users },
      { href: '/fire-control-x7k29/resellers', label: 'Revendedores', icon: UserCog },
      { href: '/fire-control-x7k29/plans', label: 'Planos', icon: FileText },
      { href: '/fire-control-x7k29/subscriptions', label: 'Assinaturas', icon: CreditCard },
      { href: '/fire-control-x7k29/tree', label: 'Árvore de rede', icon: Network },
    ],
  },
  {
    label: 'SEGURANÇA',
    items: [
      { href: '/fire-control-x7k29/audit', label: 'Auditoria', icon: ClipboardList },
      { href: '/fire-control-x7k29/sessions', label: 'Sessões', icon: Monitor },
      { href: '/fire-control-x7k29/security-events', label: 'Eventos de segurança', icon: ShieldAlert },
    ],
  },
  {
    label: 'OPERAÇÃO',
    items: [
      { href: '/fire-control-x7k29/health', label: 'Saúde da plataforma', icon: HeartPulse },
      { href: '/fire-control-x7k29/jobs', label: 'Jobs', icon: Settings },
      { href: '/fire-control-x7k29/integrations', label: 'Integrações', icon: Plug },
      { href: '/fire-control-x7k29/logs', label: 'Logs técnicos', icon: ScrollText },
    ],
  },
  {
    label: 'DADOS',
    items: [
      { href: '/fire-control-x7k29/exports', label: 'Exportações', icon: Package },
      { href: '/fire-control-x7k29/backups', label: 'Backups', icon: HardDrive },
    ],
  },
];

export default function FireControlSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
      <div className="border-b border-border p-4">
        <h1 className="text-primary text-xl font-bold">Fire Control</h1>
        <p className="text-muted-foreground text-xs">Centro de controle da plataforma</p>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="text-muted-foreground mb-1 px-3 text-xs font-semibold tracking-wider uppercase">
              {section.label}
            </p>
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar ao Workspace</span>
        </Link>
      </div>
    </aside>
  );
}
