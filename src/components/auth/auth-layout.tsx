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
 * Full-screen dark background with giant logo watermark + floating
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
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#060608] p-4">
      {/* ── Background layers ────────────────────────────── */}

      {/* Subtle warm radial gradient behind the watermark */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 42%, rgba(255, 107, 26, 0.08) 0%, rgba(255, 69, 0, 0.03) 35%, transparent 65%)',
        }}
      />

      {/* Secondary warm accent — top-right glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 40% at 85% 15%, rgba(245, 166, 35, 0.06) 0%, transparent 60%)',
        }}
      />

      {/* Noise grain texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      {/* Giant logo watermark — 60-70% of viewport, very low opacity */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Image
          src="/logo.png"
          alt=""
          width={700}
          height={700}
          className="h-[70vh] w-auto object-contain select-none"
          style={{
            opacity: 0.05,
            WebkitMaskImage:
              'radial-gradient(ellipse 80% 80% at center, black 25%, transparent 65%)',
            maskImage:
              'radial-gradient(ellipse 80% 80% at center, black 25%, transparent 65%)',
          }}
          priority
          aria-hidden
        />
      </div>

      {/* Vignette — darkens edges for depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 25%, rgba(6, 6, 8, 0.55) 65%, rgba(6, 6, 8, 0.85) 100%)',
        }}
      />

      {/* ── Floating form card ───────────────────────────── */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0E0E12]/95 p-8 shadow-[0_8px_60px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur-md sm:p-10">
          {/* Subtle top-edge glow on card */}
          <div
            className="pointer-events-none absolute -top-px left-1/2 h-px w-3/4 -translate-x-1/2"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255, 107, 26, 0.3), rgba(245, 166, 35, 0.2), transparent)',
            }}
          />

          {/* Card header */}
          <div className="mb-8 flex flex-col items-center sm:mb-10">
            <div className="mb-6 flex items-center justify-center">
              <PulseWave size={44} animated className="opacity-80" />
            </div>
            <h1 className="text-foreground text-[1.6rem] font-bold tracking-tight sm:text-2xl">
              {title}
            </h1>
            {sub && (
              <p className="text-muted-foreground/80 mt-2.5 text-center text-sm leading-relaxed">
                {sub}
              </p>
            )}
          </div>

          {/* Form content */}
          {children}
        </div>
      </div>
    </div>
  );
}
