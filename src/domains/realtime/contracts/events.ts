export type RealtimeEventType =
  | 'TripStarted'
  | 'TripEnded'
  | 'LocationUpdated'
  | 'DriverOnline'
  | 'DriverOffline'
  | 'WaitingFlagChanged'
  | 'EmergencyRaised'
  | 'StudentSubscribed'
  | 'StudentUnsubscribed'
  | 'RouteUpdated'
  | 'BusOnline'
  | 'BusOffline';

export interface RealtimeEvent {
  type: RealtimeEventType;
  channel: string;
  payload: Record<string, unknown>;
  timestamp: string;
  metadata?: {
    driverId?: string;
    busId?: string;
    tripId?: string;
    studentId?: string;
    routeId?: string;
  };
}

export interface TripStartedEvent extends RealtimeEvent {
  type: 'TripStarted';
  payload: {
    busId: string;
    tripId: string;
    driverId: string;
    routeId: string;
    shift: string;
    routeName?: string;
    busNumber?: string;
  };
}

export interface TripEndedEvent extends RealtimeEvent {
  type: 'TripEnded';
  payload: {
    busId: string;
    tripId: string;
    busNumber?: string;
  };
}

export interface LocationUpdatedEvent extends RealtimeEvent {
  type: 'LocationUpdated';
  payload: {
    busId: string;
    tripId: string;
    lat: number;
    lng: number;
    timestamp: string;
  };
}

export type RealtimeEventPayload =
  | TripStartedEvent
  | TripEndedEvent
  | LocationUpdatedEvent;

export function createEvent(
  type: RealtimeEventType,
  channel: string,
  payload: Record<string, unknown>,
  metadata?: RealtimeEvent['metadata'],
): RealtimeEvent {
  return { type, channel, payload, timestamp: new Date().toISOString(), metadata };
}
