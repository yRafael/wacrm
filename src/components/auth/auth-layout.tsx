import { type ReactNode } from 'react';
import Image from 'next/image';
import { PulseWave } from '@/components/brand/pulse-wave';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Backwards compat — maps to subtitle */
  description?: string;
}

/**
 * Unified immersive auth layout.
 *
 * Full-screen dark background with layered gradients + floating
 * glassmorphism form card centered on screen. Used by login, signup,
 * forgot-password, and reset-password pages.
 */
export default function AuthLayout({
  children,
  title,
  subtitle,
  description,
}: AuthLayoutProps) {
  const sub = subtitle ?? description;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050507] p-4">
      {/* ── Background layers ────────────────────────────── */}

      {/* Primary warm radial — centered behind card */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(255, 107, 26, 0.07) 0%, rgba(255, 69, 0, 0.025) 40%, transparent 70%)',
        }}
      />

      {/* Secondary warm accent — top-right glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 35% at 88% 12%, rgba(245, 166, 35, 0.05) 0%, transparent 60%)',
        }}
      />

      {/* Tertiary cool accent — bottom-left (subtle depth) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 30% at 12% 88%, rgba(139, 92, 246, 0.03) 0%, transparent 60%)',
        }}
      />

      {/* Noise grain texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      {/* Giant logo watermark — hero element, low opacity with soft mask */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Image
          src="/logo.png"
          alt=""
          width={700}
          height={700}
          className="h-[70vh] w-auto object-contain select-none"
          style={{
            opacity: 0.08,
            WebkitMaskImage:
              'radial-gradient(ellipse 80% 80% at center, black 30%, transparent 65%)',
            maskImage:
              'radial-gradient(ellipse 80% 80% at center, black 30%, transparent 65%)',
          }}
          priority
          aria-hidden
        />
      </div>

      {/* Vignette — darkens edges for cinematic depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 20%, rgba(5, 5, 7, 0.5) 60%, rgba(5, 5, 7, 0.88) 100%)',
        }}
      />

      {/* ── Floating form card ───────────────────────────── */}
      <div className="relative z-10 w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-6 duration-700 fill-mode-both">
        <div className="group relative overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0C0C10]/90 p-8 shadow-[0_8px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-xl sm:p-10">
          {/* Top-edge glow — fire accent */}
          <div
            className="pointer-events-none absolute -top-px left-1/2 h-px w-2/3 -translate-x-1/2"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255, 107, 26, 0.35), rgba(245, 166, 35, 0.2), transparent)',
            }}
          />

          {/* Subtle inner glow at top of card */}
          <div
            className="pointer-events-none absolute top-0 left-0 h-24 w-full opacity-40"
            style={{
              background:
                'linear-gradient(180deg, rgba(255, 107, 26, 0.04) 0%, transparent 100%)',
            }}
          />

          {/* Card header */}
          <div className="relative mb-8 flex flex-col items-center sm:mb-10">
            <div className="mb-5 flex items-center justify-center">
              <PulseWave size={40} animated className="opacity-80" />
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-[1.35rem]">
              {title}
            </h1>
            {sub && (
              <p className="text-muted-foreground/60 mt-2 text-center text-[0.82rem] leading-relaxed">
                {sub}
              </p>
            )}
          </div>

          {/* Form content */}
          <div className="relative">
            {children}
          </div>
        </div>

        {/* Footer text — brand reinforcement */}
        <p className="text-muted-foreground/30 mt-5 text-center text-[0.7rem] tracking-wide">
          Fire Play — CRM & Automação para WhatsApp
        </p>
      </div>
    </div>
  );
}
