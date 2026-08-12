// ============================================================
// Branding config — per-company identity (migration 045).
//
// Every shape here is account-scoped at the DB layer (RLS via
// is_account_member); this module is the pure client-side model:
// types, defaults, clamping and the merge used by the Personalização
// panel's draft + the token map the BrandProvider applies to <html>.
//
// Pure + side-effect free so it's unit-testable without Supabase.
// ============================================================

export type BackgroundKind = 'none' | 'preset' | 'image';

export type BackgroundPosition = 'left' | 'center' | 'right' | 'top' | 'bottom';

export const BACKGROUND_POSITIONS: readonly BackgroundPosition[] = [
  'left',
  'center',
  'right',
  'top',
  'bottom',
];

export interface BrandColors {
  /** Brand accent — overrides --primary app-wide when set. */
  primary?: string;
  /** Text on primary (buttons/links). Defaults to white. */
  primaryForeground?: string;
  /** Hover tint. Derived from primary when omitted. */
  primaryHover?: string;
  /** Translucent tint surfaces. Derived from primary when omitted. */
  primarySoft?: string;
  /** Focus/ring outline. Derived from primary when omitted. */
  ring?: string;
}

export interface ChatBackgroundSettings {
  kind: BackgroundKind;
  /** When kind === 'preset' — id from BACKGROUND_PRESETS. */
  presetId?: string;
  /** When kind === 'image' — storage path in the branding bucket. */
  path?: string;
  /** Image opacity (0..1). Controls how much the image reads. */
  opacity: number;
  /** Gaussian blur in px (0..40). */
  blur: number;
  /** Zoom (1..2) — high-res images compress cleanly at large screens. */
  scale: number;
  /** Position of the image in the frame. */
  position: BackgroundPosition;
  /** Scrim above the image, below the messages (keeps text legible). */
  overlayColor: string;
  /** Scrim strength (0..0.9). */
  overlayOpacity: number;
}

export interface ChatBubbleColors {
  sentBg?: string;
  sentText?: string;
  receivedBg?: string;
  receivedText?: string;
}

export interface ChatSettings {
  background: ChatBackgroundSettings;
  bubbles: ChatBubbleColors;
}

export interface BrandingConfig {
  colors: BrandColors;
  chat: ChatSettings;
}

/** Row from `account_branding` (config comes back from JSONB as a dict). */
export interface Branding {
  id: string;
  account_id: string;
  logo_path: string | null;
  banner_path: string | null;
  config: BrandingConfig;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_CHAT_BACKGROUND: Readonly<ChatBackgroundSettings> = {
  kind: 'none',
  opacity: 0.5,
  blur: 0,
  scale: 1,
  position: 'center',
  overlayColor: '#000000',
  overlayOpacity: 0.4,
};

/** Zero-state config — nothing customized (fire identity wins). */
export const DEFAULT_CONFIG: Readonly<BrandingConfig> = {
  colors: {},
  chat: {
    background: { ...DEFAULT_CHAT_BACKGROUND },
    bubbles: {},
  },
};

// ------------------------------------------------------------
// Clampers — the panel's sliders never write out-of-range JSONB.
// ------------------------------------------------------------

export function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampBlur(value: number): number {
  return Math.min(40, Math.max(0, value));
}

export function clampScale(value: number): number {
  return Math.min(2, Math.max(1, value));
}

export function clampOverlayOpacity(value: number): number {
  return Math.min(0.9, Math.max(0, value));
}

export function isBackgroundKind(value: unknown): value is BackgroundKind {
  return value === 'none' || value === 'preset' || value === 'image';
}

export function normalizePosition(value: unknown): BackgroundPosition {
  return (BACKGROUND_POSITIONS as ReadonlyArray<unknown>).includes(value)
    ? (value as BackgroundPosition)
    : 'center';
}

// ------------------------------------------------------------
// Numeric coercion — JSONB sliders could hold strings; coerce safely.
// ------------------------------------------------------------

function toBoundedNumber(
  value: unknown,
  fallback: number,
  clamp: (n: number) => number
): number {
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n) : fallback;
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value)
    : fallback;
}

/**
 * Normalize an arbitrary (possibly JSONB) value into a valid BrandingConfig.
 * Used when reading the row so a hand-edited or legacy `config` never
 * crashes the app or produces out-of-range sliders. Clamps everywhere.
 */
