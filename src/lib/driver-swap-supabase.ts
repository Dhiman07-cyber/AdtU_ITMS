/**
 * Driver Swap Service - Supabase-based Implementation
 * 
 * Provides real-time driver swap functionality using Supabase
 * for instant updates without polling.
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase-server';
import { calculateNotificationExpiry } from './notification-expiry';
// D10: adminDb retained temporarily for notifications (no Supabase notifications table yet)
import { db as adminDb, FieldValue } from './firebase-admin';

// Default notification TTL: 1 day (24 hours)
const NOTIFICATION_TTL_DAYS = 1;

// Server-side Supabase client with service role
const supabase = getSupabaseServer();

export interface SwapRequest {
    id: string;
    requester_driver_uid: string;
    requester_name: string;
    candidate_driver_uid: string;
    candidate_name: string;
    bus_id: string;
    bus_number: string | null;
    route_id: string | null;
    route_name: string | null;
    secondary_bus_id: string | null;
    secondary_bus_number: string | null;
    secondary_route_id: string | null;
    secondary_route_name: string | null;
    starts_at: string;
    ends_at: string;
    expires_at: string | null;
    swap_type: 'assignment' | 'swap';
    reason: string | null;
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
    created_at: string;
    updated_at: string;
    accepted_by: string | null;
    accepted_at: string | null;
    rejected_by: string | null;
    rejected_at: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    meta: Record<string, any>;
}

// Convert Supabase row to API response format (matching existing app expectations)
function toApiFormat(row: SwapRequest) {
    return {
        id: row.id,
        fromDriverUID: row.requester_driver_uid,
        fromDriverName: row.requester_name,
        toDriverUID: row.candidate_driver_uid,
        toDriverName: row.candidate_name,
        busId: row.bus_id,
        busNumber: row.bus_number || row.meta?.busNumber || '',
        routeId: row.route_id || row.meta?.routeId || '',
        routeName: row.route_name || row.meta?.routeName || '',
        secondaryBusId: row.secondary_bus_id,
        secondaryBusNumber: row.secondary_bus_number,
        secondaryRouteId: row.secondary_route_id,
        secondaryRouteName: row.secondary_route_name,
        timePeriod: {
            startTime: row.starts_at,
            endTime: row.ends_at,
            type: row.meta?.timePeriodType || 'custom'
        },
        expiresAt: row.expires_at,
        swapType: row.swap_type,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        acceptedBy: row.accepted_by,
        acceptedAt: row.accepted_at,
        rejectedBy: row.rejected_by,
        rejectedAt: row.rejected_at,
        cancelledBy: row.cancelled_by,
        cancelledAt: row.cancelled_at
    };
}

export class DriverSwapSupabaseService {

    /**
     * Create a new swap request
     */
    static async createSwapRequest(params: {
        fromDriverUID: string;
        fromDriverName: string;
        toDriverUID: string;
        toDriverName: string;
        busId: string;
        busNumber: string;
        routeId: string;
        routeName: string;
        secondaryBusId?: string;
        secondaryBusNumber?: string;
        secondaryRouteId?: string;
        secondaryRouteName?: string;
        startTime: string;
        endTime: string;
        timePeriodType?: string;
        swapType?: 'assignment' | 'swap';
        reason?: string;
    }): Promise<{ success: boolean; requestId?: string; error?: string }> {
        try {
            const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
            if (!idPattern.test(params.fromDriverUID) || !idPattern.test(params.toDriverUID) || !idPattern.test(params.busId) || !idPattern.test(params.routeId)) {
                return { success: false, error: 'Invalid ID formats provided' };
            }
            if (params.secondaryBusId && !idPattern.test(params.secondaryBusId)) {
                return { success: false, error: 'Invalid secondary bus ID format' };
            }
            if (params.secondaryRouteId && !idPattern.test(params.secondaryRouteId)) {
                return { success: false, error: 'Invalid secondary route ID format' };
            }

            console.log('📝 Creating swap request in Supabase...');

            // Calculate expiry time (20 minutes from now)
            const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

            const { data, error } = await supabase
                .from('driver_swap_requests')
                .insert({
                    requester_driver_uid: params.fromDriverUID,
                    requester_name: params.fromDriverName,
                    candidate_driver_uid: params.toDriverUID,
                    candidate_name: params.toDriverName,
                    bus_id: params.busId,
                    bus_number: params.busNumber,
                    route_id: params.routeId,
                    route_name: params.routeName,
                    secondary_bus_id: params.secondaryBusId || null,
                    secondary_bus_number: params.secondaryBusNumber || null,
                    secondary_route_id: params.secondaryRouteId || null,
                    secondary_route_name: params.secondaryRouteName || null,
                    starts_at: params.startTime,
                    ends_at: params.endTime,
                    expires_at: expiresAt,
                    swap_type: params.swapType || 'assignment',
                    reason: params.reason || null,
                    status: 'pending',
                    meta: {
                        timePeriodType: params.timePeriodType || 'custom',
                        busNumber: params.busNumber,
                        routeName: params.routeName
                    }
                })
                .select()
                .single();

            if (error) {
                console.error('❌ Error creating swap request:', error);
                return { success: false, error: error.message };
            }

            console.log('✅ Swap request created:', data.id);

            // Send notification to target driver
            await this.sendSwapRequestNotification(
                data.id,
                params.fromDriverName,
                params.toDriverName,
                params.busNumber,
                params.toDriverUID
            );

            // Send real-time broadcast to candidate driver
            await this.broadcastSwapUpdate(data.id, 'swap_requested', {
                requestId: data.id,
                requesterUID: params.fromDriverUID,
                candidateUID: params.toDriverUID,
                requesterName: params.fromDriverName,
                candidateName: params.toDriverName,
                busNumber: params.busNumber
            });

            return { success: true, requestId: data.id };
        } catch (error: any) {
            console.error('❌ Exception creating swap request:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get swap requests for a driver
     */
    static async getSwapRequests(params: {
        driverUid: string;
        type: 'incoming' | 'outgoing' | 'all';
        status?: string;
    }): Promise<{ requests: any[]; error?: string }> {
        try {
            const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
            if (!params.driverUid || !idPattern.test(params.driverUid)) {
                return { requests: [], error: 'Invalid driver UID format' };
            }

            let query = supabase.from('driver_swap_requests').select('*');

            if (params.type === 'incoming') {
                query = query.eq('candidate_driver_uid', params.driverUid);
            } else if (params.type === 'outgoing') {
                query = query.eq('requester_driver_uid', params.driverUid);
            } else {
                query = query.or(`requester_driver_uid.eq.${params.driverUid},candidate_driver_uid.eq.${params.driverUid}`);
            }

            if (params.status) {
                query = query.eq('status', params.status);
            }

            const { data, error } = await query.order('created_at', { ascending: false });

            if (error) {
                console.error('❌ Error fetching swap requests:', error);
                return { requests: [], error: error.message };
            }

            // Convert to API format
            const requests = (data || []).map(toApiFormat);
            return { requests };
        } catch (error: any) {
            console.error('❌ Exception fetching swap requests:', error);
            return { requests: [], error: error.message };
        }
    }

    /**
     * Accept a swap request
     */
    static async acceptSwapRequest(
        requestId: string,
        acceptorUid: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            console.log('✅ Accepting swap request: %s', requestId);

            // Get the current request
            const { data: request, error: fetchError } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (fetchError || !request) {
                return { success: false, error: 'Swap request not found' };
            }

            if (request.status !== 'pending') {
                if (request.status === 'accepted' && request.accepted_by === acceptorUid) {
                    await this.createTemporaryAssignment(request);
                    return { success: true };
                }
                return { success: false, error: `Cannot accept: request is ${request.status}` };
            }

            if (request.candidate_driver_uid !== acceptorUid) {
                return { success: false, error: 'You are not the target of this swap request' };
            }

            // Update the request atomically
            const { data: updatedData, error: updateError } = await supabase
                .from('driver_swap_requests')
                .update({
                    status: 'accepted',
                    accepted_by: acceptorUid,
                    accepted_at: new Date().toISOString()
                })
                .eq('id', requestId)
                .eq('status', 'pending')
                .select();

            if (updateError) {
                return { success: false, error: updateError.message };
            }

            if (!updatedData || updatedData.length === 0) {
                const { data: currentReq } = await supabase.from('driver_swap_requests').select('*').eq('id', requestId).single();
                if (currentReq?.status === 'accepted' && currentReq?.accepted_by === acceptorUid) {
                    await this.createTemporaryAssignment(currentReq);
                    return { success: true };
                }
                return { success: false, error: 'Request was already processed' };
            }

            // Create temporary assignment
            await this.createTemporaryAssignment(request);

            // Update active trip session if requested
            if (request.meta?.applyToActiveTrip) {
                await this.updateActiveTripSession(request, acceptorUid);
            }

            // Send notifications
            await this.sendSwapAcceptedNotifications(request);
            await this.notifyStudentsOfDriverChange(request);
            await this.broadcastSwapUpdate(requestId, 'swap_accepted', {
                requestId,
                acceptedBy: acceptorUid,
                requesterName: request.requester_name,
                candidateName: request.candidate_name
            }, request);

            console.log('✅ Swap request accepted successfully');
            return { success: true };
        } catch (error: any) {
            console.error('❌ Error accepting swap request:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Reject a swap request
     */
    static async rejectSwapRequest(
        requestId: string,
        rejectorUid: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            console.log('❌ Rejecting swap request: %s', requestId);

            // Get the current request
            const { data: request, error: fetchError } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (fetchError || !request) {
                return { success: false, error: 'Swap request not found' };
            }

            if (request.status !== 'pending') {
                if (request.status === 'rejected' && request.rejected_by === rejectorUid) {
                    return { success: true };
                }
                return { success: false, error: `Cannot reject: request is ${request.status}` };
            }

            if (request.candidate_driver_uid !== rejectorUid) {
                return { success: false, error: 'You are not the target of this swap request' };
            }

            // Update the request atomically
            const { data: updatedData, error: updateError } = await supabase
                .from('driver_swap_requests')
                .update({
                    status: 'rejected',
                    rejected_by: rejectorUid,
                    rejected_at: new Date().toISOString()
                })
                .eq('id', requestId)
                .eq('status', 'pending')
                .select();

            if (updateError) {
                return { success: false, error: updateError.message };
            }

            if (!updatedData || updatedData.length === 0) {
                const { data: currentReq } = await supabase.from('driver_swap_requests').select('*').eq('id', requestId).single();
                if (currentReq?.status === 'rejected' && currentReq?.rejected_by === rejectorUid) {
                    return { success: true };
                }
                return { success: false, error: 'Request was already processed' };
            }

            // Send notification to requester
            await this.sendSwapRejectedNotification(request);
            
            // Send real-time broadcast to both drivers
            await this.broadcastSwapUpdate(requestId, 'swap_rejected', {
              requestId,
              rejectedBy: rejectorUid,
              requesterName: request.requester_name,
              candidateName: request.candidate_name
            }, request);

            console.log('✅ Swap request rejected successfully');
            return { success: true };
        } catch (error: any) {
            console.error('❌ Error rejecting swap request:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel a swap request (by requester)
     */
    static async cancelSwapRequest(
        requestId: string,
        cancellerUid: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            console.log('🚫 Cancelling swap request: %s', requestId);

            // Get the current request
            const { data: request, error: fetchError } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (fetchError || !request) {
                return { success: false, error: 'Swap request not found' };
            }

            if (request.requester_driver_uid !== cancellerUid) {
                return { success: false, error: 'Only the requester can cancel this swap' };
            }

            if (request.status !== 'pending') {
                if (request.status === 'cancelled' && request.cancelled_by === cancellerUid) {
                    return { success: true };
                }
                return { success: false, error: `Cannot cancel: request is ${request.status}` };
            }

            // Update the request atomically
            const { data: updatedData, error: updateError } = await supabase
                .from('driver_swap_requests')
                .update({
                    status: 'cancelled',
                    cancelled_by: cancellerUid,
                    cancelled_at: new Date().toISOString()
                })
                .eq('id', requestId)
                .eq('status', 'pending')
                .select();

            if (updateError) {
                return { success: false, error: updateError.message };
            }

            if (!updatedData || updatedData.length === 0) {
                const { data: currentReq } = await supabase.from('driver_swap_requests').select('*').eq('id', requestId).single();
                if (currentReq?.status === 'cancelled' && currentReq?.cancelled_by === cancellerUid) {
                    return { success: true };
                }
                return { success: false, error: 'Request was already processed' };
            }

            // Send real-time broadcast to both drivers
            await this.broadcastSwapUpdate(requestId, 'swap_cancelled', {
              requestId,
              cancelledBy: cancellerUid,
              requesterName: request.requester_name,
              candidateName: request.candidate_name
            }, request);

            console.log('✅ Swap request cancelled successfully');
            return { success: true };
        } catch (error: any) {
            console.error('❌ Error cancelling swap request:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * End an active swap (revert assignment)
     * 
     * IMPORTANT: Checks for active trips before reverting
     * - If trip is ongoing, marks the swap as 'pending_revert' 
     * - System will auto-complete reversion when trip ends
     */
    static async endSwap(
        requestId: string,
        enderUid: string
    ): Promise<{ success: boolean; error?: string; pendingTripEnd?: boolean }> {
        try {
            console.log('🔄 Ending swap: %s by %s', requestId, enderUid);

            // Get the current request
            const { data: request, error: fetchError } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (fetchError || !request) {
                return { success: false, error: 'Swap request not found' };
            }

            if (request.status !== 'accepted' && request.status !== 'pending_revert') {
                return { success: false, error: 'Only accepted swaps can be ended' };
            }

            // Allow system to call this (for cron jobs)
            if (enderUid !== 'system') {
                // Verify the user is involved in the swap
                if (request.requester_driver_uid !== enderUid && request.candidate_driver_uid !== enderUid) {
                    return { success: false, error: 'You are not part of this swap' };
                }
            }

            // Check if there's an active trip on the primary bus
            // We check BOTH Supabase bus_locations AND Firestore activeTripId for robustness
            let hasPrimaryTrip = false;
            let hasSecondaryTrip = false;

            // Helper function to check if bus has active trip
                const checkBusActiveTrip = async (busId: string): Promise<boolean> => {
                // D9: Check Supabase active_trips (authoritative source)
                const { data: activeTrip } = await supabase
                    .from('active_trips')
                    .select('trip_id, status, created_at')
                    .eq('bus_id', busId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (activeTrip) {
                    const createdAt = new Date(activeTrip.created_at).getTime();
                    const isExpired = (Date.now() - createdAt) > 12 * 60 * 60 * 1000;
                    if (!isExpired) {
                        console.log('   📍 Active trip %s found in Supabase for bus %s', activeTrip.trip_id, busId);
                        return true;
                    }
                }

                return false;
            };

            // Check primary bus (candidate is currently driving this bus after swap)
            hasPrimaryTrip = await checkBusActiveTrip(request.bus_id);

            // Check secondary bus for true swaps (requester is currently driving this bus after swap)
            if (request.secondary_bus_id) {
                hasSecondaryTrip = await checkBusActiveTrip(request.secondary_bus_id);
            }

            const isAssignment = request.swap_type === 'assignment' || !request.secondary_bus_id;

            // ========== HANDLE CASE 1: ASSIGNMENT (Assigned → Reserved) ==========
            if (isAssignment) {
                if (hasPrimaryTrip) {
                    // Trip still active on primary bus - mark as pending_revert
                    console.log('⏳ Trip in progress on primary bus - marking swap %s as pending_revert', requestId);
                    console.log('   → Bus ownership will remain with driver until trip completes (swap %s)', requestId);

                    await supabase
                        .from('driver_swap_requests')
                        .update({
                            status: 'pending_revert',
                            meta: {
                                ...request.meta,
                                pending_revert_since: new Date().toISOString(),
                                revert_requested_by: enderUid,
                                primary_trip_active: true
                            }
                        })
                        .eq('id', requestId);

                    return {
                        success: true,
                        pendingTripEnd: true,
                        error: 'Swap will end automatically when current trip completes'
                    };
                }

                // No active trip - safe to revert for Assignment case
                console.log('✅ No active trips - reverting ASSIGNMENT swap %s', requestId);
                console.log('   📋 Reverting ASSIGNMENT...');

                // D9: ATOMIC Supabase updates for bus + driver ownership
                await Promise.all([
                    // Restore bus to original driver (requester) AND clear active trip
                    supabase.from('buses').update({
                        driver_uid: request.requester_driver_uid,
                    }).eq('id', request.bus_id),
                    // Restore requester (fromDriver) - reassign to their original bus
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: request.bus_id,
                        bus_id: request.bus_id,
                        assigned_route_id: request.route_id || null,
                        route_id: request.route_id || null,
                    }).eq('uid', request.requester_driver_uid),
                    // Make candidate (toDriver) reserved again
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: null,
                        bus_id: null,
                        assigned_route_id: null,
                        route_id: null,
                    }).eq('uid', request.candidate_driver_uid),
                ]);

                console.log('   ✅ Bus %s restored to requester (swap %s)', request.bus_id, requestId);
                console.log('   ✅ From driver reassigned to bus (swap %s)', requestId);
                console.log('   ✅ To driver set to reserved (swap %s)', requestId);

            } else {
                // ========== HANDLE CASE 2: TRUE SWAP (Assigned ↔ Assigned) ==========
                // After swap: candidate drives primary bus, requester drives secondary bus

                // Check previous partial revert state
                const previousPartialRevert = request.meta?.partial_revert_completed;

                if (hasPrimaryTrip && hasSecondaryTrip) {
                    // BOTH trips are active - wait for both to complete
                    console.log('⏳ Both trips in progress - marking swap %s as pending_revert', requestId);
                    console.log('   → Primary bus: candidate still on trip (swap %s)', requestId);
                    console.log('   → Secondary bus: requester still on trip (swap %s)', requestId);
                    console.log('   → Both drivers keep their current buses until trips complete');

                    await supabase
                        .from('driver_swap_requests')
                        .update({
                            status: 'pending_revert',
                            meta: {
                                ...request.meta,
                                pending_revert_since: new Date().toISOString(),
                                revert_requested_by: enderUid,
                                primary_trip_active: true,
                                secondary_trip_active: true,
                                partial_revert_completed: null
                            }
                        })
                        .eq('id', requestId);

                    return {
                        success: true,
                        pendingTripEnd: true,
                        error: 'Swap will end automatically when both trips complete'
                    };

                } else if (hasPrimaryTrip && !hasSecondaryTrip) {
                    // PRIMARY bus has active trip (candidate still driving)
                    // Secondary bus trip is done - make REQUESTER reserved temporarily
                    console.log('⏳ Partial revert - Primary bus trip still active');
                    console.log('   → Candidate still on trip with primary bus - keeps the bus (swap %s)', requestId);
                    console.log('   → Requester has finished trip - becomes RESERVED temporarily (swap %s)', requestId);

                    // Make requester reserved (they finished their trip on secondary bus)
                    await Promise.all([
                        supabase.from('driver_profiles').update({
                            assigned_bus_id: null,
                            bus_id: null,
                            assigned_route_id: null,
                            route_id: null,
                        }).eq('uid', request.requester_driver_uid),
                        // Clear the secondary bus assignment (no driver now)
                        supabase.from('buses').update({
                            driver_uid: null,
                        }).eq('id', request.secondary_bus_id!),
                    ]);
                    console.log('   ✅ Secondary bus temporarily unassigned (swap %s)', requestId);

                    await supabase
                        .from('driver_swap_requests')
                        .update({
                            status: 'pending_revert',
                            meta: {
                                ...request.meta,
                                pending_revert_since: new Date().toISOString(),
                                revert_requested_by: enderUid,
                                primary_trip_active: true,
                                secondary_trip_active: false,
                                partial_revert_completed: 'secondary', // Secondary side reverted
                                requester_made_reserved: true
                            }
                        })
                        .eq('id', requestId);

                    return {
                        success: true,
                        pendingTripEnd: true,
                        error: `${request.requester_name} is now reserved. Swap will complete when ${request.candidate_name}'s trip ends.`
                    };

                } else if (!hasPrimaryTrip && hasSecondaryTrip) {
                    // SECONDARY bus has active trip (requester still driving)
                    // Primary bus trip is done - make CANDIDATE reserved temporarily
                    console.log('⏳ Partial revert - Secondary bus trip still active');
                    console.log('   → Requester still on trip with secondary bus - keeps the bus (swap %s)', requestId);
                    console.log('   → Candidate has finished trip - becomes RESERVED temporarily (swap %s)', requestId);

                    // Make candidate reserved (they finished their trip on primary bus)
                    await Promise.all([
                        supabase.from('driver_profiles').update({
                            assigned_bus_id: null,
                            bus_id: null,
                            assigned_route_id: null,
                            route_id: null,
                        }).eq('uid', request.candidate_driver_uid),
                        // Clear the primary bus assignment (no driver now)
                        supabase.from('buses').update({
                            driver_uid: null,
                        }).eq('id', request.bus_id),
                    ]);
                    console.log('   ✅ Primary bus temporarily unassigned (swap %s)', requestId);

                    await supabase
                        .from('driver_swap_requests')
                        .update({
                            status: 'pending_revert',
                            meta: {
                                ...request.meta,
                                pending_revert_since: new Date().toISOString(),
                                revert_requested_by: enderUid,
                                primary_trip_active: false,
                                secondary_trip_active: true,
                                partial_revert_completed: 'primary', // Primary side reverted
                                candidate_made_reserved: true
                            }
                        })
                        .eq('id', requestId);

                    return {
                        success: true,
                        pendingTripEnd: true,
                        error: `${request.candidate_name} is now reserved. Swap will complete when ${request.requester_name}'s trip ends.`
                    };

                } else {
                    // NO trips active - complete full revert
                    console.log('✅ No active trips - completing TRUE SWAP revert %s', requestId);

                    const isPartialSecondary = previousPartialRevert === 'secondary';
                    const isPartialPrimary = previousPartialRevert === 'primary';
                    if (isPartialSecondary) {
                        console.log('   📋 Completing partial revert (secondary side was already done)...');
                    } else if (isPartialPrimary) {
                        console.log('   📋 Completing partial revert (primary side was already done)...');
                    } else {
                        console.log('   📋 Reverting TRUE SWAP (full revert)...');
                        console.log('   ↔️ Restoring buses to original drivers (swap %s)', requestId);
                    }

                    // D9: ATOMIC Supabase updates for both buses and drivers
                    await Promise.all([
                        // Restore PRIMARY bus to requester
                        supabase.from('buses').update({
                            driver_uid: request.requester_driver_uid,
                        }).eq('id', request.bus_id),
                        // Restore SECONDARY bus to candidate
                        supabase.from('buses').update({
                            driver_uid: request.candidate_driver_uid,
                        }).eq('id', request.secondary_bus_id!),
                        // Restore requester to primary bus
                        supabase.from('driver_profiles').update({
                            assigned_bus_id: request.bus_id,
                            bus_id: request.bus_id,
                            assigned_route_id: request.route_id || null,
                            route_id: request.route_id || null,
                        }).eq('uid', request.requester_driver_uid),
                        // Restore candidate to secondary bus
                        supabase.from('driver_profiles').update({
                            assigned_bus_id: request.secondary_bus_id,
                            bus_id: request.secondary_bus_id,
                            assigned_route_id: request.secondary_route_id || null,
                            route_id: request.secondary_route_id || null,
                        }).eq('uid', request.candidate_driver_uid),
                    ]);

                    console.log('   ✅ Primary bus restored to requester (swap %s)', requestId);
                    console.log('   ✅ Secondary bus restored to candidate (swap %s)', requestId);
                    console.log('   ✅ Requester restored to primary bus (swap %s)', requestId);
                    console.log('   ✅ Candidate restored to secondary bus (swap %s)', requestId);
                }
            }

            // If we reached here without returning, the revert was successful
            console.log('✅ Firestore bus/driver ownership reverted successfully');

            // Supabase cleanup is housekeeping — failure here must NOT lose the
            // Firestore revert. Wrapped in try-catch so the next cron pass or
            // opportunistic cleanup will drain orphaned Supabase records.
            try {
                // Delete the temporary assignment from Supabase
                await supabase
                    .from('temporary_assignments')
                    .delete()
                    .eq('source_request_id', requestId);

                // If this was a true swap (both drivers had buses), cleanup secondary too
                if (request.secondary_bus_id) {
                    await supabase
                        .from('temporary_assignments')
                        .delete()
                        .eq('bus_id', request.secondary_bus_id);
                }

                // Delete the request (cleanup)
                await supabase
                    .from('driver_swap_requests')
                    .delete()
                    .eq('id', requestId);
            } catch (cleanupErr) {
                console.error('Non-critical: Supabase cleanup failed after Firestore revert:', cleanupErr);
                // The swap is functionally ended (Firestore ownership reverted).
                // Orphaned Supabase records will be cleaned by the next cron pass.
            }


            console.log('✅ Swap ended and ownership reverted successfully');
            return { success: true };
        } catch (error: any) {
            console.error('❌ Error ending swap:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Expire old pending requests
     */
    static async expirePendingRequests(): Promise<{ expired: number }> {
        try {
            const now = new Date().toISOString();

            // Find and update expired requests
            const { data, error } = await supabase
                .from('driver_swap_requests')
                .update({ status: 'expired' })
                .eq('status', 'pending')
                .lt('expires_at', now)
                .select();

            if (error) {
                console.error('❌ Error expiring requests:', error);
                return { expired: 0 };
            }

            if (data && data.length > 0) {
                console.log('⏰ Expired %d pending requests', data.length);
            }
            return { expired: data?.length || 0 };
        } catch (error: any) {
            console.error('❌ Exception expiring requests:', error);
            return { expired: 0 };
        }
    }

    /**
     * Check if driver has any active accepted swaps
     */
    static async hasActiveSwap(driverUid: string): Promise<boolean> {
        try {
            const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
            if (!driverUid || !idPattern.test(driverUid)) {
                console.error('❌ Invalid driver UID in hasActiveSwap:', driverUid);
                return false;
            }

            const { data, error } = await supabase
                .from('driver_swap_requests')
                .select('id')
                .eq('status', 'accepted')
                .or(`requester_driver_uid.eq.${driverUid},candidate_driver_uid.eq.${driverUid}`)
                .limit(1);

            if (error) {
                console.error('❌ Error checking active swap:', error);
                return false;
            }

            return (data?.length || 0) > 0;
        } catch (error: any) {
            console.error('❌ Exception checking active swap:', error);
            return false;
        }
    }

    /**
     * Check and expire accepted swaps that have passed their end time
     * IMPORTANT: Skips swaps where the driver has an active trip ongoing
     */
    static async checkAndExpireAcceptedSwaps(): Promise<{ expired: number; skipped: number; pendingReverted: number; activated: number }> {
        try {
            const now = new Date().toISOString();

            // 1. First, check for pending_revert swaps (waiting for trips to end)
            const { pendingReverted } = await this.checkPendingRevertSwaps();

            // 2. Check for scheduled swaps that should be ACTIVATED (starts_at reached)
            const { activated } = await this.checkScheduledSwapsToActivate();

            // 3. Find accepted swaps past their end time
            const { data: expiredSwaps, error } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('status', 'accepted')
                .lt('ends_at', now);

            if (error) {
                console.error('❌ Error fetching expired swaps:', error);
                return { expired: 0, skipped: 0, pendingReverted, activated };
            }

            if (!expiredSwaps || expiredSwaps.length === 0) {
                if (pendingReverted > 0 || activated > 0) {
                    console.log('🔄 Housekeeping: %d reverted, %d activated', pendingReverted, activated);
                }
                return { expired: 0, skipped: 0, pendingReverted, activated };
            }

            let expired = 0;
            let skipped = 0;

            for (const swap of expiredSwaps) {
                // endSwap will check for active trips and handle appropriately
                const result = await this.endSwap(swap.id, 'system');

                if (result.pendingTripEnd) {
                    // Swap marked as pending_revert (trip ongoing)
                    skipped++;
                    console.log('⏭️ Swap %s marked pending_revert - trip in progress', swap.id);
                } else if (result.success) {
                    expired++;
                    console.log('✅ Auto-ended swap %s after period ended', swap.id);
                }
            }

            if (expired > 0 || skipped > 0 || pendingReverted > 0 || activated > 0) {
                console.log('🔄 Housekeeping: %d expired, %d skipped, %d reverted, %d activated', expired, skipped, pendingReverted, activated);
            }
            return { expired, skipped, pendingReverted, activated };
        } catch (error: any) {
            console.error('❌ Exception checking expired accepted swaps:', error);
            return { expired: 0, skipped: 0, pendingReverted: 0, activated: 0 };
        }
    }

    /**
     * Check for scheduled swaps that should reach their start time and activate them in Firestore
     */
    static async checkScheduledSwapsToActivate(): Promise<{ activated: number }> {
        try {
            const now = new Date().toISOString();
            
            // Find accepted swaps whose starts_at has reached but are not yet reflected in temporary_assignments 
            // OR we can just find all 'accepted' swaps that are near their start time and re-run activation.
            // Activation logic (createTemporaryAssignment) is idempotent for Firestore.
            const { data: scheduledSwaps, error } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('status', 'accepted')
                .lte('starts_at', now); // Time reached or passed

            if (error || !scheduledSwaps || scheduledSwaps.length === 0) {
                return { activated: 0 };
            }

            let activated = 0;
            for (const swap of scheduledSwaps) {
                // Re-run the activation part (Firestore updates)
                // We call createTemporaryAssignment which we modified to handle Firestore updates
                await this.createTemporaryAssignment(swap);
                activated++;
            }

            return { activated };
        } catch (error: any) {
            console.error('❌ Error activating scheduled swaps:', error);
            return { activated: 0 };
        }
    }

    /**
     * Check for swaps in 'pending_revert' status and complete them if trips are now ended
     */
    static async checkPendingRevertSwaps(): Promise<{ pendingReverted: number }> {
        try {
            // Find swaps waiting for trip completion
            const { data: pendingSwaps, error } = await supabase
                .from('driver_swap_requests')
                .select('*')
                .eq('status', 'pending_revert');

            if (error || !pendingSwaps || pendingSwaps.length === 0) {
                return { pendingReverted: 0 };
            }

            let reverted = 0;

            for (const swap of pendingSwaps) {
                // Try to end the swap - it will check for active trips
                const result = await this.endSwap(swap.id, 'system');

                if (result.success && !result.pendingTripEnd) {
                    reverted++;
                    console.log('✅ Completed pending revert for swap %s', swap.id);
                }
            }

            return { pendingReverted: reverted };
        } catch (error: any) {
            console.error('❌ Error checking pending revert swaps:', error);
            return { pendingReverted: 0 };
        }
    }

    // ==================== PRIVATE HELPER METHODS ====================

    private static async createTemporaryAssignment(request: SwapRequest): Promise<void> {
        try {
            // Remove any existing assignment for this bus
            await supabase
                .from('temporary_assignments')
                .delete()
                .eq('bus_id', request.bus_id);

            // Create new assignment in Supabase
            await supabase.from('temporary_assignments').insert({
                bus_id: request.bus_id,
                original_driver_uid: request.requester_driver_uid,
                current_driver_uid: request.candidate_driver_uid,
                route_id: request.route_id || '',
                starts_at: request.starts_at,
                ends_at: request.ends_at,
                active: true,
                created_by: request.requester_driver_uid,
                source_request_id: request.id,
                reason: 'Driver swap request accepted'
            });


            console.log('✅ Temporary assignment created in Supabase');

            // ========== UPDATE FIRESTORE FOR BUS CONTROL TRANSFER ==========
            // This is critical for the driver page to correctly show bus information
            
            const now = new Date();
            const startsAt = new Date(request.starts_at);
            
            // SECURITY/ROBUSTNESS: Only update Firestore if the swap is starting NOW or very soon (within 5 mins)
            // This prevents future swaps from overriding current assignments immediately.
            // Housekeeping task will activate these swaps when their time comes.
            const isStartingNow = startsAt.getTime() <= now.getTime() + 5 * 60 * 1000;
            
            if (!isStartingNow) {
                console.log('⏳ Swap %s is scheduled for future (%s). Skipping immediate Firestore update.', request.id, request.starts_at);
                return;
            }

            console.log('🚀 Activating swap %s immediately as it starts soon/now', request.id);

            const isAssignment = request.swap_type === 'assignment' || !request.secondary_bus_id;

            if (isAssignment) {
                // SCENARIO 1: Assignment to Reserved Driver
                // fromDriver (requester) becomes reserved, toDriver (candidate) takes over the bus
                console.log('   📋 Processing as ASSIGNMENT (to reserved driver)');

                // D9: Supabase updates for bus + driver ownership transfer
                await Promise.all([
                    supabase.from('buses').update({
                        driver_uid: request.candidate_driver_uid,
                    }).eq('id', request.bus_id),
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: null,
                        bus_id: null,
                        assigned_route_id: null,
                        route_id: null,
                    }).eq('uid', request.requester_driver_uid),
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: request.bus_id,
                        bus_id: request.bus_id,
                        assigned_route_id: request.route_id || null,
                        route_id: request.route_id || null,
                    }).eq('uid', request.candidate_driver_uid),
                ]);
                console.log('   ✅ Bus %s assigned to %s (atomic)', request.bus_id, request.id);
                console.log('   ✅ From driver (%s) set to reserved', request.id);
                console.log('   ✅ To driver (%s) assigned to bus %s', request.id, request.bus_id);

            } else {
                // SCENARIO 2: True Swap between two active drivers
                // Both drivers exchange their bus assignments
                console.log('   📋 Processing as TRUE SWAP (both drivers have buses)');
                console.log('   ↔️ Exchanging buses (swap %s)', request.id);

                // D9: Supabase updates for both buses and drivers
                await Promise.all([
                    supabase.from('buses').update({
                        driver_uid: request.candidate_driver_uid,
                    }).eq('id', request.bus_id),
                    supabase.from('buses').update({
                        driver_uid: request.requester_driver_uid,
                    }).eq('id', request.secondary_bus_id!),
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: request.secondary_bus_id,
                        bus_id: request.secondary_bus_id,
                        assigned_route_id: request.secondary_route_id || null,
                        route_id: request.secondary_route_id || null,
                    }).eq('uid', request.requester_driver_uid),
                    supabase.from('driver_profiles').update({
                        assigned_bus_id: request.bus_id,
                        bus_id: request.bus_id,
                        assigned_route_id: request.route_id || null,
                        route_id: request.route_id || null,
                    }).eq('uid', request.candidate_driver_uid),
                ]);
                console.log('   ✅ Primary bus assigned to candidate (atomic, swap %s)', request.id);
                console.log('   ✅ Secondary bus assigned to requester (swap %s)', request.id);
                console.log('   ✅ From driver assigned to secondary bus (swap %s)', request.id);
                console.log('   ✅ To driver assigned to primary bus (swap %s)', request.id);
            }

            console.log('✅ Firestore bus/driver ownership transferred successfully');
        } catch (error) {
            console.error('❌ Error creating temporary assignment:', error);
            throw error; // Re-throw to indicate failure
        }
    }

    private static async sendSwapRequestNotification(
        requestId: string,
        fromDriverName: string,
        toDriverName: string,
        busNumber: string,
        toDriverUID: string
    ): Promise<void> {
        try {
            console.log('📧 Sending swap request notification to: %s', toDriverUID);

            const now = new Date();
            const expiresAt = calculateNotificationExpiry(now, NOTIFICATION_TTL_DAYS);

            await adminDb.collection('notifications').add({
                title: '🔄 New Driver Swap Request',
                content: `${fromDriverName} has requested you to take over Bus ${busNumber}. Please visit the Swap Requests page to accept or reject this request.`,
                sender: { userId: 'system', userName: 'System', userRole: 'admin' },
                target: { type: 'specific_users', specificUserIds: [toDriverUID] },
                recipientIds: [toDriverUID],
                autoInjectedRecipientIds: [],
                createdAt: FieldValue.serverTimestamp(),
                expiresAt,
                isEdited: false,
                isDeletedGlobally: false,
                hiddenForUserIds: [],
                readByUserIds: [],
                metadata: {
                    requestId,
                    type: 'swap_request',
                    actionUrl: '/driver/swap-request'
                }
            });

            console.log('✅ Notification sent');
        } catch (error) {
            console.error('❌ Error sending notification:', error);
        }
    }

    private static async sendSwapAcceptedNotifications(request: SwapRequest): Promise<void> {
        try {
            // Notify the requester
            const now = new Date();
            const expiresAt = calculateNotificationExpiry(now, NOTIFICATION_TTL_DAYS);

            await adminDb.collection('notifications').add({
                title: '✅ Swap Request Accepted!',
                content: `${request.candidate_name} has accepted your swap request for Bus ${request.bus_number || request.bus_id}. The swap will be active during the scheduled period.`,
                sender: { userId: 'system', userName: 'System', userRole: 'admin' },
                target: { type: 'specific_users', specificUserIds: [request.requester_driver_uid] },
                recipientIds: [request.requester_driver_uid],
                autoInjectedRecipientIds: [],
                createdAt: FieldValue.serverTimestamp(),
                expiresAt,
                isEdited: false,
                isDeletedGlobally: false,
                hiddenForUserIds: [],
                readByUserIds: [],
                metadata: {
                    requestId: request.id,
                    type: 'swap_accepted',
                    actionUrl: '/driver/swap-request'
                }
            });

            console.log('✅ Swap accepted notifications sent');
        } catch (error) {
            console.error('❌ Error sending accepted notifications:', error);
        }
    }

    private static async sendSwapRejectedNotification(request: SwapRequest): Promise<void> {
        try {
            const now = new Date();
            const expiresAt = calculateNotificationExpiry(now, NOTIFICATION_TTL_DAYS);

            await adminDb.collection('notifications').add({
                title: '❌ Swap Request Declined',
                content: `${request.candidate_name} was unable to accept your swap request for Bus ${request.bus_number || request.bus_id}. You may try requesting another driver.`,
                sender: { userId: 'system', userName: 'System', userRole: 'admin' },
                target: { type: 'specific_users', specificUserIds: [request.requester_driver_uid] },
                recipientIds: [request.requester_driver_uid],
                autoInjectedRecipientIds: [],
                createdAt: FieldValue.serverTimestamp(),
                expiresAt,
                isEdited: false,
                isDeletedGlobally: false,
                hiddenForUserIds: [],
                readByUserIds: [],
                metadata: {
                    requestId: request.id,
                    type: 'swap_rejected',
                    actionUrl: '/driver/swap-request'
                }
            });

            console.log('✅ Swap rejected notification sent');
        } catch (error) {
            console.error('❌ Error sending rejected notification:', error);
        }
    }

    private static async updateActiveTripSession(request: SwapRequest, newDriverUid: string): Promise<void> {
        try {
            console.log('🔄 Checking for active trip session to update...');
            // D9: Check Supabase active_trips (authoritative source)
            const { data: activeTrip } = await supabase
                .from('active_trips')
                .select('trip_id')
                .eq('bus_id', request.bus_id)
                .eq('status', 'active')
                .maybeSingle();

            if (activeTrip) {
                // Update the driver on the active trip
                await supabase
                    .from('active_trips')
                    .update({ driver_id: newDriverUid })
                    .eq('trip_id', activeTrip.trip_id)
                    .eq('status', 'active');
                console.log('✅ Updated active trip %s with new driver %s', activeTrip.trip_id, newDriverUid);
            } else {
                console.log('ℹ️ No active trip session found to update');
            }
        } catch (error) {
            console.error('❌ Error updating active trip session:', error);
            // Don't throw - this is non-critical for the swap itself
        }
    }

    private static async notifyStudentsOfDriverChange(request: SwapRequest): Promise<void> {
        try {
            console.log('📢 Notifying students of driver change for swap %s', request.id);

            // D9: Get students on this bus from Supabase
            const { data: students } = await supabase
                .from('student_profiles')
                .select('uid')
                .eq('bus_id', request.bus_id)
                .eq('status', 'active');

            if (!students || students.length === 0) {
                console.log('ℹ️ No students found for this bus');
                return;
            }

            // D10: FCM tokens are still in Firestore subcollections (students/{id}/tokens)
            // This will be migrated in D10 when FCM token storage moves to Supabase
            const tokens: string[] = [];
            for (const student of students) {
                try {
                    const tokensSnap = await adminDb
                        .collection('students')
                        .doc(student.uid)
                        .collection('tokens')
                        .get();
                    tokensSnap.docs.forEach((doc: any) => {
                        const data = doc.data();
                        if (data?.token) tokens.push(data.token);
                    });
                } catch {
                    // Skip student if token fetch fails
                }
            }

            if (tokens.length === 0) {
                console.log('ℹ️ No FCM tokens found for students');
                return;
            }

            const messaging = (await import('firebase-admin/messaging')).getMessaging();

            const response = await messaging.sendEachForMulticast({
                tokens: tokens,
                notification: {
                    title: 'Driver Change Update',
                    body: `${request.candidate_name} will be driving Bus ${request.bus_number || request.bus_id} temporarily.`,
                },
                data: {
                    type: 'DRIVER_CHANGE',
                    busId: request.bus_id,
                    routeId: request.route_id || '',
                    newDriverName: request.candidate_name,
                    requestId: request.id
                }
            });

            console.log('✅ Sent driver change notification to %d students (%d failed)', response.successCount, response.failureCount);
        } catch (error) {
            console.error('❌ Error notifying students:', error);
            // Don't throw - notification failure shouldn't rollback swap
        }
    }

    /**
     * Broadcast real-time updates to both drivers involved in swap
     */
    private static async broadcastSwapUpdate(
        requestId: string,
        eventType: 'swap_requested' | 'swap_cancelled' | 'swap_rejected' | 'swap_accepted',
        payload: any,
        request?: SwapRequest
    ): Promise<void> {
        try {
            console.log('📡 Broadcasting %s for request %s', eventType, requestId);
            
            // Extract driver UIDs from request or payload cleanly
            const requesterUID = request?.requester_driver_uid || payload.requesterUID || payload.requesterUid;
            const candidateUID = request?.candidate_driver_uid || payload.candidateUID || payload.candidateUid;
            
            if (!requesterUID || !candidateUID) {
                console.error('❌ Cannot broadcast: missing driver UIDs');
                return;
            }
            
            // Send broadcast to both drivers involved
            const channels = [
                supabase.channel(`driver_swap_requests:${requesterUID}`),
                supabase.channel(`driver_swap_requests:${candidateUID}`)
            ];

            for (const channel of channels) {
                await channel.send({
                    type: 'broadcast',
                    event: eventType,
                    payload: {
                        requestId,
                        ...payload
                    }
                });
            }

            console.log(`✅ Broadcast sent for ${eventType}`);
        } catch (error) {
            console.error(`❌ Error broadcasting ${eventType}:`, error);
            // Don't throw - broadcast failure shouldn't rollback the operation
        }
    }
}

export default DriverSwapSupabaseService;
