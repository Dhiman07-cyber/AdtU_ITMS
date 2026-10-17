import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isWaitingFlagExpired } from '../waiting-flag-helpers';

describe('WAITING-FLAG-HELPERS: Expiry, Malformed Timestamps & Fallback Guard', () => {
  const originalNow = Date.now;
  const FIXED_NOW = new Date('2026-10-09T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  // 1. Valid future expiry
  it('returns false for a valid future expires_at timestamp', () => {
    const flag = {
      expires_at: new Date(FIXED_NOW + 10 * 60 * 1000).toISOString(), // +10m
      created_at: new Date(FIXED_NOW - 5 * 60 * 1000).toISOString(),
    };
    expect(isWaitingFlagExpired(flag)).toBe(false);
  });

  // 2. Expired timestamp
  it('returns true for an expired expires_at timestamp', () => {
    const flag = {
      expires_at: new Date(FIXED_NOW - 1000).toISOString(), // -1s
      created_at: new Date(FIXED_NOW - 16 * 60 * 1000).toISOString(),
    };
    expect(isWaitingFlagExpired(flag)).toBe(true);
  });

  // 3. Missing expires_at with valid created_at (recent -> active)
  it('falls back to created_at + 15m TTL when expires_at is undefined and created_at is recent', () => {
    const flag = {
      expires_at: undefined,
      created_at: new Date(FIXED_NOW - 5 * 60 * 1000).toISOString(), // 5m ago
    };
    expect(isWaitingFlagExpired(flag)).toBe(false);
  });

  // 3b. Missing expires_at with valid created_at (older than 15m -> expired)
  it('returns true when expires_at is undefined and created_at is older than 15m TTL', () => {
    const flag = {
      expires_at: undefined,
      created_at: new Date(FIXED_NOW - 16 * 60 * 1000).toISOString(), // 16m ago
    };
    expect(isWaitingFlagExpired(flag)).toBe(true);
  });

  // 4. Malformed expires_at with valid created_at
  it('falls back to created_at when expires_at is a malformed string', () => {
    const flagRecent = {
      expires_at: 'NOT_A_VALID_DATE_STRING',
      created_at: new Date(FIXED_NOW - 2 * 60 * 1000).toISOString(), // 2m ago
    };
    expect(isWaitingFlagExpired(flagRecent)).toBe(false);

    const flagStale = {
      expires_at: 'corrupt-timestamp-xyz',
      created_at: new Date(FIXED_NOW - 20 * 60 * 1000).toISOString(), // 20m ago
    };
    expect(isWaitingFlagExpired(flagStale)).toBe(true);
  });

  // 5. Both timestamps missing or undefined
  it('fails closed (returns true) when both expires_at and created_at are undefined or missing', () => {
    expect(isWaitingFlagExpired({})).toBe(true);
    expect(isWaitingFlagExpired({ expires_at: undefined, created_at: undefined })).toBe(true);
    expect(isWaitingFlagExpired(null)).toBe(true);
    expect(isWaitingFlagExpired(undefined)).toBe(true);
  });

  // 6. Explicitly null timestamps
  it('fails closed (returns true) when timestamps are explicitly null', () => {
    expect(isWaitingFlagExpired({ expires_at: null, created_at: null })).toBe(true);
    expect(isWaitingFlagExpired({ expires_at: null })).toBe(true);
  });

  // 7. Malformed created_at
  it('fails closed (returns true) when created_at is malformed and expires_at is missing/null/malformed', () => {
    expect(isWaitingFlagExpired({ created_at: 'invalid-date' })).toBe(true);
    expect(isWaitingFlagExpired({ expires_at: 'also-invalid', created_at: 'invalid-date' })).toBe(true);
    expect(isWaitingFlagExpired({ expires_at: null, created_at: 'invalid-date' })).toBe(true);
  });
});
