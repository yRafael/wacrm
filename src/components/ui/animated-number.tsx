'use client';

// ============================================================
// AnimatedNumber — renderiza `value` formatado, animando de 0 até
// ele via useCountUp. Usado nos chips/hero do painel "vivo".
// Formata com pt-BR por padrão; `formatter` permite moeda etc.
// ============================================================

import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: number;
  /** Formatação final (ex.: moeda). Default: toLocaleString pt-BR. */
  formatter?: (n: number) => string;
  durationMs?: number;
  className?: string;
}

const defaultFormatter = (n: number) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export function AnimatedNumber({
  value,
  formatter = defaultFormatter,
  durationMs = 900,
  className,
}: AnimatedNumberProps) {
  const animated = useCountUp(value, durationMs);
  return (
    <span className={cn('tabular-nums', className)}>{formatter(animated)}</span>
  );
}
