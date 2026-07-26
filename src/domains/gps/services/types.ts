export interface GPSCoordinate {
  lat: number;
  lng: number;
}

export interface GPSLocation {
  lat: number;
  lng: number;
  timestamp: string;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  source?: 'gps' | 'network' | 'unknown';
}

export interface GPSFilterResult {
  valid: boolean;
  reason?: string;
}

export interface GPSUpdate {
  driverUid: string;
  tripId: string;
  busId: string;
  location: GPSLocation;
  receivedAt: string;
}

export interface LocationUpdate {
  driverId: string;
  tripId: string;
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: string;
  provider?: 'gps' | 'network' | 'unknown';
  battery?: number;
}

export interface LocationUpdateNormalized {
  driverId: string;
  tripId: string;
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  timestamp: Date;
  provider: 'gps' | 'network' | 'unknown';
  battery: number | null;
}

export interface PipelineResult {
  accepted: boolean;
  reason?: string;
  normalized?: LocationUpdateNormalized;
  persisted?: boolean;
}

export interface LastLocation {
  lat: number;
  lng: number;
  timestamp: string;
}
