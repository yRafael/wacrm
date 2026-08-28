'use client';

import { type ReactNode, useState } from 'react';
import FireControlHeader from '@/components/fire-control/header';
import FireControlSidebar from '@/components/fire-control/sidebar';

interface FireControlLayoutProps {
  children: ReactNode;
  headerNotificationCount?: number;
}

export default function FireControlLayout({
  children,
  headerNotificationCount = 0,
}: FireControlLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <FireControlHeader
        notificationCount={headerNotificationCount}
        onMenuClick={() => setSidebarOpen(true)}
      />
      <div className="flex">
        {/* Desktop sidebar - always visible on md+ */}
        <div className="hidden md:block">
          <FireControlSidebar />
        </div>

        {/* Mobile sidebar - overlay when open */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <FireControlSidebar />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-x-hidden md:ml-0">
          <div className="p-6 sm:p-8">
            <div className="mx-auto max-w-7xl">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
