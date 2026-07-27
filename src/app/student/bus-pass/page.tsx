"use client";

/**
 * Student Bus Pass Page
 * 
 * Simplified QR-based bus pass system using student's Firestore UID.
 * 
 * Key Design Decisions:
 * - Fetches student document ONCE when page loads
 * - Stores UID in memory/state
 * - Shows "Show QR Code" button
 * - Instantly displays QR code with student's UID (no additional Firestore reads)
 * - No dynamic token generation - UID is the single source of truth
 */

import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock, Shield, CheckCircle, XCircle,
  ArrowLeft, AlertCircle, Bus, MapPin, Info, CreditCard,
  QrCode
} from "lucide-react";
import Link from "next/link";
import InlineQRDisplay from "@/components/bus-pass/InlineQRDisplay";
import { getStudentByUid, getBusById, getRouteById } from "@/lib/dataService";
import { hasTransportEntitlement } from "@/lib/entitlement/transport-entitlement";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { formatDateFlexible } from '@/lib/utils/date-utils';

export default function StudentBusPassPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [studentData, setStudentData] = useState<any>(null);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Single Firestore read on page load - fetches student document including UID
  useEffect(() => {
    const fetchStudentData = async () => {
      if (!currentUser?.uid) return;

      try {
        const data = await getStudentByUid(currentUser.uid);
        if (data) {
          setStudentData({
            ...data,
            uid: currentUser.uid, // Ensure UID is stored
            fullName: data.fullName || data.name,
            busId: data.busId || data.busId,
            routeId: data.routeId || data.routeId,
            status: data.status || 'pending',
            shift: data.shift || 'Not Set',
            stop_name: data.stop_name || data.stop_name || 'Not Set'
          });

          // Fetch bus and route data for display purposes
          const studentBusId = data.busId || data.busId;
          const studentRouteId = data.routeId || data.routeId;

          if (studentBusId) {
            try {
              const bus = await getBusById(studentBusId);
              if (bus) setBusData(bus);
            } catch (error) {
              console.warn('Failed to fetch bus data:', error);
            }
          }

          if (studentRouteId) {
            try {
              const route = await getRouteById(studentRouteId);
              if (route) setRouteData(route);
            } catch (error) {
              console.warn('Failed to fetch route data:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching student data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStudentData();
  }, [currentUser]);

  useEffect(() => {
    if (userData && userData.role !== "student") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  // Check if session is active
  const isSessionActive = () => {
    if (!studentData?.validUntil) return true; // If no validUntil, assume active
    try {
      const validUntilDate = studentData.validUntil.toDate
        ? studentData.validUntil.toDate()
        : new Date(studentData.validUntil);
      return validUntilDate >= new Date();
    } catch {
      return true;
    }
  };

  // CANONICAL entitlement (Phase 3) — the single source of truth deciding whether
  // a QR / bus pass may be shown. Replaces the old status+validUntil check so this
  // page, the dashboard, the profile, and the server verify endpoints all agree.
  const isActive = hasTransportEntitlement(studentData);

  if (loading) {
    return <PremiumPageLoader message="Loading Bus Pass" subMessage="Fetching your details..." />;
  }

  if (!studentData) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center">
        <Card className="max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-bold mb-2">Profile Not Found</h2>
            <p className="text-muted-foreground mb-4">
              Your profile data could not be loaded. Please contact support.
            </p>
            <Button onClick={() => router.push('/student')}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-blue-500/30 mt-12">
      {/* Dynamic Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-indigo-600/5 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '4s' }} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        {/* Navigation & Header - Optimized for all screens */}
        <div className="flex items-center justify-between gap-4 mb-10 sm:mb-12">
          <div className="flex items-center gap-3">
            <div className="hidden xs:flex p-2 md:p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-inner">
              <CreditCard className="h-5 w-5 md:h-6 md:w-6 text-blue-400" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
                Digital Pass
              </h1>
              <p className="hidden sm:block text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-0.5">AdtU Smart Transport</p>
            </div>
          </div>

          <Link href="/student" className="shrink-0">
            <Button className="h-9 sm:h-11 px-3 sm:px-5 bg-white text-slate-900 hover:bg-slate-100 font-bold text-[10px] sm:text-xs rounded-[14px] shadow-[0_4px_12px_rgba(255,255,255,0.1)] transition-all flex items-center border-none">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5 sm:mr-2 text-slate-900" />
              <span>Back to Dashboard</span>
            </Button>
          </Link>
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: The Pass (Stays sticky on desktop) */}
          <div className="lg:col-span-5 lg:sticky lg:top-8 flex flex-col items-center">
            <InlineQRDisplay
              studentUid={currentUser?.uid || ''}
              studentName={studentData.fullName || studentData.name || 'Student'}
              enrollmentId={studentData.enrollmentId}
              isActive={isActive}
            />

            {/* Status Feedback */}
            <div className="mt-8 w-full max-w-[320px]">
              {studentData.status !== 'active' ? (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-4 backdrop-blur-sm">
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-red-200">Account Inactive</h4>
                    <p className="text-xs text-red-300/60 mt-0.5 leading-relaxed">
                      Your identity verification is pending. Please visit the accounts office.
                    </p>
                  </div>
                </div>
              ) : !isSessionActive() ? (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-4 backdrop-blur-sm">
                  <div className="p-2 bg-amber-500/20 rounded-lg">
                    <Clock className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-200">Service Expired</h4>
                    <p className="text-xs text-amber-300/60 mt-0.5 leading-relaxed">
                      Your semester pass validity has ended. Please renew to continue services.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right Column: Information & Meta */}
          <div className="lg:col-span-7 space-y-8">

            {/* Info Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Identity Hub */}
              <div className="group relative">
                <div className="absolute inset-0 bg-blue-500/5 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative p-6 bg-white/[0.03] border border-white/5 rounded-3xl backdrop-blur-md hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-blue-500/20 rounded-xl">
                      <Shield className="h-5 w-5 text-blue-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white/90">Student Information</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Enrollment</span>
                      <span className="text-sm font-mono font-bold text-blue-300">{studentData.enrollmentId || 'N/A'}</span>
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Allocated Shift</span>
                      <span className="text-sm font-bold text-slate-200">{studentData.shift}</span>
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Stop Point</span>
                      <span className="text-sm font-bold text-slate-200 truncate ml-4 text-right">
                        {studentData.stop_name || 'Not Assigned'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transit Assignment */}
              <div className="group relative">
                <div className="absolute inset-0 bg-purple-500/5 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative p-6 bg-white/[0.03] border border-white/5 rounded-3xl backdrop-blur-md hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-purple-500/20 rounded-xl">
                      <Bus className="h-5 w-5 text-purple-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white/90">Bus Information</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Bus Assigned</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-purple-300">
                          {busData?.busNumber || studentData.busId || 'Not Assigned'}
                        </span>
                      </div>
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Route</span>
                      <span className="text-sm font-bold text-slate-200 truncate ml-4 text-right">
                        {routeData?.routeName || routeData?.name || 'Assigned Zone'}
                      </span>
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Shift</span>
                      <span className="text-sm font-bold text-slate-200">{studentData.shift}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* How to Use Segment */}
            <div className="relative p-8 bg-gradient-to-br from-blue-600/10 via-white/[0.02] to-purple-600/10 border border-white/5 rounded-[2rem] overflow-hidden pt-20 pb-18">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <QrCode className="h-24 w-24" />
              </div>

              <div className="relative z-10">
                <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-black">?</div>
                  Verification Process
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-3">
                    <div className="text-4xl font-black text-white/5 italic">01</div>
                    <h4 className="font-bold text-blue-300">Authentication</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Generate your secure QR using the biometrically-linked "Secure Generate" button.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="text-4xl font-black text-white/5 italic">02</div>
                    <h4 className="font-bold text-purple-300">Validation</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Present the high-fidelity code to the vehicle terminal during boarding operations.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="text-4xl font-black text-white/5 italic">03</div>
                    <h4 className="font-bold text-emerald-300">Confirmation</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Instant verification by the fleet captain allows secure entry and tracking.
                    </p>
                  </div>
                </div>
              </div>
            </div>



          </div>
        </div>
      </div>
    </div>
  );
}
