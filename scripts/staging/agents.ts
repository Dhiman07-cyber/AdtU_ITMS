/**
 * Driver & Student agents — real user journeys against the real stack.
 *
 * Driver:  initiate-trip (HTTP) -> WS auth/presence -> GPS over WS + HTTP
 *          every 2s (mirrors src/app/driver/live-tracking/page.tsx dual path)
 *          -> waiting-flag acks -> end-trip (HTTP).
 * Student: trip-status (HTTP) -> WS subscriptions (bus_location_, bus:,
 *          trip-status-o) -> periodic re-poll (like the UI's 5s poll)
 *          -> records every location packet for transport-level correlation.
 *
 * Every packet carries a unique ISO timestamp; correlation key =
 * `${driverUid}|${timestamp}`, which survives the WS server's payload
 * normalization untouched.
 */
import { WsAgent, type ReceivedMessage } from './ws-agent';
import { RouteGps } from './gps';
import { apiCall, withRetry } from './lib';

export interface GpsSentRec { key: string; tsMs: number; lat: number; lng: number; httpStatus: number | null; httpLatencyMs: number | null; tripId: string; busId: string; traceId: string; expectedFanOut: number; nodeUrl?: string; }
export interface GpsRecvRec { key: string; recvAtMs: number; lat: number; lng: number; channel: string; tripId?: string; initialSnapshot?: boolean; nodeUrl?: string; }

export interface Failure { stage: string; persona: string; correlationId?: string; error: string; at: string; }

export class DriverAgent {
  readonly label: string;
  readonly uid: string;
  readonly busId: string;
  readonly routeId: string;
  private idToken: string;
  private gps = new RouteGps(`driver-route-seed`);
  ws: WsAgent | null = null;
  private stopFlag = false;
  tripId: string | null = null;
  readonly sent: GpsSentRec[] = [];
  readonly failures: Failure[] = [];
  readonly flagsAcked: string[] = [];
  wsStats = { reconnects: 0, sent: 0 };

  private autoAckFlags: boolean;

  constructor(opts: { label: string; uid: string; idToken: string; busId: string; routeId: string; gpsSeed?: string; autoAckFlags?: boolean }) {
    this.label = opts.label; this.uid = opts.uid; this.busId = opts.busId; this.routeId = opts.routeId;
    this.idToken = opts.idToken;
    this.autoAckFlags = opts.autoAckFlags ?? true;
    if (opts.gpsSeed) this.gps = new RouteGps(opts.gpsSeed);
  }

  get liveGps(): RouteGps { return this.gps; }
  get serverErrors(): string[] { return this.ws?.serverErrors ?? []; }

