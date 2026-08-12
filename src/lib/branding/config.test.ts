import { describe, expect, it } from 'vitest';

import {
  clampBlur,
  clampOpacity,
  clampOverlayOpacity,
  clampScale,
  DEFAULT_CHAT_BACKGROUND,
  DEFAULT_CONFIG,
  fromRawConfig,
  hasBrandColors,
  hasBrandIdentity,
  mergeBrandingConfig,
  buildColorTokens,
} from './types';

describe('clamps', () => {
  it('clampOpacity bounds 0..1', () => {
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(0)).toBe(0);
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(2)).toBe(1);
  });

  it('clampBlur bounds 0..40', () => {
    expect(clampBlur(-5)).toBe(0);
    expect(clampBlur(20)).toBe(20);
    expect(clampBlur(99)).toBe(40);
  });

  it('clampScale bounds 1..2', () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(3)).toBe(2);
  });

  it('clampOverlayOpacity bounds 0..0.9', () => {
    expect(clampOverlayOpacity(-1)).toBe(0);
    expect(clampOverlayOpacity(0.5)).toBe(0.5);
    expect(clampOverlayOpacity(1)).toBe(0.9);
  });
});

describe('mergeBrandingConfig', () => {
  const base = fromRawConfig({
    colors: { primary: '#123456' },
    chat: {
      background: {
        kind: 'image',
        path: 'account-x/chat-1.png',
        opacity: 0.4,
        blur: 8,
        scale: 1.5,
        position: 'center',
        overlayColor: '#000000',
        overlayOpacity: 0.3,
      },
      bubbles: { sentBg: '#aa0000' },
    },
  });

  it('preserves untouched blocks', () => {
    const next = mergeBrandingConfig(base, { colors: { primary: '#654321' } });
    // Colors updated...
    expect(next.colors.primary).toBe('#654321');
    // ...but chat untouched.
    expect(next.chat.background).toEqual(base.chat.background);
    expect(next.chat.bubbles).toEqual(base.chat.bubbles);
  });

  it('overrides a touched block while keeping its siblings', () => {
    const next = mergeBrandingConfig(base, {
      chat: { background: { kind: 'preset', presetId: 'dots' } },
    });
    expect(next.chat.background.kind).toBe('preset');
    expect(next.chat.background.presetId).toBe('dots');
    // Sliders keep their previous values — the patch only touched kind.
    expect(next.chat.background.opacity).toBe(0.4);
    expect(next.chat.background.blur).toBe(8);
    // Bubbles preserved.
    expect(next.chat.bubbles.sentBg).toBe('#aa0000');
  });

  it('clamps numeric sliders in the patch', () => {
    const next = mergeBrandingConfig(base, {
      chat: {
        background: { opacity: 5, blur: -10, scale: 0.2, overlayOpacity: 2 },
      },
    });
    expect(next.chat.background.opacity).toBe(1);
    expect(next.chat.background.blur).toBe(0);
    expect(next.chat.background.scale).toBe(1);
    expect(next.chat.background.overlayOpacity).toBe(0.9);
  });
});

describe('fromRawConfig', () => {
  it('returns defaults for null/undefined', () => {
    expect(fromRawConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(fromRawConfig('garbage')).toEqual(DEFAULT_CONFIG);
  });

  it('coerces string numbers from JSONB', () => {
    const cfg = fromRawConfig({
      chat: {
        background: {
          kind: 'preset',
          presetId: 'grid',
          opacity: '0.7',
          blur: '12',
        },
      },
    });
    expect(cfg.chat.background.opacity).toBe(0.7);
    expect(cfg.chat.background.blur).toBe(12);
    expect(cfg.chat.background.presetId).toBe('grid');
  });

  it('clamps out-of-range values read from JSONB', () => {
    const cfg = fromRawConfig({
      chat: {
        background: {
          kind: 'image',
          opacity: 3,
          scale: 9,
          position: 'northwest',
        },
      },
    });
    expect(cfg.chat.background.opacity).toBe(1);
    expect(cfg.chat.background.scale).toBe(2);
    // Invalid position falls back to center.
    expect(cfg.chat.background.position).toBe('center');
  });

  it('rejects unknown background kinds', () => {
    const cfg = fromRawConfig({ chat: { background: { kind: 'video' } } });
    expect(cfg.chat.background.kind).toBe(DEFAULT_CHAT_BACKGROUND.kind);
  });
});

describe('buildColorTokens', () => {
  it('derives hover/soft/ring when only primary is set', () => {
    const tokens = buildColorTokens({ primary: '#ea580c' });
    expect(tokens['--primary']).toBe('#ea580c');
    expect(tokens['--ring']).toBe('#ea580c');
    expect(tokens['--primary-hover']).toContain('#ea580c');
    expect(tokens['--primary-soft']).toContain('#ea580c');
    expect(tokens['--sidebar-primary']).toBe('#ea580c');
    expect(tokens['--sidebar-primary-foreground']).toBe('#ffffff');
  });

  it('explicit overrides win over derivations', () => {
    const tokens = buildColorTokens({
      primary: '#ea580c',
      primaryHover: '#000000',
      ring: '#00ff00',
    });
    expect(tokens['--primary-hover']).toBe('#000000');
    expect(tokens['--ring']).toBe('#00ff00');
    expect(tokens['--sidebar-ring']).toBe('#00ff00');
  });

  it('returns {} for empty colors', () => {
    expect(buildColorTokens({})).toEqual({});
  });
});

describe('hasBrandColors / hasBrandIdentity', () => {
  it('detects colors', () => {
    expect(hasBrandColors({})).toBe(false);
    expect(hasBrandColors({ primary: '#000' })).toBe(true);
  });

  it('detects identity from chat config too', () => {
    const onlyChat = fromRawConfig({
      chat: { background: { kind: 'preset', presetId: 'dots' } },
    });
    expect(hasBrandColors(onlyChat.colors)).toBe(false);
    expect(hasBrandIdentity(onlyChat)).toBe(true);

    expect(hasBrandIdentity(DEFAULT_CONFIG)).toBe(false);
  });
});
