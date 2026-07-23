/**
 * Missed Bus Service (Proximity-Aware, No Admin, No Audit)
 * 
 * Stage-1: Check if assigned bus is within 100m or ETA decreasing → ask student to wait
 * Stage-2: Only if assigned bus has passed → search for candidate buses
 * 
 * Key features:
 * - Proximity-aware with Haversine distance calculation (100m threshold)
 * - Idempotent request creation (using op_id)
 * - Rate limiting (max 3 requests per day per student)
 * - ETA-based candidate selection
 * - Driver accept/reject flow
 * - Automatic expiration of pending requests
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase-server';
import * as routeService from '@/domains/route';

// Configuration (per spec)
const CONFIG = {
  NEARBY_THRESHOLD_METERS: 100,       // Proximity threshold for "bus is nearby" (Stage-1)
  BOARDING_THRESHOLD_METERS: 10,      // Final boarding detection
  AVG_MINUTES_PER_STOP: 3,            // Fallback ETA calculation
  REQUEST_EXPIRES_MINUTES: 15,        // Request TTL
  ASSIGNED_WAIT_MAX_SECONDS: 180,     // Max driver wait time
  DRIVER_HEARTBEAT_TIMEOUT_SEC: 60,   // Driver must have recent heartbeat
  RATE_LIMIT_REQUESTS_PER_DAY: 3,     // Max requests per student per day
  WORKER_LIMIT: 50,                   // Rows processed per worker run
  MAX_ETA_MINUTES: 30                 // Maximum ETA to consider a bus as candidate
};

// UI Messages (exact text as specified)
export const MESSAGES = {
  MAINTENANCE_TOAST: "This feature is currently under maintenance. Sorry for the inconvenience caused",
  ASSIGNED_NEARBY: "Your assigned bus appears nearby — please wait a few minutes so the driver can pick you up.",
  ASSIGNED_BUS_ON_WAY: "Your assigned bus is still on the way. Alternate buses are not available yet.",
  SEARCHING: "Searching other buses to help you. We'll notify you shortly.",
  REQUEST_PENDING: "Pickup request sent to nearby buses. We'll notify you when a driver accepts.",
  NO_CANDIDATES_MODAL: "Currently no bus is available to pick you up. Please wait for the next bus or try again later.",
  REQUEST_ACCEPTED: (busId: string, stop_name: string) =>
    `Good news — Bus ${busId} will pick you up. Please head to ${stop_name}.`,
  REQUEST_EXPIRED: "Your pickup request expired. Please try again if needed.",
  RATE_LIMITED: "You have reached the missed-bus request limit. Try again later.",
  DRIVER_NOT_ACTIVE: "Driver currently not active. Please wait or try another bus.",
  ALREADY_HAS_PENDING: "You already have a pending or approved missed-bus request."
};

// Types
export interface RaiseRequestInput {
  opId: string;
  studentId: string;
  assignedTripId?: string;
  assignedBusId?: string;  // Student's assigned bus ID
  routeId: string;
  stop_name: string;
  studentLocation?: { lat: number; lng: number }; // Optional student location
}

export interface RaiseRequestResult {
  success: boolean;
  stage?: 'maintenance' | 'no_candidates' | 'pending' | 'assigned_on_way' | 'assigned_nearby' | 'rate_limited' | 'already_pending';
  requestId?: string;
  candidates?: Array<{ tripId: string; busId: string; eta: number }>;
  message: string;
}

export interface DriverResponseInput {
  driverId: string;
  requestId: string;
  decision: 'accept' | 'reject';
}

export interface DriverResponseResult {
  success: boolean;
  result: 'accepted' | 'rejected' | 'already_handled' | 'not_active' | 'not_authorized';
  message?: string;
}

export interface CancelRequestInput {
  studentId: string;
  requestId: string;
}

export interface CancelRequestResult {
  success: boolean;
  message?: string;
}

interface TripCandidate {
  tripId: string;
  busId: string;
  driverId: string;
  routeId: string;
  currentSeq: number;
  eta: number;
  etaMinutes: number;
  distanceMeters?: number;
  isNearby: boolean;
  lastHeartbeat: string;
}

interface RouteStop {
  stop_name: string;
  name: string;
  sequence: number;
  lat?: number;
  lng?: number;
}

interface BusLocation {
  lat: number;
  lng: number;
  timestamp: number;
}

/**
 * Calculate Haversine distance between two points in meters
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Missed Bus Service Class
 */