  async startTrip(): Promise<void> {
    const r = await apiCall('POST', '/api/driver/initiate-trip', this.idToken, { busId: this.busId, shift: 'Morning' });
    if (r.status !== 200 || !r.json?.success) {
      throw new Error(`initiate-trip failed: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    }
    this.tripId = r.json.tripId;
  }

  async connectWs(nodeUrl: string): Promise<void> {
    const ws = new WsAgent(nodeUrl);
    await withRetry(() => ws.connect(this.idToken));
    this.ws = ws;
    ws.presence(this.busId, this.tripId || undefined, this.routeId);
    if (this.autoAckFlags) {
      ws.onChannel(`waiting_flags_${this.busId}`, (m) => this.onWaitingFlag(m).catch(() => { }));
    }
  }

  get wsOpen(): boolean { return this.ws?.isOpen ?? false; }

  async reconnectCycle(nodeUrl: string): Promise<void> {
    const old = this.ws;
    old?.kill();
    const ws = new WsAgent(nodeUrl);
    await ws.connect(this.idToken, old?.reconnectToken || undefined);
    this.ws = ws;
    this.wsStats.reconnects++;
    ws.presence(this.busId, this.tripId || undefined, this.routeId);
  }

  /** One GPS tick: WS location_update + HTTP /api/location/update (dual path, like the real page). */
  async tick(nowMs: number, expectedFanOut: number): Promise<GpsSentRec | null> {
    if (!this.tripId) return null;
    const fix = this.gps.fix(nowMs);
    const ts = new Date(nowMs).toISOString();
    const key = `${this.uid}|${ts}`;
    const rec: GpsSentRec = {
      key, tsMs: nowMs, lat: fix.lat, lng: fix.lng,
      httpStatus: null, httpLatencyMs: null, tripId: this.tripId, busId: this.busId,
      traceId: `gps-${this.label}-${this.sent.length + 1}`,
      expectedFanOut,
      nodeUrl: this.ws?.nodeUrl,
    };
    this.ws?.send({
      type: 'location_update', busId: this.busId, tripId: this.tripId,
      lat: fix.lat, lng: fix.lng, speed: fix.speedMs * 3.6, heading: fix.headingDeg,
      accuracy: fix.accuracyM, timestamp: ts,
    });
    this.wsStats.sent++;

    const t0 = Date.now();
    try {
      const r = await apiCall('POST', '/api/location/update', this.idToken, {
        busId: this.busId, routeId: this.routeId, lat: fix.lat, lng: fix.lng,
        accuracy: fix.accuracyM, speed: fix.speedMs * 3.6, heading: fix.headingDeg,
        timestamp: ts, tripId: this.tripId,
      });
      rec.httpStatus = r.status; rec.httpLatencyMs = Date.now() - t0;
      if (r.status !== 200) this.failures.push({ stage: 'gps-http', persona: this.label, correlationId: key, error: `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`, at: ts });
    } catch (e: any) {
      rec.httpStatus = 0;
      this.failures.push({ stage: 'gps-http', persona: this.label, correlationId: key, error: String(e.message || e), at: ts });
    }
    this.sent.push(rec);
    return rec;
  }

  private async onWaitingFlag(m: ReceivedMessage): Promise<void> {
    if (m.msg.event !== 'waiting_flag_created') return;
    const flagId = m.msg.payload?.flagId || m.msg.payload?.id;
    if (!flagId) return;
    const r = await apiCall('POST', '/api/driver/ack-flag', this.idToken, { flagId });
    if (r.status === 200) this.flagsAcked.push(flagId);
    else this.failures.push({ stage: 'ack-flag', persona: this.label, correlationId: flagId, error: `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`, at: new Date().toISOString() });
  }

  async endTrip(): Promise<{ status: number; json: any }> {
    this.stopFlag = true;
    const r = await apiCall('POST', '/api/driver/end-trip', this.idToken, { busId: this.busId, tripId: this.tripId });
    this.ws?.close();
    return r;
  }

  get running(): boolean { return !this.stopFlag; }
}

export class StudentAgent {
  readonly label: string;
  readonly uid: string;
  readonly busId: string;
  readonly routeId: string;
  private idToken: string;
  ws: WsAgent | null = null;
  /** Every WsAgent this student has used (initial + each reconnect). Used for
   *  event-time eligibility across connection generations. */
  readonly wsHistory: WsAgent[] = [];
  tripActive = false;
  initialLocation: { lat: number; lng: number } | null = null;
  readonly received: GpsRecvRec[] = [];
  readonly failures: Failure[] = [];
  readonly httpSamples: { route: string; status: number; latencyMs: number }[] = [];
  flagsRaised = 0;
  wsReconnects = 0;
  private raisedFlag = false;

  /** Explicit reconnect windows for event-time eligibility. */
  readonly reconnectWindows: {
    disconnectStart: number;
    reconnectStart: number;
    reconnectComplete: number;
    resubscribeComplete: number;
  }[] = [];

  timings: {
    authStart?: number;
    authComplete?: number;
    wsConnect?: number;
    presenceAuthorized?: number;
    subscribeSent?: number;
    subscribeAccepted?: number;
    firstLiveLocation?: number;
    secondLiveLocation?: number;
    /** When the last location event was received (for freshness tracking). */
    lastLocationReceivedAt?: number;
    /** When the subscription was lost (for reconnect window tracking). */
    subscriptionLostAt?: number;
    /** When the subscription was re-established after reconnect. */
    resubscriptionAcceptedAt?: number;
  } = {};

  constructor(opts: { label: string; uid: string; idToken?: string; busId: string; routeId: string }) {
    this.label = opts.label; this.uid = opts.uid; this.busId = opts.busId; this.routeId = opts.routeId;
    if (opts.idToken) this.idToken = opts.idToken;
    else this.idToken = ''; // Will be set in authenticate
  }

  async authenticate(mintFn: (uid: string) => Promise<string>): Promise<void> {
    this.timings.authStart = Date.now();
    this.idToken = await mintFn(this.uid);
    this.timings.authComplete = Date.now();
  }

  /** GET trip-status (what the track-bus page does on load and on every poll). */
  async pollTripStatus(): Promise<void> {
    const t0 = Date.now();
    const r = await apiCall('GET', `/api/student/trip-status?busId=${encodeURIComponent(this.busId)}`, this.idToken);
    this.httpSamples.push({ route: 'trip-status', status: r.status, latencyMs: Date.now() - t0 });
    if (r.status === 200 && r.json?.tripActive) {
      this.tripActive = true;
      const loc = r.json.tripData?.current_location;
      if (loc && !this.initialLocation) this.initialLocation = { lat: Number(loc.lat), lng: Number(loc.lng) };
    } else if (r.status !== 200) {
      this.failures.push({ stage: 'trip-status', persona: this.label, error: `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`, at: new Date().toISOString() });
    }
  }

  async connectWs(nodeUrl: string): Promise<void> {
    const ws = new WsAgent(nodeUrl);
    await withRetry(() => ws.connect(this.idToken));
    this.timings.wsConnect = Date.now();
    this.ws = ws;
    this.wsHistory.push(ws);

    ws.onPresenceOk(() => {
      if (!this.timings.presenceAuthorized) this.timings.presenceAuthorized = Date.now();
    });
    ws.presence(this.busId, undefined, this.routeId);

    const onLoc = (m: ReceivedMessage) => {
      // Separate initial cached snapshot from new live events.
      // The server sends a cached snapshot immediately on subscribe (getLiveBusLocation).
      // We tag those as initialSnapshot so they don't count as live receives.
      const isInitialSnapshot = !this.timings.subscribeAccepted; // arrived before sub ACK
      this.record(m, isInitialSnapshot);
      if (!isInitialSnapshot) {
        this.timings.lastLocationReceivedAt = Date.now();
        if (!this.timings.firstLiveLocation) {
          this.timings.firstLiveLocation = Date.now();
        } else if (!this.timings.secondLiveLocation) {
          this.timings.secondLiveLocation = Date.now();
        }
      }
    };
    this.timings.subscribeSent = Date.now();
    // IMPORTANT: register onSubscribeOk BEFORE calling onChannel, which sends
    // the subscribe message. The server can ACK immediately on a fast local network
    // and the dispatch fires before the handler is registered (race).
    ws.onSubscribeOk((channel) => {
      if (channel === `bus_location_${this.busId}`) {
        this.timings.subscribeAccepted = Date.now();
      }
    });
    ws.onChannel(`bus_location_${this.busId}`, onLoc);

    ws.onChannel(`trip-status-${this.busId}`, (m) => {
      if (m.msg.event === 'trip_ended') this.tripActive = false;
      if (m.msg.event === 'trip_started') this.tripActive = true;
    });
  }

  async reconnectCycle(nodeUrl: string): Promise<void> {
    const old = this.ws;
    const disconnectStart = Date.now();
    old?.kill();
    const reconnectWindow = {
      disconnectStart,
      reconnectStart: Date.now(),
      reconnectComplete: 0,
      resubscribeComplete: 0,
    };
    this.timings.subscriptionLostAt = disconnectStart;
    const ws = new WsAgent(nodeUrl);
    const oldReconnectToken = old?.reconnectToken || undefined;
    await ws.connect(this.idToken, oldReconnectToken);
    reconnectWindow.reconnectComplete = Date.now();
    this.ws = ws;
    this.wsHistory.push(ws);
    this.wsReconnects++;
    // Re-send presence: re-validates bus ownership and re-binds busId on the
    // restored session before the resubscribe below.
    ws.presence(this.busId, undefined, this.routeId);
    // Register subscribe-OK BEFORE onChannel sends the subscribe (server can
    // ACK immediately on a fast local network — same race as connectWs).
    ws.onSubscribeOk((channel) => {
      if (channel === `bus_location_${this.busId}`) {
        this.timings.resubscriptionAcceptedAt = Date.now();
        reconnectWindow.resubscribeComplete = Date.now();
      }
    });
    const onLoc = (m: ReceivedMessage) => {
      this.record(m);
      this.timings.lastLocationReceivedAt = Date.now();
    };
    ws.onChannel(`bus_location_${this.busId}`, onLoc);
    ws.onChannel(`trip-status-${this.busId}`, (m) => {
      if (m.msg.event === 'trip_ended') this.tripActive = false;
      if (m.msg.event === 'trip_started') this.tripActive = true;
    });
    // What the UI does on resume: re-sync from DB.
    await this.pollTripStatus();
    this.reconnectWindows.push(reconnectWindow);
  }

  private record(m: ReceivedMessage, initialSnapshot = false): void {
    if (m.msg.event !== 'bus_location_update') return;
    const p = m.msg.payload || {};
    const key = `${p.driverUid}|${p.timestamp}`;
    // Server-tagged snapshot (subscribe-time cache push) is never a live event,
    // regardless of whether it arrived before or after the sub ACK. This also
    // catches the snapshot re-push after a reconnect — an OLD cached event must
    // not satisfy a NEW expected delivery.
    const isSnapshot = initialSnapshot || p.source === 'snapshot';
    this.received.push({
      key, recvAtMs: m.receivedAtMs,
      lat: Number(p.lat), lng: Number(p.lng),
      channel: m.msg.channel, tripId: p.tripId,
      initialSnapshot: isSnapshot,
      nodeUrl: this.ws?.nodeUrl,
    });
  }

  /** Raise a waiting flag near the last known bus position (real journey step). */
  async raiseWaitingFlag(lastLat: number, lastLng: number): Promise<void> {
    if (this.raisedFlag || !this.tripActive) return;
    this.raisedFlag = true;
    const r = await apiCall('POST', '/api/waiting-flag/create', this.idToken, {
      busId: this.busId, routeId: this.routeId, stop_name: 'Staging Stop', accuracy: 15,
      stopLat: lastLat + 0.0005, stopLng: lastLng + 0.0005, message: 'staging flag',
    });
    if (r.status === 200 || r.json?.success) this.flagsRaised++;
    else if (r.status !== 409) { // 409/duplicate is a legitimate idempotent response
      this.failures.push({ stage: 'raise-flag', persona: this.label, error: `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`, at: new Date().toISOString() });
    }
  }

  get serverErrors(): string[] { return this.ws?.serverErrors ?? []; }
  get wsOpen(): boolean { return this.ws?.isOpen ?? false; }

  /** Check if the student is currently connected and subscribed for the given bus channel at timeMs.
   *  Uses every connection generation (initial + reconnects) so a subscription
   *  that survived on an older socket is never missed. */
  isConnectedAndSubscribedAt(timeMs: number, busChannel: string): boolean {
    for (const ws of this.wsHistory) {
      const connInterval = ws.connectionIntervals.find(
        (ci) => ci.start <= timeMs && ci.end >= timeMs,
      );
      if (!connInterval) continue;
      const subIntervals = ws.subscriptionIntervals.get(busChannel);
      if (!subIntervals) continue;
      if (subIntervals.some((si) => si.start <= timeMs && si.end >= timeMs)) return true;
    }
    return false;
  }

  close(): void { this.ws?.close(); }
}
