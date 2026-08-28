import { describe, expect, it } from 'vitest';

import {
  hasValidStepUp,
  signStepUpToken,
  STEP_UP_COOKIE,
  STEP_UP_TTL_SECONDS,
  stepUpCookieOptions,
  verifyStepUpToken,
} from './step-up';

describe('step-up token', () => {
  it('round-trips a freshly minted token', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    await expect(verifyStepUpToken(token, 1_700_000_000_000)).resolves.toBe(
      true
    );
  });

  it('is valid until the TTL elapses and invalid after', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    const inside = 1_700_000_000_000 + (STEP_UP_TTL_SECONDS - 1) * 1000;
    const atBoundary = 1_700_000_000_000 + STEP_UP_TTL_SECONDS * 1000;
    await expect(verifyStepUpToken(token, inside)).resolves.toBe(true);
    await expect(verifyStepUpToken(token, atBoundary)).resolves.toBe(false);
  });

  it('rejects tampered tokens', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    // Same length, different last hex char (flips one MAC bit).
    const flipped =
      token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    await expect(verifyStepUpToken(flipped, 1_700_000_000_000)).resolves.toBe(
      false
    );
  });

  it('rejects malformed tokens', async () => {
    await expect(verifyStepUpToken('', 1_700_000_000_000)).resolves.toBe(
      false
    );
    await expect(
      verifyStepUpToken('not-a-token', 1_700_000_000_000)
    ).resolves.toBe(false);
    await expect(
      verifyStepUpToken('1.2.3.4', 1_700_000_000_000)
    ).resolves.toBe(false);
    await expect(
      verifyStepUpToken('abc.def.ghi', 1_700_000_000_000)
    ).resolves.toBe(false);
    // Missing nonce/exp makes the payload unreproducible → false.
    await expect(
      verifyStepUpToken('1700000000..', 1_700_000_000_000)
    ).resolves.toBe(false);
  });

  it('rejects an expired exp even with a correct MAC', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    await expect(verifyStepUpToken(token, 1_800_000_000_000)).resolves.toBe(
      false
    );
  });

  it('different payloads produce different tokens', async () => {
    const a = await signStepUpToken(1_700_000_000_000);
    const b = await signStepUpToken(1_700_000_000_000);
    expect(a).not.toBe(b);
  });
});

describe('hasValidStepUp', () => {
  it('returns true when the request carries a valid grant', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    await expect(
      hasValidStepUp(
        { cookies: { get: () => ({ value: token }) } },
        1_700_000_000_000
      )
    ).resolves.toBe(true);
  });

  it('returns false when the cookie is missing', async () => {
    await expect(
      hasValidStepUp({ cookies: { get: () => undefined } })
    ).resolves.toBe(false);
  });

  it('returns false for an expired grant', async () => {
    const token = await signStepUpToken(1_700_000_000_000);
    await expect(
      hasValidStepUp(
        { cookies: { get: () => ({ value: token }) } },
        1_800_000_000_000
      )
    ).resolves.toBe(false);
  });
});

describe('stepUpCookieOptions', () => {
  it('pins the security attributes from doc §2.3', () => {
    const opts = stepUpCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.maxAge).toBe(STEP_UP_TTL_SECONDS);
    expect(opts.path).toBe('/fire-control-x7k29');
  });

  it('exposes the cookie name', () => {
    expect(STEP_UP_COOKIE).toBe('fc_step_up');
  });
});