# Operational Relief Pool & Dynamic Conductor QR Check-In Architecture (Forensic Truth)

**Module:** Reserve Driver/Relief Pool, Emergency Shift Subbing, Conductor QR Check-In & Multi-Operator Roster Locks  
**File Authority:** `src/app/api/fleet/relief-pool/route.ts`, `src/app/driver/checkin/page.tsx`, `src/domains/fleet/`  
**Operational Scope:** High-concurrency transit dispatch without driver starvation or ghost vehicle trips  

---

# PART 5: The Operational Relief Pool & Dynamic Conductor QR Check-In Architecture

### 5.1 Sub-Domain Architecture & Exact Execution Pipeline

In university transit operations, driver absenteeism and vehicle breakdowns require dynamic relief driver dispatch. ADTU ITMS enforces a **2-Tier Authority Model**:
1. **Tier 1 (On-Duty Live Driver):** Resolved from `public.active_trips`. The driver who currently scanned the vehicle's QR code and holds the distributed lock.
2. **Tier 2 (Off-Duty Primary Bus Fallback):** Resolved from `buses.primary_driver_uid`. Displayed when no active trip is running.

```
Driver Scans Physical Bus QR Sticker
                 │
                 ▼
  POST /api/driver/resolve-bus-qr
                 │
  Validates QR format (`bus:<id>` or raw UUID)
  Queries PostgreSQL `buses` & `active_trips`
                 │
   Is bus already locked by another driver?
   ├─ YES ──> Returns `isOperatedByOther: true`, `activeDriverId: <uid>`
   └─ NO  ──> Returns bus details and preselects shift via IST time
                 │
                 ▼
     Select Shift & Confirm
  (IST Hour < 12 ? 'Morning' : 'Evening')
                 │
                 ▼
    POST /api/driver/initiate-trip
                 │
       acquire_trip_lock RPC
  (Automatic Stale Opposite-Shift Archive)
                 │
                 ▼
Trip Lock Granted -> Redirect to Live Tracking
```

---

### 5.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/driver/resolve-bus-qr/route.ts
// ============================================================================

import { parseQRPayload } from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ResolveBusQRSchema = z.object({
  qrData: z.string().min(1).max(500),
});

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { qrData } = body as z.infer<typeof ResolveBusQRSchema>;
    const supabase = getSupabaseServer();

    let busId: string | null = null;

    try {
      const contract = parseQRPayload(qrData);
      if (contract.busId) {
        busId = contract.busId;
      }
    } catch {
      busId = null;
    }

    if (!busId) {
      const trimmedQr = qrData.trim();
      const qrVariations = Array.from(new Set([
        ...getBusIdVariations(trimmedQr),
        ...(/^\d+$/.test(trimmedQr.replace(/^bus_/, ''))
          ? [
              trimmedQr.replace(/^bus_/, '').padStart(2, '0'),
              `bus_${trimmedQr.replace(/^bus_/, '').padStart(2, '0')}`,
              String(parseInt(trimmedQr.replace(/^bus_/, ''), 10)),
              `bus_${parseInt(trimmedQr.replace(/^bus_/, ''), 10)}`
            ]
          : [])
      ]));
      const busByNumber = await supabase
        .from('buses')
        .select('id')
        .in('bus_number', qrVariations)
        .limit(1)
        .maybeSingle();

      if (busByNumber.data) {
        busId = busByNumber.data.id;
      }
    }

    if (!busId) {
      return NextResponse.json({ found: false, error: 'No bus found for this QR code' }, { status: 404 });
    }

    const busVariations = Array.from(new Set([
      ...getBusIdVariations(busId),
      ...(/^\d+$/.test(busId.replace(/^bus_/, ''))
        ? [
            busId.replace(/^bus_/, '').padStart(2, '0'),
            `bus_${busId.replace(/^bus_/, '').padStart(2, '0')}`,
            String(parseInt(busId.replace(/^bus_/, ''), 10)),
            `bus_${parseInt(busId.replace(/^bus_/, ''), 10)}`
          ]
        : [])
    ]));
    const now = new Date().toISOString();
    const [busResult, activeTripResult] = await Promise.all([
      supabase
        .from('buses')
        .select('id, bus_number, status, route_id, route_name')
        .in('id', busVariations)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('active_trips')
        .select('trip_id, driver_id')
        .in('bus_id', busVariations)
        .eq('status', 'active')
        .gt('expires_at', now)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!busResult.data) {
      return NextResponse.json({ found: false, error: 'Bus not found' }, { status: 404 });
    }

    const activeTrip = activeTripResult.data;
    const isOperatedByOther = !!(activeTrip && activeTrip.driver_id !== auth.uid);

    return NextResponse.json({
      found: true,
      busId: busResult.data.id,
      busNumber: busResult.data.bus_number,
      status: busResult.data.status,
      routeId: busResult.data.route_id,
      routeName: busResult.data.route_name,
      isInTrip: !!activeTrip,
      is_operated_by_other: isOperatedByOther,
      isOperatedByOther,
      activeDriverId: activeTrip?.driver_id || null,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: ResolveBusQRSchema,
    rateLimit: RateLimits.READ,
  },
);
```

```typescript
// ============================================================================
// VERBATIM FROM src/app/driver/trip/start/page.tsx (IST Preselection & QR Camera)
// ============================================================================

    const selectBus = (bus: BusInfo) => {
      if (bus.is_operated_by_other) {
        setError(`Bus ${formatIdForDisplay(bus.bus_number || bus.id)} is currently operated by another driver. Please choose an available bus.`);
        return;
      }
      if (bus.status === "inactive" || bus.status === "maintenance") {
        setError(`Bus ${formatIdForDisplay(bus.bus_number || bus.id)} is currently ${bus.status} and cannot start a trip.`);
        return;
      }
      setSelectedBus(bus);
      const now = new Date();
      const istHours = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
      setSelectedShift(istHours < 12 ? "Morning" : "Evening");
      setStep("select-shift");
    };
```

---

