import 'dotenv/config';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the security wrapper to run the handler directly
vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => {
    return async (req: any) => {
      return handler(req, {
        auth: { uid: 'test-admin', email: 'admin@test.com', role: 'admin', name: 'Test Admin' },
        body: null,
        requestId: 'test-request-id',
        headers: new Headers(),
        ip: '127.0.0.1',
      });
    };
  },
}));

// Mock Firebase Admin
const mockCountGet = vi.fn().mockResolvedValue({
  data: () => ({ count: 10 })
});

const mockDocGet = vi.fn().mockResolvedValue({
  exists: true,
  data: () => ({ busFee: { amount: 120 } })
});

const mockCollectionGet = vi.fn().mockResolvedValue({
  size: 5,
  forEach: (cb: any) => {
    cb({
      id: 'bus-1',
      data: () => ({ busNumber: 'B1', currentMembers: 20, totalCapacity: 50, status: 'Active' })
    });
  },
  docs: [
    {
      id: 'route-1',
      data: () => ({ routeName: 'Route 1' })
    }
  ]
});

const mockCollection = vi.fn().mockReturnValue({
  count: vi.fn().mockReturnValue({ get: mockCountGet }),
  where: vi.fn().mockReturnValue({
    count: vi.fn().mockReturnValue({ get: mockCountGet }),
    where: vi.fn().mockReturnValue({
      count: vi.fn().mockReturnValue({ get: mockCountGet })
    })
  }),
  get: mockCollectionGet,
  doc: vi.fn().mockReturnValue({ get: mockDocGet })
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (...args: any[]) => mockCollection(...args),
  },
  FieldValue: {
    serverTimestamp: () => 'timestamp',
  },
}));

// Mock Supabase Server
const mockSupabaseSelect = vi.fn().mockReturnValue({
  in: vi.fn().mockResolvedValue({
    data: [
      { id: 'trip-1', bus_id: 'bus-1', route_id: 'route-1', status: 'enroute', started_at: '2026-07-01T12:00:00Z' }
    ]
  }),
  or: vi.fn().mockResolvedValue({
    data: [
      { amount: 1500, method: 'online' },
      { amount: 500, method: 'offline' }
    ]
  })
});

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: () => ({
      select: mockSupabaseSelect
    })
  })
}));

// Mock Deadline Config
vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: vi.fn().mockResolvedValue({
    academicYear: { anchorMonth: 5, anchorDay: 30 },
    softBlock: { month: 4, day: 15 },
    hardDelete: { month: 5, day: 15 }
  })
}));

// Now import GET after the mocks are registered
import { GET } from './route';

describe('GET /api/admin/dashboard-counts', () => {
  it('should execute the API route handler successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/dashboard-counts');
    const res = await GET(req);
    
    console.log('Response Status:', res.status);
    const body = await res.json();
    console.log('Response Body:', JSON.stringify(body, null, 2));

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

