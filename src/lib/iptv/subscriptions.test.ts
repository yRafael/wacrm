import { describe, expect, it } from 'vitest';

import {
  countSubscriptionBuckets,
  daysUntil,
  subscriptionBucket,
} from './subscriptions';

// A fixed "today" so the day math is deterministic regardless of when the
// suite runs. `daysUntil`/`subscriptionBucket`/`countSubscriptionBuckets`
// all accept `now` — defaulting it keeps call sites terse while the tests
// pin the reference instant.
const NOW = new Date('2026-08-11T12:00:00.000Z');

const iso = (daysFromNow: number) =>
  new Date(NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();

describe('daysUntil', () => {
  it('returns the whole-day gap for a future expiry', () => {
    expect(daysUntil(iso(45), NOW)).toBe(45);
    expect(daysUntil(iso(1), NOW)).toBe(1);
  });

  it('returns 0 for an expiry today (same day, later clock)', () => {
    expect(daysUntil(NOW.toISOString(), NOW)).toBe(0);
  });

  it('returns a negative value for a past expiry (whole days, floor)', () => {
    expect(daysUntil(iso(-5), NOW)).toBe(-5);
  });

  it('returns null for an unparseable date — never NaN into a badge', () => {
    expect(daysUntil('not-a-date', NOW)).toBeNull();
    expect(daysUntil('', NOW)).toBeNull();
  });
});

describe('subscriptionBucket', () => {
  it('classifies active (> 30 days away)', () => {
    expect(
      subscriptionBucket({ expires_at: iso(45), status: 'active' }, NOW)
    ).toBe('active');
  });

  it('classifies expiring30 (8–30 days away)', () => {
    expect(
      subscriptionBucket({ expires_at: iso(30), status: 'active' }, NOW)
    ).toBe('expiring30');
    expect(
      subscriptionBucket({ expires_at: iso(8), status: 'active' }, NOW)
    ).toBe('expiring30');
  });

  it('classifies expiring7 (≤ 7 days away)', () => {
    expect(
      subscriptionBucket({ expires_at: iso(7), status: 'active' }, NOW)
    ).toBe('expiring7');
    expect(
      subscriptionBucket({ expires_at: iso(0), status: 'active' }, NOW)
    ).toBe('expiring7');
  });

  it('classifies expired (already past)', () => {
    expect(
      subscriptionBucket({ expires_at: iso(-1), status: 'active' }, NOW)
    ).toBe('expired');
  });

  it('excludes revoked credentials from every bucket', () => {
    expect(
      subscriptionBucket({ expires_at: iso(-1), status: 'revoked' }, NOW)
    ).toBeNull();
  });

  it('returns null when the date does not parse', () => {
    expect(
      subscriptionBucket({ expires_at: 'garbage', status: 'active' }, NOW)
    ).toBeNull();
  });
});

describe('countSubscriptionBuckets', () => {
  it('counts each bucket, ignoring revoked credentials', () => {
    const credentials = [
      { expires_at: iso(45), status: 'active' as const },
      { expires_at: iso(5), status: 'active' as const },
      { expires_at: iso(20), status: 'active' as const },
      { expires_at: iso(-3), status: 'active' as const },
      // Cut off — must not inflate the KPIs.
      { expires_at: iso(-3), status: 'revoked' as const },
      // Unparseable — must not crash the aggregate.
      { expires_at: 'nope', status: 'active' as const },
    ];

    expect(countSubscriptionBuckets(credentials, NOW)).toEqual({
      active: 1,
      expiring7: 1,
      expiring30: 1,
      expired: 1,
    });
  });
});
