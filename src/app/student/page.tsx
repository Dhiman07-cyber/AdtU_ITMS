"use client";

import StudentQRDisplay from "@/components/bus-pass/StudentQRDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { WebSocketClient } from '@/domains/realtime/ws-client';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { authApiFetch } from '@/lib/secure-api-client';
import { motion } from "framer-motion";
import {
	Activity,
	AlertCircle,
	ArrowRight,
	Bell,
	BookOpen,
	Bus,
	Calendar,
	Clock,
	CreditCard,
	GraduationCap,
	Info,
	MapPin,
	Monitor,
	Navigation,
	QrCode,
	RefreshCcw,
	Star,
	Timer,
	User,
	Users
} from "lucide-react";
import Link from 'next/link';
import { useRouter } from "next/navigation";
import { useEffect,useState } from 'react';
// SPARK PLAN SAFETY: Migrated to usePaginatedCollection


import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function StudentDashboard() {
  const { userData, currentUser } = useAuth();
  const router = useRouter();
  const [showQRModal, setShowQRModal] = useState(false);
  const [studentData, setStudentData] = useState<any>(null);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [driverData, setDriverData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tripActive, setTripActive] = useState(false);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null);

  // CONSOLIDATED DATA FETCH
  useEffect(() => {
    if (!currentUser?.uid) return;

    const fetchDashboardData = async () => {
      try {
        const { authApiFetch } = await import('@/lib/secure-api-client');
        const response = await authApiFetch(currentUser, '/api/student/dashboard-data');
        
        if (response.ok) {
          const result = await response.json();
          setStudentData(result.student);
          setBusData(result.bus);
          setRouteData(result.route);
          setDriverData(result.driver);
          setTripActive(result.tripActive);

          // Calculate expiry if present
          if (result.student?.validUntil) {
            const expiryDate = result.student.validUntil.seconds 
              ? new Date(result.student.validUntil.seconds * 1000)
              : new Date(result.student.validUntil);
            const diffDays = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            setDaysUntilExpiry(diffDays);
          }
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [currentUser]);

  // Automatic Payment Recovery Trigger (Phase 4)
  useEffect(() => {
    if (!currentUser || !studentData) return;

    const isOnlinePayment = studentData?.paymentInfo?.paymentMode?.toLowerCase() === 'online' ||
                            studentData?.paymentMode?.toLowerCase() === 'online';
    const isPending = studentData?.status === 'pending' || studentData?.status === 'submitted' || !studentData?.status;

    if (isOnlinePayment && isPending) {
      console.log('🔄 Triggering automatic online payment recovery from dashboard...');
      authApiFetch(currentUser, '/api/payment/recover')
      .then(res => res.json())
      .then(data => {
        const { status } = data;
        if (status === 'success' || status === 'already_processed') {
          console.log('✅ Payment recovered successfully! Refreshing dashboard...');
          window.location.reload();
        } else if (status === 'processing' || status === 'verification_pending') {
          // Silent — student can go to renew page for details
          console.log(`[Dashboard Recovery] status=${status} — silent, recovery ongoing`);
        } else {
          // failed / not_found — do nothing, don't alarm the student
          console.log(`[Dashboard Recovery] status=${status} — no action needed`);
        }
      })
      .catch(err => {
        console.error('❌ Payment recovery check failed:', err);
      });
    }
  }, [currentUser, studentData]);

  // REALTIME SUBSCRIPTIONS — WebSocket primary + 5s active trip check fallback
  useEffect(() => {
    const busId = studentData?.bus_id || studentData?.busId || busData?.id || busData?.busId || busData?.bus_id;
    if (!busId || !currentUser) return;

    let wsClient: WebSocketClient | null = null;
    let isCancelled = false;

    const checkActiveTrip = async () => {
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`/api/student/trip-status?busId=${encodeURIComponent(busId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (response.ok) {
          const result = await response.json();
          if (!isCancelled) {
            setTripActive(result.tripActive);
          }
        }
      } catch (err) {
        console.error('Error checking active trip on dashboard:', err);
      }
    };

    // Run active trip check immediately
    checkActiveTrip();

    // Fast 5s interval check as fallback
    const interval = setInterval(checkActiveTrip, 5000);

    const init = async () => {
      try {
        const token = await currentUser.getIdToken();
        if (isCancelled) return;
        const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${window.location.hostname}:3001/ws`;
        wsClient = new WebSocketClient({ url, token });
        wsClient.connect();

        wsClient.subscribe(`trip-status-${busId}`, (payload: any) => {
          const data = payload.payload || payload;
          const eventType = data.event || payload.event;
          if (eventType === 'trip_started' || data.status === 'active') {
            setTripActive(true);
          } else if (eventType === 'trip_ended' || data.status === 'ended') {
            setTripActive(false);
          }
        });
      } catch (err) {
        console.warn('Dashboard WS init failed:', err);
      }
    };

    init();

    return () => {
      isCancelled = true;
      clearInterval(interval);
      wsClient?.disconnect();
    };
  }, [studentData?.bus_id, studentData?.busId, busData?.id, busData?.busId, busData?.bus_id, currentUser]);


  useEffect(() => {
    if (userData && userData.role !== "student") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  // Note: Expiration checking is handled by AuthContext's isExpired state
  // No need for additional blocking logic here as it's already handled in StudentAuthWrapper

  if (loading) {
    return <PremiumPageLoader message="Loading Dashboard" subMessage="Preparing your student portal..." />;
  }

  // Extract key information with better fallbacks
  const hasPayment = studentData?.paymentInfo?.amountPaid > 0 || studentData?.amountPaid > 0;
  const paymentAmount = studentData?.paymentInfo?.amountPaid || studentData?.amountPaid || 0;
  const paymentVerified = studentData?.paymentInfo?.paymentVerified || studentData?.paymentVerified;
  // If student is approved (status === 'active'), payment should be considered approved
  const isPaymentApproved = paymentVerified || (studentData?.status === 'active' && hasPayment);
  const validUntil = studentData?.validUntil ? new Date(studentData.validUntil) : null;
  // Display-only hint for the renewal banner. NOT used for transport gating.
  const isExpired = validUntil ? validUntil < new Date() : false;
  // CANONICAL entitlement (Phase 3) — the single answer the dashboard uses to gate
  // every transport feature (QR generation, Track Bus / View Pass actions).
  const transportEntitled = getTransportEntitlement(studentData ?? userData).entitled;
  const rawStudentName = studentData?.fullName || studentData?.name || userData?.name || 'Student';
  const studentName = rawStudentName;
  const studentFirstName = rawStudentName.trim().split(/\s+/)[0];
  const studentShift = studentData?.shift || 'Not Set';

  // Get session years properly
  const sessionStartYear = studentData?.sessionStartYear || studentData?.sessionHistory?.[0]?.start;
  const sessionEndYear = studentData?.sessionEndYear || studentData?.sessionHistory?.[0]?.end;

  return (
    <>
      <div className="min-h-screen bg-[#0a0f1f] relative overflow-hidden">
        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-blue-400/10 rounded-full blur-3xl animate-blob" />
          <div className="absolute top-40 right-10 w-72 h-72 bg-purple-400/10 rounded-full blur-3xl animate-blob animation-delay-2000" />
          <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-cyan-400/10 rounded-full blur-3xl animate-blob animation-delay-4000" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-6 space-y-6 relative z-10">

          {/* Premium Header Section with Enhanced Gradient & Glass Morphism */}
          <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 p-[1px] md:p-[2px] animate-fade-in shadow-xl md:shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 opacity-20 blur-2xl animate-pulse" />
            <div className="relative bg-white/98 dark:bg-gray-900/98 backdrop-blur-2xl rounded-2xl md:rounded-3xl p-4 md:p-8">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 md:gap-6">
                <div className="space-y-3 md:space-y-4 w-full lg:w-auto">
                  <div className="flex items-start gap-3 md:gap-4">
                    <div className="relative p-2 md:p-3 rounded-xl md:rounded-2xl bg-gradient-to-br from-purple-500 via-blue-600 to-cyan-500 shadow-lg flex-shrink-0 mt-1 md:mt-0">
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-500 via-blue-600 to-cyan-500 rounded-xl md:rounded-2xl blur-md opacity-50" />
                      <GraduationCap className="h-5 w-5 md:h-7 md:w-7 text-white relative z-10" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h1 className="text-xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent leading-tight break-words">
                        <span className="hidden md:inline">Welcome back, {studentFirstName}!</span>
                        <span className="inline md:hidden">Welcome {studentFirstName}!</span>
                      </h1>
                      <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1 font-medium">
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                  </div>

                  {/* Status Badges with Enhanced Design - Compact Grid on Mobile */}
                  <div className="flex flex-wrap items-center gap-2 md:gap-3 pl-0 md:pl-[4.5rem]">
                    <Badge className={`px-2.5 py-1 md:px-4 md:py-1.5 text-xs md:text-sm font-semibold shadow-sm md:shadow-lg backdrop-blur-sm ${studentData?.status === 'active'
                      ? 'bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 dark:from-green-900/40 dark:to-emerald-900/40 dark:text-green-400 border border-green-200 dark:border-green-800'
                      : studentData?.status === 'verified_upcoming'
                      ? 'bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-700 dark:from-indigo-900/40 dark:to-purple-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                      : studentData?.status === 'pending_seat_allocation'
                      ? 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 dark:from-amber-900/40 dark:to-orange-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      : 'bg-gradient-to-r from-yellow-100 to-orange-100 text-yellow-700 dark:from-yellow-900/40 dark:to-orange-900/40 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                      }`}>
                      <span className={`inline-block w-1.5 h-1.5 md:w-2 md:h-2 rounded-full mr-1.5 md:mr-2 ${studentData?.status === 'active' ? 'bg-green-500 animate-pulse' : studentData?.status === 'verified_upcoming' ? 'bg-indigo-500 animate-pulse' : 'bg-yellow-500'
                        }`} />
                      {studentData?.status === 'active' ? 'Active' :
                        studentData?.status === 'verified_upcoming' ? 'Verified (Upcoming Session)' :
                        studentData?.status === 'pending_seat_allocation' ? 'Seat Queue Active' :
                        studentData?.status === 'soft_blocked' ? 'Soft blocked' :
                        studentData?.status || 'Submitted'}
                    </Badge>
                    {studentData?.semester && (
                      <Badge variant="outline" className="px-2.5 py-1 md:px-4 md:py-1.5 text-xs md:text-sm bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-gray-300 dark:border-gray-700 shadow-sm">
                        <BookOpen className="h-3 w-3 mr-1 md:mr-1.5" />
                        {studentData.semester}
                      </Badge>
                    )}
                    {studentData?.shift && (
                      <Badge variant="outline" className="px-2.5 py-1 md:px-4 md:py-1.5 text-xs md:text-sm bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-gray-300 dark:border-gray-700 shadow-sm">
                        <Clock className="h-3 w-3 mr-1 md:mr-1.5" />
                        {studentData.shift.toString().replace(/\s*Shift\s*$/i, '')} Shift
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Premium Action Buttons — Phase 3: transport actions appear only
                    while the student owns transport access. Non-entitled students
                    are guided to renewal or application status. */}
                {transportEntitled ? (
                  <div className="grid grid-cols-2 sm:flex sm:flex-row gap-3 w-full lg:w-auto mt-2 lg:mt-0">
                    <Link href="/student/track-bus" className="w-full sm:w-auto">
                      <Button className="w-full sm:w-auto group relative overflow-hidden bg-gradient-to-r from-purple-500 via-blue-600 to-cyan-500 hover:from-purple-600 hover:via-blue-700 hover:to-cyan-600 text-white font-semibold shadow-lg hover:shadow-cyan-500/50 transform hover:-translate-y-0.5 transition-all duration-300 h-10 md:h-11 text-xs md:text-sm">
                        <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
                        <span className="relative flex items-center justify-center">
                          <Navigation className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                          Track Bus
                        </span>
                      </Button>
                    </Link>
                    <Link href="/student/bus-pass" className="w-full sm:w-auto">
                      <Button className="w-full sm:w-auto group relative overflow-hidden bg-gradient-to-r from-cyan-500 via-teal-600 to-emerald-500 hover:from-cyan-600 hover:via-teal-700 hover:to-emerald-600 text-white font-semibold shadow-lg hover:shadow-teal-500/50 transform hover:-translate-y-0.5 transition-all duration-300 h-10 md:h-11 text-xs md:text-sm">
                        <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
                        <span className="relative flex items-center justify-center">
                          <QrCode className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                          View Pass
                        </span>
                      </Button>
                    </Link>
                  </div>
                ) : studentData?.status === 'verified_upcoming' || studentData?.status === 'pending_seat_allocation' || studentData?.status === 'submitted' ? (
                  <Link href={`/apply/status/${studentData?.applicationId || studentData?.uid || ''}`} className="w-full lg:w-auto mt-2 lg:mt-0">
                    <Button className="w-full sm:w-auto group relative overflow-hidden bg-gradient-to-r from-indigo-500 via-purple-600 to-blue-600 hover:from-indigo-600 hover:via-purple-700 hover:to-blue-700 text-white font-semibold shadow-lg transform hover:-translate-y-0.5 transition-all duration-300 h-10 md:h-11 text-xs md:text-sm">
                      <span className="relative flex items-center justify-center">
                        <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                        View Application Status
                      </span>
                    </Button>
                  </Link>
                ) : (
                  <Link href="/student/renew-services" className="w-full lg:w-auto mt-2 lg:mt-0">
                    <Button className="w-full sm:w-auto group relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-600 to-red-500 hover:from-amber-600 hover:via-orange-700 hover:to-red-600 text-white font-semibold shadow-lg transform hover:-translate-y-0.5 transition-all duration-300 h-10 md:h-11 text-xs md:text-sm">
                      <span className="relative flex items-center justify-center">
                        <RefreshCcw className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                        Renew Service
                      </span>
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Renewal Alert - Prominent for Expired or Expiring Soon */}
          {isExpired && (
            <div className="bg-gradient-to-r from-red-50 via-orange-50 to-red-50 dark:from-red-900/20 dark:via-orange-900/20 dark:to-red-900/20 border-2 border-red-400 dark:border-red-600 rounded-2xl p-6 shadow-xl">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500 rounded-xl shadow-lg">
                  <AlertCircle className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-red-900 dark:text-red-200 mb-1">
                    Service Expired - Action Required
                  </h3>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
                    Your bus pass expired on {validUntil?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-400 mb-4">
                    Renew now to restore access to Track Bus and other services. After you pay, your renewal is reviewed and approved by an administrator — access is restored once it&apos;s approved.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link href="/student/renew-services" className="flex-1">
                      <Button className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold shadow-lg" size="lg">
                        <RefreshCcw className="mr-2 h-5 w-5" />
                        Renew Service Now
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Warning for Services Expiring Soon (30 days or less) */}
          {!isExpired && daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 30 && (
            <div className={`rounded-2xl p-5 shadow-lg border-2 ${daysUntilExpiry <= 7
              ? 'bg-gradient-to-r from-red-50 via-orange-50 to-yellow-50 dark:from-red-900/20 dark:via-orange-900/20 dark:to-yellow-900/20 border-red-400 dark:border-red-600'
              : 'bg-gradient-to-r from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-900/20 dark:via-amber-900/20 dark:to-orange-900/20 border-yellow-400 dark:border-yellow-600'
              }`}>
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl shadow-lg ${daysUntilExpiry <= 7 ? 'bg-red-500' : 'bg-yellow-500'
                  }`}>
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className={`text-lg font-bold mb-1 ${daysUntilExpiry <= 7
                    ? 'text-red-900 dark:text-red-200'
                    : 'text-yellow-900 dark:text-yellow-200'
                    }`}>
                    {daysUntilExpiry <= 7 ? '⚠️ Urgent: ' : ''}Renewal Reminder
                  </h3>
                  <p className={`text-sm font-medium mb-2 ${daysUntilExpiry <= 7
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-yellow-800 dark:text-yellow-300'
                    }`}>
                    Your bus pass expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''} on {validUntil?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <p className={`text-sm mb-4 ${daysUntilExpiry <= 7
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-yellow-700 dark:text-yellow-400'
                    }`}>
                    Renew early to avoid service interruption. Online renewal available with instant activation after admin approval.
                  </p>
                  <Link href="/student/renew-services">
                    <Button className={`font-semibold shadow-lg ${daysUntilExpiry <= 7
                      ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700'
                      : 'bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-700 hover:to-amber-700'
                      } text-white`} size="lg">
                      <RefreshCcw className="mr-2 h-5 w-5" />
                      Renew Service
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Premium Stats Grid - Mobile Optimized */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 lg:gap-8 animate-slide-in-up">
            {/* Current Status Card - Uses tripActive from Supabase driver_status (dynamic) */}
            <div className="group cursor-pointer h-full">
              <Card className={`relative overflow-hidden border-2 border-white shadow-lg hover:shadow-xl md:hover:shadow-2xl transition-all duration-500 hover:scale-[1.02] h-full ${tripActive
                ? 'border-green-400/50 shadow-green-500/20 bg-gradient-to-br from-emerald-900/40 via-green-900/40 to-teal-900/40' // Active Green Theme - Trip is running
                : 'hover:shadow-green-500/30 bg-gradient-to-br from-orange-100 via-yellow-50 to-amber-50 dark:from-orange-900/40 dark:via-yellow-950/40 dark:to-amber-950/30' // Idle Orange Theme - No active trip
                }`}>
                <div className={`absolute inset-0 transition-all duration-500 rounded-lg ${tripActive
                  ? 'bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10 animate-pulse' // Active Glow
                  : 'bg-gradient-to-br from-orange-500/5 via-yellow-500/5 to-amber-500/5 md:group-hover:from-orange-500/15 md:group-hover:via-yellow-500/15 md:group-hover:to-amber-500/15'
                  }`} />

                <CardContent className="p-3 md:p-4 lg:p-6 relative z-10 h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-2 md:mb-3">
                    <div className="space-y-0.5 md:space-y-1 flex-1 min-w-0">
                      <p className="text-[10px] md:text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Current Status
                      </p>
                      <p className={`text-lg md:text-2xl lg:text-3xl font-black bg-clip-text text-transparent leading-tight transition-all duration-500 ${tripActive
                        ? 'bg-gradient-to-r from-green-400 to-emerald-300 drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]' // Glowing Green Text
                        : 'bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 md:group-hover:from-orange-600 md:group-hover:to-amber-600'
                        }`}>
                        {tripActive ? 'EnRoute' : 'Idle'}
                      </p>
                      <p className={`text-[10px] md:text-xs transition-colors duration-500 ${tripActive
                        ? 'text-green-300 font-medium'
                        : 'text-gray-600 dark:text-gray-400 md:group-hover:text-orange-600 dark:md:group-hover:text-orange-400'
                        }`}>
                        {tripActive ? 'Bus is on the way' : 'No active trip'}
                      </p>
                    </div>
                    <div className="relative ml-2 flex-shrink-0">
                      <div className={`relative p-2 md:p-2.5 lg:p-3 rounded-xl shadow-lg transition-all duration-500 ${tripActive
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/50 animate-pulse' // Active Green Icon
                        : 'bg-gradient-to-br from-gray-500 to-gray-600 md:group-hover:shadow-xl md:group-hover:scale-110 md:group-hover:from-orange-500 md:group-hover:to-amber-600'
                        }`}>
                        {tripActive ? (
                          <Activity className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 text-white" />
                        ) : (
                          <Bus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 text-white" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`px-2 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-semibold shadow-md text-center transition-all duration-500 ${tripActive
                    ? 'bg-green-500 text-white shadow-green-500/30' // Active Badge
                    : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 dark:from-gray-800 dark:to-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-700 md:group-hover:scale-110 md:group-hover:from-orange-100 md:group-hover:to-amber-100 md:group-hover:text-orange-700'
                    }`}>
                    {tripActive ? 'Active' : busData?.status || 'Idle'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Shift & Timing Card - Vibrant with Desktop Hover */}
            <div className="group cursor-pointer h-full">
              <Card className="relative overflow-hidden border-2 border-white shadow-lg hover:shadow-xl md:hover:shadow-2xl md:hover:shadow-purple-500/30 bg-gradient-to-br from-white via-purple-50/40 to-pink-50/30 dark:from-gray-900 dark:via-purple-950/40 dark:to-pink-950/30 transition-all duration-500 hover:scale-[1.02] h-full">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-pink-500/5 to-rose-500/5 md:group-hover:from-purple-500/15 md:group-hover:via-pink-500/15 md:group-hover:to-rose-500/15 transition-all duration-500 rounded-lg" />

                <CardContent className="p-3 md:p-4 lg:p-6 relative z-10 h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-2 md:mb-3">
                    <div className="space-y-0.5 md:space-y-1 flex-1 min-w-0">
                      <p className="text-[10px] md:text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Shift Timing
                      </p>
                      <p className="text-lg md:text-2xl lg:text-3xl font-black bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 md:group-hover:from-purple-600 md:group-hover:to-pink-600 bg-clip-text text-transparent leading-tight transition-all duration-500">
                        {studentShift !== 'Not Set' ? studentShift.toString().replace(/\s*Shift\s*$/i, '') : studentShift}
                      </p>
                      <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400 md:group-hover:text-purple-600 dark:md:group-hover:text-purple-400 truncate transition-colors duration-500">
                        {studentShift.toString().toLowerCase().includes('morning') ? '9:00 AM - 4:00 PM' : studentShift.toString().toLowerCase().includes('evening') ? '1:00 PM - 7:00 PM' : 'Not scheduled'}
                      </p>
                    </div>
                    <div className="relative ml-2 flex-shrink-0">
                      <div className="relative p-2 md:p-2.5 lg:p-3 rounded-xl shadow-lg md:group-hover:shadow-xl md:group-hover:scale-110 transition-all duration-500 bg-gradient-to-br from-purple-500 to-pink-600">
                        <Clock className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 text-white" />
                      </div>
                    </div>
                  </div>

                  <div className={`px-2 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-semibold shadow-md text-center md:group-hover:scale-110 transition-all duration-500 ${studentShift !== 'Not Set'
                    ? 'bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 dark:from-purple-900/40 dark:to-pink-900/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800'
                    : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 dark:from-gray-800 dark:to-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                    }`}>
                    {studentShift !== 'Not Set' ? 'Scheduled' : 'Not Set'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Bus Operator Card - Vibrant with Desktop Hover */}
            <div className="group cursor-pointer h-full">
              <Card className="relative overflow-hidden border-2 border-white shadow-lg hover:shadow-xl md:hover:shadow-2xl md:hover:shadow-cyan-500/30 bg-gradient-to-br from-cyan-100 via-blue-50 to-teal-50 dark:from-cyan-900/40 dark:via-blue-950/40 dark:to-teal-950/30 transition-all duration-500 hover:scale-[1.02] h-full">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-teal-500/5 md:group-hover:from-cyan-500/15 md:group-hover:via-blue-500/15 md:group-hover:to-teal-500/15 transition-all duration-500 rounded-lg" />

                <CardContent className="p-3 md:p-4 lg:p-6 relative z-10 h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-2 md:mb-3">
                    <div className="space-y-0.5 md:space-y-1 flex-1 min-w-0">
                      <p className="text-[10px] md:text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Bus Operator
                      </p>
                      <p className="text-lg md:text-2xl lg:text-3xl font-black bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 md:group-hover:from-cyan-600 md:group-hover:to-teal-600 bg-clip-text text-transparent leading-tight transition-all duration-500 truncate">
                        {driverData ? (driverData.fullName || driverData.name || 'Not Set') : 'Not Assigned'}
                      </p>
                      <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400 md:group-hover:text-cyan-600 dark:md:group-hover:text-cyan-400 truncate transition-colors duration-500">
                        {driverData ? (() => {
                          if (!driverData.joiningDate) return 'Service duration unknown';
                          try {
                            const joiningDate = new Date(driverData.joiningDate);
                            const now = new Date();
                            const diffTime = now.getTime() - joiningDate.getTime();
                            const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);

                            if (diffYears < 1) {
                              const diffMonths = Math.floor(diffYears * 12);
                              return diffMonths === 0 ? 'Joined recently' : `Served ${diffMonths} month${diffMonths !== 1 ? 's' : ''}`;
                            }

                            const years = Math.floor(diffYears);
                            return `Served ${years} year${years !== 1 ? 's' : ''}`;
                          } catch (e) {
                            return 'Service duration unknown';
                          }
                        })() : 'No driver assigned'}
                      </p>
                    </div>
                    <div className="relative ml-2 flex-shrink-0">
                      <div className="relative p-2 md:p-2.5 lg:p-3 rounded-xl shadow-lg md:group-hover:shadow-xl md:group-hover:scale-110 transition-all duration-500 bg-gradient-to-br from-cyan-500 to-teal-600">
                        <User className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 text-white" />
                      </div>
                    </div>
                  </div>

                  <div className={`px-2 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-semibold shadow-md text-center md:group-hover:scale-110 transition-all duration-500 ${driverData
                    ? 'bg-gradient-to-r from-cyan-100 to-teal-100 text-cyan-700 dark:from-cyan-900/40 dark:to-teal-900/40 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800'
                    : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 dark:from-gray-800 dark:to-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                    }`}>
                    {driverData ? 'Assigned' : 'Not Set'}
                  </div>
                </CardContent>
              </Card>
            </div>


            {/* Route Stops Card - Vibrant with Desktop Hover */}
            <div className="group cursor-pointer h-full">
              <Card className="relative overflow-hidden border-2 border-white shadow-lg hover:shadow-xl md:hover:shadow-2xl md:hover:shadow-cyan-500/30 bg-gradient-to-br from-pink-100 via-rose-50 to-red-50 dark:from-pink-900/40 dark:via-rose-950/40 dark:to-red-950/30 transition-all duration-500 hover:scale-[1.02] h-full">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-rose-500/5 to-red-500/5 md:group-hover:from-pink-500/15 md:group-hover:via-rose-500/15 md:group-hover:to-red-500/15 transition-all duration-500 rounded-lg" />

                <CardContent className="p-3 md:p-4 lg:p-6 relative z-10 h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between mb-2 md:mb-3">
                    <div className="space-y-0.5 md:space-y-1 flex-1 min-w-0">
                      <p className="text-[10px] md:text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Route Stops
                      </p>
                      <p className="text-lg md:text-2xl lg:text-3xl font-black bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 md:group-hover:from-pink-600 md:group-hover:to-rose-600 bg-clip-text text-transparent leading-tight transition-all duration-500">
                        {routeData?.stops ? routeData.stops.length : 0}
                      </p>
                      <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400 md:group-hover:text-pink-600 dark:md:group-hover:text-pink-400 transition-colors duration-500">
                        Total stops on route
                      </p>
                    </div>
                    <div className="relative ml-2 flex-shrink-0">
                      <div className="relative p-2 md:p-2.5 lg:p-3 rounded-xl shadow-lg md:group-hover:shadow-xl md:group-hover:scale-110 transition-all duration-500 bg-gradient-to-br from-pink-500 to-rose-600">
                        <MapPin className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 text-white" />
                      </div>
                    </div>
                  </div>

                  <div className={`px-2 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-semibold shadow-md text-center md:group-hover:scale-110 transition-all duration-500 ${routeData?.stops && routeData.stops.length > 0
                    ? 'bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 dark:from-pink-900/40 dark:to-rose-900/40 dark:text-pink-400 border border-pink-200 dark:border-pink-800'
                    : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 dark:from-gray-800 dark:to-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                    }`}>
                    {routeData?.stops && routeData.stops.length > 0 ? 'Available' : 'No Route'}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bus Assigned - Exact Driver Design */}
          <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-[1.01] bg-gradient-to-br from-white to-blue-50/30 dark:from-gray-900 dark:to-blue-950/20 border-2 border-blue-100 dark:border-blue-900/30">
            {/* Top gradient accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

            {/* Decorative background pattern */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity duration-500" />

            <CardHeader className="pb-3 sm:pb-4 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-4">
                  {/* Animated icon */}
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl blur-md opacity-50 group-hover:blur-lg transition-all duration-300" />
                    <div className="relative p-2 sm:p-3 rounded-lg sm:rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg group-hover:scale-110 transition-all duration-300">
                      <Bus className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white group-hover:bg-gradient-to-r group-hover:from-blue-600 group-hover:to-purple-600 group-hover:bg-clip-text group-hover:text-transparent transition-all duration-300">Bus Assigned</h3>
                    <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 font-medium mt-0.5">Complete information</p>
                  </div>
                </div>

                {/* Active Badge */}
                <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors text-[10px] sm:text-xs px-2 py-0.5">
                  <Info className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
                  {busData ? 'Assigned' : 'Pending'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {(busData || routeData) ? (
                <div className="space-y-4">

                  {/* Enhanced Details Grid - 2 columns on mobile, 3 on tablet, 6 on desktop */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6 mb-3 sm:mb-5">

                    {/* 1. ROUTE */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <Navigation className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-500" />
                        Route
                      </p>
                      <p className="text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400 group-hover/item:text-blue-700 dark:group-hover/item:text-blue-300 transition-colors truncate">
                        {busData ? `Route-${busData.id?.replace('bus_', '') || busData.busId?.replace('bus_', '') || 'N/A'}` : 'N/A'}
                      </p>
                    </div>

                    {/* 2. BUS (Bus-X) */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <Bus className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-indigo-500" />
                        Bus
                      </p>
                      <p className="text-xs sm:text-sm font-bold text-indigo-600 dark:text-indigo-400 group-hover/item:text-indigo-700 dark:group-hover/item:text-indigo-300 transition-colors truncate">
                        {busData ? `Bus-${busData.busId?.replace('bus_', '') || busData.id?.replace('bus_', '') || 'X'}` : 'N/A'}
                      </p>
                    </div>

                    {/* 3. BUS NUMBER (License Plate) */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <CreditCard className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-purple-500" />
                        Bus No.
                      </p>
                      <p className="text-xs sm:text-sm font-bold text-purple-600 dark:text-purple-400 group-hover/item:text-purple-700 dark:group-hover/item:text-purple-300 transition-colors truncate">
                        {busData?.busNumber || busData?.id || 'N/A'}
                      </p>
                    </div>

                    {/* 4. COLOUR */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <div className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <div className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-gradient-to-br from-red-500 to-yellow-500" />
                        Color
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white group-hover/item:text-gray-700 dark:group-hover/item:text-gray-300 transition-colors truncate">
                        {busData?.color || busData?.busColor || 'N/A'}
                      </p>
                    </div>

                    {/* 5. CAPACITY */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-green-500" />
                        Capacity
                      </p>
                      <p className="text-xs sm:text-sm font-bold text-green-600 dark:text-green-400 group-hover/item:text-green-700 dark:group-hover/item:text-green-300 transition-colors truncate">
                        {busData?.totalCapacity ? `${busData.currentMembers || 0}/${busData.totalCapacity}` : busData?.capacity || 'N/A'}
                      </p>
                    </div>

                    {/* 6. STATUS */}
                    <div className="group/item space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
                        <Activity className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-500" />
                        Status
                      </p>
                      <Badge className={`text-[10px] sm:text-xs font-bold ${busData?.status === 'active' ? 'bg-green-500 text-white' :
                        busData?.status === 'inactive' ? 'bg-red-500 text-white' :
                          busData?.status === 'maintenance' ? 'bg-yellow-500 text-white' :
                            'bg-gray-500 text-white'
                        }`}>
                        {busData?.status || 'N/A'}
                      </Badge>
                    </div>
                  </div>

                  {/* Enhanced Divider */}
                  <div className="relative my-4 sm:my-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                    </div>
                    <div className="relative flex justify-start">
                      <span className="bg-gray-50 dark:bg-gray-800 pr-3 text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Route Details
                      </span>
                    </div>
                  </div>

                  {/* All Stops - Horizontal Scroll */}
                  {routeData?.stops && routeData.stops.length > 0 ? (
                    <div>
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                        <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 dark:text-blue-400" />
                        <p className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">All Stops</p>
                        <Badge variant="secondary" className="text-[10px] sm:text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5">
                          {routeData.stops.length} stops
                        </Badge>
                      </div>

                      {/* Horizontal scrollable stops container */}
                      <div className="relative">
                        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
                          {(typeof routeData.stops[0] === 'object' ?
                            routeData.stops.map((stop: any, idx: number) => (
                              <div key={idx} className="flex-shrink-0">
                                <div className="flex items-center gap-1.5 sm:gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 min-w-fit group-hover:from-blue-100 dark:group-hover:from-blue-900/30 group-hover:to-indigo-100 dark:group-hover:to-indigo-900/30 transition-all duration-300">
                                  <div className="flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 bg-blue-500 text-white text-[10px] sm:text-xs font-bold rounded-full">
                                    {idx + 1}
                                  </div>
                                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {stop.name || stop}
                                  </span>
                                </div>
                              </div>
                            )) :
                            routeData.stops.map((stop: any, idx: number) => (
                              <div key={idx} className="group/stop flex-shrink-0">
                                <div className="flex items-center gap-3 bg-gradient-to-br from-white to-blue-50/50 dark:from-gray-800 dark:to-blue-900/30 border border-blue-200/50 dark:border-blue-700/50 rounded-xl px-4 py-3 min-w-fit shadow-sm hover:shadow-md transition-all duration-300 group-hover/stop:from-blue-50 group-hover/stop:to-indigo-50 dark:group-hover/stop:from-blue-900/40 dark:group-hover/stop:to-indigo-900/40">
                                  <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-bold rounded-full shadow-md group-hover/stop:scale-110 transition-all duration-300">
                                    {idx + 1}
                                  </div>
                                  <div>
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap block">
                                      {typeof stop === 'string' ? stop : stop.name || stop.stop_name || `Stop ${idx + 1}`}
                                    </span>
                                    <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap block">
                                      Stop {idx + 1}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Enhanced Gradient Fade Indicators */}
                        <div className="absolute top-0 right-0 w-12 h-full bg-gradient-to-l from-white/90 dark:from-gray-900/90 to-transparent pointer-events-none"></div>
                        <div className="absolute top-0 left-0 w-12 h-full bg-gradient-to-r from-white/90 dark:from-gray-900/90 to-transparent pointer-events-none"></div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="inline-flex p-4 bg-gray-50 dark:bg-gray-800 rounded-full mb-3">
                        <MapPin className="h-6 w-6 text-gray-400 dark:text-gray-600" />
                      </div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No Route Stops Available</p>
                      <p className="text-xs text-gray-500 dark:text-gray-500">Route information will be updated soon</p>
                    </div>
                  )}


                  {/* Premium Action Button */}
                  <Link href="/student/track-bus">
                    <Button className="group w-full relative overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white font-semibold shadow-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300 transform hover:scale-[1.02]">
                      <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
                      <span className="relative flex items-center justify-center">
                        Track Bus <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform duration-300" />
                      </span>
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="inline-flex p-4 bg-gray-50 dark:bg-gray-800 rounded-full mb-3 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-colors duration-300">
                    <Bus className="h-8 w-8 text-gray-400 dark:text-gray-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors duration-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No Bus & Route Assigned</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">Contact admin for assignment</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Grid Layout for Session & Tips */}
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Session Validity Card - Premium Glassmorphism Design */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <Card className="group relative border-0 shadow-2xl hover:shadow-3xl transition-all duration-500 hover:scale-[1.02] bg-gradient-to-br from-[#0a0f1f] to-[#1a2450] bg-opacity-80 backdrop-blur-2xl overflow-hidden rounded-2xl">
                {/* Glassmorphism overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5 rounded-2xl" />

                {/* Neon border glow */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#00ffaa40] via-[#7b61ff40] to-[#00ffaa40] p-[1px]">
                  <div className="w-full h-full bg-gradient-to-br from-[#0a0f1f] to-[#1a2450] rounded-2xl" />
                </div>

                <CardHeader className="pb-2 md:pb-3 pt-3 md:pt-4 px-4 md:px-6 lg:px-8 relative z-10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <div className="relative p-3 md:p-4 rounded-2xl shadow-lg transition-all duration-300 bg-gradient-to-br from-[#00ffaa] to-[#0066ff]">
                          <Timer className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-white group-hover:text-[#00ffaa] transition-colors duration-300 truncate">
                          Session Status
                        </h3>
                        <p className="text-xs md:text-sm text-white/80 font-medium hidden md:block">
                          Bus pass validity tracking
                        </p>
                      </div>
                    </div>

                    <div className="px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold shadow-lg flex-shrink-0 bg-gradient-to-r from-[#00ffaa] to-[#7b61ff] text-white border border-[#00ffaa]/30">
                      Active
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 md:space-y-4 relative z-10 px-4 md:px-6 lg:px-8 pb-3 md:pb-4 lg:pb-5">
                  {/* Days Remaining Circle - Premium with Breathing Animation */}
                  {daysUntilExpiry !== null && (
                    <div className="flex items-center justify-center">
                      <div className="relative">
                        {/* Blurred neon gradient halo behind circle */}
                        <div className="absolute inset-0 rounded-full blur-2xl opacity-80 animate-breathing-glow bg-gradient-to-r from-[#00ffaa] to-[#7b61ff]" />

                        {/* Main Circle with Breathing Glow */}
                        <div className="relative flex items-center justify-center w-24 h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-full bg-gradient-to-br from-[#00ffaa90] to-[#00ffaa40] animate-breathing-glow shadow-[0_0_50px_#00ffaa90] border-2 border-[#00ffaa]/50">
                          {/* Inner content - static white text */}
                          <div className="text-center relative z-10">
                            <div className="space-y-1">
                              <p className="text-2xl md:text-3xl lg:text-4xl font-black text-white leading-none">
                                {daysUntilExpiry > 0 ? daysUntilExpiry : 0}
                              </p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-white/80">
                                {daysUntilExpiry > 0 ? 'Days Remaining' : 'Expired'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Session Details - Premium Info Boxes */}
                  <div className="space-y-2 md:space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                      {/* Session Start Box */}
                      <div className="group relative overflow-hidden bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-[#00ffaa40] hover:border-[#00ffaa60] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-[#00ffaa]/20">
                        <div className="relative z-10">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="p-1.5 rounded-md bg-gradient-to-br from-[#00ffaa] to-[#0066ff] shadow-sm">
                              <Calendar className="h-3 w-3 text-white" />
                            </div>
                            <span className="text-[10px] md:text-xs font-semibold text-[#00ffaa] uppercase tracking-wide">Session Start</span>
                          </div>
                          <p className="text-sm md:text-base font-bold text-white">
                            {sessionStartYear || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Session End Box */}
                      <div className="group relative overflow-hidden bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-[#ff6b6b40] hover:border-[#ff6b6b60] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-[#ff6b6b]/20">
                        <div className="relative z-10">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="p-1.5 rounded-md bg-gradient-to-br from-[#ff6b6b] to-[#ff8e8e] shadow-sm">
                              <Calendar className="h-3 w-3 text-white" />
                            </div>
                            <span className="text-[10px] md:text-xs font-semibold text-[#ff6b6b] uppercase tracking-wide">Session End</span>
                          </div>
                          <p className="text-sm md:text-base font-bold text-white">
                            {sessionEndYear || 'N/A'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Duration and Valid Until Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                      {/* Duration Box */}
                      <div className="group relative overflow-hidden bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-[#4ecdc440] hover:border-[#4ecdc460] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-[#4ecdc4]/20">
                        <div className="relative z-10">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="p-1.5 rounded-md bg-gradient-to-br from-[#4ecdc4] to-[#26a69a] shadow-sm">
                              <Timer className="h-3 w-3 text-white" />
                            </div>
                            <span className="text-[10px] md:text-xs font-semibold text-[#4ecdc4] uppercase tracking-wide">Duration</span>
                          </div>
                          <p className="text-sm md:text-base font-bold text-white">
                            {sessionStartYear && sessionEndYear ? `${sessionEndYear - sessionStartYear} years` : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Valid Until Box */}
                      {validUntil && (
                        <div className="group relative overflow-hidden bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-[#ffa72640] hover:border-[#ffa72660] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-[#ffa726]/20">
                          <div className="relative z-10">
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="p-1.5 rounded-md bg-gradient-to-br from-[#ffa726] to-[#ffb74d] shadow-sm">
                                <Calendar className="h-3 w-3 text-white" />
                              </div>
                              <span className="text-[10px] md:text-xs font-semibold text-[#ffa726] uppercase tracking-wide">Valid Until</span>
                            </div>
                            <p className="text-sm md:text-base font-bold text-white mb-4">
                              {validUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Renewal Action */}
                  {daysUntilExpiry !== null && daysUntilExpiry <= 30 && (
                    <div className={`p-4 rounded-xl ${daysUntilExpiry <= 7
                      ? 'bg-red-500/10 border border-red-500/30'
                      : 'bg-yellow-500/10 border border-yellow-500/30'
                      }`}>
                      <div className="flex items-start gap-3 mb-3">
                        <AlertCircle className={`h-5 w-5 mt-0.5 ${daysUntilExpiry <= 7
                          ? 'text-red-400'
                          : 'text-yellow-400'
                          }`} />
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${daysUntilExpiry <= 7
                            ? 'text-red-200'
                            : 'text-yellow-200'
                            }`}>
                            {daysUntilExpiry <= 7 ? 'Urgent: ' : ''}Renewal Required Soon
                          </p>
                          <p className={`text-xs mt-1 ${daysUntilExpiry <= 7
                            ? 'text-red-300'
                            : 'text-yellow-300'
                            }`}>
                            Your bus pass {daysUntilExpiry <= 0 ? 'has expired' : `expires in ${daysUntilExpiry} days`}. Please renew to continue services.
                          </p>
                        </div>
                      </div>
                      <Link href="/student/renew-services">
                        <Button className="group w-full relative overflow-hidden font-semibold shadow-lg" size="sm" variant={daysUntilExpiry <= 7 ? 'destructive' : 'default'}>
                          <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
                          <span className="relative flex items-center justify-center">
                            Renew Now <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform duration-300" />
                          </span>
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>


            {/* Quick Tips Card - Premium Glassmorphism Design */}
            <Card className="group relative border-0 shadow-2xl hover:shadow-3xl transition-all duration-500 hover:scale-[1.02] bg-gradient-to-br from-[#1a0f2f] via-[#2a0f3f] to-[#3a0f2f] bg-opacity-85 backdrop-blur-2xl overflow-hidden rounded-2xl">
              {/* Glassmorphism overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5 rounded-2xl" />

              {/* Warm gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/20 via-orange-500/15 to-red-500/20 rounded-2xl" />

              {/* Neon border glow */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#7b61ff40] via-[#9f7aea40] to-[#7b61ff40] p-[1px]">
                <div className="w-full h-full bg-gradient-to-br from-[#1a0f2f] via-[#2a0f3f] to-[#3a0f2f] rounded-2xl" />
              </div>

              <CardHeader className="pb-3 md:pb-4 pt-3 md:pt-4 px-3 md:px-4 lg:px-6 relative z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <div className="relative flex-shrink-0">
                      <div className="relative p-2 md:p-2.5 lg:p-3 rounded-xl shadow-lg transition-all duration-300 bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500">
                        <Star className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-white group-hover:text-[#7b61ff] transition-colors duration-300 truncate">
                        Quick Tips
                      </h3>
                      <p className="text-[10px] md:text-xs lg:text-sm text-white/80 font-medium hidden md:block">
                        Essential tips for better experience
                      </p>
                    </div>
                  </div>

                  <div className="px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold shadow-lg flex-shrink-0 bg-gradient-to-r from-[#7b61ff] to-[#9f7aea] text-white border border-[#7b61ff]/30">
                    4 Tips
                  </div>
                </div>
              </CardHeader>

              <CardContent className="relative z-10 px-3 md:px-4 lg:px-6 pb-3 md:pb-4 lg:pb-6">
                <div className="space-y-2 md:space-y-3">
                  {/* Tip Cards - Compact */}
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2.5 md:p-3 border border-[#7b61ff]/30 shadow-sm">
                    <div className="flex items-start gap-2 md:gap-2.5">
                      <div className="p-1.5 md:p-2 rounded-md md:rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm flex-shrink-0">
                        <Navigation className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs md:text-sm font-bold text-white mb-0.5">
                          Track Your Bus
                        </h4>
                        <p className="text-[10px] md:text-xs text-white/80 leading-snug">
                          Real-time bus updates and arrival times
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2.5 md:p-3 border border-[#7b61ff]/30 shadow-sm">
                    <div className="flex items-start gap-2 md:gap-2.5">
                      <div className="p-1.5 md:p-2 rounded-md md:rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm flex-shrink-0">
                        <QrCode className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs md:text-sm font-bold text-white mb-0.5">
                          Keep Pass Ready
                        </h4>
                        <p className="text-[10px] md:text-xs text-white/80 leading-snug">
                          Have QR code ready for quick boarding
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2.5 md:p-3 border border-[#7b61ff]/30 shadow-sm">
                    <div className="flex items-start gap-2 md:gap-2.5">
                      <div className="p-1.5 md:p-2 rounded-md md:rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-sm flex-shrink-0">
                        <Bell className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs md:text-sm font-bold text-white mb-0.5">
                          Stay Updated
                        </h4>
                        <p className="text-[10px] md:text-xs text-white/80 leading-snug">
                          Check notifications for service updates
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2.5 md:p-3 border border-[#7b61ff]/30 shadow-sm">
                    <div className="flex items-start gap-2 md:gap-2.5">
                      <div className="p-1.5 md:p-2 rounded-md md:rounded-lg bg-gradient-to-br from-orange-500 to-red-600 shadow-sm flex-shrink-0">
                        <Monitor className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs md:text-sm font-bold text-white mb-0.5">
                          Use Chrome Browser
                        </h4>
                        <p className="text-[10px] md:text-xs text-white/80 leading-snug">
                          For smooth experience and best performance
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Actions - Ultra Premium Compact Design */}
        <div className="space-y-3 md:space-y-5 px-3 md:px-0 mt-15">
          <div className="text-center space-y-1 md:space-y-1.5">
            <h2 className="text-lg md:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-800 dark:from-white dark:via-blue-200 dark:to-purple-200 bg-clip-text text-transparent">
              Quick Actions
            </h2>
            <p className="text-[11px] md:text-sm text-gray-600 dark:text-gray-400 font-medium">
              Access features instantly
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 max-w-6xl mx-auto">
            {/* Track Bus Card */}
            <Link href="/student/track-bus" className="block group h-full">
              <div className="relative overflow-hidden rounded-lg md:rounded-xl cursor-pointer h-full transition-all duration-500 ease-out hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.98] shadow-lg hover:shadow-2xl">
                {/* Gradient Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-600 opacity-90 group-hover:opacity-100 transition-all duration-500 ease-out" />

                {/* Subtle Pattern Overlay */}
                <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                {/* Shimmer Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Content */}
                <div className="relative p-2.5 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center text-center h-full space-y-1.5 md:space-y-2.5">
                    <div className="p-1.5 md:p-2.5 rounded-lg md:rounded-xl bg-white/20 backdrop-blur-sm group-hover:bg-white/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 ease-out shadow-md">
                      <Navigation className="h-4 w-4 md:h-6 md:w-6 text-white" />
                    </div>
                    <div className="space-y-0 md:space-y-0.5">
                      <h4 className="text-xs md:text-base font-bold text-white leading-tight">
                        Track Bus
                      </h4>
                      <p className="text-[9px] md:text-xs text-blue-50/90 font-medium">
                        Real-time tracking
                      </p>
                    </div>
                    <ArrowRight className="h-3 w-3 md:h-4 md:w-4 text-white/80 group-hover:translate-x-2 transition-all duration-500 ease-out" />
                  </div>
                </div>
              </div>
            </Link>

            {/* Notifications Card */}
            <Link href="/student/notifications" className="block group h-full">
              <div className="relative overflow-hidden rounded-lg md:rounded-xl cursor-pointer h-full transition-all duration-500 ease-out hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.98] shadow-lg hover:shadow-2xl">
                {/* Gradient Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-600 opacity-90 group-hover:opacity-100 transition-all duration-500 ease-out" />

                {/* Subtle Pattern Overlay */}
                <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                {/* Shimmer Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Content */}
                <div className="relative p-2.5 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center text-center h-full space-y-1.5 md:space-y-2.5">
                    <div className="p-1.5 md:p-2.5 rounded-lg md:rounded-xl bg-white/20 backdrop-blur-sm group-hover:bg-white/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 ease-out shadow-md">
                      <Bell className="h-4 w-4 md:h-6 md:w-6 text-white" />
                    </div>
                    <div className="space-y-0 md:space-y-0.5">
                      <h4 className="text-xs md:text-base font-bold text-white leading-tight">
                        Notifications
                      </h4>
                      <p className="text-[9px] md:text-xs text-purple-50/90 font-medium">
                        Stay updated
                      </p>
                    </div>
                    <ArrowRight className="h-3 w-3 md:h-4 md:w-4 text-white/80 group-hover:translate-x-2 transition-all duration-500 ease-out" />
                  </div>
                </div>
              </div>
            </Link>

            {/* Bus Pass Card */}
            <Link href="/student/bus-pass" className="block group h-full">
              <div className="relative overflow-hidden rounded-lg md:rounded-xl cursor-pointer h-full transition-all duration-500 ease-out hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.98] shadow-lg hover:shadow-2xl">
                {/* Gradient Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-600 opacity-90 group-hover:opacity-100 transition-all duration-500 ease-out" />

                {/* Subtle Pattern Overlay */}
                <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                {/* Shimmer Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Content */}
                <div className="relative p-2.5 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center text-center h-full space-y-1.5 md:space-y-2.5">
                    <div className="p-1.5 md:p-2.5 rounded-lg md:rounded-xl bg-white/20 backdrop-blur-sm group-hover:bg-white/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 ease-out shadow-md">
                      <QrCode className="h-4 w-4 md:h-6 md:w-6 text-white" />
                    </div>
                    <div className="space-y-0 md:space-y-0.5">
                      <h4 className="text-xs md:text-base font-bold text-white leading-tight">
                        Bus Pass
                      </h4>
                      <p className="text-[9px] md:text-xs text-emerald-50/90 font-medium">
                        Digital pass
                      </p>
                    </div>
                    <ArrowRight className="h-3 w-3 md:h-4 md:w-4 text-white/80 group-hover:translate-x-2 transition-all duration-500 ease-out" />
                  </div>
                </div>
              </div>
            </Link>

            {/* Renew Services Card - Conditional Styling Based on Expiry */}
            <Link href="/student/renew-services" className="block group h-full">
              <div className={`relative overflow-hidden rounded-lg md:rounded-xl cursor-pointer h-full transition-all duration-500 ease-out hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.98] shadow-lg hover:shadow-2xl ${isExpired || (daysUntilExpiry !== null && daysUntilExpiry <= 7)
                ? 'ring-2 ring-red-400 ring-offset-1 dark:ring-offset-gray-900'
                : daysUntilExpiry !== null && daysUntilExpiry <= 30
                  ? 'ring-2 ring-yellow-400 ring-offset-1 dark:ring-offset-gray-900'
                  : ''
                }`}>
                {/* Gradient Background - Changes based on urgency */}
                <div className={`absolute inset-0 opacity-90 group-hover:opacity-100 transition-all duration-500 ease-out ${isExpired || (daysUntilExpiry !== null && daysUntilExpiry <= 7)
                  ? 'bg-gradient-to-br from-red-500 to-orange-600'
                  : daysUntilExpiry !== null && daysUntilExpiry <= 30
                    ? 'bg-gradient-to-br from-orange-500 to-amber-600'
                    : 'bg-gradient-to-br from-amber-500 to-yellow-600'
                  }`} />

                {/* Subtle Pattern Overlay */}
                <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                {/* Shimmer Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Urgent Badge - Ultra Compact */}
                {(isExpired || (daysUntilExpiry !== null && daysUntilExpiry <= 7)) && (
                  <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 z-10">
                    <div className="px-1.5 py-0.5 md:px-2 md:py-0.5 bg-white/95 rounded-full flex items-center gap-0.5 md:gap-1 shadow-md animate-pulse">
                      <div className="w-1 h-1 md:w-1.5 md:h-1.5 bg-red-500 rounded-full" />
                      <span className="text-[9px] md:text-[10px] font-bold text-red-600">URGENT</span>
                    </div>
                  </div>
                )}

                {/* Content */}
                <div className="relative p-2.5 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center text-center h-full space-y-1.5 md:space-y-2.5">
                    <div className="p-1.5 md:p-2.5 rounded-lg md:rounded-xl bg-white/20 backdrop-blur-sm group-hover:bg-white/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 ease-out shadow-md">
                      <RefreshCcw className="h-4 w-4 md:h-6 md:w-6 text-white" />
                    </div>
                    <div className="space-y-0 md:space-y-0.5">
                      <h4 className="text-xs md:text-base font-bold text-white leading-tight">
                        Renew Service
                      </h4>
                      <p className="text-[9px] md:text-xs text-white/90 font-medium">
                        {isExpired
                          ? 'Service expired'
                          : daysUntilExpiry !== null && daysUntilExpiry <= 30
                            ? `${daysUntilExpiry} days left`
                            : 'Extend validity'
                        }
                      </p>
                    </div>
                    <ArrowRight className="h-3 w-3 md:h-4 md:w-4 text-white/80 group-hover:translate-x-2 transition-all duration-500 ease-out" />
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* Bottom Spacing for Better Visual Balance */}
        <div className="pb-8 sm:pb-12"></div>
      </div>

      <StudentQRDisplay
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        studentUid={currentUser?.uid || ''}
        studentName={studentName}
        enrollmentId={studentData?.enrollmentId}
        busNumber={busData?.busNumber || studentData?.busId || studentData?.busId}
        routeName={routeData?.routeName || studentData?.routeId || studentData?.routeId}
        validUntil={studentData?.validUntil}
        isActive={transportEntitled}
      />
    </>
  );
}

