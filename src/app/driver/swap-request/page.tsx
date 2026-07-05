// @ts-nocheck
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle, XCircle, Clock, User, Calendar, Plus, Bus, AlertCircle, Search, Filter, UserCheck, ArrowRight, Sparkles, Zap, StopCircle, RefreshCw, ShieldCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { supabase } from '@/lib/supabase-client';
import { format, addHours, addDays } from 'date-fns';
import { formatDateFlexible } from '@/lib/utils/date-utils';
import EnhancedDatePicker from '@/components/enhanced-date-picker';

interface Driver {
  uid: string;
  fullName: string;
  name: string;
  driverId: string;
  phoneNumber: string;
  shift?: string;
  busId?: string;
  busNumber?: string;
}

interface SwapRequest {
  id: string;
  fromDriverUID: string;
  fromDriverName?: string;
  toDriverUID: string;
  toDriverName?: string;
  busId: string;
  busNumber?: string;
  routeId: string;
  routeName?: string;
  status: string;
  timePeriod?: any;
  reason?: string;
  createdAt: any;
  expiresAt?: any;
  acceptedAt?: any;
  rejectedAt?: any;
  swapType?: 'assignment' | 'swap';
  secondaryBusId?: string | null;
  secondaryBusNumber?: string | null;
  pendingExpiry?: boolean;
}

interface BusData {
  busId: string;
  busNumber: string;
  routeId: string;
  routeName?: string;
  shift?: string;
}

// Safe date formatter for Firestore Timestamps
const formatDate = formatDateFlexible;

// Helper to format bus identifiers consistently: Bus-X (License Plate)
const formatBusDisplay = (busId: string | undefined, busNumber: string | undefined): string => {
  if (!busId && !busNumber) return 'Unknown';

  // If already looks fully formatted, return it
  if (busNumber?.includes('Bus-') && busNumber.includes('(')) return busNumber;

  let formattedId = '';
  if (busId && typeof busId === 'string') {
    if (busId.toLowerCase().startsWith('bus')) {
      formattedId = busId.replace(/^bus[_-]/i, 'Bus-');
      if (formattedId.toLowerCase().startsWith('bus') && !formattedId.includes('-')) {
        formattedId = formattedId.replace(/^bus/i, 'Bus-');
      }
    } else {
      formattedId = busId;
    }
  }

  // Clean the busNumber (license plate)
  let plate = busNumber && busNumber !== 'N/A' && busNumber !== 'Unknown' ? busNumber : '';

  // Avoid duplicating ID into plate if they are the same
  if (plate === busId || plate === formattedId) plate = '';

  if (formattedId && plate) {
    return `${formattedId} (${plate})`;
  }
  return formattedId || plate || 'Unknown';
};

