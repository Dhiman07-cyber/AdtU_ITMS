"use client";

import { Avatar,AvatarFallback,AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useEffect,useMemo,useState } from "react";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { StatusBadge } from "@/components/application/status-badge";
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import type { AlternativeBusData } from '@/components/smart-allocation/AlternativeBusPicker';
import AlternativeBusPicker from '@/components/smart-allocation/AlternativeBusPicker';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/contexts/toast-context';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { cn } from "@/lib/utils";
import { isUpcomingApplication } from "@/lib/utils/application-eligibility";
import {
	AlertTriangle,
	ArrowRightLeft,
	Bus as BusIcon,
	Calendar,
	Check,
	ChevronDown,
	Clock,
	Eye,
	FileText,
	Loader2,
	Phone,
	RefreshCw,
	Search,
	Shield,
	SlidersHorizontal,User,
	X
} from "lucide-react";

export default function AdminApplicationsPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: pendingApplications, loading, refresh: refreshApplications } = useApiCollection('applications', {
    pageSize: 50, orderByField: 'createdAt', orderDirection: 'desc',
    autoRefresh: false, // MANUAL REFRESH ONLY
  });
  const { data: routes, loading: routesLoading, refresh: refreshRoutes } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc',
    autoRefresh: false,
  });
  const { data: buses, loading: busesLoading, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc',
    autoRefresh: false,
  });

  const [error, setError] = useState("");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  const [alternativePickerTarget, setAlternativePickerTarget] = useState<{
    item: any;
    currentBus: AlternativeBusData;
    alternatives: AlternativeBusData[];
  } | null>(null);
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

  /** Open the alternative-bus picker for a Case 2 application. */
  const openAlternativePicker = (item: any) => {
    const studentShift = (item.formData?.shift || 'Morning').toLowerCase();
    const appBusId = item.formData?.busId || item.formData?.routeId?.replace('route_', 'bus_') || '';
    const stop_name = item.formData?.stop_name || '';

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
      const route_stops = route.stops || [];
      const hasStop = route_stops.some((stop: any) => {
        const rsId = (stop.stop_name || stop.id || stop.name || '').toLowerCase().trim();
        const rsName = (stop.name || stop.stop_name || '').toLowerCase().trim();
        const normStopId = stop_name.toLowerCase().trim();
        const normStopName = stop_name.toLowerCase().trim();
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

  const handleAlternativeSelected = async (busId: string) => {
    if (!alternativePickerTarget) return;
    const { item } = alternativePickerTarget;
    
    const selectedBus = buses.find((b: any) => (b.id || b.busId) === busId);
    const busNum = selectedBus?.busNumber || busId;
    const routeId = selectedBus?.routeId || '';
    const routeName = selectedBus?.routeName || '';

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

  const { showToast } = useToast();
  const [renewalRequests, setRenewalRequests] = useState<any[]>([]);
  const [loadingRenewals, setLoadingRenewals] = useState(false);
  const [activeSection, setActiveSection] = useState<'applications' | 'upcoming' | 'renewals'>('applications');
  const [currentTime, setCurrentTime] = useState(new Date());

  const fetchRenewalRequests = async () => {
    try {
      setLoadingRenewals(true);
      if (!currentUser) return;
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/applications/all?limit=200', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const responseData = await res.json();
      const apps = responseData.applications || [];

      const requests = apps
        .filter((row: any) => {
          const state = row.state || '';
          const type = row.applicationType || row.application_type || '';
          return (state === 'submitted' || state === 'awaiting_verification' || state === 'pending') &&
                 (type === 'renewal' || type === 'renewal_after_soft_block');
        })
        .map((row: any) => ({
          id: row.applicationId || row.application_id || row.id,
          studentId: row.applicantUid || row.applicant_uid || row.studentId,
          enrollmentId: row.formData?.enrollmentId || row.form_data?.enrollmentId || '',
          studentName: row.formData?.studentName || row.form_data?.studentName || row.applicantEmail || '',
          totalFee: row.formData?.totalFee || row.form_data?.totalFee || 0,
          durationYears: row.formData?.durationYears || row.form_data?.durationYears || 0,
          paymentMode: row.formData?.paymentMode || row.form_data?.paymentMode || 'online',
          paymentId: row.formData?.paymentId || row.form_data?.paymentId || row.paymentId || '',
          receiptImageUrl: row.formData?.receiptImageUrl || row.form_data?.receiptImageUrl || '',
          studentEmail: row.formData?.studentEmail || row.form_data?.studentEmail || row.applicantEmail || '',
          paidAt: row.formData?.paidAt || row.form_data?.paidAt || row.createdAt || row.created_at || '',
          status: row.state || 'pending',
          createdAt: row.createdAt || row.created_at,
        }));
      setRenewalRequests(requests);
    } catch (error) {
      console.error('Error fetching renewal requests:', error);
    } finally {
      setLoadingRenewals(false);
    }
  };

  // Manual refresh handler for applications page
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('applications');
      invalidateCollectionCache('buses');
      await Promise.all([
        refreshApplications(),
        refreshRoutes(),
        refreshBuses(),
        fetchRenewalRequests()
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

  // Redirect if user is not an admin
  useEffect(() => {
    if (userData && userData.role !== "admin") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  useEffect(() => {
    if (currentUser) {
      fetchRenewalRequests();
    }
  }, [currentUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter applications relevant to the admin queue:
  const applicationApplications = useMemo(
    () => pendingApplications.filter((app: any) => {
      const type = app.applicationType || app.application_type || '';
      const isRenewal = type === 'renewal' || type === 'renewal_after_soft_block';
      return app.state === 'submitted' && !isUpcomingApplication(app) && !isRenewal;
    }),
    [pendingApplications]
  );

  const upcomingApplications = useMemo(
    () => pendingApplications.filter((app: any) => (app.state === 'submitted' && isUpcomingApplication(app)) || app.state === 'verified_upcoming' || app.state === 'pending_seat_allocation'),
    [pendingApplications]
  );

  // Trigger the canonical session-activation service. Activates ALL eligible
  // verified_upcoming applications for the current session (idempotent, safe to
  // call any number of times — see session-activation.service.ts).
  const [activating, setActivating] = useState(false);
  const handleRunSessionActivation = async () => {
    if (!currentUser || activating) return;
    setActivating(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/run-session-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const summary = data?.summary || data || {};
        const activated = summary.activated || 0;
        const pending = summary.pendingSeatAllocation || 0;

        await handleRefresh();
        setError('');

        if (activated > 0) {
          showToast(`Activated ${activated} student application(s) successfully!`, 'success');
        } else if (pending > 0) {
          showToast(`Session activation executed, but ${pending} application(s) remain pending due to full bus capacity.`, 'info');
        } else {
          showToast('Session activation completed.', 'info');
        }
      } else {
        showToast(data.error || 'Session activation failed', 'error');
        setError(data.error || 'Session activation failed');
      }
    } catch (err) {
      console.error('Session activation error:', err);
      showToast('Session activation failed', 'error');
      setError('Session activation failed');
    } finally {
      setActivating(false);
    }
  };

  const [reassignModalTarget, setReassignModalTarget] = useState<{ applicationId: string; studentName?: string; busName?: string; shift?: string } | null>(null);

  const handleRetryActivation = async (applicationId: string, itemData?: any) => {
    if (!currentUser) return;
    setApproving(applicationId);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/run-session-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ applicationId }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const summary = data?.summary || data || {};
        const activatedCount = summary.activated ?? data?.activated ?? 0;

        if (activatedCount > 0) {
          showToast('Student application re-approved and seat allocated successfully!', 'success');
          setProcessedIds((prev) => {
            const next = new Set(prev);
            next.add(applicationId);
            return next;
          });
          await handleRefresh();
          setError('');
        } else {
          // Bus capacity is still full — DO NOT wipe away card! Open red confirmation pop-up card
          const studentName = itemData?.formData?.fullName || itemData?.full_name || itemData?.applicantEmail || 'Student';
          setReassignModalTarget({
            applicationId,
            studentName,
          });
        }
      } else {
        const studentName = itemData?.formData?.fullName || itemData?.full_name || itemData?.applicantEmail || 'Student';
        setReassignModalTarget({
          applicationId,
          studentName,
        });
      }
    } catch (err) {
      console.error('Re-approval error:', err);
      const studentName = itemData?.formData?.fullName || itemData?.full_name || itemData?.applicantEmail || 'Student';
      setReassignModalTarget({
        applicationId,
        studentName,
      });
    } finally {
      setApproving(null);
    }
  };

  // Function to get bus display from route information
  const getBusDisplayFromRoute = (routeId: string) => {
    if (!routeId) return 'Not Assigned';

    // If routes/buses are still loading, show loading state
    if (routesLoading || busesLoading) return 'Loading...';

    // Find the route
    const route = routes?.find(r => r.routeId === routeId || r.id === routeId);
    if (!route) {
      // Extract route number from routeId (e.g., "route_01" -> "01")
      const routeNum = routeId.replace(/\D/g, '');
      return routeNum ? `Route ${routeNum}` : routeId;
    }

    // Get bus information from route
    const busId = route.busId || route.busId;
    if (!busId) return `Route ${route.routeName || routeId}`;

    // Find the bus
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
    const stop_name = item.formData?.stop_name;
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
    let shiftLoad = 0;
    if (studentShift === 'morning') {
      shiftLoad = selectedBus.load?.morningCount ?? selectedBus.morningLoad ?? 0;
    } else if (studentShift === 'evening') {
      shiftLoad = selectedBus.load?.eveningCount ?? selectedBus.eveningLoad ?? 0;
    } else {
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
    const normalizedStopName = (stop_name || '').toLowerCase().trim();

    // Find routes that have this stop
    const matchingRouteIds: string[] = [];
    routes.forEach((route: any) => {
      const route_stops = route.stops || [];
      const hasStop = route_stops.some((stop: any) => {
        const routeStopId = (stop.stop_name || stop.id || stop.name || '').toLowerCase().trim();
        const routeStopName = (stop.name || stop.stop_name || '').toLowerCase().trim();
        return routeStopId === normalizedStopName || routeStopName === normalizedStopName;
      });
      if (hasStop) {
        matchingRouteIds.push(route.routeId || route.id);
      }
    });

    // Find alternative buses
    const alternativeBuses = buses.filter((bus: any) => {
      if ((bus.id || bus.busId) === busId) return false;
      if (!matchingRouteIds.includes(bus.routeId)) return false;

      const busShift = (bus.shift || 'Both').toLowerCase();
      if (studentShift === 'morning' && busShift !== 'morning' && busShift !== 'both') return false;
      if (studentShift === 'evening' && busShift !== 'both') return false;

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
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_alternatives_exist', busNumber, shift: studentShift };
    } else {
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_only_option', busNumber, shift: studentShift };
    }
  };

  // Filtered and searched data
  const filteredData = useMemo(() => {
    const isApplicationSection = activeSection === 'applications' || activeSection === 'upcoming';
    let data = activeSection === 'applications'
      ? applicationApplications
      : activeSection === 'upcoming'
        ? upcomingApplications
        : renewalRequests;

    // Apply search filter
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

    // Apply shift filter
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

    // Filter out processed IDs (optimistic update)
    if (isApplicationSection && processedIds.size > 0) {
      data = data.filter((item: any) => !processedIds.has(item.applicationId || item.uid));
    }

    return data;
  }, [activeSection, applicationApplications, upcomingApplications, renewalRequests, searchQuery, shiftFilter, processedIds]);

  // Precompute the expensive per-card capacity check and bus display ONCE per
  // data change. getCapacityStatus scans routes (with nested stop loops) and
  // buses; doing it inline meant re-running it for every card on every render
  // (e.g. expanding a card or typing). Now it only recomputes when the
  // underlying data actually changes.
  const cardMeta = useMemo(() => {
    const map = new Map<string, { capacity: ReturnType<typeof getCapacityStatus>; busDisplay: string }>();
    const isApplicationSection = activeSection === 'applications' || activeSection === 'upcoming';
    if (!isApplicationSection) return map;

    for (const item of filteredData) {
      map.set(item.applicationId, {
        capacity: getCapacityStatus(item),
        busDisplay: item.formData?.busAssigned || getBusDisplayFromRoute(item.formData?.routeId),
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, buses, routes, routesLoading, busesLoading, activeSection]);

  const handleApproveRenewal = async (requestId: string) => {
    if (!currentUser) return;

    const renewalItem = renewalRequests.find(r => r.id === requestId);
    const busName = renewalItem?.busNumber ? `Bus ${renewalItem.busNumber}` : 'Requested Bus';

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
        const errorData = await response.json().catch(() => ({}));
        const studentName = renewalItem?.studentName || 'Student';
        setReassignModalTarget({
          applicationId: requestId,
          studentName,
          busName,
          shift: 'Morning',
        });
      }
    } catch (error) {
      console.error('Error approving renewal:', error);
      const studentName = renewalItem?.studentName || 'Student';
      setReassignModalTarget({
        applicationId: requestId,
        studentName,
        busName,
        shift: 'Morning',
      });
    } finally {
      setApproving(null);
    }
  };

  // Approve an application
  const handleApprove = async (applicationId: string, overrideBusId?: string) => {
    if (!currentUser) return;

    const appItem = pendingApplications.find((app: any) => app.applicationId === applicationId);
    const capStatus = appItem ? getCapacityStatus(appItem) : null;

    if (capStatus?.needsCapacityReview && capStatus.reassignmentReason === 'bus_full_only_option' && !overrideBusId) {
      const studentName = appItem?.formData?.fullName || appItem?.full_name || appItem?.applicantEmail || 'Student';
      const routeId = appItem?.routeId || appItem?.formData?.routeId || '';
      const busName = getBusDisplayFromRoute(routeId);
      const shift = (appItem?.shift || appItem?.formData?.shift || 'Morning');
      setReassignModalTarget({
        applicationId,
        studentName,
        busName,
        shift,
      });
      return;
    }

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

      if (response.ok) {
        setError("");
        // Clear staged bus selection if any
        sessionStorage.removeItem(`staged_bus_${applicationId}`);
        setStagedBusesTrigger(prev => prev + 1);

        // Format bus/route for toast
        const isUpcoming = appItem ? isUpcomingApplication(appItem) : false;
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

        const msg = isUpcoming
          ? 'Upcoming application verified successfully! It will be activated when the new session begins.'
          : busLabel 
            ? `Application approved successfully with ${busLabel}${routeLabel ? ` on ${routeLabel}` : ''}! Student notified via email.` 
            : 'Application approved successfully! Student notified via email.';
        showToast(msg, 'success');

        // Optimistically hide the card
        setProcessedIds(prev => {
          const newSet = new Set(prev);
          newSet.add(applicationId);
          return newSet;
        });
        await handleRefresh();
      } else {
        const errorData = await response.json().catch(() => ({}));
        const studentName = appItem?.formData?.fullName || appItem?.full_name || appItem?.applicantEmail || 'Student';
        const routeId = appItem?.routeId || appItem?.formData?.routeId || '';
        const busName = getBusDisplayFromRoute(routeId);
        const shift = (appItem?.shift || appItem?.formData?.shift || 'Morning');
        setReassignModalTarget({
          applicationId,
          studentName,
          busName,
          shift,
        });
      }
    } catch (error) {
      console.error("Error approving application:", error);
      const studentName = appItem?.formData?.fullName || appItem?.full_name || appItem?.applicantEmail || 'Student';
      const routeId = appItem?.routeId || appItem?.formData?.routeId || '';
      const busName = getBusDisplayFromRoute(routeId);
      const shift = (appItem?.shift || appItem?.formData?.shift || 'Morning');
      setReassignModalTarget({
        applicationId,
        studentName,
        busName,
        shift,
      });
    } finally {
      setApproving(null);
    }
  };

  // Rejection Dialog State
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [selectedApplication, setSelectedApplication] = useState<string | null>(null);

  // Open rejection dialog
  const handleRejectClick = (applicationId: string) => {
    setSelectedApplication(applicationId);
    setRejectionReason("");
    setShowRejectDialog(true);
  };

  // Confirm rejection
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
            rejectorName: userData?.displayName || userData?.fullName || 'Admin',
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

        if (response.ok) {
          setError("");
          // Clear staged bus selection if any
          if (selectedApplication) {
            sessionStorage.removeItem(`staged_bus_${selectedApplication}`);
            setStagedBusesTrigger(prev => prev + 1);
          }
          setShowRejectDialog(false);
          setRejectionReason("");
          // Optimistically hide the card
          if (selectedApplication) {
            setProcessedIds(prev => {
              const newSet = new Set(prev);
              newSet.add(selectedApplication);
              return newSet;
            });
          }
          await handleRefresh();
          setSelectedApplication(null);
        } else {
          const errorData = await response.json();
          setError(errorData.error || "Failed to reject application");
        }
      }
    } catch (error) {
      console.error("Error rejecting application:", error);
      setError("Failed to reject application");
    } finally {
      setRejecting(null);
    }
  };

  if (!currentUser) {
    return (
      <div className="mt-12 min-h-screen flex items-center justify-center p-4">
        <Card>
          <CardContent className="py-8 text-center max-w-md">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
            <p className="text-muted-foreground">
              You need to be signed in as an admin to view applications.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="mt-12 space-y-6">
      {/* Page Header */}
      <div className="space-y-2 mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white leading-none">Student Applications</h1>
            <div className="hidden md:block">
              <Badge className="text-[10px] font-bold px-2 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-tight rounded-md">
                {activeSection === 'applications' ? 'Freshers' : activeSection === 'upcoming' ? 'Upcoming' : 'Renewals'}: {filteredData.length}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeSection === 'upcoming' && (
              <Button
                size="sm"
                className="group h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-700 shadow-sm font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 cursor-pointer"
                onClick={handleRunSessionActivation}
                disabled={activating}
                title="Activate all verified upcoming-session applications for the current session"
              >
                {activating ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Calendar className="mr-2 h-3.5 w-3.5" />
                )}
                Run Session Activation
              </Button>
            )}
            <Button
              size="sm"
              className="group h-8 px-3.5 bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-300/80 dark:border-zinc-700 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-500/50 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 cursor-pointer"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn(`mr-2 h-3.5 w-3.5 transition-transform duration-500`, isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-zinc-400 text-sm max-w-2xl">
          Review and manage all student bus service applications
        </p>
      </div>

      {/* Filter Toolbar - Full Width Layout */}
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

        <div className="flex flex-col sm:flex-row gap-2 flex-1 w-full font-sans">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              placeholder={activeSection === 'renewals' ? "Search renewals..." : "Search by name, enrollment ID, phone..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 w-full bg-[#12131A] border-white/[0.05] focus:border-indigo-500/50 transition-all text-sm"
            />
          </div>

          <div className="flex gap-2">
            {(activeSection === 'applications' || activeSection === 'upcoming') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "hidden md:flex h-10 gap-2 border-white/[0.05] bg-[#12131A] hover:bg-zinc-900 transition-all text-sm px-4",
                      shiftFilter.length > 0 && "border-indigo-500/50 text-indigo-400 font-medium"
                    )}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filter by Shift
                    {shiftFilter.length > 0 && (
                      <Badge className="ml-1 bg-indigo-500 text-white border-none h-5 px-1.5 min-w-[1.25rem] justify-center text-[10px]">
                        {shiftFilter.length}
                      </Badge>
                    )}
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-[#12131A] border-white/[0.1] text-zinc-300">
                  <DropdownMenuLabel className="text-zinc-500 text-[10px] uppercase tracking-wider font-bold">Shift Preferences</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/[0.05]" />
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('morning')}
                    onCheckedChange={(checked) => {
                      setShiftFilter(checked ? [...shiftFilter, 'morning'] : shiftFilter.filter(s => s !== 'morning'));
                    }}
                    className="cursor-pointer focus:bg-white/[0.05]"
                  >
                    Morning Shift
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('evening')}
                    onCheckedChange={(checked) => {
                      setShiftFilter(checked ? [...shiftFilter, 'evening'] : shiftFilter.filter(s => s !== 'evening'));
                    }}
                    className="cursor-pointer focus:bg-white/[0.05]"
                  >
                    Evening Shift
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={shiftFilter.includes('both')}
                    onCheckedChange={(checked) => {
                      setShiftFilter(checked ? [...shiftFilter, 'both'] : shiftFilter.filter(s => s !== 'both'));
                    }}
                    className="cursor-pointer focus:bg-white/[0.05]"
                  >
                    Dual Shift (Both)
                  </DropdownMenuCheckboxItem>
                  {shiftFilter.length > 0 && (
                    <>
                      <DropdownMenuSeparator className="bg-white/[0.05]" />
                      <DropdownMenuItem onClick={() => setShiftFilter([])} className="cursor-pointer text-red-400 focus:text-red-400 focus:bg-red-400/10">
                        Clear Shift Filters
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {(shiftFilter.length > 0 || searchQuery !== "") && (
              <Button
                variant="ghost"
                onClick={() => {
                  setShiftFilter([]);
                  setSearchQuery("");
                }}
                className="h-10 px-4 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-300 border border-red-500/20"
              >
                <X className="h-4 w-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Content Area */}
      {(loading || loadingRenewals || routesLoading || busesLoading) && pendingApplications.length === 0 ? (
        <div className="flex justify-center items-center h-96">
          <PremiumPageLoader message="Fetching data..." />
        </div>
      ) : (
        <>
          {(loading || loadingRenewals || routesLoading || busesLoading) && (
            <div className="w-full h-1 bg-indigo-500/10 overflow-hidden mb-4 rounded-full">
              <div className="animate-progress w-full h-full bg-indigo-500 origin-left-right"></div>
            </div>
          )}
          {filteredData.length === 0 ? (
            <Card className="bg-[#12131A]/40 border-white/[0.05]">
              <CardContent className="py-20 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="p-4 bg-muted rounded-full">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-white">No items found</h3>
                    <p className="text-sm text-zinc-500 max-w-sm">
                      There are no pending requests matching your criteria.
                    </p>
                  </div>
                  {(searchQuery || shiftFilter.length > 0) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("");
                        setShiftFilter([]);
                      }}
                      className="border-white/10 hover:bg-white/5"
                    >
                      Clear All Filters
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredData.map((item: any) => {
                const isApplication = activeSection === 'applications' || activeSection === 'upcoming';
                const isUpcoming = activeSection === 'upcoming';
                const key = isApplication ? item.applicationId : item.id;

                return (
                  <Card
                    key={key}
                    className="group transition-all duration-300 border-white/[0.05] bg-[#12131A]/40 hover:bg-indigo-500/[0.03] hover:border-indigo-500/20 overflow-hidden relative"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-top" />

                    {isApplication ? (() => {
                      const meta = cardMeta.get(item.applicationId);
                      const { needsCapacityReview, reassignmentReason, busNumber, shift } =
                        meta?.capacity ?? { needsCapacityReview: false, reassignmentReason: 'no_issue' as const, busNumber: 'Unknown', shift: 'morning' };
                      const busDisplay = meta?.busDisplay ?? '';

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

                              {/* Top Right: Payment Info (Desktop Only) */}
                              <div className="hidden sm:flex flex-col items-end gap-2">
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

                            {/* Upcoming lifecycle banner */}
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
                              {/* Desktop Layout - Unchanged */}
                              <div className="hidden sm:flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300 group-hover:bg-zinc-800/60 transition-colors">
                                  <BusIcon className="h-3 w-3 text-indigo-400" />
                                  <span className="font-medium text-white/90">{busDisplay}</span>
                                </Badge>

                                {stagedBuses.has(item.applicationId) && (
                                  <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-purple-500/10 text-purple-400 border-purple-500/30 font-medium">
                                    <Check className="h-3 w-3 text-purple-400 shrink-0" />
                                    Staged Bus: {stagedBuses.get(item.applicationId)?.busNumber}
                                  </Badge>
                                )}

                                <Badge variant="outline" className="gap-1.5 text-[10px] py-1 px-2.5 bg-zinc-800/40 border-white/5 text-zinc-300 capitalize">
                                  <Clock className="h-3 w-3 text-indigo-400" />
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

                              {/* Mobile Layout */}
                              <div className="flex md:hidden flex-col gap-2.5 mt-4">
                                {item.formData?.paymentInfo?.amountPaid && (
                                  <div className="w-full bg-zinc-900/80 border border-zinc-800 rounded-none py-2 px-3 flex justify-center items-center shadow-sm">
                                    <span className="text-[13px] font-mono font-bold text-zinc-200 tracking-wide uppercase">
                                      PAYMENT AMOUNT : ₹{Number(item.formData.paymentInfo.amountPaid).toLocaleString('en-IN')}
                                    </span>
                                  </div>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                  <Badge variant="outline" className="justify-center h-9 text-[11px] border-white/10 bg-zinc-800/50 text-zinc-200 rounded-full font-medium">
                                    <BusIcon className="h-3.5 w-3.5 mr-1.5 text-indigo-400 shrink-0" />
                                    <span className="truncate">{busDisplay}</span>
                                  </Badge>
                                  <Badge variant="outline" className="justify-center h-9 text-[11px] border-white/10 bg-zinc-800/50 text-zinc-200 rounded-full font-medium capitalize">
                                    <Clock className="h-3.5 w-3.5 mr-1.5 text-indigo-400 shrink-0" />
                                    {item.formData?.shift || 'Morning'}
                                  </Badge>
                                </div>

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
                                              variant="outline"
                                              className="h-7 text-[10px] gap-1.5 w-full sm:w-auto border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                                              onClick={() => router.push('/admin/smart-allocation')}
                                            >
                                              <ArrowRightLeft className="h-3 w-3" />
                                              Manage Allocations
                                            </Button>
                                          ) : (
                                            <>
                                              <Button
                                                size="sm"
                                                className="h-7 text-[10px] gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-500 text-white hover:from-indigo-500 hover:to-blue-400 border-0 shadow-md shadow-indigo-500/20 transition-all w-full sm:w-auto"
                                                onClick={() => openAlternativePicker(item)}
                                              >
                                                <BusIcon className="h-3 w-3" />
                                                {stagedBuses.has(item.applicationId) ? "Change Alternative Bus" : "Select Alternative Bus"}
                                              </Button>
                                              {stagedBuses.has(item.applicationId) && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  className="h-7 text-[10px] border-zinc-700 text-zinc-300 hover:bg-zinc-800 w-full sm:w-auto"
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

                            {/* Footer: Actions */}
                            {item.state === 'verified_upcoming' ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                                <Button
                                  variant="outline"
                                  className="w-full bg-white hover:bg-gray-100 text-black border-transparent shadow-sm font-medium h-10 gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                  onClick={() => router.push(`/admin/applications/${item.applicationId}`)}
                                >
                                  <Eye className="h-4 w-4" />
                                  View
                                </Button>
                                <Button
                                  disabled
                                  className="w-full h-10 gap-2 font-medium bg-indigo-600/40 text-white/70 cursor-not-allowed"
                                  title={item.eligibleApproval ? `Activates on ${new Date(item.eligibleApproval).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Awaiting new academic session'}
                                >
                                  <Calendar className="h-4 w-4" />
                                  Awaiting Activation
                                </Button>
                              </div>
                            ) : item.state === 'pending_seat_allocation' ? (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                                <Button
                                  variant="outline"
                                  className="w-full bg-white hover:bg-gray-100 text-black border-transparent shadow-sm font-medium h-10 gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                  onClick={() => router.push(`/admin/applications/${item.applicationId}`)}
                                >
                                  <Eye className="h-4 w-4" />
                                  View
                                </Button>
                                <Button
                                  className="w-full h-10 gap-2 font-medium bg-amber-600 hover:bg-amber-500 text-white shadow-lg"
                                  onClick={() => handleRetryActivation(item.applicationId, item)}
                                  disabled={approving === item.applicationId}
                                  title="Re-approve application — succeeds if a seat is available"
                                >
                                  {approving === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  Re-Approve
                                </Button>
                                <Button
                                  variant="outline"
                                  className="w-full h-10 gap-2 border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                  onClick={() => handleRejectClick(item.applicationId)}
                                  disabled={rejecting === item.applicationId}
                                >
                                  {rejecting === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                                <Button
                                  variant="outline"
                                  className="w-full bg-white hover:bg-gray-100 text-black border-transparent shadow-sm font-medium h-10 gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                  onClick={() => router.push(`/admin/applications/${item.applicationId}`)}
                                >
                                  <Eye className="h-4 w-4" />
                                  View
                                </Button>

                                <Button
                                  className={cn(
                                    "w-full h-10 gap-2 font-medium shadow-lg shadow-emerald-900/20 hover:shadow-emerald-900/40 hover:scale-[1.02] active:scale-[0.98] transition-all",
                                    (needsCapacityReview && !stagedBuses.has(item.applicationId))
                                      ? "bg-emerald-600/50 text-white/50 cursor-not-allowed"
                                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                                  )}
                                  onClick={() => {
                                    const staged = stagedBuses.get(item.applicationId);
                                    handleApprove(item.applicationId, staged?.busId);
                                  }}
                                  disabled={((needsCapacityReview && !stagedBuses.has(item.applicationId)) || approving === item.applicationId)}
                                >
                                  {approving === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  {isUpcoming ? "Verify" : "Approve"}
                                </Button>

                                <Button
                                  variant="outline"
                                  className="w-full h-10 gap-2 border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                  onClick={() => handleRejectClick(item.applicationId)}
                                  disabled={rejecting === item.applicationId}
                                >
                                  {rejecting === item.applicationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                  Reject
                                </Button>
                              </div>
                            )}
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
        </>
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
              className="bg-red-600 hover:bg-red-700"
            >
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Capacity Full / Unable to Re-Approve Reddish Confirmation Pop-up Card */}
      <Dialog open={!!reassignModalTarget} onOpenChange={(open) => !open && setReassignModalTarget(null)}>
        <DialogContent className="max-w-xl w-full bg-[#180e11] border border-rose-500/40 text-white p-0 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header Banner */}
          <div className="p-6 sm:p-7 bg-gradient-to-b from-rose-950/60 to-red-950/20 border-b border-white/10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-rose-600 text-white shrink-0 shadow-lg">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium border bg-rose-500/20 text-rose-300 border-rose-500/40 mb-1.5">
                  Capacity Full • Seat Unavailable
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  No Seats Available for Re-Approval
                </h1>
              </div>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 sm:p-7 space-y-5">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <h2 className="text-sm font-semibold text-zinc-200">
                Application for <strong className="text-white font-bold">{reassignModalTarget?.studentName}</strong>
              </h2>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                No seats are currently available on <strong className="text-rose-300">{reassignModalTarget?.busName}</strong> for the <strong className="text-zinc-100">{reassignModalTarget?.shift}</strong> shift, and no alternative buses serving this stop have free capacity.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/50 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold uppercase tracking-wider">
                <ArrowRightLeft className="h-4 w-4 text-rose-400" />
                How to Make a Seat Available
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                To free up a seat for <strong className="text-white">{reassignModalTarget?.studentName}</strong>, navigate to <strong className="text-rose-300">Student Reassignment</strong> and transfer an existing active student on <strong className="text-rose-300">{reassignModalTarget?.busName}</strong> to another bus or route.
              </p>
            </div>

            {/* Footer Buttons */}
            <div className="flex flex-row justify-between items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-1/2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border-white/10 h-11 font-medium rounded-xl transition-all"
                onClick={() => setReassignModalTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-1/2 bg-white/5 hover:bg-white/10 text-white border-white/10 h-11 font-medium rounded-xl transition-all"
                onClick={() => {
                  setReassignModalTarget(null);
                  router.push('/admin/smart-allocation');
                }}
              >
                Reassign Student
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {alternativePickerTarget && (
        <AlternativeBusPicker
          applicantName={alternativePickerTarget.item.formData?.fullName || 'Applicant'}
          applicantStopName={alternativePickerTarget.item.formData?.stop_name || alternativePickerTarget.item.formData?.stop_name || ''}
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
