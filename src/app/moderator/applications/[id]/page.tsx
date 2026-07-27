"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useParams,useRouter } from 'next/navigation';
import { useEffect,useMemo,useState } from 'react';

import { StatusBadge } from '@/components/application/status-badge';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { useToast } from '@/contexts/toast-context';
import { invalidateCollectionCache } from '@/hooks/usePaginatedCollection';
import { downloadFile } from '@/lib/download-utils';
import { safeImageSrc,safeMailtoHref,safeTelHref } from '@/lib/security/url-sanitizer';
import { Application } from '@/lib/types/application';
import { cn } from '@/lib/utils';
import { isUpcomingApplication } from '@/lib/utils/application-eligibility';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import {
	AlertTriangle,
	ArrowLeft,
	Briefcase,
	Bus as BusIcon,
	Calendar,
	CalendarDays,
	CheckCircle,
	Clock,
	Copy,
	CreditCard,
	Download,
	FileText,
	Hash,
	Loader2,
	Mail,
	Phone,
	RefreshCw,
	ShieldCheck,
	User as UserIcon,
	XCircle
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import ReassignmentPanel,{ type BusData as RPBusData,type StudentData as RPStudentData } from '@/components/smart-allocation/ReassignmentPanel';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';


export default function ModeratorApplicationDetailPage() {
  const { currentUser, userData, loading } = useAuth();
  const { canApplicationView, canApplicationApprove, canApplicationReject, loading: permsLoading } = useModeratorPermissions();
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const applicationId = params?.id as string;

  const [application, setApplication] = useState<Application | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [yearlyBusFee, setYearlyBusFee] = useState<number>(1200); // Default
  const [driverData, setDriverData] = useState<any>(null);
  const [verifierData, setVerifierData] = useState<any>(null);
  const [routeError, setRouteError] = useState(false);

  const [sessionStartYear, setSessionStartYear] = useState<number>(0);
  const [sessionEndYear, setSessionEndYear] = useState<number>(0);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [deadlineConfig, setDeadlineConfig] = useState<any>(null);
  const [paymentData, setPaymentData] = useState<any>(null);
  const [stagedBus, setStagedBus] = useState<{ busId: string; busNumber: string; routeId: string; routeName: string } | null>(null);

  useEffect(() => {
    if (applicationId) {
      const staged = sessionStorage.getItem(`staged_bus_${applicationId}`);
      if (staged) {
        try {
          setStagedBus(JSON.parse(staged));
        } catch (e) {
          console.error('Failed to parse staged bus', e);
        }
      }
    }
  }, [applicationId]);

  const [reassignmentTarget, setReassignmentTarget] = useState<{
    item: any;
    busId: string;
    busData: RPBusData;
    busStudents: RPStudentData[];
  } | null>(null);
  const [allBuses, setAllBuses] = useState<RPBusData[]>([]);
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [loadingReassignmentData, setLoadingReassignmentData] = useState(false);

  const capacityStatus = useMemo(() => {
    if (!application || !busData) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue' as const };
    }

    if (stagedBus) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue' as const };
    }

    const studentShift = (application.formData?.shift || 'Morning').toLowerCase();
    const totalCapacity = busData.totalCapacity || busData.capacity || 50;

    let shiftLoad = 0;
    if (studentShift === 'morning') {
      shiftLoad = busData.load?.morningCount ?? busData.morningLoad ?? 0;
    } else if (studentShift === 'evening') {
      shiftLoad = busData.load?.eveningCount ?? busData.eveningLoad ?? 0;
    } else {
      const morningLoad = busData.load?.morningCount ?? busData.morningLoad ?? 0;
      const eveningLoad = busData.load?.eveningCount ?? busData.eveningLoad ?? 0;
      shiftLoad = Math.max(morningLoad, eveningLoad);
    }

    const availableSeats = totalCapacity - shiftLoad;
    const isFull = availableSeats <= 0;

    if (!isFull) {
      return { needsCapacityReview: false, reassignmentReason: 'no_issue' as const };
    }

    // Bus is full, check for alternative buses serving this stop in the same shift
    const stop_name = application.formData?.stop_name || '';
    const normalizedStopName = stop_name.toLowerCase().trim();

    // Find routes that serve this stop
    const matchingRouteIds: string[] = [];
    allRoutes.forEach((route: any) => {
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
    const alternativeBuses = allBuses.filter((bus: any) => {
      const busIdVal = bus.id || bus.busId;
      const currentBusIdVal = busData.id || busData.busId;
      if (busIdVal === currentBusIdVal) return false;
      if (!matchingRouteIds.includes(bus.routeId)) return false;

      // Check shift compatibility
      const busShift = (bus.shift || 'Both').toLowerCase();
      if (studentShift === 'morning' && busShift !== 'morning' && busShift !== 'both') return false;
      if (studentShift === 'evening' && busShift !== 'evening' && busShift !== 'both') return false;

      // Check capacity
      const altTotalCapacity = bus.capacity || bus.totalCapacity || 50;
      let altShiftLoad = 0;
      if (studentShift === 'morning') {
        altShiftLoad = bus.load?.morningCount ?? bus.morningLoad ?? 0;
      } else if (studentShift === 'evening') {
        altShiftLoad = bus.load?.eveningCount ?? bus.eveningLoad ?? 0;
      } else {
        const morningLoad = bus.load?.morningCount ?? bus.morningLoad ?? 0;
        const eveningLoad = bus.load?.eveningCount ?? bus.eveningLoad ?? 0;
        altShiftLoad = Math.max(morningLoad, eveningLoad);
      }
      const altAvailableSeats = altTotalCapacity - altShiftLoad;
      return altAvailableSeats > 0;
    });

    if (alternativeBuses.length > 0) {
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_alternatives_exist' as const };
    } else {
      return { needsCapacityReview: true, reassignmentReason: 'bus_full_only_option' as const };
    }
  }, [application, busData, allBuses, allRoutes, stagedBus]);

  const isReassignmentRequired = capacityStatus.needsCapacityReview;

  const openReassignment = async () => {
    if (!application || !busData) return;
    setLoadingReassignmentData(true);
    try {
      const studentAssignedBusId = application.formData?.busId || application.formData?.busId || application.formData?.routeId?.replace('route_', 'bus_') || '';

      const authToken = await currentUser?.getIdToken();
      const studentsRes = await fetch('/api/students?busId=' + encodeURIComponent(studentAssignedBusId), {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const studentsJson = await studentsRes.json();
      const busStudents: RPStudentData[] = (Array.isArray(studentsJson) ? studentsJson : []).map((s: any) => ({
        id: s.id || '',
        fullName: s.name || s.id || '',
        enrollmentId: s.enrollmentId,
        stop_name: s.stop_name || '',
        busId: s.busId || s.busId || studentAssignedBusId,
        shift: s.shift,
        semester: s.semester,
        phone: s.phone,
        photoURL: s.profilePhotoUrl,
      }));

      let rpBuses = allBuses;
      if (rpBuses.length === 0) {
        const [routesRes, busesRes] = await Promise.all([
          fetch('/api/routes', { headers: { 'Authorization': `Bearer ${authToken}` } }),
          fetch('/api/buses', { headers: { 'Authorization': `Bearer ${authToken}` } })
        ]);
        const routesJson = await routesRes.json();
        const routesList = Array.isArray(routesJson) ? routesJson : (routesJson.routes || []);
        const busesJson = await busesRes.json();
        const busesList = busesJson.buses || [];
        rpBuses = busesList.map((b: any) => {
          const matchedRoute = routesList.find((r: any) => r.routeId === b.routeId || r.id === b.routeId);
          const rawStops = matchedRoute?.stops || b.route?.stops || b.stops || [];
          const stops = rawStops.map((s: any) => ({
            id: s.id || s.stop_name || s.name || '',
            name: s.name || s.stop_name || s.id || '',
            sequence: s.sequence ?? 0,
          }));
          return {
            id: b.id || '',
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
        setAllBuses(rpBuses);
      }

      const currentBusRpb = rpBuses.find(b => b.id === studentAssignedBusId) || {
        id: studentAssignedBusId,
        busNumber: busData.busNumber || `Bus-${studentAssignedBusId}`,
        capacity: busData.capacity || busData.totalCapacity || 55,
        currentMembers: busData.currentMembers || 0,
        shift: busData.shift || 'both',
        stops: [],
        load: busData.load || { morningCount: 0, eveningCount: 0 },
      };

      setReassignmentTarget({
        item: application,
        busId: studentAssignedBusId,
        busData: currentBusRpb,
        busStudents
      });
    } catch (err: any) {
      showToast(err?.message || 'Failed to load reassignment data', 'error');
    } finally {
      setLoadingReassignmentData(false);
    }
  };

  const handleReassignmentSuccess = async () => {
    setReassignmentTarget(null);
    showToast('Reassignment completed successfully.', 'success');
    invalidateCollectionCache('applications');
    invalidateCollectionCache('buses');
    await loadApplication();
  };

  const [fetchingPayment, setFetchingPayment] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  useEffect(() => {
    const fetchDeadlineConfig = async () => {
      try {
        const response = await fetch('/api/settings/deadline-config');
        if (response.ok) {
          const data = await response.json();
          setDeadlineConfig(data.config);
        }
      } catch (error) {
        console.error('Error fetching deadline config:', error);
      }
    };
    fetchDeadlineConfig();
  }, []);

  const fetchPaymentData = async (studentUid: string, token: string) => {
    try {
      setFetchingPayment(true);
      const response = await fetch(`/api/payment/transactions?studentUid=${studentUid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.transactions && data.transactions.length > 0) {
          const mainPayment = data.transactions.find((t: any) => t.status === 'completed') || data.transactions[0];
          setPaymentData(mainPayment);
          console.log('✅ Linked payment record found:', mainPayment.paymentId);
        }
      }
    } catch (error) {
      console.error('Error fetching payment data:', error);
    } finally {
      setFetchingPayment(false);
    }
  };

  const getCurrentAcademicSessionStartYear = () => {
    if (!deadlineConfig) return new Date().getFullYear();
    const referenceDate = new Date();
    const currentYear = referenceDate.getFullYear();
    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6;
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;
    const anchorDate = new Date(currentYear, startMonth, startDay, 0, 0, 0, 0);
    if (referenceDate.getTime() >= anchorDate.getTime()) {
      return currentYear;
    } else {
      return currentYear - 1;
    }
  };

  const sessionStartYearBase = getCurrentAcademicSessionStartYear();
  const nextSessionStartYear = sessionStartYearBase + 1;

  const getDerivedValidUntilText = () => {
    if (!deadlineConfig) return 'Loading...';
    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6;
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;
    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);
    const date = lifecycle.expiry;

    const day = date.getUTCDate();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = monthNames[date.getUTCMonth()];
    const year = date.getUTCFullYear();

    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;

    return `${day} ${month} ${year} ${hours}:${minutesStr} ${ampm}`;
  };

  const originalStartYear = application?.formData?.sessionInfo?.sessionStartYear || 0;
  const originalEndYear = application?.formData?.sessionInfo?.sessionEndYear || 0;
  const hasUnsavedChanges = application ? (
    (sessionStartYear !== 0 && sessionStartYear !== Number(originalStartYear)) ||
    (sessionEndYear !== 0 && sessionEndYear !== Number(originalEndYear))
  ) : false;


  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    showToast('Copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadReceipt = async () => {
    // Priority 1: PDF Receipt from Supabase for online payment
    if (paymentData?.paymentId && application?.formData?.paymentInfo?.paymentMode?.toLowerCase() === 'online') {
      try {
        setDownloadingReceipt(true);
        const token = await currentUser?.getIdToken();
        const response = await fetch(`/api/payment/receipt/${paymentData.paymentId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Receipt_${application?.formData?.fullName.replace(/\s+/g, '_') || 'Student'}_${paymentData.paymentId}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          showToast('Payment Receipt downloaded!', 'success');
          setReceiptModalOpen(false);
          return;
        } else {
          throw new Error('Failed to generate PDF receipt');
        }
      } catch (error) {
        console.error('Error downloading PDF receipt:', error);
        showToast('Failed to generate Payment Receipt', 'error');
        return;
      } finally {
        setDownloadingReceipt(false);
      }
    }

    if (!application?.formData?.paymentInfo?.paymentEvidenceUrl) return;

    try {
      setDownloadingReceipt(true);
      const evidenceUrl = application.formData.paymentInfo.paymentEvidenceUrl;
      const filename = `${application.formData.fullName.replace(/\s+/g, '_')}_receipt.${evidenceUrl.split('.').pop()?.split('?')[0] || 'jpg'}`;
      await downloadFile(evidenceUrl, filename);
      showToast('Receipt downloaded successfully!', 'success');
      setReceiptModalOpen(false);
    } catch (error) {
      console.error('Error downloading receipt:', error);
      showToast('Failed to download receipt', 'error');
    } finally {
      setDownloadingReceipt(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      if (!currentUser || !userData || userData.role !== 'moderator') {
        router.push('/login');
        return;
      }
      loadApplication();
    }
  }, [loading, currentUser, userData, router, applicationId]);

  useEffect(() => {
    const fetchBusFee = async () => {
      try {
        const response = await fetch('/api/settings/bus-fees');
        if (response.ok) {
          const data = await response.json();
          setYearlyBusFee(data.amount || 1200);
        }
      } catch (error) {
        console.error('Error fetching bus fee:', error);
      }
    };
    fetchBusFee();
  }, []);

  // Helper function to map ApplicationState to StatusBadge status
  const mapStateToStatus = (state: string | undefined): 'pending' | 'approved' | 'rejected' | 'submitted' => {
    if (!state) return 'pending';
    switch (state) {
      case 'approved':
        return 'approved';
      case 'submitted':
      case 'verified':
      case 'awaiting_verification':
        return 'submitted';
      default:
        return 'pending';
    }
  };

  const loadApplication = async () => {
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch(`/api/applications/${applicationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setApplication(data.application);
        if (data.application?.formData?.sessionInfo) {
          setSessionStartYear(Number(data.application.formData.sessionInfo.sessionStartYear) || new Date().getFullYear());
          setSessionEndYear(Number(data.application.formData.sessionInfo.sessionEndYear) || (Number(data.application.formData.sessionInfo.sessionStartYear) || new Date().getFullYear()) + 1);
        }


        // Fetch bus, route, and verifier data in parallel
        const promises = [];
        const studentAssignedBusId = data.application.formData?.busId || data.application.formData?.busId;
        const routeId = data.application.formData?.routeId || data.application.formData?.routeId;
        if ((routeId || studentAssignedBusId) && token) {
          promises.push(fetchBusAndRouteData(routeId, studentAssignedBusId, token));
        }

        const verifiedById = data.application.verifiedById || data.application.verifiedBy;
        if (verifiedById && token) {
          promises.push(fetchVerifierData(verifiedById, token));
        }

        // Prefetch buses and routes for capacity check
        const loadBusesAndRoutes = async () => {
          try {
            const authToken = await currentUser?.getIdToken();
            const [busesRes, routesRes] = await Promise.all([
              fetch('/api/buses', { headers: { 'Authorization': `Bearer ${authToken}` } }),
              fetch('/api/routes', { headers: { 'Authorization': `Bearer ${authToken}` } })
            ]);
            const busesJson = busesRes.ok ? await busesRes.json().catch(() => ({})) : {};
            const routesJson = routesRes.ok ? await routesRes.json().catch(() => ([])) : [];
            const busesList = Array.isArray(busesJson) ? busesJson : (busesJson.buses || []);
            const routesList = Array.isArray(routesJson) ? routesJson : (routesJson.routes || []);
            const rpBuses: RPBusData[] = busesList.map((bdata: any) => {
              const route = routesList.find((r: any) => r.id === bdata.routeId);
              const rawStops = route?.stops || bdata.route?.stops || bdata.stops || [];
              const stops = rawStops.map((s: any) => ({
                id: s.id || s.stop_name || s.name || '',
                name: s.name || s.stop_name || s.id || '',
                sequence: s.sequence ?? 0,
              }));
              return {
                id: bdata.id || '',
                busNumber: bdata.busNumber || bdata.id || '',
                routeId: bdata.routeId || '',
                routeName: bdata.routeName || route?.routeName || route?.name || '',
                currentMembers: bdata.currentMembers || 0,
                capacity: bdata.capacity || bdata.totalCapacity || 55,
                shift: bdata.shift || 'both',
                stops,
                load: bdata.load || { morningCount: 0, eveningCount: 0 },
                route: route || bdata.route || null,
              };
            });
            setAllBuses(rpBuses);
            setAllRoutes(routesList);
          } catch (e) {
            console.error('Error prefetching buses and routes:', e);
          }
        };
        promises.push(loadBusesAndRoutes());

        await Promise.all(promises);

        // Fetch payment data from Supabase separately
        fetchPaymentData(data.application.applicantUid, token);
      } else {
        showToast('Application not found', 'error');
        router.push('/moderator/applications');
      }
    } catch (error) {
      console.error('Error loading application:', error);
      showToast('Failed to load application', 'error');
    } finally {
      setLoadingApp(false);
    }
  };

  const handleVerifyPayment = async () => {
    setVerifyingPayment(true);
    try {
      const token = await currentUser?.getIdToken();
      if (!token) return;

      const response = await fetch(`/api/payment/recover?studentUid=${application?.applicantUid || applicationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && (data.status === 'success' || data.status === 'already_processed')) {
          showToast('Payment verified successfully!', 'success');
          loadApplication();
        } else {
          showToast(data.message || 'Payment status could not be verified.', 'info');
        }
      } else {
        showToast('Failed to contact verification gateway.', 'error');
      }
    } catch (error) {
      console.error('Error verifying payment:', error);
      showToast('An error occurred during verification.', 'error');
    } finally {
      setVerifyingPayment(false);
    }
  };

  const fetchBusAndRouteData = async (routeId: string | undefined, busId: string | undefined, token: string) => {
    try {
      // Fetch bus and route data in parallel if we have IDs
      const promises: Promise<Response | null>[] = [];

      if (busId) {
        promises.push(fetch(`/api/buses/${busId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null));
      } else if (routeId) {
        promises.push(fetch(`/api/buses?routeId=${routeId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }

      if (routeId) {
        promises.push(fetch(`/api/routes/${routeId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }

      const [busResponse, routeResponse] = await Promise.all(promises);

      if (busResponse?.ok) {
        const busResult = await busResponse.json();
        // Handle both point endpoints and list endpoints
        // Bus API can return { bus: ... }, { buses: [...] }, or the bus object directly
        const bus = busResult.bus || (busResult.buses && busResult.buses.length > 0 ? busResult.buses[0] : (busResult.busId ? busResult : null));
        if (bus) {
          setBusData(bus);

          // Fetch driver data if assignedDriverId or activeDriverId exists
          const driverId = bus.assignedDriverId || bus.activeDriverId;
          if (driverId) {
            await fetchDriverData(driverId, token);
          }
        }
      }

      if (routeResponse?.ok) {
        const routeResult = await routeResponse.json();
        setRouteData(routeResult.route);
        setRouteError(false);
      } else if (routeId) {
        console.warn(`Route ${routeId} not found (Status: ${routeResponse?.status})`);
        setRouteError(true);
      }
    } catch (error) {
      console.error('Error fetching bus/route data:', error);
      // Determine if this was a route error vs network error
      setRouteError(true);
    }
  };

  const fetchDriverData = async (driverId: string, token: string) => {
    try {
      console.log('🔍 Fetching driver with ID:', driverId);
      const driverResponse = await fetch(`/api/drivers/${driverId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (driverResponse.ok) {
        const driverResult = await driverResponse.json();
        console.log('✅ Driver API Response:', driverResult);

        // Handle both response formats: { driver } or just the driver object
        const driver = driverResult.driver || driverResult;
        console.log('📝 Setting driver data:', driver);
        setDriverData(driver);
      } else {
        console.error('❌ Driver API failed:', driverResponse.status);
      }
    } catch (error) {
      console.error('❌ Error fetching driver data:', error);
    }
  };

  const fetchVerifierData = async (verifiedById: string, token: string) => {
    if (!verifiedById) return;

    // Special handling for system-verified applications (online payments)
    if (verifiedById === 'system_online_payment') {
      setVerifierData({
        name: 'Automated System',
        employeeId: 'ONLINE-PAY',
        role: 'system'
      });
      return;
    }

    // Special handling for offline submission bypass
    if (verifiedById === 'system_offline_submission_bypass') {
      setVerifierData({
        name: 'Offline Submission Bypass',
        employeeId: 'SYSTEM-BYPASS',
        role: 'system'
      });
      return;
    }

    try {
      console.log('🔍 Fetching verifier with ID:', verifiedById);
      // Look up in moderators collection
      const verifierResponse = await fetch(`/api/moderators/${verifiedById}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (verifierResponse.ok) {
        const verifierResult = await verifierResponse.json();
        console.log('✅ Verifier API Response:', verifierResult);
        // Moderator API returns the moderator object directly
        setVerifierData(verifierResult);
      } else {
        console.warn('⚠️ Verifier API failed:', verifierResponse.status);
      }
    } catch (error) {
      console.error('❌ Error fetching verifier data:', error);
    }
  };

  const [capacityWarningOpen, setCapacityWarningOpen] = useState(false);
  const [warningType, setWarningType] = useState<'yellow' | 'red' | null>(null);
  const [pendingUseModified, setPendingUseModified] = useState(false);

  const checkCapacityAndApprove = (useModified: boolean) => {
    if (stagedBus) {
      // Staged bus chosen, bypass original capacity check
      handleApprove(useModified);
      return;
    }
    if (busData) {
      const capacity = Number(busData.capacity || 0);
      const current = Number(busData.currentMembers || 0);
      const freeSeats = capacity - current;

      if (capacity <= current) {
        setWarningType('red');
        setPendingUseModified(useModified);
        setCapacityWarningOpen(true);
        return;
      } else if (freeSeats > 0 && freeSeats <= 5) {
        setWarningType('yellow');
        setPendingUseModified(useModified);
        setCapacityWarningOpen(true);
        return;
      }
    }
    handleApprove(useModified);
  };

  const handleApprove = async (useModified = false) => {
    if (!userData) return;

    // If we have bus data but routeError is true, it's a minor inconsistency
    // We only block if BOTH are missing and it's a new assignment
    if (routeError && !busData && !stagedBus) {
      showToast('Cannot approve: The assigned route does not exist. Please reassign the route first.', 'error');
      return;
    }

    setProcessing(true);
    try {
      const token = await currentUser?.getIdToken();

      const body: any = {
        studentUid: applicationId
      };

      if (stagedBus) {
        body.overrideBusId = stagedBus.busId;
      }

      if (useModified) {
        body.sessionStartYear = sessionStartYear;
        body.sessionEndYear = sessionEndYear;
      }

      const response = await fetch('/api/applications/approve-unauth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });


      if (response.ok) {
        // Clear staged bus selection if any
        sessionStorage.removeItem(`staged_bus_${applicationId}`);

        let busLabel = '';
        let routeLabel = '';
        if (stagedBus) {
          const busNum = stagedBus.busId.replace(/[^0-9]/g, '');
          busLabel = `Bus-${busNum || stagedBus.busId} (${stagedBus.busNumber})`;
          const routeNum = stagedBus.routeId.replace(/[^0-9]/g, '');
          routeLabel = `Route-${routeNum || stagedBus.routeId}`;
        } else if (busData) {
          const busId = busData.id || busData.busId || '';
          const busNum = busId.replace(/[^0-9]/g, '');
          busLabel = `Bus-${busNum || busId} (${busData.busNumber})`;
          const routeId = application?.formData?.routeId || routeData?.routeId || '';
          const routeNum = routeId.replace(/[^0-9]/g, '');
          routeLabel = `Route-${routeNum || routeId}`;
        }

        const msg = busLabel
          ? `Application approved successfully with ${busLabel}${routeLabel ? ` on ${routeLabel}` : ''}! Student can now access their account.`
          : 'Application approved successfully! Student can now access their account.';

        showToast(msg, 'success');
        invalidateCollectionCache('applications');
        invalidateCollectionCache('buses');
        router.push('/moderator/applications');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve application');
      }
    } catch (error: any) {
      console.error('Error approving application:', error);
      showToast(error.message || 'Failed to approve application', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = () => {
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const confirmReject = async () => {
    if (!userData || !rejectionReason.trim()) return;

    setProcessing(true);
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch('/api/applications/reject-unauth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          studentUid: applicationId,
          reason: rejectionReason
        })
      });

      if (response.ok) {
        // Clear staged bus selection if any
        sessionStorage.removeItem(`staged_bus_${applicationId}`);

        showToast('Application rejected and deleted successfully', 'success');
        setRejectDialogOpen(false);
        invalidateCollectionCache('applications');
        invalidateCollectionCache('buses');
        router.push('/moderator/applications');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject application');
      }
    } catch (error: any) {
      console.error('Error rejecting application:', error);
      showToast(error.message || 'Failed to reject application', 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (loading || loadingApp) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-48px)] flex items-center justify-center bg-transparent">
        <PremiumPageLoader message="Curating Application Details..." />
      </div>
    );
  }

  if (!application) {
    return (
      <div className="mt-15 text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">Application not found</p>
      </div>
    );
  }

  if (!permsLoading && !canApplicationView) {
    return <PermissionDeniedCard title="Application Details Restricted" actionName="Viewing Application Details" />;
  }

  return (
    <div className="min-h-screen bg-transparent mt-10 py-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <Link href="/moderator/applications">
            <Button variant="ghost" size="sm" className="gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200">
              <ArrowLeft className="h-4 w-4" />
              Back to Applications
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* ONE Single Large Container */}
        <div className="bg-[#12131A] rounded-[20px] shadow-2xl border border-white/5 overflow-hidden">

          {/* SECTION 1 — TOP HERO CARD (KEEP AS IS ✅) */}
          <div className="p-1">
            <Card className="border-none shadow-none !bg-transparent overflow-hidden">
              <CardContent className="p-8">
                <div className="flex flex-col md:flex-row gap-8">
                  {/* Premium Profile Photo */}
                  <div className="flex justify-center md:justify-start">
                    <div className="relative w-32 h-32">
                      {/* Multi-layered glow effect */}
                      <div className="absolute inset-[-8px] rounded-full bg-gradient-to-tr from-purple-500/30 via-indigo-500/20 to-blue-500/30 blur-xl opacity-60 transition-opacity"></div>
                      <div className="absolute inset-[-2px] rounded-full bg-gradient-to-tr from-purple-400/50 via-indigo-400/40 to-blue-400/50 opacity-70"></div>

                      {/* Glass-morphism container matching the dark theme */}
                      <div className="relative w-full h-full rounded-full bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border-[3px] border-white/20 p-1 flex items-center justify-center overflow-hidden z-10 shadow-2xl">
                        {application.formData?.profilePhotoUrl ? (
                          <div className="w-full h-full rounded-full overflow-hidden ring-2 ring-white/10">
                            <img
                              src={safeImageSrc(application.formData.profilePhotoUrl)}
                              alt={application.formData?.fullName}
                              className="w-full h-full object-cover rounded-full"
                            />
                          </div>
                        ) : (
                          <div className="w-full h-full rounded-full bg-white/5 flex items-center justify-center">
                            <UserIcon className="w-16 h-16 text-gray-500" />
                          </div>
                        )}
                      </div>

                      {/* Verified/Status badge - positioned more centered */}
                      <div className="absolute bottom-0 right-1 w-9 h-9 rounded-full border-4 border-[#12131A] flex items-center justify-center shadow-xl z-20 bg-gradient-to-br from-emerald-400 to-teal-500">
                        <ShieldCheck className="h-5 w-5 text-white" />
                      </div>
                    </div>
                  </div>

                  {/* Student Info */}
                  <div className="flex-1 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <h1 className="text-3xl font-bold text-white tracking-tight">
                        {application.formData?.fullName}
                      </h1>
                      <StatusBadge status={mapStateToStatus(application.state as string)} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-zinc-400 text-[13px] font-medium">
                      <div className="flex items-center gap-2 bg-white/5 px-2.5 py-1 rounded-md border border-white/5">
                        <Hash className="h-3.5 w-3.5 text-indigo-400" />
                        <span className="font-mono">{application.formData?.enrollmentId}</span>
                        <button
                          onClick={() => copyToClipboard(application.formData?.enrollmentId)}
                          className="text-zinc-500 hover:text-white transition-colors ml-1"
                        >
                          {copied ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 cursor-pointer" />}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-zinc-500" />
                        <a href={safeTelHref(application.formData?.phoneNumber) ?? undefined} className="hover:text-indigo-400 transition-colors">
                          {application.formData?.phoneNumber}
                        </a>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-zinc-500" />
                        <a href={safeMailtoHref(application.email || application.formData?.email) ?? undefined} className="hover:text-indigo-400 transition-colors">
                          {(() => {
                            const email = application.email || application.formData?.email;
                            return (typeof email === 'string' && email.includes('@')) ? email : '—';
                          })()}
                        </a>
                      </div>
                    </div>

                    {/* Chips */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline" className="bg-indigo-500/10 text-indigo-300 border-indigo-500/20 px-3 py-1 font-medium">
                        <Briefcase className="h-3 w-3 mr-2" />
                        {application.formData?.department}
                      </Badge>
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 px-3 py-1 font-medium">
                        <Calendar className="h-3 w-3 mr-2" />
                        Semester {application.formData?.semester}
                      </Badge>
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/20 px-3 py-1 font-medium capitalize">
                        <Clock className="h-3 w-3 mr-2" />
                        {application.formData?.shift || 'Flexible'} Shift
                      </Badge>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  {application.state === 'verified_upcoming' ? (
                    <div className="flex flex-row md:flex-col gap-3 self-start md:self-center">
                      <Button
                        disabled
                        className="bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-not-allowed gap-2 h-11 px-6 min-w-[140px]"
                        title={application.eligibleApproval ? `Activates on ${new Date(application.eligibleApproval).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Awaiting new academic session'}
                      >
                        <Calendar className="h-4 w-4" />
                        Approved (Awaiting Activation)
                      </Button>
                    </div>
                  ) : (application.state === 'submitted' || application.state === 'awaiting_verification' || application.state === 'verified') && (
                    <div className="flex flex-row md:flex-col gap-3 self-start md:self-center">
                      {!canApplicationApprove ? (
                        <Button
                          onClick={() => {
                            showToast("You are not authorized to approve students.", "error");
                          }}
                          className="bg-emerald-600/30 text-white/50 opacity-60 cursor-pointer border border-emerald-500/10 hover:bg-emerald-600/30 shadow-xl shadow-emerald-900/10 gap-2 h-11 px-6 min-w-[120px]"
                        >
                          <CheckCircle className="h-4 w-4" />
                          {isUpcomingApplication(application) ? "Verify" : "Approve"}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            if (hasUnsavedChanges) {
                              setApproveConfirmOpen(true);
                            } else {
                              checkCapacityAndApprove(false);
                            }
                          }}
                          disabled={processing || (capacityStatus.needsCapacityReview && !stagedBus)}
                          className={cn(
                            "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-900/10 gap-2 h-11 px-6 min-w-[120px]",
                            (capacityStatus.needsCapacityReview && !stagedBus)
                              ? "bg-emerald-600/50 text-white/50 cursor-not-allowed shadow-lg shadow-emerald-900/20"
                              : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-900/10"
                          )}
                        >
                          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                          {isUpcomingApplication(application) ? "Verify" : "Approve"}
                        </Button>
                      )}
                      {application.formData?.paymentInfo?.paymentMode === 'online' && (
                        <Button
                          onClick={handleVerifyPayment}
                          disabled={verifyingPayment || processing}
                          className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-900/10 gap-2 h-11 px-6 md:min-w-[120px]"
                        >
                          {verifyingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Verify Payment Status
                        </Button>
                      )}
                      <Button
                        variant={!canApplicationReject ? "outline" : "destructive"}
                        onClick={() => {
                          if (!canApplicationReject) {
                            showToast("You are not authorized to reject students.", "error");
                            return;
                          }
                          handleReject();
                        }}
                        disabled={canApplicationReject && processing}
                        className={cn(
                          "gap-2 h-11 px-6 transition-all",
                          !canApplicationReject
                            ? "bg-red-500/5 opacity-60 border border-red-500/10 text-red-500/50 cursor-pointer hover:bg-red-500/5 hover:text-red-500/50"
                            : "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
                        )}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="h-px bg-white/[0.08]" />

          {/* SECTION 2 — INFORMATION GRID (REDESIGNED WITH UNIFIED LAYOUT) */}
          <div className="p-10">
            {/* Section Title Row - Using grid to match content alignment */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-x-10 mb-8 items-center">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="h-5 w-1 bg-indigo-500 rounded-full"></div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Personal Information</h3>
              </div>
              <div className="hidden lg:block"></div>
              <div className="flex items-center justify-between gap-2 flex-shrink-0 mt-8 lg:mt-0 w-full">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-1 bg-emerald-500 rounded-full"></div>
                  <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Service Configuration</h3>
                </div>
                {hasUnsavedChanges && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] py-0.5 px-2 font-medium animate-pulse">
                    Modified
                  </Badge>
                )}
              </div>

            </div>

            {/* Two Column Grid with Vertical Divider */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-x-10">
              {/* Personal Details Column */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                <InfoRow label="Full Name" value={application.formData?.fullName} />
                <InfoRow label="Enrollment ID" value={application.formData?.enrollmentId} isMono />
                <InfoRow label="Email" value={(() => {
                  const email = application.email || application.formData?.email;
                  return (typeof email === 'string' && email.includes('@')) ? email : null;
                })()} />
                <InfoRow label="Phone" value={application.formData?.phoneNumber} />
                <InfoRow label="DOB" value={application.formData?.dob} />
                <InfoRow
                  label="Age"
                  value={(() => {
                    const dob = application.formData?.dob;
                    if (!dob) return '—';
                    const birthDate = new Date(dob);
                    if (isNaN(birthDate.getTime())) return '—';
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const monthDiff = today.getMonth() - birthDate.getMonth();
                    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                      age--;
                    }
                    return age.toString();
                  })()}
                />
                <InfoRow label="Blood Group" value={application.formData?.bloodGroup} />
                <InfoRow label="Parent/Guardian" value={application.formData?.parentName} />
                <InfoRow label="Emergency Contact" value={application.formData?.parentPhone} />
              </div>

              {/* Vertical Divider */}
              <div className="hidden lg:block bg-white/[0.06]"></div>

              {/* Service Details Column */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 mt-8 lg:mt-0">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Route Assignment</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-zinc-300">
                      {application.formData?.routeId ? `Route ${application.formData.routeId.replace('route_', '')}` : 'Not Assigned'}
                    </span>
                    {routeError && !application.formData?.busId && !application.formData?.busId && (
                      <Badge variant="destructive" className="h-5 text-[10px] px-1.5 py-0" title="The assigned route doesn't exist or was deleted">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Missing
                      </Badge>
                    )}
                  </div>
                </div>
                <InfoRow label="Bus Number" value={busData?.busNumber || 'PENDING'} isMono />
                <InfoRow label="Operating Shift" value={application.formData?.shift || 'Flexible'} />
                <div className="flex flex-col gap-1.5 min-w-0">
                  <Label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Start Year</Label>
                  <Select
                    value={sessionStartYear.toString()}
                    onValueChange={(value) => {
                      const start = parseInt(value);
                      setSessionStartYear(start);
                      setSessionEndYear(start + 1);
                    }}
                    disabled={application.state !== 'submitted'}
                  >
                    <SelectTrigger className="h-9 bg-white/5 border-white/10 hover:bg-white/10 text-white text-xs rounded-lg transition-colors focus:ring-1 focus:ring-indigo-500">
                      <SelectValue placeholder="Start Year" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12131A] border-slate-800 text-white">
                      <SelectItem value={sessionStartYearBase.toString()}>{sessionStartYearBase}</SelectItem>
                      <SelectItem value={nextSessionStartYear.toString()}>{nextSessionStartYear}</SelectItem>
                      {sessionStartYear !== sessionStartYearBase && sessionStartYear !== nextSessionStartYear && sessionStartYear !== 0 && (
                        <SelectItem value={sessionStartYear.toString()}>{sessionStartYear}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <InfoRow
                  label="End Year"
                  value={sessionEndYear ? sessionEndYear.toString() : '—'}
                />

                <InfoRow
                  label="Valid Until"
                  value={deadlineConfig ? getDerivedValidUntilText() : 'Loading...'}
                />

                <InfoRow
                  label="Assigned Pilot"
                  value={(application as any).assignedDriverName || driverData?.name || driverData?.fullName || busData?.driverName || 'Allocating Pilot...'}
                />
                <InfoRow
                  label="Bus Stop"
                  value={(() => {
                    const raw_stop_name = application.formData?.stop_name || (application.formData as any)?.pickupPoint;
                    if (!raw_stop_name) return '—';
                    let stop_display = raw_stop_name;
                    if (routeData?.stops) {
                      const stop = routeData.stops.find((s: any) => s.id === raw_stop_name || s.stop_name === raw_stop_name || s.name === raw_stop_name);
                      stop_display = stop ? stop.name || stop.stop_name || raw_stop_name : raw_stop_name;
                    }
                    return stop_display.charAt(0).toUpperCase() + stop_display.slice(1);
                  })()}
                />
                {stagedBus && (
                  <div className="col-span-2 sm:col-span-2 mt-4 p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 text-purple-200 shadow-lg shadow-purple-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <BusIcon className="h-5 w-5 text-purple-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Staged Bus Assignment</span>
                          <p className="text-sm font-semibold text-white">
                            {stagedBus.busNumber}
                          </p>
                          {stagedBus.routeName && (
                            <p className="text-xs text-zinc-400">
                              Route: {stagedBus.routeName}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          sessionStorage.removeItem(`staged_bus_${applicationId}`);
                          setStagedBus(null);
                          showToast('Staged bus assignment cleared.', 'info');
                        }}
                        className="h-7 px-2.5 text-[10px] font-semibold text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 border border-purple-500/20 transition-all"
                      >
                        Clear Staging
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.08]" />

          {/* SECTION 3 — PAYMENT INFORMATION (SIMPLIFIED) */}
          <div className="p-10">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-5 w-1 bg-amber-500 rounded-full"></div>
              <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Payment Information</h3>
            </div>

            {/* Payment Strip */}
            <div className="flex flex-wrap items-center gap-y-8 gap-x-12 py-10 px-10 rounded-[18px] bg-white/[0.02] border border-white/[0.05] relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
                <CreditCard className="h-20 w-20 text-white" />
              </div>

              <div className="flex flex-col gap-1.5 min-w-[140px] flex-grow">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Amount Collected</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white">₹{application.formData?.paymentInfo?.amountPaid?.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Paid</span>
                </div>
              </div>

              <div className="hidden md:block w-[2px] h-12 bg-white/10 flex-shrink-0" />

              <div className="flex flex-col gap-1.5 min-w-[100px] flex-grow">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Payment Mode</span>
                <span className="text-sm font-bold text-white capitalize">{application.formData?.paymentInfo?.paymentMode}</span>
              </div>

              <div className="hidden md:block w-[2px] h-12 bg-white/10 flex-shrink-0" />

              <div className="flex flex-col gap-1.5 min-w-[100px] flex-grow">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Subscription</span>
                <span className="text-sm font-bold text-white">{application.formData?.sessionInfo?.durationYears || 1} Year Plan</span>
              </div>

              <div className="hidden md:block w-[2px] h-12 bg-white/10 flex-shrink-0" />

              <div className="flex flex-col gap-1.5 min-w-[120px] flex-grow">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Gateway Status</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-emerald-400 uppercase tracking-tight">Active</span>
                </div>
              </div>

              {(application.formData?.paymentInfo?.paymentEvidenceUrl ||
                (paymentData?.paymentId && application.formData?.paymentInfo?.paymentMode?.toLowerCase() === 'online')) && (
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-6 border-t border-white/[0.05] w-full mt-6">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-auto self-start sm:self-center">
                    Payment Attachment & Receipts
                  </span>
                  {paymentData?.paymentId && application.formData?.paymentInfo?.paymentMode?.toLowerCase() === 'online' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full sm:w-auto gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20 text-[11px] font-bold uppercase tracking-wider h-9"
                      onClick={handleDownloadReceipt}
                      disabled={downloadingReceipt}
                    >
                      {downloadingReceipt ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Processing
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5" />
                          Payment Receipt
                        </>
                      )}
                    </Button>
                  )}
                  {application.formData?.paymentInfo?.paymentEvidenceUrl && application.formData?.paymentInfo?.paymentMode !== 'online' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full sm:w-auto gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 text-[11px] font-bold uppercase tracking-wider h-9"
                      onClick={() => setReceiptModalOpen(true)}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Inspect Receipt
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Sub-strip for metadata */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Transaction / Reference ID</span>
                <span className="text-[13px] font-bold text-zinc-200 font-mono truncate tracking-tight" title={application.formData?.paymentInfo?.razorpayPaymentId || application.formData?.paymentInfo?.paymentReference || 'N/A'}>
                  {application.formData?.paymentInfo?.razorpayPaymentId || application.formData?.paymentInfo?.paymentReference || 'N/A'}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Payment made on</span>
                <span className="text-[13px] font-bold text-zinc-200">
                  {paymentData?.timestamp || application.formData?.paymentInfo?.paymentTime || application.formData?.paymentInfo?.paidAt
                    ? new Date(paymentData?.timestamp || application.formData?.paymentInfo?.paymentTime || (application.formData?.paymentInfo?.paidAt as string)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : 'N/A'}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Verification State</span>
                <span className="text-[13px] font-bold text-zinc-200 truncate">
                  {application.formData?.paymentInfo?.paymentMode === 'online'
                    ? 'System Verified'
                    : (application.state === 'approved' ? 'Verified' : 'Pending Verification')}
                </span>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.08]" />

          {/* SECTION 4 — FORM CONTEXT (FULL-WIDTH 3-COLUMN GRID) */}
          <div className="p-10 pb-16">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-5 w-1 bg-blue-500 rounded-full"></div>
              <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Form Context</h3>
            </div>

            {/* Full-width equalized 3-column grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Submission State Column */}
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Submission State</span>
                <p className="text-[13px] font-bold text-zinc-200 capitalize">
                  {application.state === 'submitted' ? 'Pending Review' : (application.state || 'Submitted')}
                </p>
              </div>
              {/* Reassignment Required Column */}
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Reassignment Required</span>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    "text-[13px] font-bold",
                    isReassignmentRequired
                      ? (capacityStatus.reassignmentReason === 'bus_full_only_option' ? "text-red-400" : "text-amber-400")
                      : "text-emerald-400"
                  )}>
                    {isReassignmentRequired
                      ? (capacityStatus.reassignmentReason === 'bus_full_only_option' ? "Yes (Critical Limit)" : "Yes")
                      : "No"}
                  </span>
                  {isReassignmentRequired && (
                    capacityStatus.reassignmentReason === 'bus_full_only_option' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push('/moderator/smart-allocation')}
                        className="h-7 px-2.5 text-[10px] font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all gap-1.5"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Free Capacity
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={openReassignment}
                        disabled={loadingReassignmentData}
                        className="h-7 px-2.5 text-[10px] font-semibold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20 transition-all gap-1.5"
                      >
                        {loadingReassignmentData ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <RefreshCw className="h-3 w-3" />
                            Reassign
                          </>
                        )}
                      </Button>
                    )
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] justify-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Submitted on</span>
                <p className="text-[13px] font-bold text-zinc-200 font-mono">
                  {(application as any).submittedAt
                    ? new Date((application as any).submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : (application.formData?.paymentInfo?.paymentTime
                      ? new Date(application.formData.paymentInfo.paymentTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'Real-time')}
                </p>
              </div>
            </div>


          </div>
        </div>

        {/* Receipt Modal */}
        {application.formData?.paymentInfo?.paymentEvidenceUrl && (
          <Dialog open={receiptModalOpen} onOpenChange={setReceiptModalOpen}>
            <DialogContent className="max-w-3xl w-full p-0 gap-0 bg-[#0E0F12] border border-white/10 text-white overflow-hidden shadow-2xl sm:rounded-2xl top-[5%] translate-y-0 data-[state=open]:slide-in-from-top-[5%] mt-8">
              <div className="flex flex-col h-full max-h-[85vh]">
                {/* Header */}
                <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-white/[0.03] to-transparent border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <FileText className="h-5 w-5 text-indigo-400" />
                        Payment Receipt
                      </DialogTitle>
                      <DialogDescription className="text-zinc-400 text-xs">
                        Reference ID: <span className="font-mono text-zinc-300">{application.formData.paymentInfo.paymentReference || 'N/A'}</span>
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                {/* Content - Scrollable Image Area */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-black/40 min-h-[300px] flex items-center justify-center relative">
                  {/* Checkerboard background for transparency */}
                  <div className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: 'radial-gradient(#333 1px, transparent 1px)',
                      backgroundSize: '20px 20px'
                    }}
                  />

                  <div className="relative shadow-2xl rounded-lg overflow-hidden border border-white/10 bg-[#0E0F12]">
                    <Image
                      src={safeImageSrc(application.formData.paymentInfo.paymentEvidenceUrl)}
                      alt="Payment receipt"
                      width={800}
                      height={1000}
                      className="w-full h-auto max-h-[60vh] object-contain"
                      unoptimized // Important for external URLs to render correctly without optimization issues
                    />
                  </div>
                </div>

                {/* Footer */}
                <DialogFooter className="p-6 pt-4 bg-[#0E0F12] border-t border-white/5 flex flex-row items-center justify-between gap-3">
                  <div className="text-xs text-zinc-500 font-mono hidden sm:block">
                    Name: {application.formData.fullName}
                    <br />
                    ID: {application.formData.enrollmentId}
                  </div>
                  <div className="flex items-center gap-3 ml-auto">
                    <Button
                      variant="ghost"
                      onClick={() => setReceiptModalOpen(false)}
                      className="text-white hover:text-white bg-red-500 hover:bg-red-600 "
                    >
                      Close
                    </Button>
                    <Button
                      onClick={handleDownloadReceipt}
                      disabled={downloadingReceipt}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-900/20"
                    >
                      {downloadingReceipt ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          Download Receipt
                        </>
                      )}
                    </Button>
                  </div>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )}


      </div>

      {/* Approval Confirmation Dialog for Session Changes */}
      <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
        <DialogContent className="max-w-md bg-[#12131A] text-white border-white/10 shadow-2xl sm:rounded-2xl">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className="h-12 w-12 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 mb-3">
              <CalendarDays className="h-6 w-6 text-indigo-400" />
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">
              Confirm Academic Year Update
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm mt-3 text-justify leading-relaxed">
              You have updated the academic session details for this application. Please choose whether you want to save these modifications with the approval or proceed with the student's original session details.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 my-3 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Original Start Year:</span>
              <span className="font-semibold text-white">{originalStartYear}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-indigo-400">Modified Start Year:</span>
              <span className="font-bold text-indigo-400">{sessionStartYear}</span>
            </div>
            <div className="h-px bg-white/10 my-2" />
            <div className="flex justify-between">
              <span className="text-slate-400">Original End Year:</span>
              <span className="font-semibold text-white">{originalEndYear}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-400">Modified End Year:</span>
              <span className="font-bold text-emerald-400">{sessionEndYear}</span>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-col gap-2 mt-4">
            <Button
              onClick={async () => {
                setApproveConfirmOpen(false);
                checkCapacityAndApprove(true);
              }}
              disabled={processing}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-10 rounded-lg shadow-lg shadow-indigo-600/20 transition-all duration-200"
            >
              Update & Approve
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setApproveConfirmOpen(false);
                checkCapacityAndApprove(false);
              }}
              disabled={processing}
              className="w-full border-white/10 text-white hover:bg-white/5 h-10 rounded-lg transition-colors"
            >
              Approve Without Changes
            </Button>
            <Button
              variant="ghost"
              onClick={() => setApproveConfirmOpen(false)}
              disabled={processing}
              className="w-full text-zinc-400 hover:text-white hover:bg-white/5 h-10 rounded-lg transition-colors"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bus Capacity Warning Dialog */}
      <Dialog open={capacityWarningOpen} onOpenChange={setCapacityWarningOpen}>
        <DialogContent className="max-w-md bg-[#0B0C10] text-white border-white/10 shadow-2xl sm:rounded-2xl p-6">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center border mb-3 ${warningType === 'red' ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"
              }`}>
              <AlertTriangle className={`h-6 w-6 ${warningType === 'red' ? "text-red-400" : "text-amber-400"}`} />
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">
              Bus Capacity Alert
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs mt-2 text-justify leading-relaxed">
              Please review the capacity status of the assigned bus before confirming the approval.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4">
            <div className={`p-4 rounded-xl border flex flex-col gap-2.5 ${warningType === 'red'
              ? "bg-red-500/5 border-red-500/20 text-red-200"
              : "bg-amber-500/5 border-amber-500/20 text-amber-200"
              }`}>
              <p className="text-sm font-semibold">
                {(() => {
                  const id = busData?.id || '';
                  const num = busData?.busNumber || '';
                  if (!id) return 'Bus';
                  const capId = id.charAt(0).toUpperCase() + id.slice(1);
                  return `${capId} (${num})`;
                })()} is {warningType === 'red' ? 'full' : 'low on capacity'}.
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Current members: {busData?.currentMembers || 0} / {busData?.capacity || 0}.
                {warningType === 'red'
                  ? " Approving this student will exceed the bus capacity limit."
                  : " Approving this student will leave less than 5 free seats remaining."
                }
              </p>
            </div>

            {/* Redirection to Reassignment Portal */}
            <div className="mt-4 flex justify-center">
              <Button
                variant="link"
                onClick={() => {
                  setCapacityWarningOpen(false);
                  router.push('/moderator/smart-allocation');
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-4 p-0 h-auto"
              >
                Go to Student Reassignment Portal
              </Button>
            </div>
          </div>

          <DialogFooter className="flex justify-between items-center sm:justify-between w-full mt-4 gap-4">
            <Button
              variant="outline"
              onClick={() => setCapacityWarningOpen(false)}
              className="border-white/10 text-white hover:bg-white/5 h-10 rounded-lg px-4 order-first"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setCapacityWarningOpen(false);
                await handleApprove(pendingUseModified);
              }}
              className={`text-white font-semibold h-10 rounded-lg px-6 order-last transition-all duration-200 ${warningType === 'red'
                ? "bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20 hover:shadow-red-500/35 hover:scale-[1.02] active:scale-[0.98]"
                : "bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 hover:scale-[1.02] active:scale-[0.98]"
                }`}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
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
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)} className="border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={!rejectionReason.trim() || processing}
              className="bg-red-600 hover:bg-red-700 font-bold"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reassignmentTarget && (
        <ReassignmentPanel
          selectedStudents={reassignmentTarget.busStudents}
          allBuses={allBuses}
          currentBus={reassignmentTarget.busData}
          onClose={() => setReassignmentTarget(null)}
          onSuccess={handleReassignmentSuccess}
        />
      )}
    </div>
  );
}

// Helper components
function InfoRow({ label, value, isMono = false }: { label: string; value: string | undefined | null; isMono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span
        className={cn(
          "text-[14px] font-semibold text-zinc-300 truncate leading-tight",
          isMono && "font-mono tracking-tight"
        )}
        title={value || '—'}
      >
        {value || '—'}
      </span>
    </div>
  );
}

