import { describe, expect, it } from 'vitest';

import {
  brandAssetPathUrl,
  brandAssetUrl,
  BRAND_MAX_BYTES,
  buildBrandAssetPath,
} from './assets';

const ACCOUNT = '5f0b6e1c-9f2a-4d3b-8c7e-1a2b3c4d5e6f';

describe('buildBrandAssetPath', () => {
  it('prefixes with account-<uuid>/<kind>-<ts>-<base>.<ext>', () => {
    const path = buildBrandAssetPath(ACCOUNT, 'logo', 'Vision Logo.png', 1000);
    expect(path).toBe(`account-${ACCOUNT}/logo-1000-Vision_Logo.png`);
  });

  it('defaults extension to png for bare names', () => {
    const path = buildBrandAssetPath(ACCOUNT, 'banner', 'wallpaper', 2000);
    expect(path).toBe(`account-${ACCOUNT}/banner-2000-wallpaper.png`);
  });

  it('sanitizes unsafe base and truncates to 40 chars', () => {
    const path = buildBrandAssetPath(
      ACCOUNT,
      'chat',
      'a/b\\c:d?e*f"g<h>i|j k'.repeat(10) + '.webp',
      3000
    );
    expect(path.startsWith(`account-${ACCOUNT}/chat-3000-`)).toBe(true);
    // Base replaced unsafe chars, truncated.
    expect(path.endsWith('.webp')).toBe(true);
    const base = path
      .split('/')[1]
      .replace('chat-3000-', '')
      .replace('.webp', '');
    expect(base.length).toBeLessThanOrEqual(40);
    expect(base).not.toContain('/');
    expect(base).not.toContain(':');
  });

  it('sanitizes an all-unsafe name into underscores (still safe)', () => {
    const path = buildBrandAssetPath(ACCOUNT, 'gallery', '!!!', 4000);
    expect(path).toBe(`account-${ACCOUNT}/gallery-4000-_.png`);
  });

  it('falls back to the kind when the name has no base left', () => {
    // '.png' — only an extension, no usable base.
    const path = buildBrandAssetPath(ACCOUNT, 'gallery', '.png', 4000);
    expect(path).toBe(`account-${ACCOUNT}/gallery-4000-gallery.png`);
  });
});

describe('brand URLs', () => {
  it('builds a stable kind URL for the session-gated proxy', () => {
    expect(brandAssetUrl('logo')).toBe('/api/branding/asset?kind=logo');
    expect(brandAssetUrl('banner')).toBe('/api/branding/asset?kind=banner');
    expect(brandAssetUrl('chat')).toBe('/api/branding/asset?kind=chat');
  });

  it('builds a path URL with the account-scoped object encoded', () => {
    const url = brandAssetPathUrl(`account-${ACCOUNT}/chat-1-bg.png`);
    expect(url).toBe(
      `/api/branding/asset?path=${encodeURIComponent(`account-${ACCOUNT}/chat-1-bg.png`)}`
    );
  });

  it('caps uploads at 5 MB', () => {
    expect(BRAND_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
