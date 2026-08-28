'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// AVISO: este hook é puramente dissuasivo (UX).
// NÃO é uma camada de segurança. Qualquer decisão de autorização,
// acesso a dado ou validação de plano DEVE continuar sendo feita
// exclusivamente no backend, independente deste código existir ou não.

interface DevToolsState {
  isOpen: boolean;
  method: 'size-diff' | 'debugger-timing' | null;
}

/**
 * Heuristic DevTools detection — never 100% reliable.
 *
 * Uses two complementary methods:
 * 1. Size diff: compares outer vs inner window dimensions.
 *    When DevTools is docked, the difference grows significantly.
 * 2. Debugger timing: measures time spent in a `debugger` statement.
 *    DevTools pauses execution, causing a measurable delay.
 *
 * Both methods have false positives (accessibility tools, browser
 * extensions, tiling window managers). Never use as sole auth gate.
 */
export function useDevToolsDetection(checkIntervalMs = 2000): DevToolsState {
  const [state, setState] = useState<DevToolsState>({
    isOpen: false,
    method: null,
  });

  const detectSizeDiff = useCallback(() => {
    if (typeof window === 'undefined') return false;
    // When DevTools is docked to the side, the width difference
    // between outer and inner is typically >100px. When docked to
    // bottom, height difference >100px. We use a conservative threshold.
    const widthDiff = Math.abs(window.outerWidth - window.innerWidth);
    const heightDiff = Math.abs(window.outerHeight - window.innerHeight);
    return widthDiff > 150 || heightDiff > 150;
  }, []);

  const detectDebuggerTiming = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const elapsed = performance.now() - start;
    // If DevTools is open and paused on debugger, elapsed > ~50ms.
    // Normal execution is <1ms.
    return elapsed > 50;
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const check = () => {
      const sizeDiff = detectSizeDiff();
      const debuggerTiming = detectDebuggerTiming();
      console.log('[useDevToolsDetection] check: sizeDiff=', sizeDiff, 'debuggerTiming=', debuggerTiming);
      if (sizeDiff) {
        setState({ isOpen: true, method: 'size-diff' });
        return;
      }
      if (debuggerTiming) {
        setState({ isOpen: true, method: 'debugger-timing' });
        return;
      }
    };

    console.log('[useDevToolsDetection] hook initialized, interval=', checkIntervalMs);
    // Initial check after a short delay (lets the page settle)
    const timeoutId = setTimeout(check, 1000);
    // Periodic re-checks
    intervalId = setInterval(check, checkIntervalMs);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [checkIntervalMs, detectSizeDiff, detectDebuggerTiming]);

  return state;
}
