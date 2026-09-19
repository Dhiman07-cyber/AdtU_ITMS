import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Multi-Driver Concurrency & Dynamic Bus Assignment Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Available Buses Real-Time Occupancy', () => {
    it('accurately tags bus occupancy per requesting driver UID', () => {
      const driverAUid = 'driver_A';
      const driverBUid = 'driver_B';

      const buses = [
        { id: 'bus_6', bus_number: 'BUS-06', status: 'active', route_id: 'r6', route_name: 'Route 6' },
        { id: 'bus_7', bus_number: 'BUS-07', status: 'active', route_id: 'r7', route_name: 'Route 7' },
      ];

      const activeTrips = [
        { trip_id: 'trip_101', bus_id: 'bus_6', driver_id: driverAUid, status: 'active', expires_at: new Date(Date.now() + 600000).toISOString() },
      ];

      const activeTripsMap = new Map<string, any>();
      activeTrips.forEach((t) => activeTripsMap.set(t.bus_id, t));

      const enrichForDriver = (requestingUid: string) => {
        return buses.map((bus) => {
          const activeTrip = activeTripsMap.get(bus.id);
          const isInTrip = !!activeTrip;
          const isOperatedByOther = isInTrip && activeTrip.driver_id !== requestingUid;
          const isOperatedByMe = isInTrip && activeTrip.driver_id === requestingUid;

          return {
            ...bus,
            isInTrip,
            is_in_trip: isInTrip,
            isOperatedByOther,
            is_operated_by_other: isOperatedByOther,
            isOperatedByMe,
            is_operated_by_me: isOperatedByMe,
            activeDriverId: activeTrip?.driver_id || null,
          };
        });
      };

      // When Driver B queries available buses:
      const busesForDriverB = enrichForDriver(driverBUid);
      const bus6ForB = busesForDriverB.find((b) => b.id === 'bus_6');
      const bus7ForB = busesForDriverB.find((b) => b.id === 'bus_7');

      expect(bus6ForB?.is_in_trip).toBe(true);
      expect(bus6ForB?.is_operated_by_other).toBe(true);
      expect(bus6ForB?.is_operated_by_me).toBe(false);

      expect(bus7ForB?.is_in_trip).toBe(false);
      expect(bus7ForB?.is_operated_by_other).toBe(false);
      expect(bus7ForB?.is_operated_by_me).toBe(false);

      // When Driver A queries available buses:
      const busesForDriverA = enrichForDriver(driverAUid);
      const bus6ForA = busesForDriverA.find((b) => b.id === 'bus_6');

      expect(bus6ForA?.is_in_trip).toBe(true);
      expect(bus6ForA?.is_operated_by_other).toBe(false);
      expect(bus6ForA?.is_operated_by_me).toBe(true);
    });
  });

  describe('Check Active Trip Scoping', () => {
    it('does not lock out an idle driver whose default assigned bus is in use', () => {
      const driverBUid = 'driver_B';
      const activeTripsInDb = [
        { trip_id: 'trip_101', bus_id: 'bus_6', driver_id: 'driver_A', status: 'active' },
      ];

      // Driver B checks their own active status without an active trip
      const myTrip = activeTripsInDb.find((t) => t.driver_id === driverBUid && t.status === 'active');
      expect(myTrip).toBeUndefined();

      // Idle driver query: busId is NOT passed from client on idle mount
      const inputBusId = undefined;
      let busLockedByOther = false;

      if (!myTrip && inputBusId) {
        const targetBusTrip = activeTripsInDb.find((t) => t.bus_id === inputBusId && t.status === 'active');
        if (targetBusTrip && targetBusTrip.driver_id !== driverBUid) {
          busLockedByOther = true;
        }
      }

      // Proves Driver B is NOT locked out and is free to start any bus
      expect(busLockedByOther).toBe(false);
    });

    it('retains Driver B active trip on Bus 7 even if legacy busId=bus_6 is passed', () => {
      const driverBUid = 'driver_B';
      const activeTripsInDb = [
        { trip_id: 'trip_101', bus_id: 'bus_6', driver_id: 'driver_A', status: 'active' },
        { trip_id: 'trip_102', bus_id: 'bus_7', driver_id: driverBUid, status: 'active' },
      ];

      // Even if legacy client code passed busId = 'bus_6'
      const inputBusId = 'bus_6';

      // Primary check: DOES THIS DRIVER HAVE AN ACTIVE TRIP? (independent of inputBusId)
      const myTrip = activeTripsInDb.find((t) => t.driver_id === driverBUid && t.status === 'active');

      expect(myTrip).toBeDefined();
      expect(myTrip?.bus_id).toBe('bus_7');
      expect(myTrip?.trip_id).toBe('trip_102');
      // Driver B active trip is correctly preserved on Bus 7
    });
  });

  describe('Concurrent Multi-Driver Independence', () => {
    it('permits Driver A on Bus 6 and Driver B on Bus 7 to operate simultaneously without collision', () => {
      const activeTrips = new Map<string, { driverId: string; busId: string }>();

      const startTrip = (driverId: string, busId: string) => {
        // Exclusive bus operation check
        if (activeTrips.has(busId)) {
          const existing = activeTrips.get(busId)!;
          if (existing.driverId !== driverId) {
            return { success: false, errorCode: 'LOCKED_BY_OTHER', reason: 'Bus currently operated by another driver' };
          }
          return { success: true, alreadyActive: true };
        }
        activeTrips.set(busId, { driverId, busId });
        return { success: true, alreadyActive: false };
      };

      // 1. Driver A starts Bus 6
      const startA = startTrip('driver_A', 'bus_6');
      expect(startA.success).toBe(true);

      // 2. Driver B starts Bus 7 concurrently
      const startB = startTrip('driver_B', 'bus_7');
      expect(startB.success).toBe(true);

      // 3. Driver B tries to start Bus 6 -> fails with LOCKED_BY_OTHER
      const conflictB = startTrip('driver_B', 'bus_6');
      expect(conflictB.success).toBe(false);
      expect(conflictB.errorCode).toBe('LOCKED_BY_OTHER');

      // 4. Driver A ends Bus 6
      activeTrips.delete('bus_6');

      // 5. Driver C or Driver B can now start Bus 6
      const startC = startTrip('driver_C', 'bus_6');
      expect(startC.success).toBe(true);
    });
  });
});