export function fromRawConfig(raw: unknown): BrandingConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_CONFIG,
      chat: { background: { ...DEFAULT_CHAT_BACKGROUND }, bubbles: {} },
    };
  }
  const r = raw as { colors?: unknown; chat?: unknown };
  const colors =
    r.colors && typeof r.colors === 'object' ? (r.colors as BrandColors) : {};
  const chat =
    r.chat && typeof r.chat === 'object'
      ? (r.chat as { background?: unknown; bubbles?: unknown })
      : {};
  const bg =
    chat.background && typeof chat.background === 'object'
      ? (chat.background as Partial<ChatBackgroundSettings>)
      : {};
  const bubbles =
    chat.bubbles && typeof chat.bubbles === 'object'
      ? (chat.bubbles as ChatBubbleColors)
      : ({} as ChatBubbleColors);

  return {
    colors,
    chat: {
      background: {
        kind: isBackgroundKind(bg.kind)
          ? bg.kind
          : DEFAULT_CHAT_BACKGROUND.kind,
        presetId: typeof bg.presetId === 'string' ? bg.presetId : undefined,
        path: typeof bg.path === 'string' ? bg.path : undefined,
        opacity: toBoundedNumber(
          bg.opacity,
          DEFAULT_CHAT_BACKGROUND.opacity,
          clampOpacity
        ),
        blur: toBoundedNumber(bg.blur, DEFAULT_CHAT_BACKGROUND.blur, clampBlur),
        scale: toBoundedNumber(
          bg.scale,
          DEFAULT_CHAT_BACKGROUND.scale,
          clampScale
        ),
        position: normalizePosition(bg.position),
        overlayColor:
          typeof bg.overlayColor === 'string' && bg.overlayColor
            ? bg.overlayColor
            : DEFAULT_CHAT_BACKGROUND.overlayColor,
        overlayOpacity: toBoundedNumber(
          bg.overlayOpacity,
          DEFAULT_CHAT_BACKGROUND.overlayOpacity,
          clampOverlayOpacity
        ),
      },
      bubbles,
    },
  };
}

export type BrandingConfigPatch = {
  colors?: Partial<BrandColors>;
  chat?: {
    background?: Partial<ChatBackgroundSettings>;
    bubbles?: Partial<ChatBubbleColors>;
  };
};

/**
 * Merge a patch into the current config, clamping every numeric slider.
 * Any block left out of the patch is preserved untouched — the panel's
 * per-tab draft relies on this semantics.
 */
export function mergeBrandingConfig(
  current: BrandingConfig,
  patch: BrandingConfigPatch
): BrandingConfig {
  const mergedBg: ChatBackgroundSettings = {
    ...current.chat.background,
    ...(patch.chat?.background ?? {}),
    opacity: clampOpacity(
      patch.chat?.background?.opacity ?? current.chat.background.opacity
    ),
    blur: clampBlur(
      patch.chat?.background?.blur ?? current.chat.background.blur
    ),
    scale: clampScale(
      patch.chat?.background?.scale ?? current.chat.background.scale
    ),
    position: normalizePosition(
      patch.chat?.background?.position ?? current.chat.background.position
    ),
    overlayOpacity: clampOverlayOpacity(
      patch.chat?.background?.overlayOpacity ??
        current.chat.background.overlayOpacity
    ),
  };

  return {
    colors: { ...current.colors, ...(patch.colors ?? {}) },
    chat: {
      background: mergedBg,
      bubbles: {
        ...current.chat.bubbles,
        ...(patch.chat?.bubbles ?? {}),
      },
    },
  };
}

// ------------------------------------------------------------
// CSS token map — what BrandProvider writes into <html>.
// ------------------------------------------------------------

export interface ColorTokens {
  [cssVar: string]: string;
}

/**
 * Expand the company's BrandColors into the CSS custom properties the
 * existing theme system uses (--primary, --primary-soft, --ring,
 * --chart-*, --sidebar-*). With just `primary` set, the derived tokens
 * are computed via color-mix so every surface stays coherent instead of
 * inheriting the accent theme's stale violet/fire values. Explicit
 * overrides from the panel win over the derivations.
 */
export function buildColorTokens(colors: BrandColors): ColorTokens {
  const tokens: ColorTokens = {};
  const { primary, primaryHover, primarySoft, ring, primaryForeground } =
    colors;

  if (primary) {
    tokens['--primary'] = primary;
    tokens['--primary-hover'] =
      primaryHover ?? `color-mix(in oklab, ${primary} 88%, white)`;
    tokens['--primary-soft'] =
      primarySoft ?? `color-mix(in oklab, ${primary} 14%, transparent)`;
    tokens['--primary-soft-2'] =
      primarySoft ?? `color-mix(in oklab, ${primary} 26%, transparent)`;
    tokens['--ring'] = ring ?? primary;
    tokens['--chart-1'] = primary;
    tokens['--chart-2'] = `color-mix(in oklab, ${primary} 65%, white)`;
    tokens['--sidebar-primary'] = primary;
    tokens['--sidebar-primary-foreground'] = primaryForeground ?? '#ffffff';
    tokens['--sidebar-ring'] = ring ?? primary;
  } else {
    // Edge: someone set individual brand tokens without a primary.
    if (primaryHover) tokens['--primary-hover'] = primaryHover;
    if (primarySoft) {
      tokens['--primary-soft'] = primarySoft;
      tokens['--primary-soft-2'] = primarySoft;
    }
    if (ring) {
      tokens['--ring'] = ring;
      tokens['--sidebar-ring'] = ring;
    }
    if (primaryForeground)
      tokens['--sidebar-primary-foreground'] = primaryForeground;
  }
  return tokens;
}

/**
 * Does the config carry any real color override? Drives whether the
 * panel's Cores tab shows "active" and the provider re-applies tokens.
 */
export function hasBrandColors(colors: BrandColors): boolean {
  return Boolean(
    colors.primary || colors.primaryHover || colors.primarySoft || colors.ring
  );
}

/**
 * Has the company customized anything at all? Helps surfaces decide
 * between the default Fire identity and the company identity.
 */
export function hasBrandIdentity(config: BrandingConfig): boolean {
  return (
    hasBrandColors(config.colors) ||
    config.chat.background.kind !== 'none' ||
    Object.keys(config.chat.bubbles).length > 0
  );
}
