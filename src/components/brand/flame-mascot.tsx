'use client';

// NOTE: The original FlameMascot (flame with facial expressions) has been
// replaced by PulseWave — an abstract waveform symbol (Opção A per the
// Fire Control design doc) that aligns with the data-oriented interface.
// The FlameMascot component is preserved below for backward-compatible
// imports (e.g. sidebar icon) but no longer drives the dashboard greeting.
import { useId } from 'react';
import { cn } from '@/lib/utils';

export type FlameExpression = 'normal' | 'happy' | 'busy';

interface FlameMascotProps {
  /** Largura em px (a altura é ~1,15×). Default 48. */
  size?: number;
  expression?: FlameExpression;
  animated?: boolean;
  className?: string;
  /** Label acessível. Default "Fire Play". */
  ariaLabel?: string;
}

const EYE_Y = 62;
const EYE_LEFT_X = 38;
const EYE_RIGHT_X = 62;

export function FlameMascot({
  size = 48,
  expression = 'normal',
  animated = true,
  className,
  ariaLabel = 'Fire Play',
}: FlameMascotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const outerId = `flame-outer-${uid}`;
  const coreId = `flame-core-${uid}`;

  const happy = expression === 'happy';
  const busy = expression === 'busy';

  return (
    <svg
      width={size}
      height={Math.round(size * 1.15)}
      viewBox="0 0 100 115"
      fill="none"
      role="img"
      aria-label={ariaLabel}
      className={cn(animated && 'animate-flame-flicker', className)}
      // Deixa o flicker (escala > 1) respirar sem cortar a silhueta.
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient
          id={outerId}
          x1="50"
          y1="0"
          x2="50"
          y2="115"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--flame-1)" />
          <stop offset="60%" stopColor="var(--flame-2)" />
        </linearGradient>
        <linearGradient
          id={coreId}
          x1="50"
          y1="28"
          x2="50"
          y2="93"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--flame-3)" />
          <stop offset="100%" stopColor="var(--flame-1)" />
        </linearGradient>
      </defs>

      {/* Chama externa — corpo da chama */}
      <path
        d="M50 6 C 68 30 90 44 88 72 C 86 96 68 111 50 111 C 32 111 14 96 12 72 C 10 44 32 30 50 6 Z"
        fill={`url(#${outerId})`}
      />

      {/* Núcleo (brasal) — parte interna, mais clara */}
      <path
        d="M50 30 C 59 44 71 52 70 69 C 69 84 60 93 50 93 C 40 93 31 84 30 69 C 29 52 41 44 50 30 Z"
        fill={`url(#${coreId})`}
        opacity={0.92}
      />

      {/* Brilho no topo — "brasa acesa" */}
      <ellipse
        cx="38"
        cy="30"
        rx="5"
        ry="9"
        fill="var(--flame-3)"
        opacity={0.5}
      />

      {/* Olhos — grupo anima (piscada) mantendo o centro dos olhos */}
      <g
        className={cn(animated && 'animate-blink')}
        style={{
          transformBox: 'fill-box',
          transformOrigin: `center ${EYE_Y}px`,
        }}
      >
        {happy ? (
          <>
            <path
              d={`M${EYE_LEFT_X - 5} ${EYE_Y + 1} Q ${EYE_LEFT_X} ${EYE_Y - 6} ${EYE_LEFT_X + 5} ${EYE_Y + 1}`}
              stroke="var(--foreground)"
              strokeWidth="3.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={`M${EYE_RIGHT_X - 5} ${EYE_Y + 1} Q ${EYE_RIGHT_X} ${EYE_Y - 6} ${EYE_RIGHT_X + 5} ${EYE_Y + 1}`}
              stroke="var(--foreground)"
              strokeWidth="3.5"
              strokeLinecap="round"
              fill="none"
            />
          </>
        ) : (
          <>
            <ellipse
              cx={EYE_LEFT_X}
              cy={EYE_Y}
              rx="3.4"
              ry={busy ? 5 : 4.4}
              fill="var(--foreground)"
            />
            <ellipse
              cx={EYE_RIGHT_X}
              cy={EYE_Y}
              rx="3.4"
              ry={busy ? 5 : 4.4}
              fill="var(--foreground)"
            />
          </>
        )}
      </g>

      {/* Sobrancelha franzida (só no modo ocupado) */}
      {busy && (
        <g stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round">
          <line x1="31" y1="50" x2="42" y2="54" />
          <line x1="69" y1="50" x2="58" y2="54" />
        </g>
      )}

      {/* Boca — serena / sorriso / tensa */}
      {happy ? (
        <path
          d="M42 78 Q 50 87 58 78"
          stroke="var(--foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      ) : busy ? (
        <path
          d="M45 80 Q 50 77.5 55 80"
          stroke="var(--foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <path
          d="M44 79 Q 50 83 56 79"
          stroke="var(--foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}
