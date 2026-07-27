/**
 * PROGRAM-004 / PHASE-01 Observability Foundation
 * Canonical Type Definitions & Instrumentation Contracts
 */

export type SeverityLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface StructuredLogEntry {
  timestamp: string;
  severity: SeverityLevel;
  service: string;
  component: string;
  operation: string;
  correlation_id: string;
  request_id: string;
  trace_id: string;
  span_id: string;
  user_role?: string;
  user_id?: string;
  driver_id?: string;
  student_id?: string;
  trip_id?: string;
  bus_id?: string;
  route_id?: string;
  application_id?: string;
  payment_id?: string;
  notification_id?: string;
  duration_ms?: number;
  result?: 'SUCCESS' | 'FAILURE' | 'REJECTED' | 'TIMEOUT' | 'DEGRADED';
  error_type?: string;
  environment: string;
  build_version: string;
  hostname: string;
  process_id: number;
  thread: string;
  [key: string]: unknown;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  flags?: number;
  baggage?: Record<string, string>;
}

export interface RequestContext {
  correlationId: string;
  requestId: string;
  traceContext: TraceContext;
  service: string;
  component: string;
  operation: string;
  userId?: string;
  userRole?: string;
  driverId?: string;
  studentId?: string;
  tripId?: string;
  busId?: string;
  routeId?: string;
  applicationId?: string;
  paymentId?: string;
  notificationId?: string;
  startTime: number;
  environment: string;
  buildVersion: string;
  hostname: string;
  processId: number;
}

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'timer' | 'observable_gauge';

export interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labelNames?: string[];
  namespace?: string;
}

export interface MetricValue {
  name: string;
  help: string;
  type: MetricType;
  values: Array<{
    value: number;
    labels?: Record<string, string>;
    timestamp?: number;
  }>;
}

export const CanonicalErrorClass = {
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  REDIS_ERROR: 'REDIS_ERROR',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  GPS_ERROR: 'GPS_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  APPLICATION_ERROR: 'APPLICATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  SECURITY_ERROR: 'SECURITY_ERROR',
} as const;

export type CanonicalErrorClass = typeof CanonicalErrorClass[keyof typeof CanonicalErrorClass];

export type EventName =
  | 'TripStarted'
  | 'TripEnded'
  | 'GPSUpdated'
  | 'PaymentInitiated'
  | 'PaymentCompleted'
  | 'ApplicationSubmitted'
  | 'ApplicationApproved'
  | 'ApplicationRejected'
  | 'NotificationSent'
  | 'WaitingFlagRaised'
  | 'DriverAssigned'
  | 'StudentBoarded'
  | 'SessionStarted'
  | 'SessionEnded'
  | 'BusAssigned'
  | 'RouteAssigned'
  | 'RoleChanged'
  | 'ConfigurationUpdated';

export interface EventActor {
  id?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
}

export interface EventTarget {
  id?: string;
  type?: string;
}

export interface CanonicalEvent<T = Record<string, unknown>> {
  eventId: string;
  eventName: EventName;
  version: string;
  timestamp: string;
  correlationId: string;
  traceId: string;
  origin: string;
  actor?: EventActor;
  target?: EventTarget;
  payload: T;
  reliabilityExpectation: 'EXACTLY_ONCE' | 'AT_LEAST_ONCE' | 'BEST_EFFORT';
}

export type HealthStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'MAINTENANCE';

export interface ComponentHealth {
  status: HealthStatus;
  details?: Record<string, unknown>;
  latencyMs?: number;
  error?: string;
  lastChecked?: string;
}

export interface SystemHealthResponse {
  status: HealthStatus;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: Record<string, ComponentHealth>;
}
