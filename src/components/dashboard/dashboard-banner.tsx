'use client';

import { useBranding } from '@/hooks/use-branding';
import { brandAssetPathUrl } from '@/lib/branding/assets';

/**
 * Company dashboard banner — a full-width hero strip above the FireHero
 * greeting, rendered only when the company uploaded a banner (Personalização
 * → Dashboard). The asset is session-gated through the branding proxy, so
 * it never leaks across companies. Renders nothing otherwise, leaving the
 * dashboard exactly as it is today.
 *
 * The banner keeps the image's NATURAL aspect ratio (height follows width)
 * instead of a fixed height, so an uploaded banner is never cropped on any
 * screen size. A generous max-height guards against pathological portrait
 * uploads without affecting normal landscape banners.
 */
export function DashboardBanner() {
  const { branding, brandingSettled } = useBranding();

  if (!brandingSettled || !branding?.banner_path) return null;

  return (
    <div className="border-border relative w-full overflow-hidden rounded-2xl border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brandAssetPathUrl(branding.banner_path)}
        alt=""
        className="block h-auto max-h-[420px] w-full object-cover"
      />
      {/* Subtle scrim at the bottom keeps the strip from feeling flat
          over bright images. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
    </div>
  );
}
