import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Security regression (Etapa 2/3): /api/branding/asset is the ONLY way the
// browser reads brand assets (private `branding` bucket). The account comes
// from the SESSION (`getCurrentAccount`), never from the URL:
//
//   - No session                     → 401
//   - Profile/account not resolved   → 403
//   - ?path= outside the caller's    → 403 (foreign `account-<other>/…`
//     account folder                   prefix is refused before any download)
//   - Missing asset                  → 404
//   - Non-image bytes                → 415 (magic-byte detection)
//   - Valid PNG                      → 200 with Content-Type from the real
//                                      bytes + nosniff + cache-control
//
// `getBranding` and `getCurrentAccount` are mocked; `detectImageType` and
// `BRAND_MIME_BY_TYPE` come from the REAL module so the byte checks run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  getBranding: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: (err: unknown) => {
    const e = err as { status?: number; message?: string };
    return Response.json(
      { error: e?.message ?? 'Internal server error' },
      { status: e?.status ?? 500 }
    );
  },
}));

vi.mock('@/lib/branding/queries', () => ({
  getBranding: mocks.getBranding,
}));

import { GET } from './route';

const ACCOUNT = 'acct-vision';

interface DownloadResult {
  data: Blob | null;
  error: Error | null;
}

// Session context whose storage mock records every download request so we can
// assert which object path the proxy actually asked for.
function makeCtx(accountId: string, result: DownloadResult) {
  const downloads: string[] = [];
  return {
    ctx: {
      userId: 'user-caller',
      accountId,
      role: 'agent',
      account: { id: accountId, name: 'Vision' },
      supabase: {
        storage: {
          from: () => ({
            download: vi.fn(async (path: string) => {
              downloads.push(path);
              return result;
            }),
          }),
        },
      },
    },
    downloads,
  };
}

function request(query: string) {
  return new Request(`http://localhost/api/branding/asset${query}`);
}

// 8-byte PNG signature — a real image the proxy must accept.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const pngBlob = () => new Blob([PNG]);

const htmlBlob = () =>
  new Blob([
    new TextEncoder().encode('<!doctype html><html><body>fake</body>'),
  ]);

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.getBranding.mockReset();
});

describe('GET /api/branding/asset — session-gated, account-scoped', () => {
  it('401 without a session', async () => {
    mocks.getCurrentAccount.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    );
    const res = await GET(request('?kind=logo'));
    expect(res.status).toBe(401);
  });

  it('403 when the profile/account cannot be resolved', async () => {
    mocks.getCurrentAccount.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    );
    const res = await GET(request('?kind=logo'));
    expect(res.status).toBe(403);
  });

  it('403 when ?path points at ANOTHER account folder — refused before download', async () => {
    const { ctx, downloads } = makeCtx(ACCOUNT, {
      data: pngBlob(),
      error: null,
    });
    mocks.getCurrentAccount.mockResolvedValue(ctx);

    const res = await GET(
      request(`?path=${encodeURIComponent('account-acct-joao/logo-1-a.png')}`)
    );

    expect(res.status).toBe(403);
    // The foreign object is never even requested from storage.
    expect(downloads).toHaveLength(0);
  });

  it('403 when ?path has a valid prefix but belongs to a different account', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: pngBlob(), error: null });
    mocks.getCurrentAccount.mockResolvedValue(ctx);

    // account-acct-vision is NOT "account-" + caller account as a single
    // segment — the prefix check must treat it as foreign too.
    const res = await GET(
      request(`?path=${encodeURIComponent('account-acct-otra/logo-1-a.png')}`)
    );
    expect(res.status).toBe(403);
  });

  it('404 when kind resolves to no asset (no branding row)', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: pngBlob(), error: null });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue(null);

    const res = await GET(request('?kind=logo'));
    expect(res.status).toBe(404);
  });

  it('404 when kind=chat but the background is not an image', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: pngBlob(), error: null });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: null,
      banner_path: null,
      config: { chat: { background: { kind: 'preset', presetId: 'ocean' } } },
    });

    const res = await GET(request('?kind=chat'));
    expect(res.status).toBe(404);
  });

  it('serves the logo for kind=logo with a session-scoped object path', async () => {
    const { ctx, downloads } = makeCtx(ACCOUNT, {
      data: pngBlob(),
      error: null,
    });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: `account-${ACCOUNT}/logo-1-vision.png`,
      banner_path: null,
      config: {},
    });

    const res = await GET(request('?kind=logo'));

    expect(res.status).toBe(200);
    expect(downloads).toEqual([`account-${ACCOUNT}/logo-1-vision.png`]);
    const bytes = await res.arrayBuffer();
    expect(new Uint8Array(bytes).slice(0, 8)).toEqual(PNG.slice(0, 8));
  });

  it('serves the chat background image via its stored path', async () => {
    const { ctx, downloads } = makeCtx(ACCOUNT, {
      data: pngBlob(),
      error: null,
    });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: null,
      banner_path: null,
      config: {
        chat: {
          background: {
            kind: 'image',
            path: `account-${ACCOUNT}/chat-1-bg.png`,
          },
        },
      },
    });

    const res = await GET(request('?kind=chat'));

    expect(res.status).toBe(200);
    expect(downloads).toEqual([`account-${ACCOUNT}/chat-1-bg.png`]);
  });

  it('404 when the object exists in storage but download fails', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: null, error: new Error('nope') });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: `account-${ACCOUNT}/logo-1-vision.png`,
      banner_path: null,
      config: {},
    });

    const res = await GET(request('?kind=logo'));
    expect(res.status).toBe(404);
  });

  it('415 when the object bytes are not a real image (HTML polyglot)', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: htmlBlob(), error: null });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: `account-${ACCOUNT}/logo-1-vision.png`,
      banner_path: null,
      config: {},
    });

    const res = await GET(request('?kind=logo'));
    expect(res.status).toBe(415);
  });

  it('serves a valid PNG with bytes-derived Content-Type + nosniff + cache', async () => {
    const { ctx } = makeCtx(ACCOUNT, { data: pngBlob(), error: null });
    mocks.getCurrentAccount.mockResolvedValue(ctx);
    mocks.getBranding.mockResolvedValue({
      logo_path: `account-${ACCOUNT}/logo-1-vision.png`,
      banner_path: null,
      config: {},
    });

    const res = await GET(request('?kind=logo'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });
});
