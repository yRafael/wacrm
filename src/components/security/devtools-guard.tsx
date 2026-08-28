'use client';

import { useEffect } from 'react';

// AVISO: este bloqueio é puramente dissuasivo (UX).
// NÃO é uma camada de segurança. Qualquer decisão de autorização,
// acesso a dado ou validação de plano DEVE continuar sendo feita
// exclusivamente no backend, independente deste código existir ou não.

interface DevToolsGuardProps {
  children: React.ReactNode;
  /** Set to false to disable all blocking (e.g. for admin/debug mode) */
  enabled?: boolean;
}

/**
 * Client-side DevTools dissuasion layer.
 *
 * Blocks common DevTools keyboard shortcuts and disables the context
 * menu. This is NOT security — it's UX friction to discourage casual
 * inspection by non-technical users. Any developer or attacker can
 * trivially bypass this (different browser, proxy, disabling JS, etc.).
 *
 * The real security enforcement lives in:
 * - src/middleware.ts (edge auth + subscription check)
 * - src/lib/auth/account.ts (server-side account context)
 * - src/lib/auth/api-context.ts (API key auth + subscription)
 */
export function DevToolsGuard({
  children,
  enabled = true,
}: DevToolsGuardProps) {
  console.log('[DevToolsGuard] rendered, enabled=', enabled);

  useEffect(() => {
    console.log('[DevToolsGuard] effect running, enabled=', enabled);
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block F12
      if (e.key === 'F12') {
        console.log('[DevToolsGuard] blocked F12');
        e.preventDefault();
        return;
      }

      // Block Ctrl+Shift+I (Inspect), Ctrl+Shift+J (Console),
      // Ctrl+Shift+C (Element picker), Ctrl+U (View source)
      if (e.ctrlKey && e.shiftKey) {
        const key = e.key.toUpperCase();
        if (key === 'I' || key === 'J' || key === 'C') {
          console.log('[DevToolsGuard] blocked Ctrl+Shift+' + key);
          e.preventDefault();
          return;
        }
      }

      // Ctrl+U (View source)
      if (e.ctrlKey && e.key.toUpperCase() === 'U') {
        console.log('[DevToolsGuard] blocked Ctrl+U');
        e.preventDefault();
        return;
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Disable right-click context menu
      e.preventDefault();
    };

    console.log('[DevToolsGuard] attaching event listeners');
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      console.log('[DevToolsGuard] cleaning up event listeners');
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [enabled]);

  return <>{children}</>;
}
