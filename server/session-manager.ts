import crypto from 'crypto';

export interface Session {
  socketId: string;
  uid: string;
  role: string;
  busId?: string;
  tripId?: string;
  routeId?: string;
  subscriptions: Set<string>;
  connectedSince: number;
  lastHeartbeat: number;
  ip: string;
  device?: string;
  reconnectToken?: string;
  previousSocketId?: string;
}

const sessions = new Map<string, Session>();
const reconnectTokens = new Map<string, string>(); // token → socketId
const uidIndex = new Map<string, Set<string>>();
const busIdIndex = new Map<string, Set<string>>();
const tripIdIndex = new Map<string, Set<string>>();
const routeIdIndex = new Map<string, Set<string>>();
const roleIndex = new Map<string, Set<string>>();

function addToIndex(map: Map<string, Set<string>>, key: string, socketId: string): void {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(socketId);
}

function removeFromIndex(map: Map<string, Set<string>>, key: string, socketId: string): void {
  map.get(key)?.delete(socketId);
  if (map.get(key)?.size === 0) map.delete(key);
}

export class SessionManager {
  create(params: {
    socketId: string;
    uid: string;
    role: string;
    ip: string;
    device?: string;
    previousSocketId?: string;
  }): Session {
    const reconnectToken = crypto.randomUUID();
    const session: Session = {
      socketId: params.socketId,
      uid: params.uid,
      role: params.role,
      subscriptions: new Set(),
      connectedSince: Date.now(),
      lastHeartbeat: Date.now(),
      ip: params.ip,
      device: params.device,
      reconnectToken,
      previousSocketId: params.previousSocketId,
    };
    sessions.set(params.socketId, session);
    reconnectTokens.set(reconnectToken, params.socketId);
    addToIndex(uidIndex, params.uid, params.socketId);
    addToIndex(roleIndex, params.role, params.socketId);
    return session;
  }

  get(socketId: string): Session | undefined {
    return sessions.get(socketId);
  }

  getByUid(uid: string): Session[] {
    const ids = uidIndex.get(uid);
    if (!ids) return [];
    return Array.from(ids).map(id => sessions.get(id)).filter(Boolean) as Session[];
  }

  getByRole(role: string): Session[] {
    const ids = roleIndex.get(role);
    if (!ids) return [];
    return Array.from(ids).map(id => sessions.get(id)).filter(Boolean) as Session[];
  }

  getByBusId(busId: string): Session[] {
    const ids = busIdIndex.get(busId);
    if (!ids) return [];
    return Array.from(ids).map(id => sessions.get(id)).filter(Boolean) as Session[];
  }

  getByTripId(tripId: string): Session[] {
    const ids = tripIdIndex.get(tripId);
    if (!ids) return [];
    return Array.from(ids).map(id => sessions.get(id)).filter(Boolean) as Session[];
  }

  getByRouteId(routeId: string): Session[] {
    const ids = routeIdIndex.get(routeId);
    if (!ids) return [];
    return Array.from(ids).map(id => sessions.get(id)).filter(Boolean) as Session[];
  }

  findByReconnectToken(token: string): Session | undefined {
    const socketId = reconnectTokens.get(token);
    if (!socketId) return undefined;
    return sessions.get(socketId);
  }

  updateHeartbeat(socketId: string): void {
    const session = sessions.get(socketId);
    if (session) session.lastHeartbeat = Date.now();
  }

  addSubscription(socketId: string, channel: string): boolean {
    const session = sessions.get(socketId);
    if (!session) return false;
    session.subscriptions.add(channel);
    return true;
  }

  removeSubscription(socketId: string, channel: string): boolean {
    const session = sessions.get(socketId);
    if (!session) return false;
    return session.subscriptions.delete(channel);
  }

  setBusId(socketId: string, busId: string): void {
    const session = sessions.get(socketId);
    if (!session) return;
    if (session.busId) removeFromIndex(busIdIndex, session.busId, socketId);
    session.busId = busId;
    addToIndex(busIdIndex, busId, socketId);
  }

  setTripId(socketId: string, tripId: string): void {
    const session = sessions.get(socketId);
    if (!session) return;
    if (session.tripId) removeFromIndex(tripIdIndex, session.tripId, socketId);
    session.tripId = tripId;
    addToIndex(tripIdIndex, tripId, socketId);
  }

  setRouteId(socketId: string, routeId: string): void {
    const session = sessions.get(socketId);
    if (!session) return;
    if (session.routeId) removeFromIndex(routeIdIndex, session.routeId, socketId);
    session.routeId = routeId;
    addToIndex(routeIdIndex, routeId, socketId);
  }

  restoreSession(token: string, newSocketId: string): Session | undefined {
    const session = this.findByReconnectToken(token);
    if (!session) return undefined;
    const subscriptions = session.subscriptions;
    const busId = session.busId;
    const tripId = session.tripId;
    const routeId = session.routeId;

    this.delete(session.socketId);

    const restored = this.create({
      socketId: newSocketId,
      uid: session.uid,
      role: session.role,
      ip: session.ip,
      device: session.device,
      previousSocketId: session.socketId,
    });

    for (const ch of subscriptions) restored.subscriptions.add(ch);
    if (busId) this.setBusId(newSocketId, busId);
    if (tripId) this.setTripId(newSocketId, tripId);
    if (routeId) this.setRouteId(newSocketId, routeId);

    return restored;
  }

  delete(socketId: string): void {
    const session = sessions.get(socketId);
    if (!session) return;
    if (session.busId) removeFromIndex(busIdIndex, session.busId, socketId);
    if (session.tripId) removeFromIndex(tripIdIndex, session.tripId, socketId);
    if (session.routeId) removeFromIndex(routeIdIndex, session.routeId, socketId);
    removeFromIndex(uidIndex, session.uid, socketId);
    removeFromIndex(roleIndex, session.role, socketId);
    if (session.reconnectToken) reconnectTokens.delete(session.reconnectToken);
    sessions.delete(socketId);
  }

  get size(): number {
    return sessions.size;
  }

  getActiveSockets(): Session[] {
    return Array.from(sessions.values());
  }
}

export const sessionManager = new SessionManager();
