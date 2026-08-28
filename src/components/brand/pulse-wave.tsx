'use client';

import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PulseWaveProps {
  size?: number;
  animated?: boolean;
  className?: string;
  ariaLabel?: string;
}

const BARS = [35, 60, 80, 55, 70, 40, 90];

export function PulseWave({
  size = 48,
  animated = true,
  className,
  ariaLabel = 'Fire Radar',
}: PulseWaveProps) {
  const barWidth = Math.max(2, Math.floor(size / 16));
  const gap = Math.max(1, Math.floor(size / 40));
  const totalWidth = BARS.length * barWidth + (BARS.length - 1) * gap;
  const offsetX = (size - totalWidth) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label={ariaLabel}
      className={cn(animated && 'animate-pulse', className)}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="pulseGrad" x1="0" y1="0" x2="0" y2="100">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="60%" stopColor="var(--flame-2)" />
          <stop offset="100%" stopColor="var(--flame-1)" />
        </linearGradient>
      </defs>

      {BARS.map((h, i) => {
        const x = offsetX + i * (barWidth + gap);
        const y = 100 - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={1}
            fill="url(#pulseGrad)"
            style={
              animated
                ? {
                    animation: `pulse-bar 1.6s ease-in-out infinite`,
                    animationDelay: `${i * 0.12}s`,
                  }
                : undefined
            }
          />
        );
      })}

      {/* Subtle flame accent at the base */}
      <Flame
        className="absolute bottom-0 left-1/2 -translate-x-1/2 h-3 w-3 text-primary opacity-60"
        style={{ filter: 'blur(1px)' }}
      />
    </svg>
  );
}

export { FlameMascot } from './flame-mascot';
export type { FlameExpression } from './flame-mascot';
