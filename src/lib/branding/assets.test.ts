import { describe, expect, it } from 'vitest';

import {
  brandAssetPathUrl,
  brandAssetUrl,
  BRAND_MAX_BYTES,
  BRAND_MIME_BY_TYPE,
  buildBrandAssetPath,
  detectImageType,
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

// Real byte signatures — the proxy refuses anything that is not an actual
// PNG/JPEG/WebP, so the mime served never comes from a file extension.
const bytes = (arr: number[]) => new Uint8Array(arr);

describe('detectImageType', () => {
  it('detects PNG from its 8-byte signature', () => {
    const png = bytes([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(detectImageType(png)).toBe('png');
  });

  it('detects JPEG from its FF D8 FF marker', () => {
    const jpeg = bytes([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    expect(detectImageType(jpeg)).toBe('jpeg');
  });

  it('detects WebP from the RIFF/WEBP container', () => {
    const webp = bytes([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageType(webp)).toBe('webp');
  });

  it('returns null for too-short buffers', () => {
    expect(detectImageType(bytes([0x89, 0x50]))).toBeNull();
    expect(detectImageType(new Uint8Array(0))).toBeNull();
  });

  it('refuses SVG — even with a .svg extension it is not a valid image', () => {
    const svg = bytes([
      0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22,
    ]);
    expect(detectImageType(svg)).toBeNull();
  });

  it('refuses an HTML polyglot / fake png', () => {
    // <html>… bytes renamed to .png
    const fake = bytes([
      0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x68, 0x65, 0x61, 0x64, 0x3e,
    ]);
    expect(detectImageType(fake)).toBeNull();
  });
});

describe('BRAND_MIME_BY_TYPE', () => {
  it('maps every detected type to its real mime', () => {
    expect(BRAND_MIME_BY_TYPE.png).toBe('image/png');
    expect(BRAND_MIME_BY_TYPE.jpeg).toBe('image/jpeg');
    expect(BRAND_MIME_BY_TYPE.webp).toBe('image/webp');
  });
});
