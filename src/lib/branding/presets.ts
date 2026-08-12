// ============================================================
// Background presets — the built-in "library" of the Chat tab.
//
// Companies that don't want to upload an image can pick a ready-made
// pattern/gradient. Each preset is pure CSS (a `background-image`
// value) so it renders everywhere without storage. Own uploads live in
// the Imagens tab (`kind === 'image'`); presets are `kind === 'preset'`
// with a `presetId`.
//
// The `nameKey` maps to `Settings.personalization.chat.presets.*` in
// the message files — keep ids and keys in sync across the three
// locales.
// ============================================================

export interface BackgroundPreset {
  id: string;
  /** i18n key under `Settings.personalization.chat.presets`. */
  nameKey: string;
  /** CSS `background-image` value. */
  css: string;
}

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  {
    id: 'doodles',
    nameKey: 'doodles',
    css: "url('/inbox-doodle.svg')",
  },
  {
    id: 'dots',
    nameKey: 'dots',
    css: 'radial-gradient(rgba(255,255,255,0.14) 1.5px, transparent 1.5px) 0 0 / 22px 22px',
  },
  {
    id: 'grid',
    nameKey: 'grid',
    css: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px',
  },
  {
    id: 'gradientSunset',
    nameKey: 'gradientSunset',
    css: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #7c3aed 100%)',
  },
  {
    id: 'gradientOcean',
    nameKey: 'gradientOcean',
    css: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  },
  {
    id: 'gradientMidnight',
    nameKey: 'gradientMidnight',
    css: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #334155 100%)',
  },
  {
    id: 'gradientMint',
    nameKey: 'gradientMint',
    css: 'linear-gradient(135deg, #a7f3d0 0%, #6ee7b7 50%, #34d399 100%)',
  },
];

export function getPresetCss(id: string | undefined): string | null {
  if (!id) return null;
  return BACKGROUND_PRESETS.find((p) => p.id === id)?.css ?? null;
}

/**
 * The CSS background (image value) for the active chat background config.
 * Returns null when nothing is active (the app keeps the doodle default).
 */
export function resolveBackgroundCss(bg: {
  kind: string;
  presetId?: string;
  path?: string;
}): string | null {
  if (bg.kind === 'preset') return getPresetCss(bg.presetId);
  if (bg.kind === 'image' && bg.path)
    return `url('/api/branding/asset?path=${encodeURIComponent(bg.path)}')`;
  return null;
}