function SwapRequestPageContent() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("create");

  // State for incoming requests
  const [incomingRequests, setIncomingRequests] = useState<SwapRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<SwapRequest[]>([]);
  const [incomingLoading, setIncomingLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [hasActiveSwap, setHasActiveSwap] = useState(false); // Track if driver has active swap

  const [showEndSwapDialog, setShowEndSwapDialog] = useState(false);
  const [swapToEnd, setSwapToEnd] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchSwapRequests();
    await fetchMyBusData();
    setTimeout(() => {
      setRefreshing(false);
      addToast('Refreshed data successfully', 'success');
    }, 800);
  };

  // State for create request
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [filteredDrivers, setFilteredDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [timePeriodType, setTimePeriodType] = useState<'first_trip' | 'one_day' | 'two_days' | 'custom'>('one_day');
  const [customDuration, setCustomDuration] = useState(24); // hours
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [myBusData, setMyBusData] = useState<BusData | null>(null);
  const [busLoading, setBusLoading] = useState(true);
  const [outgoingLoading, setOutgoingLoading] = useState(true);

  // Filters for drivers
  const [driverFilter, setDriverFilter] = useState<'all' | 'same_shift' | 'reserved' | 'same_bus'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync tab with URL and state
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    } else if (hasActiveSwap) {
      setActiveTab("my-requests");
    }
  }, [searchParams, hasActiveSwap]);

  // NOTE: Cache clearing removed for production - caching is now enabled

  // Initial fetch function for Swap Requests (replacing Firestore onSnapshot)
  const fetchSwapRequests = async () => {
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken();
      const headers = { 'Authorization': `Bearer ${token}` };

      // Fetch Incoming
      const resIn = await fetch('/api/driver-swap/requests?type=incoming', { headers });
      const dataIn = await resIn.json();
      if (dataIn.success) {
        setIncomingRequests(dataIn.requests);
        setIncomingLoading(false);
      }

      // Fetch Outgoing
      const resOut = await fetch('/api/driver-swap/requests?type=outgoing', { headers });
      const dataOut = await resOut.json();
      if (dataOut.success) {
        setOutgoingRequests(dataOut.requests);
        setOutgoingLoading(false);
      }

      // Check active swaps
      const hasAcceptedIn = (dataIn.requests || []).some((r: any) => r.status === 'accepted');
      const hasAcceptedOut = (dataOut.requests || []).some((r: any) => r.status === 'accepted');
      setHasActiveSwap(hasAcceptedIn || hasAcceptedOut);

    } catch (error) {
      console.error("❌ Error fetching swap requests:", error);
      setIncomingLoading(false);
      setOutgoingLoading(false);
    }
  };

  useEffect(() => {
    // Wait for auth to finish loading before checking auth state
    if (authLoading) return;

    if (!currentUser || !userData) {
      router.push('/login');
      return;
    }

    fetchMyBusData();
    fetchDrivers();
    fetchSwapRequests();

    // Set up real-time Supabase listeners
    console.log('🔄 Setting up real-time Supabase listeners for swap requests...');

    // Channel for Table Changes (Global/RLS dependent)
    const dbChannel = supabase.channel('driver-swaps-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_swap_requests'
        },
        async (payload) => {
          console.log('🔔 DB Real-time update received:', payload);

          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          const uid = currentUser.uid;

          // Check if update is relevant to current user
          const isRelevant =
            (newRecord && (newRecord.requester_driver_uid === uid || newRecord.candidate_driver_uid === uid)) ||
            (oldRecord && (oldRecord.requester_driver_uid === uid || oldRecord.candidate_driver_uid === uid));

          if (isRelevant) {
            console.log('✨ Relevant DB update detected, refreshing data...');
            
            // Handle immediate state clearing for cancelled/rejected requests
            if (newRecord && (newRecord.status === 'cancelled' || newRecord.status === 'rejected')) {
              console.log(`🗑️ Immediately clearing ${newRecord.status} request from UI state`);
              
              setIncomingRequests(prev => prev.filter(req => 
                req.id !== newRecord.id
              ));
              setOutgoingRequests(prev => prev.filter(req => 
                req.id !== newRecord.id
              ));
            }
            
            // Always fetch fresh data to ensure consistency
            await fetchSwapRequests();
          }
        }
      )
      .subscribe();

    // Channel for Direct Broadcasts (User specific, bypasses RLS issues for trigger)
    const broadcastChannel = supabase.channel(`driver_swap_requests:${currentUser.uid}`)
      .on('broadcast', { event: 'swap_requested' }, (payload) => {
        console.log('📢 Swap Requested Broadcast received:', payload);
        fetchSwapRequests();
        addToast(`📩 New swap request from ${payload.payload?.requesterName || 'a driver'}!`, 'info');
      })
      .on('broadcast', { event: 'swap_cancelled' }, (payload) => {
        console.log('🚫 Swap Cancelled Broadcast received:', payload);
        fetchSwapRequests();
        addToast('A swap request was cancelled', 'info');
        
        // Immediately clear the specific request from UI state
        setIncomingRequests(prev => prev.filter(req => 
          req.id !== payload.payload?.requestId
        ));
        setOutgoingRequests(prev => prev.filter(req => 
          req.id !== payload.payload?.requestId
        ));
      })
      .on('broadcast', { event: 'swap_rejected' }, (payload) => {
        console.log('❌ Swap Rejected Broadcast received:', payload);
        fetchSwapRequests();
        addToast('A swap request was rejected', 'info');
        
        // Immediately clear the specific request from UI state
        setIncomingRequests(prev => prev.filter(req => 
          req.id !== payload.payload?.requestId
        ));
        setOutgoingRequests(prev => prev.filter(req => 
          req.id !== payload.payload?.requestId
        ));
      })
      .subscribe();

    // Cleanup listeners on unmount
    return () => {
      console.log('🧹 Cleaning up Supabase listeners');
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [currentUser, userData, authLoading]);

  const fetchMyBusData = async () => {
    if (!currentUser) return;

    try {
      console.log('🔍 Fetching bus data for driver:', currentUser.uid);

      // First get driver's assigned bus from drivers collection
      const driverDoc = await getDoc(doc(db, 'drivers', currentUser.uid));

      if (!driverDoc.exists()) {
        console.error('❌ Driver document not found');
        setMyBusData(null);
        return;
      }

      const driverData = driverDoc.data();
      let driverBusId = driverData.assignedBusId || driverData.busId;

      console.log('👤 Driver data:', { assignedBusId: driverData.assignedBusId, busId: driverData.busId });

      if (!driverBusId || (typeof driverBusId === 'string' && driverBusId.toLowerCase() === 'reserved')) {
        console.log('⚠️ No bus assigned to driver or reserved status');
        setMyBusData(null);
        return;
      }

      // Now fetch the bus details
      const busDoc = await getDoc(doc(db, 'buses', driverBusId));

      if (!busDoc.exists()) {
        console.error('❌ Bus document not found:', driverBusId);
        // Even if the document is missing, we can try to format the ID if it looks like a bus ID
        if (typeof driverBusId === 'string' && driverBusId.toLowerCase().startsWith('bus')) {
          const formattedBusNumber = driverBusId.replace(/^bus[_-]/i, 'Bus-').replace(/^bus/i, 'Bus-');
          setMyBusData({
            busId: driverBusId,
            busNumber: formattedBusNumber,
            routeId: 'N/A',
            routeName: 'Manual Assignment',
            shift: driverData.shift || 'Both'
          });
          return;
        }
        setMyBusData({
          busId: driverBusId,
          busNumber: formatBusDisplay(driverBusId, undefined), // No license plate available
          routeId: 'N/A',
          routeName: 'Manual Assignment',
          shift: driverData.shift || 'Both'
        });
        return;
      }

      const busDetails = busDoc.data();
      const finalBusDisplay = formatBusDisplay(driverBusId, busDetails.busNumber);

      const busData: BusData = {
        busId: busDoc.id,
        busNumber: finalBusDisplay,
        routeId: busDetails.routeId || 'N/A',
        routeName: busDetails.route?.routeName || busDetails.routeName || 'N/A',
        shift: busDetails.shift || driverData.shift
      };

      console.log('✅ Bus data loaded:', busData);
      setMyBusData(busData);
    } catch (error) {
      console.error('❌ Error fetching bus data:', error);
      setMyBusData(null);
    } finally {
      setBusLoading(false);
    }
  };

  const fetchDrivers = async () => {
    if (!currentUser) return;

    try {
      // Fetch all buses first to have a mapping for fallback bus numbers
      const busesSnapshot = await getDocs(collection(db, 'buses'));
      const busMapping: Record<string, string> = {};
      busesSnapshot.forEach(doc => {
        busMapping[doc.id] = doc.data().busNumber || 'N/A';
      });

      const driversSnapshot = await getDocs(collection(db, 'drivers'));
      const driversList: Driver[] = [];

      driversSnapshot.forEach((doc) => {
        const data = doc.data();
        // Exclude current user
        if (data.uid !== currentUser.uid) {
          let busId = data.assignedBusId || data.busId;

          // Normalize "reserved" drivers so they appear in the correct group (where busId is falsy)
          if (busId && typeof busId === 'string' && (
            busId.toLowerCase() === 'reserved' ||
            busId.toLowerCase() === 'none' ||
            busId.toLowerCase() === 'unassigned'
          )) {
            busId = undefined;
          }

          let licensePlate = data.busNumber || (busId ? busMapping[busId] : undefined);
          let formattedBusId = '';

          if (busId && typeof busId === 'string' && busId.toLowerCase().startsWith('bus')) {
            formattedBusId = busId.replace(/^bus[_-]/i, 'Bus-');
            if (formattedBusId.toLowerCase().startsWith('bus') && !formattedBusId.includes('-')) {
              formattedBusId = formattedBusId.replace(/^bus/i, 'Bus-');
            }
          }

          const finalBusNumber = formatBusDisplay(busId, licensePlate);

          driversList.push({
            uid: data.uid,
            fullName: data.fullName || data.name || 'Unknown',
            name: data.name || data.fullName || 'Unknown',
            driverId: data.driverId || data.employeeId || 'N/A',
            phoneNumber: data.phoneNumber || 'N/A',
            shift: data.shift,
            busId: busId,
            busNumber: finalBusNumber
          });
        }
      });

      setDrivers(driversList);
      setFilteredDrivers(driversList);
    } catch (error) {
      console.error('Error fetching drivers:', error);
      addToast('Failed to load drivers', 'error');
    }
  };

  // Note: Swap requests are now fetched via real-time Firestore listeners (onSnapshot)
  // No manual fetch function needed - UI updates automatically when data changes

  // Apply filters to drivers list
  useEffect(() => {
    let filtered = [...drivers];

    // Filter by shift - match same shift OR drivers with "Both"
    if (driverFilter === 'same_shift' && myBusData?.shift) {
      const currentShift = myBusData.shift.toLowerCase();
      filtered = filtered.filter(d => {
        if (!d.shift) return false;
        const driverShift = d.shift.toLowerCase();

        // Driver has same shift as current driver
        if (driverShift === currentShift) return true;

        // Driver works both shifts
        if (driverShift === 'both') return true;
        if (driverShift.includes('both')) return true;

        return false;
      });
    } else if (driverFilter === 'reserved') {
      // Filter for reserved drivers (no bus assigned or busId is 'reserved')
      filtered = filtered.filter(d => !d.busId || d.busId === 'reserved');
    } else if (driverFilter === 'same_bus' && myBusData?.busId) {
      // Filter for drivers assigned to the same bus
      filtered = filtered.filter(d => d.busId === myBusData.busId);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(d =>
        d.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.driverId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.phoneNumber.includes(searchQuery)
      );
    }

    setFilteredDrivers(filtered);
  }, [drivers, driverFilter, searchQuery, myBusData]);

  // Calculate time period based on selection
  const calculateTimePeriod = () => {
    const now = new Date();
    let start = new Date(now.getTime() + 5 * 60000); // +5 minutes
    let end: Date;

    switch (timePeriodType) {
      case 'first_trip':
        end = addHours(start, 4); // 4 hours for first trip
        break;
      case 'one_day':
        end = addDays(start, 1);
        break;
      case 'two_days':
        end = addDays(start, 2);
        break;
      case 'custom':
        if (startTime && endTime) {
          start = new Date(startTime);
          end = new Date(endTime);
        } else {
          end = addHours(start, customDuration);
        }
        break;
      default:
        end = addDays(start, 1);
    }

    return {
      type: timePeriodType,
      duration: timePeriodType === 'custom' ? customDuration : undefined,
      startTime: start.toISOString(),
      endTime: end.toISOString()
    };
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser || !selectedDriver || !myBusData) {
      addToast('Please fill all required fields', 'error');
      return;
    }

    // Check if driver has active swap
    if (hasActiveSwap) {
      addToast('You already have an active swap! Please end it before creating a new request.', 'error');
      return;
    }

    // Validate custom dates if selected
    if (timePeriodType === 'custom') {
      if (!startTime || !endTime) {
        addToast('Please select start and end times for custom period', 'error');
        return;
      }

      const start = new Date(startTime);
      const end = new Date(endTime);

      if (start >= end) {
        addToast('End time must be after start time', 'error');
        return;
      }

      const now = new Date();
      if (start < now) {
        addToast('Start time must be in the future', 'error');
        return;
      }
    }

    try {
      setLoading(true);
      const idToken = await currentUser.getIdToken();
      const timePeriod = calculateTimePeriod();

      const response = await fetch('/api/driver-swap/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          fromDriverUID: currentUser.uid,
          toDriverUID: selectedDriver,
          busId: myBusData.busId,
          routeId: myBusData.routeId,
          timePeriod,
          reason: null
        })
      });

      const data = await response.json();

      if (response.ok) {
        addToast('Swap request sent successfully! 🎉', 'success');
        // Reset form
        setSelectedDriver('');
        setTimePeriodType('one_day');
        setCustomDuration(24);
        setStartTime('');
        setEndTime('');
        // Note: UI updates automatically via real-time Firestore listeners
      } else {
        addToast(data.error || 'Failed to create swap request', 'error');
      }
    } catch (error: any) {
      console.error('Error creating swap request:', error);
      addToast('Failed to create swap request', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId: string) => {
    if (!currentUser) return;

    try {
      setProcessing(requestId);
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/driver-swap/requests/${requestId}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        addToast('Swap request accepted! 🎉', 'success');
        // Note: UI updates automatically via real-time Firestore listeners
        router.push('/driver');
      } else {
        addToast(data.error || 'Failed to accept request', 'error');
      }
    } catch (error: any) {
      console.error('Error accepting request:', error);
      addToast('Failed to accept request', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!currentUser) return;

    try {
      setProcessing(requestId);
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/driver-swap/requests/${requestId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ reason: 'Not available' })
      });

      const data = await response.json();

      if (response.ok) {
        addToast('Swap request rejected', 'info');
        
        // Immediately remove from incoming requests
        setIncomingRequests(prev => prev.filter(req => req.id !== requestId));
        
        // Note: Document deleted from Firestore, UI updates via real-time listener
      } else {
        addToast(data.error || 'Failed to reject request', 'error');
      }
    } catch (error: any) {
      console.error('Error rejecting request:', error);
      addToast('Failed to reject request', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleCancel = async (requestId: string) => {
    if (!currentUser) return;

    try {
      setProcessing(requestId);
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/driver-swap/requests/${requestId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        addToast('Swap request cancelled', 'success');
        
        // Immediately remove from outgoing requests
        setOutgoingRequests(prev => prev.filter(req => req.id !== requestId));
        
        // Note: UI updates automatically via real-time Firestore listeners
      } else {
        addToast(data.error || 'Failed to cancel request', 'error');
      }
    } catch (error: any) {
      console.error('Error cancelling request:', error);
      addToast('Failed to cancel request', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleEndSwapClick = (requestId: string) => {
    console.log('🔄 End swap button clicked for request:', requestId);
    setSwapToEnd(requestId);
    setShowEndSwapDialog(true);
  };

  const handleEndSwapConfirm = async () => {
    if (!currentUser || !swapToEnd) {
      console.error('❌ No current user or swap ID');
      addToast('Please log in again', 'error');
      return;
    }

    console.log('🔄 Starting end swap process for request:', swapToEnd);
    setShowEndSwapDialog(false);

    try {
      setProcessing(swapToEnd);
      console.log('📝 Getting ID token...');
      const idToken = await currentUser.getIdToken();
      console.log('✅ Got ID token');

      console.log('🌐 Calling API endpoint...');
      const response = await fetch(`/api/driver-swap/requests/${swapToEnd}/end`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'completed' // manually ended
        })
      });

      console.log('📥 Response status:', response.status);
      const data = await response.json();
      console.log('📥 Response data:', data);

      if (response.ok) {
        console.log('✅ Swap ended successfully!');
        addToast('✅ Swap ended successfully! Drivers restored to original assignments.', 'success');

        // Note: UI updates automatically via real-time Firestore listeners

        // Trigger a page reload to refresh all driver data
        console.log('🔄 Reloading page in 1.5 seconds...');
        setTimeout(() => {
          console.log('🔄 Reloading now...');
          window.location.reload();
        }, 1500);
      } else {
        console.error('❌ API error:', data.error);
        addToast(data.error || 'Failed to end swap', 'error');
      }
    } catch (error: any) {
      console.error('❌ Error ending swap:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      addToast('Failed to end swap: ' + error.message, 'error');
    } finally {
      console.log('🏁 Clearing processing state');
      setProcessing(null);
    }
  };

  // --- PREMIUM HELPER COMPONENTS ---

  const DriverStatusBadge = ({ status, pendingExpiry }: { status: string; pendingExpiry?: boolean }) => {
    if (pendingExpiry) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#111318] text-amber-500 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wide">
          <Clock className="h-3 w-3" />
          Expiring Soon
        </div>
      );
    }

    const configs: Record<string, { bgClass: string; textClass: string; borderClass: string; icon: any; label: string }> = {
      pending: { bgClass: 'bg-[#111318]', textClass: 'text-amber-500', borderClass: 'border-amber-500/30', icon: Clock, label: 'Pending' },
      accepted: { bgClass: 'bg-[#111318]', textClass: 'text-emerald-500', borderClass: 'border-emerald-500/30', icon: CheckCircle, label: 'Active' },
      rejected: { bgClass: 'bg-[#111318]', textClass: 'text-rose-500', borderClass: 'border-rose-500/30', icon: XCircle, label: 'Rejected' },
      expired: { bgClass: 'bg-[#111318]', textClass: 'text-gray-500', borderClass: 'border-gray-500/30', icon: AlertCircle, label: 'Expired' },
      cancelled: { bgClass: 'bg-[#111318]', textClass: 'text-gray-500', borderClass: 'border-gray-500/30', icon: XCircle, label: 'Cancelled' },
    };

    const config = configs[status] || { bgClass: 'bg-[#111318]', textClass: 'text-gray-500', borderClass: 'border-gray-500/30', icon: AlertCircle, label: status };
    const Icon = config.icon;

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgClass} ${config.textClass} border ${config.borderClass} text-[10px] font-bold uppercase tracking-wide`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </div>
    );
  };

  const DriverAvatar = ({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) => {
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const sizeClasses = {
      sm: 'h-8 w-8 text-xs',
      md: 'h-11 w-11 text-sm',
      lg: 'h-16 w-16 text-lg',
    };

    return (
      <div className={`${sizeClasses[size]} rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold`}>
        {initials}
      </div>
    );
  };

  const RequestConnection = ({ from, to, busNumber, type }: { from: string, to: string, busNumber: string, type: string }) => (
    <div className="flex items-center justify-between gap-4 p-4 bg-[#0A0C10] border border-white/5 rounded-xl">
      <div className="flex flex-col items-center gap-2">
        <div className="h-10 w-10 rounded-lg bg-[#111318] border border-white/10 flex items-center justify-center text-indigo-400">
          <User className="h-5 w-5" />
        </div>
        <span className="text-xs font-medium text-gray-400 truncate max-w-[80px] text-center">{from || 'Unknown'}</span>
      </div>

      <div className="flex-1 flex flex-col items-center gap-2 px-4">
        <div className="w-full flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <ArrowRight className="h-4 w-4 text-indigo-400" />
          <div className="flex-1 h-px bg-white/10" />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111318] border border-white/10">
          <Bus className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-white">{busNumber}</span>
        </div>
        <span className={`text-[10px] font-medium uppercase tracking-wide ${type === 'swap' ? 'text-indigo-400' : 'text-amber-400'}`}>
          {type === 'swap' ? 'Full Swap' : 'Duty Assignment'}
        </span>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="h-10 w-10 rounded-lg bg-[#111318] border border-white/10 flex items-center justify-center text-emerald-400">
          <UserCheck className="h-5 w-5" />
        </div>
        <span className="text-xs font-medium text-gray-400 truncate max-w-[80px] text-center">{to || 'Unknown'}</span>
      </div>
    </div>
  );

  const formatTimePeriod = (timePeriod: any) => {
    if (!timePeriod) return 'Select time period';

    // Handle UI preview when building the request (startTime/endTime might be empty strings)
    if (!timePeriod.startTime && !timePeriod.endTime) {
      switch (timePeriod.type) {
        case 'first_trip': return 'First trip (4 hours from now)';
        case 'one_day': return '1 day from now';
        case 'two_days': return '2 days from now';
        case 'custom': return 'Select dates above';
        default: return 'Select time period';
      }
    }

    try {
      const start = new Date(timePeriod.startTime);
      const end = new Date(timePeriod.endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        // For custom type without valid dates
        if (timePeriod.type === 'custom') return 'Select dates above';
        return 'Pending date selection';
      }

      switch (timePeriod.type) {
        case 'first_trip': return 'First trip only';
        case 'one_day': return `1 day (${format(start, 'MMM dd')})`;
        case 'two_days': return `2 days (${format(start, 'MMM dd')} - ${format(end, 'MMM dd')})`;
        case 'custom': return `${format(start, 'MMM dd HH:mm')} - ${format(end, 'MMM dd HH:mm')}`;
        default: return 'Select time period';
      }
    } catch (e) {
      console.warn('Error formatting time period:', e);
      return 'Pending date selection';
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 flex flex-col items-center justify-center space-y-6">
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-full border-2 border-indigo-500/40 border-t-indigo-500 animate-spin" />
          <div className="absolute inset-3 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
            <Bus className="h-7 w-7 text-indigo-400" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Loading Driver Swap</p>
          <div className="h-1 w-16 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mx-auto">
            <div className="h-full w-1/2 bg-indigo-500 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 text-gray-900 dark:text-gray-100 pb-24 md:pb-12 font-sans">

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10 space-y-6">
        {/* Header Section */}
        {/* Hero Header Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 md:p-10 shadow-2xl shadow-indigo-500/10">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-lg">
                  <RefreshCw className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                    Driver Swap Requests
                  </h1>
                  <p className="text-blue-100 text-sm md:text-base font-medium">
                    Manage driver swap requests for your shift
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {myBusData ? (
                <>
                  <div className="px-4 py-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white font-semibold text-sm flex items-center gap-2 shadow-sm">
                    <Bus className="h-4 w-4 text-blue-200" />
                    {myBusData.busNumber}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-4 py-2 h-auto rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white font-semibold text-sm flex items-center gap-2 shadow-sm transition-all"
                  >
                    <RefreshCw className={cn("h-4 w-4 text-emerald-200", refreshing && "animate-spin")} />
                    Refresh
                  </Button>
                </>
              ) : (
                <div className="px-4 py-2 rounded-xl bg-amber-500/20 backdrop-blur-md border border-amber-500/30 text-amber-100 font-semibold text-sm flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  Reserved Pool
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6" defaultValue={''} children={undefined}>
          <TabsList className="bg-gray-200 dark:bg-[#1a1d24] w-full grid grid-cols-3 p-1 rounded-xl h-auto">
            <TabsTrigger
              value="create"
              disabled={hasActiveSwap}
              className="h-10 rounded-lg text-gray-600 dark:text-gray-400 font-medium data-[state=active]:bg-sky-700 data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:shadow-md transition-all duration-200"
            >
              + New Swap
            </TabsTrigger>
            <TabsTrigger
              value="incoming"
              className="h-10 rounded-lg text-gray-600 dark:text-gray-400 font-medium data-[state=active]:bg-sky-700 data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:shadow-md transition-all duration-200"
            >
              Incoming ({incomingRequests.length})
            </TabsTrigger>
            <TabsTrigger
              value="my-requests"
              className="h-10 rounded-lg text-gray-600 dark:text-gray-400 font-medium data-[state=active]:bg-sky-700 data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:shadow-md transition-all duration-200"
            >
              My Sent ({outgoingRequests.length})
            </TabsTrigger>
          </TabsList>


          <TabsContent value="create" className="animate-in fade-in duration-300">
            {busLoading || outgoingLoading ? (
              <Card className="bg-white dark:bg-[#111318] border border-gray-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <CardContent className="p-20 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative h-16 w-16">
                      <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 animate-pulse uppercase tracking-[0.2em]">
                      Validating assignment...
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : !myBusData ? (
              <Card className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <CardContent className="p-8 md:p-12 text-center">
                  <div className="flex flex-col items-center gap-5">
                    <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                      <AlertCircle className="h-8 w-8 text-amber-500" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-white uppercase tracking-tight">Reserved Driver</h3>
                      <p className="text-gray-400 text-sm max-w-md leading-relaxed font-medium">
                        You are currently in the reserved pool. You don't have an active duty assignment to swap.
                      </p>
                      <div className="pt-3">
                        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-widest bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20">
                          Check the Incoming tab to accept duties
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : outgoingRequests.some(r => r.status === 'pending') ? (
              <Card className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <CardContent className="p-8 md:p-12 text-center">
                  <div className="flex flex-col items-center gap-6">
                    <div className="h-20 w-20 rounded-3xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-[0_0_30px_rgba(99,102,241,0.1)]">
                      <Zap className="h-10 w-10 text-indigo-400 animate-pulse" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-xl font-bold text-white uppercase tracking-tight">Active Swap Request Found</h3>
                      <p className="text-gray-400 text-sm max-w-md leading-relaxed font-medium">
                        You already have an active swap request waiting for approval. To start a new one, please cancel the existing one in the <span className="text-indigo-400 font-bold">"My Sent"</span> tab.
                      </p>
                    </div>
                    <Button
                      onClick={() => (document.querySelector('[value="my-requests"]') as HTMLButtonElement)?.click()}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-8 h-12 transition-all active:scale-95 shadow-lg shadow-indigo-600/20"
                    >
                      View My Requests
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white dark:bg-[#111318] border border-gray-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-xl mt-0 pt-0">
                <CardHeader className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-b border-gray-200 dark:border-white/10 pt-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <CardTitle className="text-base md:text-lg font-semibold text-gray-900 dark:text-white">
                        Initiate Driver Swap
                      </CardTitle>
                      <CardDescription className="text-gray-600 dark:text-gray-400 text-xs md:text-sm">
                        Select a replacement driver for a specific time period.
                      </CardDescription>
                    </div>
                    {hasActiveSwap && (
                      <div className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                          Active Swap in Progress
                        </span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                  <form onSubmit={handleCreateRequest} className="space-y-6">
                    {/* Row 1: Time Period & Custom Duration */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-gray-400">Time Period</Label>
                        <Select value={timePeriodType} onValueChange={(value: any) => setTimePeriodType(value)}>
                          <SelectTrigger className="h-11 bg-[#0A0C10] border-white/10 rounded-xl text-white font-medium text-sm hover:bg-white/5 transition-colors">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1d24] border-white/10 rounded-xl text-white shadow-xl" position="popper" side="bottom" align="start">
                            <SelectItem value="first_trip">First Trip (4 hours)</SelectItem>
                            <SelectItem value="one_day">1 Day</SelectItem>
                            <SelectItem value="two_days">2 Days</SelectItem>
                            <SelectItem value="custom">Custom Duration</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2 relative group">
                          <Label className={`text-xs font-medium transition-colors ${timePeriodType !== 'custom' ? 'text-gray-600' : 'text-gray-400'}`}>Start Date/Time</Label>
                          <div className="relative">
                            <div className={cn(
                              "transition-all duration-300",
                              timePeriodType !== 'custom' ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'
                            )}>
                              <EnhancedDatePicker
                                id="startTime"
                                value={startTime}
                                onChange={(value: string) => setStartTime(value)}
                                placeholder="Select Start"
                                includeTime={true}
                                locked={timePeriodType !== 'custom'}
                                minDate={new Date().toISOString()}
                                className="h-11 bg-[#0A0C10] border-white/10 rounded-xl text-white"
                              />
                            </div>
                            {timePeriodType !== 'custom' && (
                              <div
                                className="absolute inset-0 z-10 cursor-not-allowed flex items-center justify-end pr-10 touch-none active:scale-95 transition-transform"
                                title="Select 'Custom Duration' to enable"
                                onClick={() => addToast('Select "Custom Duration" to enable these slots', 'info')}
                              >
                                {/* Lock icon now handled inside EnhancedDatePicker */}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 relative group">
                          <Label className={`text-xs font-medium transition-colors ${timePeriodType !== 'custom' ? 'text-gray-600' : 'text-gray-400'}`}>End Date/Time</Label>
                          <div className="relative">
                            <div className={cn(
                              "transition-all duration-300",
                              timePeriodType !== 'custom' ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'
                            )}>
                              <EnhancedDatePicker
                                id="endTime"
                                value={endTime}
                                onChange={(value: string) => setEndTime(value)}
                                placeholder="Select End"
                                includeTime={true}
                                locked={timePeriodType !== 'custom'}
                                minDate={startTime || new Date().toISOString()}
                                className="h-11 bg-[#0A0C10] border-white/10 rounded-xl text-white"
                              />
                            </div>
                            {timePeriodType !== 'custom' && (
                              <div
                                className="absolute inset-0 z-10 cursor-not-allowed flex items-center justify-end pr-10 touch-none active:scale-95 transition-transform"
                                title="Select 'Custom Duration' to enable"
                                onClick={() => addToast('Select "Custom Duration" to enable these slots', 'info')}
                              >
                                {/* Lock icon now handled inside EnhancedDatePicker */}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Driver Selection & Search */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-gray-400">Select Target Driver</Label>
                        <span className="text-xs font-semibold text-blue-400">
                          {filteredDrivers.length} available
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select value={driverFilter} onValueChange={(value: any) => setDriverFilter(value)}>
                          <SelectTrigger className="h-11 bg-[#0A0C10] border-white/10 rounded-xl text-white font-medium text-sm hover:bg-white/5 transition-colors">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1d24] border-white/10 rounded-xl text-white shadow-xl" position="popper" side="bottom" align="start">
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="same_shift">Same Shift</SelectItem>
                            <SelectItem value="same_bus">Same Bus</SelectItem>
                            <SelectItem value="reserved">Reserved Pool</SelectItem>
                          </SelectContent>
                        </Select>

                        <div className="relative md:col-span-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                            <Input
                              placeholder="Search by name or ID..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="pl-10 pr-10 h-11 bg-[#0A0C10] border-white/10 rounded-xl text-white font-medium placeholder:text-gray-600 hover:bg-white/5 transition-colors"
                            />
                            {searchQuery && (
                              <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {searchQuery && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-[#111318] border border-white/10 rounded-2xl shadow-2xl z-50 max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                              <div className="p-2 space-y-1">
                                {filteredDrivers.length > 0 ? (
                                  filteredDrivers.map((driver) => (
                                    <button
                                      key={driver.uid}
                                      type="button"
                                      onClick={() => {
                                        setSelectedDriver(driver.uid);
                                        setSearchQuery('');
                                      }}
                                      className={cn(
                                        "w-full text-left p-3 rounded-xl transition-all border border-transparent hover:border-white/5 flex flex-col gap-1",
                                        selectedDriver === driver.uid ? "bg-indigo-500/20 border-indigo-500/30" : "hover:bg-white/5"
                                      )}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold text-sm text-white">{driver.fullName}</span>
                                        <span className="text-[10px] font-bold text-gray-500">{driver.driverId || 'N/A'}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className={cn(
                                          "h-1.5 w-1.5 rounded-full shadow-sm",
                                          driver.busId ? "bg-indigo-500 shadow-indigo-500/50" : "bg-amber-500 shadow-amber-500/50"
                                        )} />
                                        <span className="text-[10px] font-medium text-gray-400 capitalize">
                                          {(!driver.busNumber || driver.busNumber === 'Unknown' || driver.busNumber === 'N/A') ? 'Reserved' : driver.busNumber} {driver.shift && `• ${driver.shift} Shift`}
                                        </span>
                                      </div>
                                    </button>
                                  ))
                                ) : (
                                  <div className="p-4 text-center">
                                    <AlertCircle className="h-5 w-5 text-gray-600 mx-auto mb-2" />
                                    <p className="text-xs font-medium text-gray-500">No drivers found for "{searchQuery}"</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <Select value={selectedDriver} onValueChange={setSelectedDriver} required>
                        <SelectTrigger className="h-16 bg-[#0A0C10] border-white/10 rounded-xl text-white font-bold text-sm shadow-lg hover:bg-white/5 transition-all">
                          <SelectValue placeholder="Choose a driver from the list..." />
                        </SelectTrigger>
                        <SelectContent
                          className="bg-[#111318] border-white/10 rounded-2xl p-2 max-h-[400px] overflow-y-auto z-[9999] shadow-2xl"
                          position="popper"
                          sideOffset={12}
                        >
                          {filteredDrivers.length > 0 ? (
                            <div className="space-y-2">
                              {filteredDrivers.some(d => !d.busId) && (
                                <div className="space-y-1 pb-2">
                                  <div className="px-4 py-3 text-[9px] font-black text-amber-500 uppercase tracking-[0.2em] bg-amber-500/5 rounded-2xl border border-amber-500/10 mb-2">
                                    Reserved Personnel (Assigned to Duty)
                                  </div>
                                  {filteredDrivers.filter(d => !d.busId).map((driver) => (
                                    <SelectItem key={driver.uid} value={driver.uid} className="py-4 pl-10 pr-4 cursor-pointer rounded-2xl focus:bg-indigo-500/20 data-[state=checked]:bg-indigo-500/30 transition-all border border-transparent hover:border-white/5">
                                      <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-3">
                                          <span className="font-black text-sm text-white tracking-tight uppercase italic">{driver.fullName}</span>
                                          <span className="px-2 py-0.5 bg-white/5 rounded-md text-[9px] font-black text-gray-500 tracking-widest border border-white/5">
                                            {driver.driverId || 'N/A'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                                          <span className="text-[10px] font-bold text-amber-500/80 uppercase tracking-widest">Reserved Pool</span>
                                          {driver.shift && <span className="text-[10px] font-medium text-gray-500">• {driver.shift} Shift</span>}
                                        </div>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </div>
                              )}

                              {filteredDrivers.some(d => d.busId) && (
                                <div className="space-y-1">
                                  <div className="px-4 py-3 text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] bg-indigo-500/5 rounded-2xl border border-indigo-500/10 mb-2">
                                    Active Duty (Swap Eligible)
                                  </div>
                                  {filteredDrivers.filter(d => d.busId).map((driver) => (
                                    <SelectItem key={driver.uid} value={driver.uid} className="py-4 pl-10 pr-4 cursor-pointer rounded-2xl focus:bg-indigo-500/20 data-[state=checked]:bg-indigo-500/30 transition-all border border-transparent hover:border-white/5">
                                      <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-3">
                                          <span className="font-black text-sm text-white tracking-tight uppercase italic">{driver.fullName}</span>
                                          <span className="px-2 py-0.5 bg-white/5 rounded-md text-[9px] font-black text-gray-500 tracking-widest border border-white/5">
                                            {driver.driverId || 'N/A'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                                          <span className="text-[10px] font-black text-indigo-400/80 uppercase tracking-widest">{driver.busNumber || 'Unknown'}</span>
                                          {driver.shift && <span className="text-[10px] font-medium text-gray-500">• {driver.shift} Shift</span>}
                                        </div>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="px-8 py-16 text-center bg-white/5 rounded-[2rem] m-2">
                              <AlertCircle className="h-10 w-10 text-gray-600 mx-auto mb-4" />
                              <p className="text-sm font-black text-white uppercase tracking-[0.2em]">Fleet Unavailable</p>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-2">No eligible personnel found matching filters.</p>
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Submit Section */}
                    <div className="pt-5 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-[#0A0C10] flex items-center justify-center border border-white/10">
                          <Clock className="h-5 w-5 text-blue-400" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-medium text-gray-400">Calculated Window</p>
                          <p className="text-sm font-medium text-white">{formatTimePeriod({ type: timePeriodType, startTime, endTime })}</p>
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={loading || hasActiveSwap || !selectedDriver}
                        className="w-full md:w-auto min-w-[200px] h-11 bg-white text-black hover:bg-gray-200 disabled:bg-[#0A0C10] disabled:text-gray-500 disabled:border-white/5 rounded-xl transition-all active:scale-[0.98] font-bold text-sm shadow-lg hover:shadow-xl"
                      >
                        {loading ? (
                          <div className="flex items-center gap-3">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Sending...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>Send Swap Request</span>
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Incoming Requests Tab */}
          <TabsContent value="incoming" className="space-y-4 animate-in fade-in duration-300">
            {incomingLoading ? (
              <div className="text-center py-20">
                <RefreshCw className="h-10 w-10 text-indigo-500 animate-spin mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Synchronizing fleet data...</p>
              </div>
            ) : incomingRequests.length === 0 ? (
              <Card className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <CardContent className="text-center py-16">
                  <div className="h-16 w-16 bg-[#0A0C10] border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <RefreshCw className="h-8 w-8 text-gray-500" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1">No Incoming Requests</h3>
                  <p className="text-gray-400 text-sm">Your incoming queue is currently empty.</p>
                </CardContent>
              </Card>
            ) : (
              incomingRequests.map((request) => (
                <Card key={request.id} className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl hover:border-white/10 transition-colors">
                  <CardContent className="p-5 md:p-6 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <DriverAvatar name={request.fromDriverName || 'Unknown'} />
                        <div className="space-y-0.5">
                          <h4 className="text-xs sm:text-sm font-semibold text-white">{request.fromDriverName}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs text-gray-400">Sent on {formatDate(request.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <DriverStatusBadge status={request.status} pendingExpiry={request.pendingExpiry} />
                    </div>

                    <RequestConnection
                      from={request.fromDriverName || 'Unknown'}
                      to="You"
                      busNumber={formatBusDisplay(request.busId, request.busNumber)}
                      type={request.swapType || 'duty'}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-[#0A0C10] border border-white/5 p-3 rounded-lg">
                        <p className="text-[9px] sm:text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Duration</p>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-emerald-400" />
                          <span className="text-xs sm:text-sm font-medium text-gray-200">{formatTimePeriod(request.timePeriod)}</span>
                        </div>
                      </div>
                      <div className="bg-[#0A0C10] border border-white/5 p-3 rounded-lg">
                        <p className="text-[9px] sm:text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Assignment</p>
                        <div className="flex items-center gap-2">
                          <Bus className="h-4 w-4 text-indigo-400" />
                          <span className="text-xs sm:text-sm font-medium text-gray-200">
                            {formatBusDisplay(request.busId, request.busNumber)} {request.timePeriod?.type !== 'custom' && `• ${request.timePeriod?.type?.split('_').join(' ')}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex gap-3 pt-2">
                        <Button
                          onClick={() => handleAccept(request.id)}
                          disabled={processing === request.id}
                          className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm"
                        >
                          {processing === request.id ? 'Processing...' : 'Accept Swap'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleReject(request.id)}
                          disabled={processing === request.id}
                          className="flex-1 h-10 bg-transparent border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-lg font-semibold text-sm"
                        >
                          Reject
                        </Button>
                      </div>
                    )}

                    {request.status === 'accepted' && (
                      <Button
                        onClick={() => handleEndSwapClick(request.id)}
                        disabled={processing === request.id}
                        className="w-full h-10 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-rose-50 dark:hover:bg-rose-900/40 hover:border-rose-300 dark:hover:border-rose-700/50 text-gray-900 dark:text-white rounded-lg font-semibold text-sm transition-all"
                      >
                        {request.pendingExpiry ? 'Confirm Reversion' : 'End Active Swap'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* My Requests Tab */}
          <TabsContent value="my-requests" className="space-y-4 animate-in fade-in duration-300">
            {outgoingRequests.length === 0 ? (
              <Card className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <CardContent className="text-center py-16">
                  <div className="h-16 w-16 bg-[#0A0C10] border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <UserCheck className="h-8 w-8 text-gray-500" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1">No Sent Requests</h3>
                  <p className="text-gray-400 text-sm">You haven't initiated any swap requests yet.</p>
                </CardContent>
              </Card>
            ) : (
              outgoingRequests.map((request) => (
                <Card key={request.id} className="bg-[#111318] border border-white/5 rounded-2xl overflow-hidden shadow-xl hover:border-white/10 transition-colors">
                  <CardContent className="p-5 md:p-6 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <DriverAvatar name={request.toDriverName || 'Unknown'} />
                        <div className="space-y-0.5">
                          <h4 className="text-xs sm:text-sm font-semibold text-white">To: {request.toDriverName}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs text-gray-400">Sent on {formatDate(request.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <DriverStatusBadge status={request.status} pendingExpiry={request.pendingExpiry} />
                    </div>

                    <RequestConnection
                      from="You"
                      to={request.toDriverName || 'Unknown'}
                      busNumber={formatBusDisplay(request.busId, request.busNumber)}
                      type={request.swapType || 'duty'}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-[#0A0C10] border border-white/5 p-3 rounded-lg">
                        <p className="text-[9px] sm:text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Target Duration</p>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-blue-400" />
                          <span className="text-xs sm:text-sm font-medium text-gray-200">{formatTimePeriod(request.timePeriod)}</span>
                        </div>
                      </div>
                      <div className="bg-[#0A0C10] border border-white/5 p-3 rounded-lg">
                        <p className="text-[9px] sm:text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Fleet Details</p>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-purple-400" />
                          <span className="text-xs sm:text-sm font-medium text-gray-200">
                            {formatBusDisplay(request.busId, request.busNumber)} {request.timePeriod?.type !== 'custom' && `• ${request.timePeriod?.type?.split('_').join(' ')}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {request.status === 'pending' && (
                      <Button
                        variant="outline"
                        onClick={() => handleCancel(request.id)}
                        disabled={processing === request.id}
                        className="w-full h-10 bg-transparent border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-lg font-semibold text-sm"
                      >
                        Cancel Request
                      </Button>
                    )}

                    {request.status === 'accepted' && (
                      <Button
                        onClick={() => handleEndSwapClick(request.id)}
                        disabled={processing === request.id}
                        className="w-full h-10 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-rose-50 dark:hover:bg-rose-900/40 hover:border-rose-300 dark:hover:border-rose-700/50 text-gray-900 dark:text-white rounded-lg font-semibold text-sm transition-all"
                      >
                        {request.pendingExpiry ? 'Confirm Reversion' : 'End Active Swap'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>

        {/* End Swap Confirmation Dialog */}
        <Dialog open={showEndSwapDialog} onOpenChange={(open) => {
          setShowEndSwapDialog(open);
          if (!open) setSwapToEnd(null);
        }}>
          <DialogContent
            onWheel={(e) => e.stopPropagation()}
            className="bg-[#111318] border-white/10 rounded-2xl sm:max-w-md p-6 shadow-2xl"
          >
            <DialogHeader className="space-y-3">
              <div className="h-14 w-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
                <StopCircle className="h-7 w-7" />
              </div>
              <div className="text-center space-y-1">
                <DialogTitle className="text-xl font-semibold text-white">
                  Revert Duty Assignment
                </DialogTitle>
                <DialogDescription className="text-gray-400 text-sm">
                  Termination will restore the original driver assignments across the fleet.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="py-4">
              <div className="p-4 rounded-lg bg-[#0A0C10] border border-white/10 space-y-3">
                <p className="text-xs font-medium text-gray-400">Restoration Protocols:</p>
                <ul className="space-y-2">
                  {[
                    'Restore original driver to primary vehicle',
                    'Return exchange recipient to reserved status',
                    'Immediate fleet-wide synchronization'
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ShieldCheck className="h-4 w-4 text-indigo-400 shrink-0" />
                      <span className="text-xs text-gray-400">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEndSwapDialog(false)}
                className="flex-1 h-10 bg-transparent border-white/10 text-gray-400 rounded-lg font-medium text-sm hover:bg-white/5 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleEndSwapConfirm}
                disabled={processing === swapToEnd}
                className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-sm transition-all"
              >
                {processing === swapToEnd ? 'Processing...' : 'Confirm Reversion'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div >
  );
}

export default function SwapRequestPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    }>
      <SwapRequestPageContent />
    </Suspense>
  );
}

