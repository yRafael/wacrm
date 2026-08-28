'use client';

import { useCallback } from 'react';
import { SecurityWarning } from '@/components/security/security-warning';
import { DevToolsGuard } from '@/components/security/devtools-guard';
import { DevToolsDetectedBanner } from '@/components/security/devtools-detected-banner';
import { logSecurityEvent } from '@/lib/security/log-event';

/**
 * Root-level security dissuasion layer.
 *
 * Wraps the entire app so DevTools blocking, the legal warning modal,
 * and the detected banner are present on EVERY page — /login, /pricing,
 * /dashboard, etc.
 *
 * This is UX only. Real enforcement is server-side.
 */
export function SecurityLayer({ children }: { children: React.ReactNode }) {
  const handleDevToolsDetected = useCallback((method: string) => {
    logSecurityEvent({
      action: 'SECURITY_DEVTOOLS_DETECTED',
      metadata: { method },
    });
  }, []);

  return (
    <DevToolsGuard>
      {children}
      <SecurityWarning onDevToolsDetected={handleDevToolsDetected} />
      <DevToolsDetectedBanner onDetected={handleDevToolsDetected} />
    </DevToolsGuard>
  );
}
