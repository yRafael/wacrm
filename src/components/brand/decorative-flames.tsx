"use client";

// ============================================================
// DecorativeFlames — chaminhas de fundo para heróis/empty states
//
// Três chamas pequenas em cantos estratégicos, flutuando suavemente
// (animate-float-slow) com opacidade baixa. Apenas decorativas:
// pointer-events-none + aria-hidden. O componente é posicionado
// absolutamente dentro de um parent `relative`.
// ============================================================

import { cn } from "@/lib/utils";

interface DecorativeFlamesProps {
  className?: string;
}

interface FlameDotProps {
  className?: string;
  /** Atraso da flutuação (s) — desfasa as chamas entre si. */
  delay?: string;
}

function FlameDot({ className, delay = "0s" }: FlameDotProps) {
  return (
    <svg
      viewBox="0 0 100 115"
      fill="none"
      aria-hidden
      className={cn("animate-float-slow", className)}
      style={{ animationDelay: delay, overflow: "visible" }}
    >
      <path
        d="M50 6 C 68 30 90 44 88 72 C 86 96 68 111 50 111 C 32 111 14 96 12 72 C 10 44 32 30 50 6 Z"
        fill="var(--flame-1)"
        opacity={0.4}
      />
      <path
        d="M50 30 C 59 44 71 52 70 69 C 69 84 60 93 50 93 C 40 93 31 84 30 69 C 29 52 41 44 50 30 Z"
        fill="var(--flame-3)"
        opacity={0.5}
      />
    </svg>
  );
}

export function DecorativeFlames({ className }: DecorativeFlamesProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <FlameDot className="absolute -top-6 right-4 h-20 w-20" delay="0s" />
      <FlameDot className="absolute bottom-2 left-8 h-11 w-11 opacity-80" delay="1.4s" />
      <FlameDot className="absolute -bottom-3 right-1/4 h-8 w-8" delay="2.7s" />
    </div>
  );
}
