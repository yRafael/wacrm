import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/ui/animated-number';

interface MetricCardProps {
  title: string;
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * When present, the numeric value counts up from 0 on mount via
   * <AnimatedNumber>. The `value` string is still used as a fallback
   * (e.g. during SSR hydration) and for currency formatting — pass the
   * raw number here and a formatted string in `value`.
   */
  animatedValue?: number;
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number;
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string;
  };
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string;
  /** Visual variant — 'default' uses standard card, 'pulse' uses amber/gold accents. */
  variant?: 'default' | 'pulse';
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  animatedValue,
  variant = 'default',
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-5 transition-colors',
        variant === 'pulse'
          ? 'border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent'
          : 'border-border bg-card'
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-muted-foreground text-sm font-medium">{title}</p>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            variant === 'pulse'
              ? 'bg-amber-500/10 text-amber-400'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-foreground mt-3 text-[28px] leading-none font-bold tabular-nums">
        {animatedValue !== undefined ? (
          <AnimatedNumber value={animatedValue} formatter={() => value} />
        ) : (
          value
        )}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
      ) : null}
    </div>
  );
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
        ? 'text-red-400'
        : 'text-muted-foreground';
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus;
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
