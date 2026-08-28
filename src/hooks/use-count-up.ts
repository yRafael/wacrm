'use client';

// ============================================================
// useCountUp — anima um número de 0 até `target` usando
// requestAnimationFrame + easing easeOutCubic.
//
// · Quando `target` muda, re-anima do valor atual até o novo alvo
//   (não reseta para 0) — os contadores do hero "sobem" ao vivo.
// · Respeita prefers-reduced-motion: pula direto para o alvo.
// · Puro e testável — o easing (easeOutCubic) fica aqui para o
//   teste importar sem disparar navegador.
// ============================================================

import { useEffect, useRef, useState } from 'react';

/** easeOutCubic: começa rápido, desacelera no fim. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Animates `target` from its current value over `durationMs`. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      };
    }

    const from = value;
    const delta = target - from;
    // Sem movimento (valor igual) — evita reiniciar o frame inutilmente.
    if (delta === 0) return () => {};

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / durationMs);
      const eased = easeOutCubic(elapsed);
      setValue(from + delta * eased);
      if (elapsed < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // `value` fica de fora de propósito: queremos animar do valor
    // visível atual, mas sem re-subescrever o effect a cada frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