export class MissedBusService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseServer();
  }

  /**
   * Raise a missed-bus request (student action)
   * Implements Stage-1 (assigned bus check) and Stage-2 (candidate search) flow
   */
  async raiseRequest(input: RaiseRequestInput): Promise<RaiseRequestResult> {
    const { opId, studentId, routeId, stop_name, assignedBusId } = input;

    try {
      console.log(`\n🚌 === MISSED BUS REQUEST ===`);
      console.log(`📋 Input: studentId=${studentId}, routeId=${routeId}, stop_name=${stop_name}, assignedBusId=${assignedBusId}`);

      // STEP 1: Check idempotency - return existing request if opId matches
      const { data: existingByOpId } = await this.supabase
        .from('missed_bus_requests')
        .select('*')
        .eq('op_id', opId)
        .maybeSingle();

      if (existingByOpId) {
        console.log(`♻️ Idempotent return: existing request ${existingByOpId.id}`);
        return {
          success: true,
          stage: 'pending',
          requestId: existingByOpId.id,
          message: MESSAGES.REQUEST_PENDING
        };
      }

      // STEP 2: Check if student already has a pending/approved request
      const { data: existingPending } = await this.supabase
        .from('missed_bus_requests')
        .select('id, status')
        .eq('student_id', studentId)
        .in('status', ['pending', 'approved'])
        .limit(1);

      if (existingPending && existingPending.length > 0) {
        console.log(`⚠️ Student already has pending request: ${existingPending[0].id}`);
        return {
          success: false,
          stage: 'already_pending',
          message: MESSAGES.ALREADY_HAS_PENDING
        };
      }

      // STEP 3: Check rate limit
      const rateLimitOk = await this.checkRateLimit(studentId);
      if (!rateLimitOk) {
        console.log(`🚫 Rate limit exceeded for student ${studentId}`);
        return {
          success: false,
          stage: 'rate_limited',
          message: MESSAGES.RATE_LIMITED
        };
      }

      // STEP 4: Get student's stop sequence and location from route
      const studentSequence = await this.getStudentSequence(routeId, stop_name);
      const stopLocation = await this.getStopLocation(routeId, stop_name);
      console.log(`📍 Student: sequence=${studentSequence ?? 'unknown'}, stopLocation=${stopLocation ? `(${stopLocation.lat},${stopLocation.lng})` : 'unknown'}`);

      // ===============================
      // STAGE-1: ASSIGNED BUS CHECK
      // ===============================
      console.log(`\n🔍 === STAGE-1: ASSIGNED BUS CHECK ===`);

      if (assignedBusId) {
        // Query for assigned bus's current status
        const { data: assignedBusStatus } = await this.supabase
          .from('driver_status')
          .select('*')
          .eq('bus_id', assignedBusId)
          .eq('status', 'on_trip')
          .maybeSingle();

        if (assignedBusStatus) {
          console.log(`🚍 Found assigned bus ${assignedBusId} is currently on_trip`);

          // Get assigned bus location from bus_locations
          const busLocation = await this.getBusLocation(assignedBusId);

          if (busLocation && stopLocation) {
            // Calculate Haversine distance
            const distanceMeters = haversineDistance(
              busLocation.lat, busLocation.lng,
              stopLocation.lat, stopLocation.lng
            );
            console.log(`📏 Distance: Bus to stop = ${distanceMeters.toFixed(0)}m`);

            // PROXIMITY CHECK: If within 100m, ask student to wait
            if (distanceMeters <= CONFIG.NEARBY_THRESHOLD_METERS) {
              console.log(`✅ Assigned bus is within ${CONFIG.NEARBY_THRESHOLD_METERS}m - student should wait`);
              return {
                success: false,
                stage: 'assigned_nearby',
                message: MESSAGES.ASSIGNED_NEARBY
              };
            }
          }

          // SEQUENCE CHECK: If bus hasn't passed student's stop, it's still approaching
          const busSequence = assignedBusStatus.metadata?.current_stop_sequence ?? 0;
          console.log(`📍 Assigned bus sequence: ${busSequence}, Student sequence: ${studentSequence ?? 'unknown'}`);

          if (studentSequence !== null && busSequence < studentSequence) {
            // Bus hasn't passed the student's stop yet
            console.log(`🚌 Assigned bus (seq ${busSequence}) hasn't passed student's stop (seq ${studentSequence})`);

            // Calculate ETA for assigned bus
            const stopsRemaining = studentSequence - busSequence;
            const etaMinutes = stopsRemaining * CONFIG.AVG_MINUTES_PER_STOP;
            console.log(`⏱️ Assigned bus ETA: ${etaMinutes} minutes (${stopsRemaining} stops remaining)`);

            // If ETA is reasonable, the bus is still approaching
            if (etaMinutes <= CONFIG.MAX_ETA_MINUTES) {
              console.log(`✅ Assigned bus is still approaching (ETA ${etaMinutes}min) - cannot raise missed bus request`);
              return {
                success: false,
                stage: 'assigned_on_way',
                message: MESSAGES.ASSIGNED_BUS_ON_WAY
              };
            }
          } else if (studentSequence !== null && busSequence >= studentSequence) {
            console.log(`✅ Assigned bus has passed student's stop (bus seq ${busSequence} >= student seq ${studentSequence}) - proceeding to Stage-2`);
          }
        } else {
          console.log(`📭 Assigned bus ${assignedBusId} is not currently on_trip - proceeding to Stage-2`);
        }
      } else {
        console.log(`⚠️ No assignedBusId provided - proceeding to Stage-2`);
      }

      // ===============================
      // STAGE-2: CANDIDATE SEARCH
      // ===============================
      console.log(`\n🔍 === STAGE-2: CANDIDATE SEARCH ===`);

      // Query driver_status for all active drivers on this route
      const { data: activeDrivers, error: driversError } = await this.supabase
        .from('driver_status')
        .select('*')
        .eq('route_id', routeId)
        .eq('status', 'on_trip');

      if (driversError) {
        console.error(`❌ Error querying driver_status:`, driversError);
      }

      console.log(`🔍 Found ${activeDrivers?.length || 0} on_trip drivers for route ${routeId}`);

      if (!activeDrivers || activeDrivers.length === 0) {
        // Try case-insensitive match
        const { data: allActiveDrivers } = await this.supabase
          .from('driver_status')
          .select('*')
          .eq('status', 'on_trip');

        const matchingDrivers = allActiveDrivers?.filter(d =>
          d.route_id?.toLowerCase() === routeId?.toLowerCase()
        );

        if (matchingDrivers && matchingDrivers.length > 0) {
          console.log(`✅ Found ${matchingDrivers.length} drivers with case-insensitive match`);
          // Use matching drivers
          return this.processStage2Candidates(
            input, matchingDrivers, studentSequence, stopLocation
          );
        }

        console.log(`❌ No active drivers found for route ${routeId}`);
        return {
          success: false,
          stage: 'no_candidates',
          message: MESSAGES.NO_CANDIDATES_MODAL
        };
      }

      return this.processStage2Candidates(input, activeDrivers, studentSequence, stopLocation);

    } catch (error: any) {
      console.error('❌ Error in raiseRequest:', error);
      throw error;
    }
  }

  /**
   * Process Stage-2 candidates after assigned bus check passed
   */
  private async processStage2Candidates(
    input: RaiseRequestInput,
    activeDrivers: any[],
    studentSequence: number | null,
    stopLocation: { lat: number; lng: number } | null
  ): Promise<RaiseRequestResult> {
    const { opId, studentId, routeId, stop_name, assignedBusId } = input;
    const now = new Date();
    const candidates: TripCandidate[] = [];

    console.log(`\n👥 Processing ${activeDrivers.length} potential candidates...`);

    for (const driver of activeDrivers) {
      // Skip assigned bus (we already checked it in Stage-1)
      if (driver.bus_id === assignedBusId) {
        console.log(`  ⏭️ Skipping assigned bus ${driver.bus_id}`);
        continue;
      }

      // Check heartbeat freshness
      const heartbeatTime = new Date(driver.last_updated_at);
      const heartbeatAgeSec = (now.getTime() - heartbeatTime.getTime()) / 1000;

      // For driver_status, last_updated_at updates when status changes
      // But we can also check bus_locations for recent location updates
      const recentLocation = await this.getBusLocation(driver.bus_id);
      let isActive = false;

      if (recentLocation) {
        const locationAgeSec = (now.getTime() - recentLocation.timestamp) / 1000;
        isActive = locationAgeSec < 300; // 5 minutes
        console.log(`  📍 Bus ${driver.bus_id}: location ${locationAgeSec.toFixed(0)}s old, active=${isActive}`);
      } else {
        // If no recent location, check if driver was recently updated
        isActive = heartbeatAgeSec < 600; // 10 minutes for driver_status
        console.log(`  ⏰ Bus ${driver.bus_id}: driver_status ${heartbeatAgeSec.toFixed(0)}s old, active=${isActive}`);
      }

      if (!isActive) {
        console.log(`  ⏭️ Skipping bus ${driver.bus_id} - stale (inactive)`);
        continue;
      }

      // Get bus sequence
      const busSequence = driver.metadata?.current_stop_sequence ?? 0;

      // Check if bus has passed student's stop
      if (studentSequence !== null && busSequence >= studentSequence) {
        console.log(`  ⏭️ Skipping bus ${driver.bus_id} - has passed stop (bus seq ${busSequence} >= student seq ${studentSequence})`);
        continue;
      }

      // Calculate distance if we have location data
      let distanceMeters: number | undefined;
      if (recentLocation && stopLocation) {
        distanceMeters = haversineDistance(
          recentLocation.lat, recentLocation.lng,
          stopLocation.lat, stopLocation.lng
        );
      }

      // Calculate ETA
      const stopsRemaining = studentSequence !== null ? Math.max(0, studentSequence - busSequence) : 0;
      const etaMinutes = stopsRemaining * CONFIG.AVG_MINUTES_PER_STOP;
      const etaSeconds = etaMinutes * 60;

      // Include if ETA is reasonable or bus is nearby
      const isNearby = distanceMeters !== undefined && distanceMeters <= CONFIG.NEARBY_THRESHOLD_METERS;

      if (etaMinutes <= CONFIG.MAX_ETA_MINUTES || isNearby) {
        candidates.push({
          tripId: driver.trip_id || driver.id,
          busId: driver.bus_id,
          driverId: driver.driver_uid,
          routeId: driver.route_id,
          currentSeq: busSequence,
          eta: etaSeconds,
          etaMinutes: etaMinutes,
          distanceMeters: distanceMeters,
          isNearby: isNearby,
          lastHeartbeat: driver.last_updated_at
        });
        console.log(`  ✅ Added candidate: bus ${driver.bus_id}, ETA ${etaMinutes}min, distance ${distanceMeters?.toFixed(0) ?? 'unknown'}m`);
      } else {
        console.log(`  ⏭️ Skipping bus ${driver.bus_id} - ETA too high (${etaMinutes}min)`);
      }
    }

    // Sort by ETA ascending (closest first)
    candidates.sort((a, b) => a.eta - b.eta);
    console.log(`\n👥 Final candidates: ${candidates.length}`);

    if (candidates.length === 0) {
      console.log(`❌ No candidates after filtering`);
      return {
        success: false,
        stage: 'no_candidates',
        message: MESSAGES.NO_CANDIDATES_MODAL
      };
    }

    // Create the request in database
    const expiresAt = new Date(now.getTime() + CONFIG.REQUEST_EXPIRES_MINUTES * 60 * 1000);
    const tripCandidates = candidates.map(c => ({
      trip_id: c.tripId,
      bus_id: c.busId,
      eta_minutes: c.etaMinutes,
      nearby: c.isNearby
    }));

    const { data: newRequest, error: insertError } = await this.supabase
      .from('missed_bus_requests')
      .insert({
        op_id: opId,
        student_id: studentId,
        route_id: routeId,
        stop_name: stop_name,
        student_sequence: studentSequence,
        status: 'pending',
        trip_candidates: tripCandidates,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error(`❌ Failed to create request:`, insertError);
      throw new Error('Failed to create missed bus request');
    }

    console.log(`✅ Created request ${newRequest.id} with ${candidates.length} candidates`);

    // Log completion
    const elapsed = Date.now() - now.getTime();
    console.log(`\n📝 Missed-bus raise completed in ${elapsed}ms:`, {
      studentId,
      routeId,
      stop_name,
      success: true,
      stage: 'pending',
      candidateCount: candidates.length
    });

    return {
      success: true,
      stage: 'pending',
      requestId: newRequest.id,
      candidates: candidates.map(c => ({
        tripId: c.tripId,
        busId: c.busId,
        eta: c.etaMinutes
      })),
      message: MESSAGES.REQUEST_PENDING
    };
  }

  /**
   * Get bus location from bus_locations table
   */
  private async getBusLocation(busId: string): Promise<BusLocation | null> {
    try {
      const { data, error } = await this.supabase
        .from('bus_locations')
        .select('lat, lng, timestamp')
        .eq('bus_id', busId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      return {
        lat: data.lat,
        lng: data.lng,
        timestamp: new Date(data.timestamp).getTime()
      };
    } catch {
      return null;
    }
  }

  /**
   * Get stop location from route data
   */
  private async getStopLocation(routeId: string, stop_name: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const route = await routeService.getById(routeId);
      if (route) {
        const stops = route.stops || [];
        const stop = stops.find((s: any) =>
          s.stop_name === stop_name ||
          s.id === stop_name ||
          s.name?.toLowerCase() === stop_name.toLowerCase()
        );
        if (stop && stop.lat && stop.lng) {
          return { lat: stop.lat, lng: stop.lng };
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to get stop location:`, error);
    }
    return null;
  }

  /**
   * Get student's stop sequence from route data
   */
  private async getStudentSequence(routeId: string, stop_name: string): Promise<number | null> {
    try {
      const route = await routeService.getById(routeId);
      if (route) {
        const stops = route.stops || [];
        const stopIndex = stops.findIndex((s: any) =>
          s.stop_name === stop_name ||
          s.id === stop_name ||
          s.name?.toLowerCase() === stop_name.toLowerCase()
        );
        if (stopIndex >= 0) {
          return stopIndex + 1; // 1-indexed sequence
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to get student sequence:`, error);
    }
    return null;
  }

  /**
   * Check rate limit for student
   */
  private async checkRateLimit(studentId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await this.supabase
      .from('missed_bus_requests')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .gte('created_at', today.toISOString());

    if (error) {
      console.warn('Rate limit check failed:', error);
      return true; // Allow on error
    }

    return (count || 0) < CONFIG.RATE_LIMIT_REQUESTS_PER_DAY;
  }

  /**
   * Driver responds to a missed-bus request (accept/reject)
   */
  async driverResponse(input: DriverResponseInput): Promise<DriverResponseResult> {
    const { driverId, requestId, decision } = input;

    try {
      // Get the request
      const { data: request, error: fetchError } = await this.supabase
        .from('missed_bus_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError || !request) {
        return { success: false, result: 'not_authorized', message: 'Request not found' };
      }

      // Check if request is still pending
      if (request.status !== 'pending') {
        return { success: false, result: 'already_handled', message: 'Request already handled' };
      }

      // Verify driver is a candidate
      const candidates = request.trip_candidates || [];
      const isCandidate = candidates.some((c: any) =>
        c.driver_id === driverId || c.bus_id
      );

      // Get driver's active trip
      const { data: driverStatus } = await this.supabase
        .from('driver_status')
        .select('*')
        .eq('driver_uid', driverId)
        .eq('status', 'on_trip')
        .single();

      if (!driverStatus) {
        return { success: false, result: 'not_active', message: MESSAGES.DRIVER_NOT_ACTIVE };
      }

      if (decision === 'accept') {
        // Atomic update - only succeeds if status is still 'pending'
        const { data: updated, error: updateError } = await this.supabase
          .from('missed_bus_requests')
          .update({
            status: 'approved',
            candidate_trip_id: driverStatus.trip_id || driverStatus.id,
            responded_by: driverId,
            responded_at: new Date().toISOString()
          })
          .eq('id', requestId)
          .eq('status', 'pending')
          .select();

        if (updateError || !updated || updated.length === 0) {
          return { success: false, result: 'already_handled' };
        }

        return {
          success: true,
          result: 'accepted',
          message: 'You have accepted the pickup request'
        };

      } else {
        // Reject - just update status
        await this.supabase
          .from('missed_bus_requests')
          .update({
            status: 'rejected',
            responded_by: driverId,
            responded_at: new Date().toISOString()
          })
          .eq('id', requestId)
          .eq('status', 'pending');

        return {
          success: true,
          result: 'rejected',
          message: 'You have declined the pickup request'
        };
      }

    } catch (error: any) {
      console.error('Error in driverResponse:', error);
      throw error;
    }
  }

  /**
   * Cancel a pending request (student action)
   */
  async cancelRequest(input: CancelRequestInput): Promise<CancelRequestResult> {
    const { studentId, requestId } = input;

    try {
      const { data: updated, error } = await this.supabase
        .from('missed_bus_requests')
        .update({
          status: 'cancelled',
          student_location: null
        })
        .eq('id', requestId)
        .eq('student_id', studentId)
        .eq('status', 'pending')
        .select();

      if (error || !updated || updated.length === 0) {
        return { success: false, message: 'Unable to cancel request' };
      }

      return { success: true, message: 'Request cancelled' };

    } catch (error: any) {
      console.error('Error in cancelRequest:', error);
      throw error;
    }
  }

  /**
   * Get student's active request status
   */
  async getStatus(studentId: string): Promise<any | null> {
    try {
      const { data } = await this.supabase
        .from('missed_bus_requests')
        .select('*')
        .eq('student_id', studentId)
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Expire pending missed-bus requests that have exceeded their TTL.
   * Called by the cleanup cron job.
   * @returns Number of requests expired
   */
  async expirePendingRequests(): Promise<number> {
    try {
      const now = new Date().toISOString();

      // Atomically update all pending requests where expires_at has passed.
      // The WHERE clause ensures idempotency: already-expired or already-handled
      // rows are not touched.
      const { data, error } = await this.supabase
        .from('missed_bus_requests')
        .update({
          status: 'expired',
          updated_at: now
        })
        .eq('status', 'pending')
        .lt('expires_at', now)
        .select('id');

      if (error) {
        console.error('Failed to expire pending missed-bus requests:', error);
        return 0;
      }

      const count = data?.length || 0;
      if (count > 0) {
        console.log(`🔄 Expired ${count} stale missed-bus requests`);
      }
      return count;
    } catch (error) {
      console.error('Error in expirePendingRequests:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const missedBusService = new MissedBusService();
