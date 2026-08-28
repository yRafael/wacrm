'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useDevToolsDetection } from '@/hooks/use-devtools-detection';

// AVISO: este componente é puramente dissuasivo (UX).
// NÃO é uma camada de segurança. Qualquer decisão de autorização,
// acesso a dado ou validação de plano DEVE continuar sendo feita
// exclusivamente no backend, independente deste código existir ou não.

interface DevToolsDetectedBannerProps {
  /** Called when DevTools is detected — for logging purposes */
  onDetected?: (method: string) => void;
}

/**
 * Shows a non-blocking banner when DevTools opening is detected.
 * Does NOT block navigation or force logout — just displays a
 * warning. See document section 3.2 for why blocking is avoided.
 */
export function DevToolsDetectedBanner({
  onDetected,
}: DevToolsDetectedBannerProps) {
  const { isOpen, method } = useDevToolsDetection();
  const [dismissed, setDismissed] = useState(false);
  const [hasNotified, setHasNotified] = useState(false);

  console.log('[DevToolsDetectedBanner] rendered, isOpen=', isOpen, 'method=', method, 'dismissed=', dismissed);

  useEffect(() => {
    console.log('[DevToolsDetectedBanner] effect:detection, isOpen=', isOpen, 'hasNotified=', hasNotified);
    if (isOpen && !hasNotified) {
      onDetected?.(method ?? 'unknown');
      setHasNotified(true);
    }
  }, [isOpen, hasNotified, method, onDetected]);

  // Reset dismissed state if DevTools is closed and reopened
  useEffect(() => {
    if (!isOpen) {
      setDismissed(false);
      setHasNotified(false);
    }
  }, [isOpen]);

  if (!isOpen || dismissed) return null;

  return (
    <div className="bg-destructive/10 border-destructive/20 text-foreground fixed bottom-4 right-4 z-[100] flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <span>
        Ferramentas de desenvolvedor detectadas. Todas as atividades são
        monitoradas e registradas.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
