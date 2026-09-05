/**
 * Pure decision logic for the realtime bus-location pipeline.
 *
 * All mutable state lives in `TripGuardState`; the function returns the next
 * state and whether the packet should be applied. No refs, no setState —
 * unit-testable in isolation (see __tests__/location-packet-guard.test.ts).
 */

export interface TripGuardState {
  isTripActive: boolean;
  activeTripId: string | null;
  endedTripId: string | null;
  lastTimestampMs: number;
}

export interface TripPacket {
  tripId?: string | null;
  timestamp: string | number;
}

export type RejectReason = 'ended-trip' | 'cross-trip-stale' | 'stale-timestamp';

export interface TripPacketDecision {
  apply: boolean;
  rejectReason?: RejectReason;
  isTripActive: boolean;
  activeTripId: string | null;
  endedTripId: string | null;
  lastTimestampMs: number;
  incomingTsMs: number;
}

export function parseTimestampMs(ts: any): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    if (ts > 1e9 && ts < 1e11) return ts * 1000; // 10-digit Unix timestamp in seconds
    return ts;
  }
  if (!ts) return Date.now();
  const num = Number(ts);
  if (Number.isFinite(num)) {
    if (num > 1e9 && num < 1e11) return num * 1000;
    if (num > 100000000000) return num;
  }
  const parsed = new Date(ts).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const rejected = (
  state: TripGuardState,
  reason: RejectReason,
  incomingTsMs: number
): TripPacketDecision => ({
  apply: false,
  rejectReason: reason,
  isTripActive: state.isTripActive,
  activeTripId: state.activeTripId,
  endedTripId: state.endedTripId,
  lastTimestampMs: state.lastTimestampMs,
  incomingTsMs,
});

export function decideLocationPacket(
  packet: TripPacket,
  state: TripGuardState
): TripPacketDecision {
  const incomingTsMs = parseTimestampMs(packet.timestamp);

  // Tombstoned trip: any packet still claiming this tripId is dead forever.
  if (state.endedTripId && packet.tripId && packet.tripId === state.endedTripId) {
    return rejected(state, 'ended-trip', incomingTsMs);
  }

  const decision: TripPacketDecision = {
    apply: false,
    isTripActive: state.isTripActive,
    activeTripId: state.activeTripId,
    endedTripId: state.endedTripId,
    lastTimestampMs: state.lastTimestampMs,
    incomingTsMs,
  };

  // Self-healing trip state: a valid packet means the trip is active. Never
  // drop live updates because an initial fetch saw an inactive state before
  // the driver started the trip. An explicitly ended trip does NOT self-heal.
  if (!decision.isTripActive && !decision.endedTripId) {
    decision.isTripActive = true;
  }

  // Cross-trip contamination guard with auto-recovery for newer trips.
  if (
    decision.activeTripId &&
    packet.tripId &&
    packet.tripId !== decision.activeTripId
  ) {
    // A packet from a different trip is stale only if it is strictly
    // OLDER than the last accepted position from the current trip (with 5s skew tolerance).
    if (incomingTsMs > 0 && incomingTsMs + 5000 < decision.lastTimestampMs) {
      return rejected(state, 'cross-trip-stale', incomingTsMs);
    }
    // Adopt the newer trip; untombstone if one was set. A packet we accept
    // with a tripId means that trip is live.
    decision.isTripActive = true;
    decision.activeTripId = packet.tripId;
    decision.endedTripId = null;
  } else if (!decision.activeTripId && packet.tripId) {
    // First packet after trip_ended with a *different* tripId = brand new
    // trip. Untombstone and activate so it can flow normally.
    decision.isTripActive = true;
    decision.endedTripId = null;
    decision.activeTripId = packet.tripId;
  }

  // Monotonic timestamp guard with 5-second clock skew tolerance:
  // Drops packets only if they are genuinely older than 5s before the last accepted packet.
  // This prevents driver device clock lag from starving student live updates.
  const SKEW_TOLERANCE_MS = 5000;
  if (incomingTsMs > 0 && decision.lastTimestampMs > 0 && incomingTsMs + SKEW_TOLERANCE_MS < decision.lastTimestampMs) {
    return rejected(state, 'stale-timestamp', incomingTsMs);
  }
  if (incomingTsMs > 0) {
    decision.lastTimestampMs = Math.max(decision.lastTimestampMs, incomingTsMs);
  }

  decision.apply = true;
  return decision;
}