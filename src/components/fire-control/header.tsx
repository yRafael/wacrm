'use client';

import { Bell, Menu, LogOut, Moon, Sun, User, Shield } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';

interface FireControlHeaderProps {
  notificationCount?: number;
  onMenuClick?: () => void;
}

export default function FireControlHeader({
  notificationCount = 0,
  onMenuClick,
}: FireControlHeaderProps) {
  const { toggleMode } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-foreground text-xl font-semibold">Fire Control</h1>
          <span className="text-muted-foreground hidden sm:inline-block text-sm">
            Centro de controle da plataforma
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {notificationCount > 0 && (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs"
              >
                {notificationCount > 99 ? '99+' : notificationCount}
              </Badge>
            )}
          </Button>

          <Button variant="ghost" size="icon" onClick={toggleMode}>
            <Sun className="h-5 w-5 dark:hidden" />
            <Moon className="h-5 w-5 hidden dark:block" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger className="hover:bg-muted/70 focus:bg-muted/70 data-popup-open:bg-muted/70 flex items-center gap-2 rounded-md px-1 py-1 transition-colors focus:outline-none">
              <Avatar className="h-9 w-9">
                <AvatarImage src="/placeholder-avatar.png" alt="Operador" />
                <AvatarFallback>○</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Rafael</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    rafael@fireplay.com
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <Link href="/fire-control-x7k29/profile" className="ml-2 flex-1">
                    Meu perfil
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <Link href="/fire-control-x7k29/security" className="ml-2 flex-1">
                    Segurança
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <Link href="/fire-control-x7k29/sessions" className="ml-2 flex-1">
                    Sessões
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <LogOut className="mr-2 h-4 w-4" />
                <Link href="/logout" className="ml-2 flex-1">
                  Sair
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
