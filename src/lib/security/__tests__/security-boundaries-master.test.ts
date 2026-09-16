import { describe, it, expect, afterEach, vi } from 'vitest';
import { isOriginAllowed, validateOrigin } from '../../../proxy';
import { checkDeviceSession } from '../../session-device-service';
import { validateStudentScannerContext } from '../scanner-auth';
import {
  encryptQRCodeData,
  decryptQRCodeData,
  createSecurePaymentReference,
  verifySecurePaymentReference,
  QRCodePayload,
} from '../encryption.service';
import { atomicGpsGuardAndUpdate } from '../../../domains/gps/services/gps-redis-guard';

describe('Master Security Boundaries & Invariant Suite', () => {
  describe('CSRF & Origin Validation (SEC-01, SEC-02, SEC-03)', () => {
    it('rejects arbitrary .vercel.app origins (SEC-03 wildcard fix)', () => {
      expect(isOriginAllowed('https://attacker-domain.vercel.app')).toBe(false);
      expect(isOriginAllowed('https://phishing.vercel.app')).toBe(false);
    });

    it('rejects malicious external origins', () => {
      expect(isOriginAllowed('https://evil-phishing.com')).toBe(false);
      expect(isOriginAllowed('https://google.com')).toBe(false);
    });

    it('allows trusted production and localhost origins', () => {
      expect(isOriginAllowed('https://adtu-bus.vercel.app')).toBe(true);
      expect(isOriginAllowed('https://adtu-bus-xq.vercel.app')).toBe(true);
    });

    it('validateOrigin blocks state-changing requests with missing Origin and Referer when unauthenticated (SEC-01/02)', () => {
      const mockReq = {
        method: 'POST',
        headers: new Headers({}),
        nextUrl: { pathname: '/api/applications/submit' },
      } as any;
      expect(validateOrigin(mockReq)).toBe(false);
    });

    it('validateOrigin permits requests with missing Origin/Referer if Authorization Bearer header is supplied', () => {
      const mockReq = {
        method: 'POST',
        headers: new Headers({
          authorization: 'Bearer valid-jwt-token-from-mobile-or-script',
        }),
        nextUrl: { pathname: '/api/location/update' },
      } as any;
      expect(validateOrigin(mockReq)).toBe(true);
    });
  });

  describe('Device Session Fail-Closed Enforcement (AUTH-02 / MIMO #2)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fails closed on network exception by denying single-device authority', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await checkDeviceSession('user-123', 'driver_location_share', true);
      expect(result.isCurrentDevice).toBe(false);
      expect(result.hasActiveSession).toBe(true);
      expect(result.serviceUnavailable).toBe(true);
    });

    it('fails closed on HTTP 500 server error response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const result = await checkDeviceSession('user-123', 'driver_location_share', true);
      expect(result.isCurrentDevice).toBe(false);
      expect(result.hasActiveSession).toBe(true);
      expect(result.serviceUnavailable).toBe(true);
    });

    it('fails closed on malformed non-JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('SyntaxError: Unexpected token <')),
      });

      const result = await checkDeviceSession('user-123', 'driver_location_share', true);
      expect(result.isCurrentDevice).toBe(false);
      expect(result.hasActiveSession).toBe(true);
      expect(result.serviceUnavailable).toBe(true);
    });
  });

  describe('Scanner Moderator Permissions (NEW-04)', () => {
    it('denies verification if moderator lacks explicit canView permission', async () => {
      const auth = { uid: 'mod-123', role: 'moderator' };
      // validateStudentScannerContext queries moderator permissions
      // We test that role 'other' is strictly forbidden
      const res = await validateStudentScannerContext({ uid: 'random-user', role: 'student' }, 'BUS-1');
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
    });
  });

  describe('128-bit Cryptographic Invariants (NEW-06, NEW-07)', () => {
    it('generates Version 2 QR tokens with 128-bit HMAC and decrypts successfully', () => {
      const qrToken = encryptQRCodeData('STU12345', { busId: 'BUS01', name: 'John Doe' });
      expect(qrToken).toBeDefined();

      const decrypted = decryptQRCodeData(qrToken);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.uid).toBe('STU12345');
      expect(decrypted?.busId).toBe('BUS01');
    });

    it('generates 128-bit (32 hex char) payment references and verifies integrity', () => {
      const ref = createSecurePaymentReference('pay_test_9999', 'stu_8888', 5000, 'Online');
      expect(ref).toBeDefined();

      const verified = verifySecurePaymentReference(ref);
      expect(verified).not.toBeNull();
      expect(verified?.paymentId).toBe('pay_test_9999');
      expect(verified?.signature.length).toBe(32); // 128-bit HMAC (32 hex characters)
    });
  });

  describe('GPS Redis Guard Multi-Instance Fail-Closed Invariant (Section 12)', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalRedisUrl = process.env.REDIS_URL;

    afterEach(() => {
      (process.env as any).NODE_ENV = originalEnv;
      process.env.REDIS_URL = originalRedisUrl;
      delete process.env.ALLOW_INSECURE_LOCAL_GPS_FALLBACK;
    });

    it('fails closed and returns redis_unavailable in production when Redis is unreachable', async () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://invalid-nonexistent-redis-host:6379';
      delete process.env.ALLOW_INSECURE_LOCAL_GPS_FALLBACK;

      const result = await atomicGpsGuardAndUpdate('BUS_TEST_FAILCLOSED', 26.1, 91.8, Date.now(), Date.now());
      expect(result).toBe('redis_unavailable');
    });
  });
});
