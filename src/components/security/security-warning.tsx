'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// AVISO: este componente é puramente dissuasivo (UX).
// NÃO é uma camada de segurança. Qualquer decisão de autorização,
// acesso a dado ou validação de plano DEVE continuar sendo feita
// exclusivamente no backend, independente deste código existir ou não.

const STORAGE_KEY = 'fire_security_warning_acknowledged';

interface SecurityWarningProps {
  /** Force show the warning (e.g. when DevTools is detected) */
  forceShow?: boolean;
  /** Called when DevTools is detected — for logging purposes */
  onDevToolsDetected?: (method: string) => void;
}

/**
 * Security warning modal — shown once after first login, and again
 * when DevTools opening is detected.
 *
 * Purpose: establishes legal notice (user was informed that the
 * platform is monitored and that manipulation attempts have
 * consequences). Important for potential legal action and for
 * deterring casual "script kids".
 *
 * The actual security enforcement is in the backend (middleware,
 * getCurrentAccount, requireRole). This is UX only.
 */
export function SecurityWarning({
  forceShow = false,
  onDevToolsDetected,
}: SecurityWarningProps) {
  const [open, setOpen] = useState(false);

  console.log('[SecurityWarning] rendered, forceShow=', forceShow, 'open=', open);

  useEffect(() => {
    console.log('[SecurityWarning] effect:forceShow running, forceShow=', forceShow);
    // Show on first login if not yet acknowledged
    if (!forceShow) {
      try {
        const acknowledged = localStorage.getItem(STORAGE_KEY);
        console.log('[SecurityWarning] localStorage acknowledged=', acknowledged);
        if (!acknowledged) {
          console.log('[SecurityWarning] setting open=true (first login)');
          setOpen(true);
        }
      } catch {
        console.log('[SecurityWarning] localStorage unavailable, setting open=true');
        setOpen(true);
      }
    }
  }, [forceShow]);

  useEffect(() => {
    console.log('[SecurityWarning] effect:forceShow-change, forceShow=', forceShow);
    if (forceShow) {
      setOpen(true);
      onDevToolsDetected?.('force-show');
    }
  }, [forceShow, onDevToolsDetected]);

  const handleAcknowledge = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Ignore — worst case, warning shows again next time
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleAcknowledge(); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <div className="bg-destructive/10 mb-2 flex h-12 w-12 items-center justify-center rounded-full">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle>Aviso de Segurança e Uso Aceitável</DialogTitle>
        </DialogHeader>

        <DialogDescription>
          Este sistema é monitorado e toda atividade é registrada.
        </DialogDescription>

        <div className="text-foreground/80 max-h-[50vh] overflow-y-auto text-sm leading-relaxed space-y-3">
          <p>
            Este sistema é monitorado. Toda atividade nesta plataforma —
            incluindo requisições à API, tentativas de acesso a dados de
            outras contas, ou qualquer tentativa de manipular, interceptar
            ou alterar comunicações entre este aplicativo e nossos
            servidores — é registrada e analisada.
          </p>

          <p>
            Tentativas de acessar, modificar ou obter, sem autorização,
            dados, funcionalidades ou vantagens não concedidas ao seu
            plano/conta podem se enquadrar como{' '}
            <strong>acesso não autorizado a sistema de informação</strong>,
            nos termos da legislação brasileira aplicável (incluindo, mas
            não se limitando a, a Lei nº 12.737/2012 e o Marco Civil da
            Internet — Lei nº 12.965/2014).
          </p>

          <p>
            Contas identificadas com atividade suspeita de manipulação
            estão sujeitas a:
          </p>

          <ul className="list-disc space-y-1 pl-5">
            <li>
              Suspensão ou banimento imediato, sem aviso prévio;
            </li>
            <li>
              Registro e preservação de evidências para eventual medida
              judicial;
            </li>
            <li>
              Comunicação às autoridades competentes, quando aplicável.
            </li>
          </ul>

          <p>
            Se você é um pesquisador de segurança e encontrou uma
            vulnerabilidade real, agradecemos o reporte responsável — entre
            em contato através do nosso canal de divulgação responsável
            antes de explorar qualquer falha.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={handleAcknowledge} className="w-full sm:w-auto">
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
