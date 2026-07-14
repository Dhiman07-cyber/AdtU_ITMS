"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// SPARK PLAN SAFETY: Manual refresh only for applications page
import { usePaginatedCollection, invalidateCollectionCache } from '@/hooks/usePaginatedCollection';
import {
  FileText, Shield, Eye, Check, X, Loader2, Search,
  SlidersHorizontal, User, Phone, Calendar, Clock, Bus as BusIcon,
  ChevronDown, RefreshCw, AlertTriangle, ArrowRightLeft, Bus
} from "lucide-react";
import { StatusBadge } from "@/components/application/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import ReassignmentPanel from '@/components/smart-allocation/ReassignmentPanel';
import type { StudentData as RPStudentData, BusData as RPBusData } from '@/components/smart-allocation/ReassignmentPanel';
import AlternativeBusPicker from '@/components/smart-allocation/AlternativeBusPicker';
import type { AlternativeBusData } from '@/components/smart-allocation/AlternativeBusPicker';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { supabase } from '@/lib/supabase-client';
import { useToast } from '@/contexts/toast-context';
import { isUpcomingApplication, getUpcomingStatus } from '@/lib/utils/application-eligibility';

import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

export default function ModeratorApplicationsPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const { canApplicationView, canApplicationApprove, canApplicationReject, loading: permsLoading } = useModeratorPermissions();

  // SPARK PLAN SAFETY: Manual refresh only - no auto-polling to conserve quota
  const { data: pendingApplications, loading, refresh: refreshApplications } = usePaginatedCollection('applications', {
    pageSize: 50, orderByField: 'createdAt', orderDirection: 'desc',
    autoRefresh: false, // MANUAL REFRESH ONLY
  });
  const [renewalRequests, setRenewalRequests] = useState<any[]>([]);
  const [loadingRenewals, setLoadingRenewals] = useState(false);

  const fetchRenewalRequests = async () => {
    try {
      setLoadingRenewals(true);
      // D8: Query PostgreSQL applications table instead of Firestore renewal_requests
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('state', 'submitted')
        .in('application_type', ['renewal', 'renewal_after_soft_block']);

      if (error) throw error;
      const requests = (data || []).map((row: any) => ({
        id: row.application_id,
        studentId: row.applicant_uid,
        enrollmentId: row.formData?.enrollmentId || row.form_data?.enrollmentId || '',
        studentName: row.formData?.studentName || row.form_data?.studentName || '',
        totalFee: row.formData?.totalFee || row.form_data?.totalFee || 0,
        durationYears: row.formData?.durationYears || row.form_data?.durationYears || 0,
        paymentMode: row.formData?.paymentMode || row.form_data?.paymentMode || '',
        paymentId: row.formData?.paymentId || row.form_data?.paymentId || '',
        receiptImageUrl: row.formData?.receiptImageUrl || row.form_data?.receiptImageUrl || '',
        studentEmail: row.formData?.studentEmail || row.form_data?.studentEmail || '',
        paidAt: row.formData?.paidAt || row.form_data?.paidAt || '',
        status: 'pending',
        createdAt: row.created_at,
      }));
      setRenewalRequests(requests);
    } catch (error) {
      console.error('Error fetching renewal requests:', error);
    } finally {
      setLoadingRenewals(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchRenewalRequests();
    }
  }, [currentUser]);
  const { data: routes, loading: routesLoading, refresh: refreshRoutes } = usePaginatedCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc',
    autoRefresh: false,
  });
  const { data: buses, loading: busesLoading, refresh: refreshBuses } = usePaginatedCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc',
    autoRefresh: false,
  });

  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<'applications' | 'upcoming' | 'renewals'>('applications');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [selectedApplication, setSelectedApplication] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  // ── Inline resolution modals ────────────────────────────────────────────────
  const [reassignmentTarget, setReassignmentTarget] = useState<{
    item: any;
    busId: string;
    busData: RPBusData;
    busStudents: RPStudentData[];
  } | null>(null);
  const [alternativePickerTarget, setAlternativePickerTarget] = useState<{
    item: any;
    currentBus: AlternativeBusData;
    alternatives: AlternativeBusData[];
  } | null>(null);
  const [loadingBusStudents, setLoadingBusStudents] = useState(false);
  const [stagedBusesTrigger, setStagedBusesTrigger] = useState(0);

  const stagedBuses = useMemo(() => {
    const map = new Map<string, { busId: string; busNumber: string; routeId: string; routeName: string }>();
    if (typeof window === 'undefined') return map;
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('staged_bus_')) {
        const appId = key.replace('staged_bus_', '');
        try {
          const data = JSON.parse(sessionStorage.getItem(key) || '{}');
          if (data.busId) {
            map.set(appId, data);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
    return map;
  }, [stagedBusesTrigger, pendingApplications]);

  /** Fetch active students on a given bus and open the ReassignmentPanel. */
  const openReassignmentForBus = async (item: any, capacityStatus: ReturnType<typeof getCapacityStatus>) => {
    const { busNumber: busLabel, shift: capShift } = capacityStatus;
    // Determine the actual bus id from the application data (the same logic
    // getCapacityStatus uses to find the bus).
    const appBusId = item.formData?.busId || item.formData?.routeId?.replace('route_', 'bus_') || '';
    const selectedBus = buses.find((b: any) => b.id === appBusId || b.busId === appBusId);
    if (!selectedBus) {
      showToast('Could not identify the overloaded bus', 'error');
      return;
    }
    setLoadingBusStudents(true);
    try {
      // Query active students currently assigned to this bus
      const q = query(
        collection(db, 'students'),
        where('busId', '==', appBusId),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      const busStudents: RPStudentData[] = snap.docs.map(d => {
        const s = d.data();
        return {
          id: d.id,
          fullName: s.fullName || s.name || d.id,
          enrollmentId: s.enrollmentId,
          stopId: s.stopId || '',
          stopName: s.stopName || s.stopId || '',
          assignedBusId: s.busId || appBusId,
          shift: s.shift,
          semester: s.semester,
          phone: s.phoneNumber || s.phone,
          photoURL: s.profilePhotoUrl || s.photoURL,
        };
      });

      // Convert buses to ReassignmentPanel's BusData format
      const rpBuses: RPBusData[] = buses.map((b: any) => {
        const matchedRoute = routes.find((r: any) => r.routeId === b.routeId || r.id === b.routeId);
        const rawStops: Array<{ id?: string; stopId?: string; name?: string; sequence?: number }> =
          matchedRoute?.stops || b.route?.stops || b.stops || [];
        const stops = rawStops.map((s: any) => ({
          id: s.id || s.stopId || s.name || '',
          name: s.name || s.stopId || s.id || '',
          sequence: s.sequence ?? 0,
        }));
        return {
          id: b.id || b.busId || '',
          busNumber: b.busNumber || b.id || '',
          routeId: b.routeId,
          routeName: b.routeName || matchedRoute?.routeName || (b.route?.routeName) || '',
          currentMembers: b.currentMembers || 0,
          capacity: b.capacity || b.totalCapacity || 55,
          shift: b.shift || 'both',
          stops,
          load: b.load || { morningCount: 0, eveningCount: 0 },
          route: matchedRoute || b.route || null,
        };
      });

      const currentBusRpb: RPBusData = rpBuses.find(b => b.id === appBusId) || {
        id: appBusId,
        busNumber: selectedBus.busNumber || `Bus-${appBusId}`,
        capacity: selectedBus.capacity || selectedBus.totalCapacity || 55,
        currentMembers: selectedBus.currentMembers || 0,
        shift: selectedBus.shift || 'both',
        stops: [],
        load: selectedBus.load || { morningCount: 0, eveningCount: 0 },
      };

      setReassignmentTarget({ item, busId: appBusId, busData: currentBusRpb, busStudents });
    } catch (err: any) {
      showToast(err?.message || 'Failed to load bus data', 'error');
    } finally {
      setLoadingBusStudents(false);
    }
  };

  /** Open the alternative-bus picker for a Case 2 application. */
  const openAlternativePicker = (item: any) => {
    const studentShift = (item.formData?.shift || 'Morning').toLowerCase();
    const appBusId = item.formData?.busId || item.formData?.routeId?.replace('route_', 'bus_') || '';
    const stopId = (item.formData?.stopId || '').toLowerCase().trim();
    const stopName = item.formData?.stopName || '';

    // Current (full) bus
    const currentBusDoc = buses.find((b: any) => b.id === appBusId || b.busId === appBusId);
    const currentBus: AlternativeBusData = currentBusDoc
      ? {
          id: currentBusDoc.id || currentBusDoc.busId || appBusId,
          busNumber: currentBusDoc.busNumber || `Bus-${appBusId}`,
          capacity: currentBusDoc.capacity || currentBusDoc.totalCapacity || 55,
          shift: currentBusDoc.shift || 'both',
          routeId: currentBusDoc.routeId,
          routeName: currentBusDoc.routeName || currentBusDoc.route?.routeName,
          load: currentBusDoc.load,
          currentMembers: currentBusDoc.currentMembers,
        }
      : { id: appBusId, busNumber: `Bus-${appBusId}`, capacity: 55, shift: 'both' };

    // Alternative buses (re-use the getCapacityStatus logic to find them)
    const matchingRouteIds: string[] = [];
    routes.forEach((route: any) => {
      const routeStops = route.stops || [];
      const hasStop = routeStops.some((stop: any) => {
        const rsId = (stop.stopId || stop.id || stop.name || '').toLowerCase().trim();
        const rsName = (stop.name || stop.stopName || '').toLowerCase().trim();
        const normStopId = stopId;
        const normStopName = stopName.toLowerCase().trim();
        return rsId === normStopId || rsName === normStopName ||
          rsName === normStopId || rsId === normStopName;
      });
      if (hasStop) matchingRouteIds.push(route.routeId || route.id);
    });

    const alternatives: AlternativeBusData[] = buses
      .filter((b: any) => {
        if ((b.id || b.busId) === appBusId) return false;
        if (!matchingRouteIds.includes(b.routeId)) return false;
        // Shift compatibility
        const bShift = (b.shift || 'Both').toLowerCase();
        if (studentShift === 'morning' && bShift !== 'morning' && bShift !== 'both') return false;
        if (studentShift === 'evening' && bShift !== 'both') return false;
        // Has capacity
        const busTotalCapacity = b.capacity || b.totalCapacity || 55;
        let busShiftLoad = 0;
        if (studentShift === 'morning') busShiftLoad = b.load?.morningCount ?? b.morningLoad ?? 0;
        else busShiftLoad = b.load?.eveningCount ?? b.eveningLoad ?? 0;
        return (busTotalCapacity - busShiftLoad) > 0;
      })
      .map((b: any) => ({
        id: b.id || b.busId || '',
        busNumber: b.busNumber || b.id || '',
        capacity: b.capacity || b.totalCapacity || 55,
        shift: b.shift || 'both',
        routeId: b.routeId,
        routeName: b.routeName || b.route?.routeName,
        load: b.load || { morningCount: 0, eveningCount: 0 },
        currentMembers: b.currentMembers,
      }));

    setAlternativePickerTarget({
      item,
      currentBus,
      alternatives,
    });
  };

  // Manual refresh handler - refreshes applications and renewals sections
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('applications');
      invalidateCollectionCache('buses');
      await Promise.all([
        refreshApplications(),
        fetchRenewalRequests(),
        refreshRoutes(),
        refreshBuses()
      ]);
    } catch (error) {
      console.error('Error refreshing applications:', error);
      setError("Failed to refresh data");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string[]>([]);

  // Update current time every second for countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Removed verification codes cleanup effect

  useEffect(() => {
    if (userData && userData.role !== "moderator") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);



  // Freshers/Renewals queue: submitted, current-session (non-upcoming) applications.
  // Upcoming (future-session) applications are split into their own tab so they
  // never mix with the immediately-actionable queue.
  const applicationApplications = pendingApplications.filter((app: any) =>
    app.state === 'submitted' && !isUpcomingApplication(app)
  );

  // Upcoming queue: submitted future-session applications. Their actionability is
  // derived from the frozen eligibleApproval date (no extra stored state).
  const upcomingApplications = pendingApplications.filter((app: any) =>
    app.state === 'submitted' && isUpcomingApplication(app)
  );

  const getBusDisplayFromRoute = (routeId: string) => {
    if (!routeId) return 'Not Assigned';
    if (routesLoading || busesLoading) return 'Loading...';

    const route = routes?.find(r => r.routeId === routeId || r.id === routeId);
    if (!route) {
      const routeNum = routeId.replace(/\D/g, '');
      return routeNum ? `Route ${routeNum}` : routeId;
    }

    const busId = route.busId || route.assignedBusId;
    if (!busId) return `Route ${route.routeName || routeId}`;

    const bus = buses?.find(b => b.busId === busId || b.id === busId);
    if (!bus) {
      const busNum = busId.replace(/\D/g, '') || '?';
      return `Bus ${busNum}`;
    }

    return `${bus.busNumber || 'Bus'} (${route.routeName || 'Route'})`;
  };

  /**
   * Real-time capacity status check for an application.
   * Checks if the selected bus is at capacity for the student's shift.
   * Returns: { needsCapacityReview, reassignmentReason, busNumber, shift }
   */
  const getCapacityStatus = (item: any): {
    needsCapacityReview: boolean;
    reassignmentReason: 'bus_full_only_option' | 'bus_full_alternatives_exist' | 'no_issue';
    busNumber: string;
    shift: string;
  } => {
    // Upcoming applications do not check capacity or occupy seats until activation
    if (isUpcomingApplication(item)) {
      return {
        needsCapacityReview: false,
        reassignmentReason: 'no_issue',
        busNumber: item.formData?.busAssigned || 'Unknown',
        shift: item.formData?.shift || 'Morning'
      };
    }

    // If stored data already has capacity review info, use it
    if (item.needsCapacityReview && item.reassignmentReason) {
      return {
        needsCapacityReview: item.needsCapacityReview,
        reassignmentReason: item.reassignmentReason,
        busNumber: item.formData?.busAssigned || 'Unknown',
        shift: item.formData?.shift || 'Morning'
      };
    }

    // Real-time check from loaded buses data
    const busId = item.formData?.busId;
    const routeId = item.formData?.routeId;
    const stopId = item.formData?.stopId;
    const studentShift = (item.formData?.shift || 'Morning').toLowerCase();

    if (!busId || buses.length === 0) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue', busNumber: 'Unknown', shift: studentShift };
    }

    // Find the selected bus
    const selectedBus = buses.find((b: any) => b.id === busId || b.busId === busId);
    if (!selectedBus) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue', busNumber: 'Unknown', shift: studentShift };
    }

    const busNumber = selectedBus.busNumber || `Bus-${busId}`;
    const totalCapacity = selectedBus.totalCapacity || selectedBus.capacity || 50;

    // Get shift-specific load from bus document
    // The bus doc has: load.morningCount, load.eveningCount OR morningLoad, eveningLoad
    let shiftLoad = 0;
    if (studentShift === 'morning') {
      shiftLoad = selectedBus.load?.morningCount ?? selectedBus.morningLoad ?? 0;
    } else if (studentShift === 'evening') {
      shiftLoad = selectedBus.load?.eveningCount ?? selectedBus.eveningLoad ?? 0;
    } else {
      // For "both" shift, check both
      const morningLoad = selectedBus.load?.morningCount ?? selectedBus.morningLoad ?? 0;
      const eveningLoad = selectedBus.load?.eveningCount ?? selectedBus.eveningLoad ?? 0;
      shiftLoad = Math.max(morningLoad, eveningLoad);
    }

    const availableSeats = totalCapacity - shiftLoad;
    const isFull = availableSeats <= 0;

    if (!isFull) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue', busNumber, shift: studentShift };
    }

    // Bus is full - check if alternatives exist for this stop
    // Find all buses that serve this stop (via routes) and have capacity
    const stopName = item.formData?.stopName || '';
    const normalizedStopId = (stopId || '').toLowerCase().trim();
    const normalizedStopName = stopName.toLowerCase().trim();

    // Find routes that have this stop
    const matchingRouteIds: string[] = [];
    routes.forEach((route: any) => {
      const routeStops = route.stops || [];
      const hasStop = routeStops.some((stop: any) => {
        const routeStopId = (stop.stopId || stop.id || stop.name || '').toLowerCase().trim();
        const routeStopName = (stop.name || stop.stopName || '').toLowerCase().trim();
        return routeStopId === normalizedStopId || routeStopName === normalizedStopName ||
          routeStopName === normalizedStopId || routeStopId === normalizedStopName;
      });
      if (hasStop) {
        matchingRouteIds.push(route.routeId || route.id);
      }
    });

    // Find alternative buses (on matching routes, with capacity, compatible with shift)
    const alternativeBuses = buses.filter((bus: any) => {
      if ((bus.id || bus.busId) === busId) return false; // Exclude current bus
      if (!matchingRouteIds.includes(bus.routeId)) return false; // Must serve the stop

      // Check shift compatibility
      const busShift = (bus.shift || 'Both').toLowerCase();
      if (studentShift === 'morning' && busShift !== 'morning' && busShift !== 'both') return false;
      if (studentShift === 'evening' && busShift !== 'both') return false;

      // Check if bus has capacity for the shift
      const busTotalCapacity = bus.totalCapacity || bus.capacity || 50;
      let busShiftLoad = 0;
      if (studentShift === 'morning') {
        busShiftLoad = bus.load?.morningCount ?? bus.morningLoad ?? 0;
      } else if (studentShift === 'evening') {
        busShiftLoad = bus.load?.eveningCount ?? bus.eveningLoad ?? 0;
      }

      return (busTotalCapacity - busShiftLoad) > 0;
    });

    if (alternativeBuses.length > 0) {
      // Case 2: Bus is full but alternatives exist
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_alternatives_exist', busNumber, shift: studentShift };
    } else {
      // Case 1: Bus is full and no alternatives
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_only_option', busNumber, shift: studentShift };
    }
  };

  const filteredData = useMemo(() => {
    const isApplicationSection = activeSection === 'applications' || activeSection === 'upcoming';
    let data = activeSection === 'applications'
      ? applicationApplications
      : activeSection === 'upcoming'
        ? upcomingApplications
        : renewalRequests;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      data = data.filter((item: any) => {
        if (isApplicationSection) {
          return (
            item.formData?.fullName?.toLowerCase().includes(query) ||
            item.formData?.enrollmentId?.toLowerCase().includes(query) ||
            item.formData?.phoneNumber?.includes(query)
          );
        } else {
          const name = item.studentName || '';
          const enrollment = item.enrollmentId || '';
          const bus = item.busNumber || '';
          return (
            name.toLowerCase().includes(query) ||
            enrollment.toLowerCase().includes(query) ||
            bus.toLowerCase().includes(query)
          );
        }
      });
    }

    if (shiftFilter.length > 0 && isApplicationSection) {
      data = data.filter((item: any) => {
        const itemShift = (item.formData?.shift || 'both').toLowerCase();
        return shiftFilter.some(f => {
          if (f === 'morning') return itemShift === 'morning' || itemShift === 'both';
          if (f === 'evening') return itemShift === 'evening' || itemShift === 'both';
          if (f === 'both') return itemShift === 'both';
          return false;
        });
      });
    }

    if (isApplicationSection && processedIds.size > 0) {
      data = data.filter((item: any) => !processedIds.has(item.applicationId || item.uid));
    }

    return data;
  }, [activeSection, applicationApplications, upcomingApplications, renewalRequests, searchQuery, shiftFilter, processedIds]);

  const handleApprove = async (applicationId: string, overrideBusId?: string) => {
    if (!currentUser) return;
    setApproving(applicationId);
    try {
      const token = await currentUser.getIdToken();
      const body: Record<string, unknown> = { studentUid: applicationId };
      if (overrideBusId) body.overrideBusId = overrideBusId;
      const response = await fetch('/api/applications/approve-unauth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || "Failed to approve application");
        return false;
      } else {
        setError("");
        // Clear staged bus selection if any
        sessionStorage.removeItem(`staged_bus_${applicationId}`);
        setStagedBusesTrigger(prev => prev + 1);

        // Format bus/route for toast
        const appItem = pendingApplications.find((app: any) => app.applicationId === applicationId);
        const activeBusId = overrideBusId || appItem?.formData?.busId || appItem?.formData?.routeId?.replace('route_', 'bus_') || '';
        const selectedBus = buses.find((b: any) => (b.id || b.busId) === activeBusId);
        let busLabel = '';
        let routeLabel = '';
        if (selectedBus) {
          const busIdNum = activeBusId.replace(/[^0-9]/g, '');
          busLabel = `Bus-${busIdNum || activeBusId} (${selectedBus.busNumber})`;
          const routeIdVal = selectedBus.routeId || '';
          const routeNum = routeIdVal.replace(/[^0-9]/g, '');
          routeLabel = `Route-${routeNum || routeIdVal}`;
        }

        const msg = busLabel 
          ? `Application approved successfully with ${busLabel}${routeLabel ? ` on ${routeLabel}` : ''}!` 
          : 'Application approved successfully!';
        showToast(msg, 'success');

        // Optimistically hide the card
        setProcessedIds(prev => {
          const newSet = new Set(prev);
          newSet.add(applicationId);
          return newSet;
        });
        await handleRefresh();
        return true;
      }
    } catch (error) {
      setError("Failed to approve application");
      return false;
    } finally {
      setApproving(null);
    }
  };

  // ── Case 2: alternative-bus selection → stage choice ───────────
  const handleAlternativeSelected = async (busId: string) => {
    if (!alternativePickerTarget) return;
    const { item } = alternativePickerTarget;
    
    // Find selected bus details
    const selectedBus = buses.find((b: any) => (b.id || b.busId) === busId);
    const busNum = selectedBus?.busNumber || busId;
    const routeId = selectedBus?.routeId || '';
    const routeName = selectedBus?.routeName || '';

    // Stage in sessionStorage
    const stageData = {
      busId,
      busNumber: busNum,
      routeId,
      routeName,
      stagedAt: Date.now()
    };
    sessionStorage.setItem(`staged_bus_${item.applicationId}`, JSON.stringify(stageData));

    const busIdNum = busId.replace(/[^0-9]/g, '');
    const formattedBusLabel = `Bus-${busIdNum || busId} (${busNum})`;

    showToast(`${formattedBusLabel} selected and staged for approval.`, 'success');
    setAlternativePickerTarget(null);
    setStagedBusesTrigger(prev => prev + 1);
  };

  // ── Case 1: reassignment completed → approve the now-unblocked application
  const handleReassignmentResolved = async () => {
    if (!reassignmentTarget) return;
    const { item } = reassignmentTarget;
    setReassignmentTarget(null);
    // The bus now has a freed seat — approve normally.
    const ok = await handleApprove(item.applicationId);
    if (ok) {
      showToast('Capacity freed and application approved', 'success');
    }
  };

  const handleRejectClick = (applicationId: string) => {
    setSelectedApplication(applicationId);
    setRejectionReason("");
    setShowRejectDialog(true);
  };

  const handleApproveRenewal = async (requestId: string) => {
    if (!currentUser) return;
    setApproving(requestId);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/renewal-requests/approve-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ requestId })
      });

      if (response.ok) {
        showToast('Renewal request approved successfully', 'success');
        setRenewalRequests(prev => prev.filter(r => r.id !== requestId));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to approve renewal request');
      }
    } catch (error) {
      console.error('Error approving renewal:', error);
      setError('Failed to approve renewal request');
    } finally {
      setApproving(null);
    }
  };

  const confirmReject = async () => {
    if (!currentUser || !selectedApplication || !rejectionReason.trim()) return;

    setRejecting(selectedApplication);
    try {
      const token = await currentUser.getIdToken();
      if (activeSection === 'renewals') {
        const response = await fetch('/api/renewal-requests/reject', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            requestId: selectedApplication,
            reason: rejectionReason.trim(),
            rejectorName: userData?.displayName || userData?.fullName || 'Moderator',
            rejectorId: currentUser.uid
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || "Failed to reject renewal request");
        } else {
          setError("");
          setShowRejectDialog(false);
          setRejectionReason("");
          setRenewalRequests(prev => prev.filter(r => r.id !== selectedApplication));
          setSelectedApplication(null);
        }
      } else {
        const response = await fetch('/api/applications/reject-unauth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ studentUid: selectedApplication, reason: rejectionReason })
        });

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || "Failed to reject application");
        } else {
          setError("");
          // Clear staged bus selection if any
          sessionStorage.removeItem(`staged_bus_${selectedApplication}`);
          setStagedBusesTrigger(prev => prev + 1);
          
          setShowRejectDialog(false);
          setRejectionReason("");
          setProcessedIds(prev => {
            const newSet = new Set(prev);
            newSet.add(selectedApplication);
            return newSet;
          });
          await handleRefresh();
          setSelectedApplication(null);
        }
      }
    } catch (error) {
      setError("Failed to reject");
    } finally {
      setRejecting(null);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="bg-[#12131A] border-white/10">
          <CardContent className="py-8 text-center max-w-md">
            <Shield className="h-12 w-12 mx-auto mb-4 text-zinc-500" />
            <h2 className="text-xl font-semibold mb-2 text-white">Authentication Required</h2>
            <p className="text-zinc-400">
              You need to be signed in as a moderator to view applications.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!permsLoading && !canApplicationView) {
    return <PermissionDeniedCard title="Applications Section Restricted" actionName="Viewing Applications" showGoBack={false} />;
  }

  return (
    <div className="mt-12 space-y-6">
      {/* Page Header - Responsive Custom Implementation */}
      <div className="space-y-2 mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white leading-none">Student Applications</h1>
            <div className="hidden md:block">
              <Badge className="text-[10px] font-bold px-2 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-tight rounded-md">
                {activeSection === 'applications' ? 'Applications' : activeSection === 'upcoming' ? 'Upcoming' : 'Renewals'}: {filteredData.length}
              </Badge>
            </div>
          </div>
          <Button
            size="sm"
            className="group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn(`mr-2 h-3.5 w-3.5 transition-transform duration-500`, isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            Refresh
          </Button>
        </div>
        <p className="text-zinc-400 text-sm max-w-2xl">
          Review and manage all student bus application requests
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 p-1 bg-[#12131A]/40 border border-white/[0.05] rounded-lg flex-1 sm:flex-initial">
          <Button
            variant={activeSection === 'applications' ? 'default' : 'ghost'}
            onClick={() => setActiveSection('applications')}
            className={cn(
              "flex-1 gap-2 h-9",
              activeSection === 'applications' ? "bg-indigo-600 hover:bg-indigo-700" : "text-zinc-400"
            )}
            size="sm"
          >
            <FileText className="h-4 w-4" />
            Freshers
          </Button>
          <Button
            variant={activeSection === 'upcoming' ? 'default' : 'ghost'}
            onClick={() => setActiveSection('upcoming')}
            className={cn(
              "flex-1 gap-2 h-9 relative",
              activeSection === 'upcoming' ? "bg-indigo-600 hover:bg-indigo-700" : "text-zinc-400"
            )}
            size="sm"
          >
            <Calendar className="h-4 w-4" />
            Upcoming
            {upcomingApplications.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full bg-purple-500/30 text-purple-200 border border-purple-400/30">
                {upcomingApplications.length}
              </span>
            )}
          </Button>
          <Button
            variant={activeSection === 'renewals' ? 'default' : 'ghost'}
            onClick={() => setActiveSection('renewals')}
            className={cn(
              "flex-1 gap-2 h-9",
              activeSection === 'renewals' ? "bg-indigo-600 hover:bg-indigo-700" : "text-zinc-400"
            )}
            size="sm"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Renewals
            {renewalRequests.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full bg-purple-500/30 text-purple-200 border border-purple-400/30">
                {renewalRequests.length}
              </span>
            )}
          </Button>
        </div>

        {(activeSection === 'applications' || activeSection === 'upcoming' || activeSection === 'renewals') && (
          <div className="flex flex-col sm:flex-row gap-2 flex-1 w-full font-sans">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                placeholder="Search students..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 w-full bg-[#12131A] border-white/[0.05] focus:border-indigo-500/50 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="hidden md:flex h-10 gap-2 border-white/[0.05] bg-[#12131A] text-sm">
                    <SlidersHorizontal className="h-4 w-4" />
                    Shift
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-[#12131A] border-white/10 text-zinc-300">
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('morning')}
                    onCheckedChange={(c) => setShiftFilter(c ? [...shiftFilter, 'morning'] : shiftFilter.filter(s => s !== 'morning'))}
                  >Morning</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('evening')}
                    onCheckedChange={(c) => setShiftFilter(c ? [...shiftFilter, 'evening'] : shiftFilter.filter(s => s !== 'evening'))}
                  >Evening</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('both')}
                    onCheckedChange={(c) => setShiftFilter(c ? [...shiftFilter, 'both'] : shiftFilter.filter(s => s !== 'both'))}
                  >Both</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {(searchQuery || shiftFilter.length > 0) && (
                <Button variant="ghost" onClick={() => { setSearchQuery(""); setShiftFilter([]); }} className="h-10 text-red-400 hover:bg-red-400/10 hover:text-red-400">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading || loadingRenewals || routesLoading || busesLoading ? (
        <div className="flex-1 min-h-[calc(100dvh-120px)] flex justify-center items-center">
          <PremiumPageLoader message="Fetching data..." />
        </div>
      ) : filteredData.length === 0 ? (
        <Card className="bg-[#12131A]/40 border-white/[0.05]">
          <CardContent className="py-20 text-center">
            <div className="flex flex-col items-center gap-4">
              <FileText className="h-12 w-12 text-zinc-600" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">No items found</h3>
                <p className="text-zinc-500">There are no pending requests matching your criteria.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredData.map((item: any) => {
            const isApplication = activeSection === 'applications' || activeSection === 'upcoming';
            const isUpcoming = activeSection === 'upcoming';
            // Derived upcoming lifecycle status (no stored state): the frozen
            // eligibleApproval date alone decides waiting vs eligible.
            const upcomingStatus = isUpcoming
              ? getUpcomingStatus(item, currentTime)
              : null;
            const isEligibleNow = upcomingStatus === 'eligible_for_approval';
            const key = isApplication ? item.applicationId : item.codeId;

            return (
              <Card key={key} className="group hover:border-indigo-500/20 transition-all duration-300 border-white/[0.05] bg-[#12131A]/40 hover:bg-indigo-500/[0.03] overflow-hidden relative">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300" />

                {isApplication ? (() => {
                  // Get capacity status for this application (computed once on render)
                  const capacityStatus = getCapacityStatus(item);
                  const { needsCapacityReview, reassignmentReason, busNumber, shift } = capacityStatus;
                  const isExpanded = expandedCards.has(item.applicationId);
                  const toggleExpanded = () => {
                    setExpandedCards(prev => {
                      const next = new Set(prev);
                      if (next.has(item.applicationId)) {
                        next.delete(item.applicationId);
                      } else {
                        next.add(item.applicationId);
                      }
                      return next;
                    });
                  };

                  return (
                    <CardContent className="p-5">
                      <div className="flex flex-col gap-2">

                        {/* Header Section: Profile & Status */}
                        <div className="flex justify-between items-start">
                          <div className="flex items-start gap-4">
                            <Avatar className="h-12 w-12 ring-2 ring-white/5 bg-zinc-900 shadow-xl">
                              <AvatarImage src={item.formData?.profilePhotoUrl} />
                              <AvatarFallback className="bg-indigo-500/10 text-indigo-400 font-bold">
                                {item.formData?.fullName?.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-bold text-base text-white leading-none">{item.formData?.fullName}</h3>
                                <StatusBadge status={item.state || 'submitted'} />
                              </div>
                              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mt-1">
                                <span className="flex items-center gap-1.5 bg-zinc-900/50 px-2.5 py-1.5 md:py-0.5 rounded border border-white/5 font-mono text-[11px] md:text-xs text-zinc-300 w-full md:w-fit break-all">
                                  <User className="h-3 w-3 text-zinc-500 shrink-0" />
                                  {item.formData?.enrollmentId}
                                </span>
                                <span className="flex items-center gap-1.5 font-mono text-[11px] md:text-xs text-zinc-400 w-full md:w-auto px-1">
                                  <Phone className="h-3 w-3 text-zinc-500 shrink-0" />
                                  {item.formData?.phoneNumber}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Top Right: Payment Info (Desktop) */}
                          <div className="hidden md:flex flex-col items-end gap-2">
                            <Badge variant="outline" className={cn(
                              "gap-1.5 text-[10px] px-2.5 py-1 h-fit font-medium tracking-wide shadow-sm",
                              item.formData?.paymentInfo?.paymentMode === 'online' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            )}>
                              <div className={cn("w-1.5 h-1.5 rounded-full", item.formData?.paymentInfo?.paymentMode === 'online' ? "bg-emerald-400" : "bg-amber-400")} />
                              {item.formData?.paymentInfo?.paymentMode === 'online' ? 'ONLINE' : 'MANUAL'}
                            </Badge>
                            {item.formData?.paymentInfo?.amountPaid && (
                              <span className="text-xs font-mono font-bold text-zinc-500 bg-zinc-900/80 px-2 py-1 rounded border border-white/5">
                                ₹{Number(item.formData.paymentInfo.amountPaid).toLocaleString('en-IN')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Upcoming (future-session) lifecycle banner — indicates verification status */}
                        {isUpcoming && (
                          <div className="mt-3 rounded-lg p-3 border bg-indigo-500/5 border-indigo-500/20 flex items-start gap-2.5">
                            <Clock className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold text-xs text-indigo-300">
                                  Upcoming Session Application
                                </h4>
                                {item.targetSession && (
                                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-white/10 text-zinc-400">
                                    Session {item.targetSession.startYear}-{item.targetSession.endYear}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                                This application is for the upcoming session and will transition to verified status upon review. It does not occupy a seat or affect capacity until session activation.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Middle Section: Bus Info & Tags */}
                        <div className="space-y-3 mb-3">
                          {/* Desktop Layout */}
                          <div className="hidden md:flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300 group-hover:bg-zinc-800/60 transition-colors">
                              <BusIcon className="h-3 w-3 text-indigo-400" />
                              <span className="font-medium text-white/90">{item.formData?.busAssigned || getBusDisplayFromRoute(item.formData?.routeId)}</span>
                            </Badge>

                            {stagedBuses.has(item.applicationId) && (
                              <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-purple-500/10 text-purple-400 border-purple-500/30 font-medium">
                                <Check className="h-3 w-3 text-purple-400 shrink-0" />
                                Staged Bus: {stagedBuses.get(item.applicationId)?.busNumber}
                              </Badge>
                            )}

                            <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300 capitalize">
                              <Clock className="h-3 -3 text-indigo-400" />
                              {item.formData?.shift || 'Morning'}
                            </Badge>

                            {item.formData?.sessionInfo?.durationYears && (
                              <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300">
                                <Calendar className="h-3 w-3 text-indigo-400" />
                                {item.formData.sessionInfo.durationYears} Year Plan
                              </Badge>
                            )}

                            {needsCapacityReview && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "gap-1.5 text-[10px] py-1 px-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95 select-none",
                                  reassignmentReason === 'bus_full_only_option'
                                    ? "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 shadow-[0_0_10px_-3px_rgba(239,68,68,0.3)] animate-pulse"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 shadow-[0_0_10px_-3px_rgba(245,158,11,0.3)]"
                                )}
                                onClick={toggleExpanded}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {reassignmentReason === 'bus_full_only_option' ? "Critical Limit" : "Over Capacity"}
                                <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform duration-300", isExpanded && "rotate-180")} />
                              </Badge>
                            )}
                          </div>
                          <div className="flex md:hidden flex-col gap-2.5 mt-4">
                            {/* Row 1: Amount - Squared Badge */}
                            {item.formData?.paymentInfo?.amountPaid && (
                              <div className="w-full bg-zinc-900/80 border border-zinc-800 rounded-none py-2 px-3 flex justify-center items-center shadow-sm">
                                <span className="text-[13px] font-mono font-bold text-zinc-200 tracking-wide uppercase">
                                  PAYMENT AMOUNT : ₹{Number(item.formData.paymentInfo.amountPaid).toLocaleString('en-IN')}
                                </span>
                              </div>
                            )}

                            {/* Row 2: Bus & Shift - Rounded Badges */}
                            <div className="grid grid-cols-2 gap-2">
                              <Badge variant="outline" className="justify-center h-9 text-[11px] border-white/10 bg-zinc-800/50 text-zinc-200 rounded-full font-medium">
                                <BusIcon className="h-3.5 w-3.5 mr-1.5 text-indigo-400 shrink-0" />
                                <span className="truncate">{item.formData?.busAssigned || getBusDisplayFromRoute(item.formData?.routeId)}</span>
                              </Badge>
                              <Badge variant="outline" className="justify-center h-9 text-[11px] border-white/10 bg-zinc-800/50 text-zinc-200 rounded-full font-medium capitalize">
                                <Clock className="h-3.5 w-3.5 mr-1.5 text-indigo-400 shrink-0" />
                                {item.formData?.shift || 'Morning'}
                              </Badge>
                            </div>

                            {/* Row 3: Duration & Payment Mode - Mode Highlighted */}
                            <div className="grid grid-cols-2 gap-2">
                              <Badge variant="outline" className="justify-center h-9 text-[11px] border-white/10 bg-zinc-800/50 text-zinc-200 rounded-full font-medium">
                                <Calendar className="h-3.5 w-3.5 mr-1.5 text-indigo-400 shrink-0" />
                                {item.formData?.sessionInfo?.durationYears ? `${item.formData.sessionInfo.durationYears} Year Plan` : 'N/A'}
                              </Badge>

                              <Badge variant="outline" className={cn(
                                "justify-center h-9 text-[11px] border-none font-bold rounded-full",
                                item.formData?.paymentInfo?.paymentMode === 'online'
                                  ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                                  : "bg-amber-500/20 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                              )}>
                                {item.formData?.paymentInfo?.paymentMode === 'online' ? 'ONLINE' : 'MANUAL'}
                              </Badge>
                            </div>

                            {/* Mobile Capacity Warning */}
                            {needsCapacityReview && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "w-full justify-center py-2 mt-1 text-[11px] cursor-pointer select-none rounded-lg",
                                  reassignmentReason === 'bus_full_only_option'
                                    ? "bg-red-500/10 text-red-400 border-red-500/30 animate-pulse"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                )}
                                onClick={toggleExpanded}
                              >
                                <AlertTriangle className="h-4 w-4 mr-2" />
                                {reassignmentReason === 'bus_full_only_option' ? "Critical Limit - Tap to Review" : "Over Capacity - Tap to Review"}
                              </Badge>
                            )}
                          </div>

                          {/* Capacity Warning Expansion */}
                          {needsCapacityReview && isExpanded && (
                            <div className={cn(
                              "mt-3 rounded-lg p-3 border animate-in slide-in-from-top-2 fade-in duration-200",
                              reassignmentReason === 'bus_full_only_option'
                                ? "bg-red-500/5 border-red-500/20"
                                : "bg-amber-500/5 border-amber-500/20"
                            )}>
                              <div className="flex items-start gap-2">
                                <AlertTriangle className={cn(
                                  "h-4 w-4 shrink-0 mt-0.5",
                                  reassignmentReason === 'bus_full_only_option' ? "text-red-400" : "text-amber-400"
                                )} />
                                <div className="flex-1 space-y-2">
                                  <h4 className={cn(
                                    "font-semibold text-xs",
                                    reassignmentReason === 'bus_full_only_option' ? "text-red-400" : "text-amber-400"
                                  )}>
                                    {reassignmentReason === 'bus_full_only_option'
                                      ? "Action Required: No Alternative Buses"
                                      : "Warning: Bus Overloaded"}
                                  </h4>
                                  <div className="space-y-2">
                                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                                      {reassignmentReason === 'bus_full_only_option'
                                        ? `Bus ${busNumber} (${shift}) is at full capacity. This is the only bus serving the student's stop. You must reassign other students or add bus capacity before approving.`
                                        : `Bus ${busNumber} (${shift}) exceeds capacity. Alternative buses are available for this route/stop. Please check reassignment options.`}
                                    </p>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    {reassignmentReason === 'bus_full_only_option' ? (
                                      <Button
                                        size="sm"
                                        className="h-7 text-[10px] gap-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:from-purple-500 hover:to-pink-400 border-0 shadow-md shadow-purple-500/20 transition-all"
                                        onClick={() => openReassignmentForBus(item, capacityStatus)}
                                        disabled={loadingBusStudents}
                                      >
                                        {loadingBusStudents ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
                                        Free Capacity
                                      </Button>
                                    ) : (
                                      <>
                                        <Button
                                          size="sm"
                                          className="h-7 text-[10px] gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-500 text-white hover:from-indigo-500 hover:to-blue-400 border-0 shadow-md shadow-indigo-500/20 transition-all"
                                          onClick={() => openAlternativePicker(item)}
                                        >
                                          <BusIcon className="h-3 w-3" />
                                          {stagedBuses.has(item.applicationId) ? "Change Alternative Bus" : "Select Alternative Bus"}
                                        </Button>
                                        {stagedBuses.has(item.applicationId) && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-[10px] border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              sessionStorage.removeItem(`staged_bus_${item.applicationId}`);
                                              setStagedBusesTrigger(prev => prev + 1);
                                              showToast('Staged bus selection cleared.', 'info');
                                            }}
                                          >
                                            Clear Staged Bus
                                          </Button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Footer: Actions - Equal Length Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                          <Button
                            variant="outline"
                            className="w-full bg-white hover:bg-gray-100 text-black border-transparent shadow-sm font-medium h-10 gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
                            onClick={() => router.push(`/moderator/applications/${item.applicationId}`)}
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </Button>

                          <Button
                            className={cn(
                              "w-full h-10 gap-2 font-medium transition-all",
                              !canApplicationApprove
                                ? "bg-emerald-600/30 text-white/50 opacity-60 cursor-pointer border border-emerald-500/10 hover:bg-emerald-600/30"
                                : (needsCapacityReview && !stagedBuses.has(item.applicationId))
                                  ? "bg-emerald-600/50 text-white/50 cursor-not-allowed shadow-lg shadow-emerald-900/20"
                                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 hover:shadow-emerald-900/40 hover:scale-[1.02] active:scale-[0.98]"
                            )}
                            onClick={() => {
                              if (!canApplicationApprove) {
                                showToast("You are not authorized to approve students.", "error");
                                return;
                              }
                              const staged = stagedBuses.get(item.applicationId);
                              handleApprove(item.applicationId, staged?.busId);
                            }}
                            disabled={canApplicationApprove && ((needsCapacityReview && !stagedBuses.has(item.applicationId)) || approving === item.applicationId)}
                          >
                            {approving === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {isUpcoming ? "Verify" : "Approve"}
                          </Button>

                          <Button
                            variant="outline"
                            className={cn(
                              "w-full h-10 gap-2 transition-all",
                              !canApplicationReject
                                ? "border-red-500/10 text-red-500/50 bg-red-500/5 opacity-60 cursor-pointer hover:bg-red-500/5 hover:text-red-500/50"
                                : "border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 hover:scale-[1.02] active:scale-[0.98]"
                            )}
                            onClick={() => {
                              if (!canApplicationReject) {
                                showToast("You are not authorized to reject students.", "error");
                                return;
                              }
                              handleRejectClick(item.applicationId);
                            }}
                            disabled={canApplicationReject && (rejecting === item.applicationId)}
                          >
                            {rejecting === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                            Reject
                          </Button>
                        </div>

                      </div>
                    </CardContent>
                  );
                })() : (
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-2">
                      {/* Profile & Status */}
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-12 w-12 ring-2 ring-white/5 bg-zinc-900 shadow-xl">
                            <AvatarFallback className="bg-indigo-500/10 text-indigo-400 font-bold">
                              {item.studentName?.substring(0, 2).toUpperCase() || 'RN'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-bold text-base text-white leading-none">{item.studentName || 'Renewal Student'}</h3>
                              <Badge className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold rounded uppercase px-2 py-0.5">
                                Renewal
                              </Badge>
                            </div>
                            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mt-1">
                              <span className="flex items-center gap-1.5 bg-zinc-900/50 px-2.5 py-0.5 rounded border border-white/5 font-mono text-[11px] md:text-xs text-zinc-300 w-fit">
                                <User className="h-3 w-3 text-zinc-500 shrink-0" />
                                {item.enrollmentId}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant="outline" className={cn(
                            "gap-1.5 text-[10px] px-2.5 py-1 h-fit font-medium tracking-wide shadow-sm",
                            item.paymentMode === 'online' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          )}>
                            <div className={cn("w-1.5 h-1.5 rounded-full", item.paymentMode === 'online' ? "bg-emerald-400" : "bg-amber-400")} />
                            {item.paymentMode === 'online' ? 'ONLINE' : 'MANUAL'}
                          </Badge>
                          {item.amountPaid && (
                            <span className="text-xs font-mono font-bold text-zinc-500 bg-zinc-900/80 px-2 py-1 rounded border border-white/5">
                              ₹{Number(item.amountPaid).toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bus & Route info */}
                      <div className="flex flex-wrap items-center gap-2 mt-3 mb-4">
                        <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300">
                          <BusIcon className="h-3 w-3 text-indigo-400" />
                          <span className="font-medium text-white/90">{item.busNumber || item.busId || 'Bus'}</span>
                        </Badge>
                        <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300 capitalize">
                          <Clock className="h-3 w-3 text-indigo-400" />
                          {item.shift || 'Flexible'}
                        </Badge>
                        {item.durationYears && (
                          <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300">
                            <Calendar className="h-3 w-3 text-indigo-400" />
                            {item.durationYears} Year Plan
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.05]">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSelectedApplication(item.id);
                            setRejectionReason("");
                            setShowRejectDialog(true);
                          }}
                          disabled={rejecting === item.id || approving === item.id}
                          className="border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 text-[11px] font-bold uppercase tracking-wider h-9 px-4 transition-all"
                        >
                          Reject
                        </Button>
                        <Button
                          onClick={() => handleApproveRenewal(item.id)}
                          disabled={rejecting === item.id || approving === item.id}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-wider h-9 px-4 transition-all shadow-md shadow-emerald-950/20"
                        >
                          {approving === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Approve'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Rejection Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="sm:max-w-[425px] bg-[#12131A] text-white border-white/10">
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Please provide a reason for rejecting this student application.
              The student will be notified via email.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reason" className="text-zinc-300">Rejection Reason</Label>
              <Textarea
                id="reason"
                className="bg-zinc-900/50 border-white/10 focus:border-red-500/50 min-h-[100px] text-zinc-200 resize-none"
                placeholder="e.g., Incorrect profile photo, Payment proof unclear, Invalid enrollment ID..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)} className="border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={!rejectionReason.trim() || rejecting !== null}
              className="bg-red-650 hover:bg-red-600"
            >
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Case 1 — Free Capacity: reuse the existing ReassignmentPanel, pre-targeted
          at the overloaded bus (its active students are the move candidates). */}
      {reassignmentTarget && (
        <ReassignmentPanel
          selectedStudents={reassignmentTarget.busStudents}
          allBuses={(buses as any[]).map((b: any) => {
            const matchedRoute = routes.find((r: any) => r.routeId === b.routeId || r.id === b.routeId);
            const rawStops: any[] = matchedRoute?.stops || b.route?.stops || b.stops || [];
            return {
              id: b.id || b.busId || '',
              busNumber: b.busNumber || b.id || '',
              routeId: b.routeId,
              routeName: b.routeName || matchedRoute?.routeName || b.route?.routeName || '',
              currentMembers: b.currentMembers || 0,
              capacity: b.capacity || b.totalCapacity || 55,
              shift: b.shift || 'both',
              stops: rawStops.map((s: any) => ({
                id: s.id || s.stopId || s.name || '',
                name: s.name || s.stopId || s.id || '',
                sequence: s.sequence ?? 0,
              })),
              load: b.load || { morningCount: 0, eveningCount: 0 },
              route: matchedRoute || b.route || null,
            };
          })}
          currentBus={reassignmentTarget.busData}
          onClose={() => setReassignmentTarget(null)}
          onSuccess={() => { void handleReassignmentResolved(); }}
        />
      )}

      {/* Case 2 — Select Alternative Bus: lightweight picker (no reassignment),
          same visual language as ReassignmentPanel. */}
      {alternativePickerTarget && (
        <AlternativeBusPicker
          applicantName={alternativePickerTarget.item.formData?.fullName || 'Applicant'}
          applicantStopName={alternativePickerTarget.item.formData?.stopName || alternativePickerTarget.item.formData?.stopId || ''}
          applicantShift={alternativePickerTarget.item.formData?.shift || 'Morning'}
          currentBus={alternativePickerTarget.currentBus}
          alternatives={alternativePickerTarget.alternatives}
          onSelect={handleAlternativeSelected}
          onClose={() => setAlternativePickerTarget(null)}
        />
      )}
    </div>
  );
}
