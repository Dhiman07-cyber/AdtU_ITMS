import { describe, expect, it } from 'vitest';
import {
  decideLocationPacket,
  type TripGuardState,
} from '../location-packet-guard';

const active = (over: Partial<TripGuardState> = {}): TripGuardState => ({
  isTripActive: true,
  activeTripId: 'trip-abc',
  endedTripId: null,
  lastTimestampMs: 2000,
  ...over,
});

describe('decideLocationPacket — trip lifecycle guard', () => {
  it('accepts a live packet from the active trip and advances the timestamp', () => {
    const d = decideLocationPacket({ tripId: 'trip-abc', timestamp: 3000 }, active());
    expect(d.apply).toBe(true);
    expect(d.lastTimestampMs).toBe(3000);
    expect(d.activeTripId).toBe('trip-abc');
  });

  it('rejects a packet from the ended trip (stale-data resurrection)', () => {
    // Simulates: trip_ended('trip-abc') -> stale GPS packet still claiming trip-abc.
    const state: TripGuardState = {
      isTripActive: false,
      activeTripId: null,
      endedTripId: 'trip-abc',
      lastTimestampMs: 0,
    };
    const d = decideLocationPacket({ tripId: 'trip-abc', timestamp: 9000 }, state);
    expect(d.apply).toBe(false);
    expect(d.rejectReason).toBe('ended-trip');
  });

  it('accepts a packet from a NEW trip after trip_ended (untombstones)', () => {
    const state: TripGuardState = {
      isTripActive: false,
      activeTripId: null,
      endedTripId: 'trip-abc',
      lastTimestampMs: 0,
    };
    const d = decideLocationPacket({ tripId: 'trip-new', timestamp: 5000 }, state);
    expect(d.apply).toBe(true);
    expect(d.activeTripId).toBe('trip-new');
    expect(d.endedTripId).toBeNull();
    expect(d.isTripActive).toBe(true);
  });

  it('rejects a stale timestamp within the same trip', () => {
    const d = decideLocationPacket({ tripId: 'trip-abc', timestamp: 1000 }, active({ lastTimestampMs: 10000 }));
    expect(d.apply).toBe(false);
    expect(d.rejectReason).toBe('stale-timestamp');
  });

  it('rejects a stale cross-trip packet without adopting its tripId', () => {
    const d = decideLocationPacket({ tripId: 'trip-other', timestamp: 1000 }, active({ lastTimestampMs: 10000 }));
    expect(d.apply).toBe(false);
    expect(d.rejectReason).toBe('cross-trip-stale');
    expect(d.activeTripId).toBe('trip-abc');
  });

  it('adopts a newer cross-trip packet', () => {
    const d = decideLocationPacket({ tripId: 'trip-other', timestamp: 5000 }, active());
    expect(d.apply).toBe(true);
    expect(d.activeTripId).toBe('trip-other');
  });

  it('self-heals an inactive trip that was never explicitly ended', () => {
    const state: TripGuardState = {
      isTripActive: false,
      activeTripId: null,
      endedTripId: null,
      lastTimestampMs: 0,
    };
    const d = decideLocationPacket({ tripId: 'trip-late-start', timestamp: 100 }, state);
    expect(d.apply).toBe(true);
    expect(d.isTripActive).toBe(true);
  });

  it('does NOT self-heal an explicitly ended trip with a matching packet', () => {
    const state: TripGuardState = {
      isTripActive: false,
      activeTripId: null,
      endedTripId: 'trip-dead',
      lastTimestampMs: 0,
    };
    const d = decideLocationPacket({ tripId: 'trip-dead', timestamp: 100 }, state);
    expect(d.apply).toBe(false);
    expect(d.rejectReason).toBe('ended-trip');
  });

  it('RT-002: rejects a DB snapshot that is older than the last known GPS position', () => {
    // Simulates: client has GPS at 10:00:15, reconnect fetch returns DB snapshot at 10:00:05.
    // The monotonic guard must reject the older snapshot even if lastTimestampMs was never reset.
    const state: TripGuardState = {
      isTripActive: true,
      activeTripId: 'trip-abc',
      endedTripId: null,
      lastTimestampMs: 15000, // known GPS position at 15s
    };
    // DB snapshot at 5s (10s older than known 15s — exceeds 5s skew tolerance)
    const d = decideLocationPacket({ tripId: 'trip-abc', timestamp: 5000 }, state);
    expect(d.apply).toBe(false);
    expect(d.rejectReason).toBe('stale-timestamp');
    // State must NOT regress — lastTimestampMs stays at 15000
    expect(d.lastTimestampMs).toBe(15000);
  });

  it('RT-002: accepts a DB snapshot that is newer than the last known GPS position', () => {
    const state: TripGuardState = {
      isTripActive: true,
      activeTripId: 'trip-abc',
      endedTripId: null,
      lastTimestampMs: 10000,
    };
    // DB snapshot at 15s (newer than known 10s)
    const d = decideLocationPacket({ tripId: 'trip-abc', timestamp: 15000 }, state);
    expect(d.apply).toBe(true);
    expect(d.lastTimestampMs).toBe(15000);
  });
});