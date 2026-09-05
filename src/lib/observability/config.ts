/**
 * Centralized Observability Configuration Framework
 */

export interface ObservabilityConfig {
  environment: 'development' | 'production' | 'test';
  buildVersion: string;
  serviceName: string;
  hostname: string;
  processId: number;
  logLevel: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  logFormat: 'json' | 'pretty';
  samplingRate: number;
  tracingEnabled: boolean;
  metricPrefix: string;
  namespace: string;
  healthTimeoutsMs: {
    liveness: number;
    readiness: number;
    dependency: number;
  };
  correlationHeader: string;
  traceHeader: string;
  requestIdHeader: string;
  piiRedactionKeys: string[];
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

export const observabilityConfig: ObservabilityConfig = {
  environment: isTest ? 'test' : isProd ? 'production' : 'development',
  buildVersion: process.env.NEXT_PUBLIC_APP_VERSION || process.env.BUILD_VERSION || '1.0.0',
  serviceName: process.env.SERVICE_NAME || 'itms-platform',
  hostname: typeof window === 'undefined' ? (process.env.HOSTNAME || 'localhost') : 'browser',
  processId: typeof process !== 'undefined' && process.pid ? process.pid : 1,
  logLevel: (process.env.LOG_LEVEL?.toUpperCase() as ObservabilityConfig['logLevel']) || (isProd ? 'INFO' : 'WARN'),
  logFormat: (process.env.LOG_FORMAT as ObservabilityConfig['logFormat']) || 'json',
  samplingRate: parseFloat(process.env.TRACE_SAMPLING_RATE || '1.0'),
  tracingEnabled: process.env.TRACING_ENABLED === 'true' || true,
  metricPrefix: process.env.METRIC_PREFIX || 'itms_',
  namespace: process.env.METRIC_NAMESPACE || 'transport',
  healthTimeoutsMs: {
    liveness: 2000,
    readiness: 5000,
    dependency: 3000,
  },
  correlationHeader: 'x-correlation-id',
  traceHeader: 'traceparent',
  requestIdHeader: 'x-request-id',
  piiRedactionKeys: [
    'password',
    'secret',
    'jwt',
    'token',
    'authorization',
    'razorpay_payment_id',
    'razorpay_signature',
    'card',
    'cvv',
    'ssn',
    'student_name',
    'driver_phone',
    'phone',
    'email',
    'address',
  ],
};
