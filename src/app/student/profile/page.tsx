"use client";

import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import {
  User, Mail, Phone, Calendar, GraduationCap, Building, Heart,
  CheckCircle, QrCode, Shield, Home, IndianRupee, Hash,
  BookOpen, Clock, Users, ShieldCheck, AlertTriangle, Camera
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StudentQRDisplay from "@/components/bus-pass/StudentQRDisplay";
import SessionStatusBanner from "@/components/student/SessionStatusBanner";
import { hasTransportEntitlement } from "@/lib/entitlement/transport-entitlement";
import ProfileImageUpdateModal from "@/components/ProfileImageUpdateModal";
import { useToast } from "@/contexts/toast-context";
import Image from "next/image";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { formatDateFlexible } from '@/lib/utils/date-utils';

export default function StudentProfilePage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const [showQRModal, setShowQRModal] = useState(false);
  const [showProfileUpdateModal, setShowProfileUpdateModal] = useState(false);
  const [studentDataFirestore, setStudentDataFirestore] = useState<any>(null);
  const [studentDataLoading, setStudentDataLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [hasPendingProfileUpdate, setHasPendingProfileUpdate] = useState(false);

  // Fetch student data directly from Firestore with proper field mapping
  useEffect(() => {
    const fetchStudentData = async () => {
      if (!currentUser?.uid) return;

      try {
        // Use the dataService to get student data
        const { getStudentByUid } = await import('@/lib/dataService');
        const data = await getStudentByUid(currentUser.uid);

        if (data) {
          // Map the correct field names from Firestore
          setStudentDataFirestore({
            ...data,
            // Ensure correct field mappings
            fullName: data.fullName || data.name,
            busId: data.busId || data.busId,
            routeId: data.routeId || data.routeId,
            status: data.status || 'pending',
            shift: data.shift || 'Not Set',
            stop_name: data.stop_name || data.stop_name || 'Not Set',
            // Preserve paymentAmount and paid_on from dataService
            paymentAmount: data.paymentAmount,
            paid_on: data.paid_on,
            paymentInfo: data.paymentInfo || {
              amountPaid: data.amountPaid || 0,
              paymentVerified: data.paymentVerified || false,
              currency: 'INR'
            }
          });
          // Reset image error state when new data is loaded
          setImageError(false);

          // Check if there's a pending profile update - use API to verify (bypasses permission issues)
          if (data.pendingProfileUpdate && currentUser) {
            try {
              const idToken = await currentUser.getIdToken();
              const response = await fetch('/api/student/check-pending-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  idToken,
                  requestId: data.pendingProfileUpdate
                })
              });

              const result = await response.json();

              if (result.success && result.exists && result.status === 'pending') {
                setHasPendingProfileUpdate(true);
              } else {
                setHasPendingProfileUpdate(false);
              }
            } catch (error) {
              console.error('Error checking pending profile update:', error);
              // If API fails, don't show pending badge
              setHasPendingProfileUpdate(false);
            }
          } else {
            setHasPendingProfileUpdate(false);
          }
        }
      } catch (error) {
        console.error('Error fetching student data:', error);
      } finally {
        setStudentDataLoading(false);
      }
    };

    fetchStudentData();
  }, [currentUser]);

  // Use Firestore data
  const studentData = studentDataFirestore;

  useEffect(() => {
    if (userData && userData.role !== "student") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  const formatDate = formatDateFlexible;

  const formatCurrency = (amount: number | undefined) => {
    if (amount === undefined || amount === null) return '₹0';
    return `₹${amount.toLocaleString()}`;
  };

  // Handle profile image update request (requires driver approval)
  const handleProfileImageUpdate = async (newImageUrl: string) => {
    if (!currentUser) {
      addToast('Please log in to update your profile', 'error');
      return;
    }

    try {
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/student/request-profile-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken,
          newImageUrl,
          fullName: studentData?.fullName,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        addToast('Profile update request sent to your driver for approval', 'success');
        setHasPendingProfileUpdate(true);
      } else {
        throw new Error(result.error || 'Failed to submit request');
      }
    } catch (error: any) {
      console.error('Error requesting profile update:', error);
      addToast(error.message || 'Failed to submit profile update request', 'error');
      throw error; // Re-throw to let the modal handle it
    }
  };

  if (studentDataLoading) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="h-16 w-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400 font-medium">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!studentData) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Card className="max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <User className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-bold mb-2">Profile Not Found</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Your profile data could not be loaded. Please contact support.
            </p>
            <Button onClick={() => router.push('/student')}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sessionExpired = studentData?.validUntil ? new Date(studentData.validUntil) < new Date() : false;

  return (
    <div className="flex-1 min-h-[calc(100dvh-120px)] bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 pt-20 pb-4 md:pt-24 md:pb-6">

        {/* Compact Header with Gradient */}
        <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-purple-700 rounded-xl md:rounded-2xl shadow-lg overflow-hidden mb-4 md:mb-6">
          <div className="relative px-4 py-6 md:px-6 md:py-8">
            <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
              {/* Premium Profile Photo - Static */}
              <div className="relative group">
                <div
                  className="relative h-24 w-24 md:h-32 md:w-32"
                >
                  {/* Multi-layered glow effect */}
                  <div className="absolute inset-[-6px] md:inset-[-8px] rounded-full bg-gradient-to-tr from-white/30 via-purple-300/20 to-blue-300/30 blur-xl opacity-40 transition-opacity"></div>
                  <div className="absolute inset-[-2px] rounded-full bg-gradient-to-tr from-white/60 via-purple-200/40 to-white/60 opacity-60"></div>

                  {/* Glass-morphism container matching the header gradient */}
                  <div className="relative w-full h-full rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-sm border-[3px] border-white/30 p-1 flex items-center justify-center overflow-hidden z-10 shadow-lg">
                    {studentData.profilePhotoUrl && !imageError ? (
                      <div className="w-full h-full rounded-full overflow-hidden ring-2 ring-white/20">
                        <img
                          src={safeImageSrc(studentData.profilePhotoUrl)}
                          alt={studentData.fullName || 'Student'}
                          className="w-full h-full object-cover rounded-full"
                          onError={() => {
                            console.warn('Profile image failed to load');
                            setImageError(true);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-full h-full rounded-full bg-white/10 flex items-center justify-center">
                        <User className="w-10 h-10 md:w-16 md:h-16 text-white/70" />
                      </div>
                    )}

                    {/* Pending indicator */}
                    {hasPendingProfileUpdate && (
                      <div className="absolute inset-0 rounded-full bg-yellow-500/30 flex items-center justify-center">
                        <span className="text-[8px] md:text-[10px] font-medium text-white bg-yellow-600 px-1.5 py-0.5 rounded-full">Pending</span>
                      </div>
                    )}
                  </div>

                  {/* Verified/Status badge - positioned more centered */}
                  <div className={`absolute bottom-0 right-1 md:right-1.5 w-7 h-7 md:w-9 md:h-9 rounded-full border-[3px] md:border-4 border-blue-600 flex items-center justify-center shadow-xl z-20 ${sessionExpired ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-emerald-400 to-teal-500'
                    }`}>
                    {sessionExpired ? <AlertTriangle className="w-3 h-3 md:w-4 md:h-4 text-white" /> : <ShieldCheck className="w-3 h-3 md:w-4 md:h-4 text-white" />}
                  </div>
                </div>
              </div>


              {/* Compact Name and Info */}
              <div className="flex-1 text-center md:text-left">
                <h1 className="text-xl md:text-3xl font-bold text-white mb-1 md:mb-2">
                  {studentData.fullName || 'Student Name'}
                </h1>
                <div className="flex flex-col md:flex-row flex-wrap items-center justify-center md:justify-start gap-2 mb-2 md:mb-3">
                  <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm px-2 md:px-3 py-0.5 text-xs">
                    Student
                  </Badge>
                  <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm px-2 md:px-3 py-0.5 text-xs">
                    {studentData.enrollmentId || 'No ID'}
                  </Badge>
                </div>
                <p className="text-blue-100 text-xs md:text-base">{studentData.email || studentData.emailAddress}</p>
              </div>

              {/* Compact Action Buttons */}
              <div className="flex flex-col gap-2 w-full md:w-auto">
                <Button
                  onClick={() => router.push('/student/bus-pass')}
                  disabled={studentData.status !== 'active'}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed px-3 md:px-4 py-2 text-xs md:text-sm"
                >
                  <QrCode className="mr-1 md:mr-2 h-3 w-3 md:h-4 md:w-4" />
                  Generate Bus Pass
                </Button>
                <Button
                  onClick={() => router.push('/student')}
                  variant="outline"
                  className="bg-gradient-to-r from-orange-500/20 to-pink-500/20 border-white/40 text-white hover:from-orange-500/30 hover:to-pink-500/30 backdrop-blur-sm px-3 py-2 text-xs md:text-sm"
                >
                  Back to Dashboard
                </Button>
              </div>
            </div>

            {/* Compact Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-4 md:mt-6">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2 md:p-3 border border-white/20">
                <div className="text-blue-100 text-[10px] md:text-xs mb-0.5">Session</div>
                <div className="text-white font-semibold text-xs md:text-sm">
                  {studentData.sessionStartYear && studentData.sessionEndYear
                    ? `${studentData.sessionStartYear}-${studentData.sessionEndYear}`
                    : 'Not set'}
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2 md:p-3 border border-white/20">
                <div className="text-blue-100 text-[10px] md:text-xs mb-0.5">Valid Until</div>
                <div className="text-white font-semibold text-xs md:text-sm">{formatDate(studentData.validUntil)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2 md:p-3 border border-white/20">
                <div className="text-blue-100 text-[10px] md:text-xs mb-0.5">Shift</div>
                <div className="text-white font-semibold text-xs md:text-sm">{studentData.shift || 'Not set'}</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2 md:p-3 border border-white/20">
                <div className="text-blue-100 text-[10px] md:text-xs mb-0.5">Status</div>
                <Badge className={`text-xs ${studentData.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`}>
                  {studentData.status === 'active' ? 'Active' : (studentData.status === 'inactive' ? 'Inactive' : studentData.status || 'Unknown')}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Compact Session Status Banner */}
        <div className="mb-3 md:mb-4">
          <SessionStatusBanner
            validUntil={studentData.validUntil}
            onRenewClick={() => {
              alert('Please contact the administration to renew your bus service.');
            }}
          />
        </div>

        {/* Compact Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">

          {/* Left Column */}
          <div className="lg:col-span-2 space-y-3 md:space-y-4">

            {/* Compact Personal Information */}
            <Card className="shadow-md hover:shadow-lg transition-shadow pt-0 bg-gradient-to-br from-orange-50/80 via-red-50/60 to-pink-50/80 dark:from-gray-900/90 dark:via-gray-800/90 dark:to-gray-900/90">
              <CardHeader className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 py-4 md:py-5 px-4 md:px-6 rounded-t-lg border-0">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base text-white">
                  <User className="h-4 w-4 text-white" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-4 !mt-0 !pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  <div className="space-y-2 md:space-y-3">
                    <div className="flex items-start gap-2">
                      <Mail className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0 " />
                      <div className="min-w-0 ">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Email</p>
                        <p className="font-medium text-xs md:text-sm truncate">{studentData.email || studentData.emailAddress || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Phone className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Phone</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.phoneNumber || studentData.phone || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Date of Birth</p>
                        <p className="font-medium text-xs md:text-sm">{formatDate(studentData.dob || studentData.dateOfBirth)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 md:space-y-3">
                    <div className="flex items-start gap-2">
                      <User className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Gender</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.gender || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Heart className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Blood Group</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.bloodGroup || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Home className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Address</p>
                        <p className="font-medium text-xs md:text-sm line-clamp-2">{studentData.address || studentData.location || 'Not provided'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Compact Academic Information */}
            <Card className="shadow-md hover:shadow-lg transition-shadow overflow-y-hidden p-0 bg-gradient-to-br from-purple-50/80 via-pink-50/60 to-purple-50/80 dark:from-gray-900/90 dark:via-gray-800/90 dark:to-gray-900/90">
              <CardHeader className="bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 py-4 md:py-5 px-4 md:px-6 m-0 rounded-t-lg border-0">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base text-white">
                  <GraduationCap className="h-4 w-4 text-white" />
                  Academic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-4 !mt-0 !pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  <div className="space-y-2 md:space-y-3">
                    <div className="flex items-start gap-2">
                      <Hash className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Enrollment ID</p>
                        <p className="font-mono font-bold text-sm md:text-base">{studentData.enrollmentId || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <GraduationCap className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Semester</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.semester || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Shift</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.shift || 'Not set'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 md:space-y-3">
                    <div className="flex items-start gap-2">
                      <Building className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Faculty</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.faculty || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <BookOpen className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Department</p>
                        <p className="font-medium text-xs md:text-sm">{studentData.department || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 mb-5">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Session</p>
                        <p className="font-medium text-xs md:text-sm">
                          {studentData.sessionStartYear && studentData.sessionEndYear
                            ? `${studentData.sessionStartYear}-${studentData.sessionEndYear}`
                            : 'Not set'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>



          </div>

          {/* Right Column */}
          <div className="space-y-3 md:space-y-4">

            {/* Compact Payment Summary */}
            <Card className="shadow-md hover:shadow-lg transition-shadow overflow-y-hidden p-0 bg-gradient-to-br from-green-50/80 via-emerald-50/60 to-teal-50/80 dark:from-gray-900/90 dark:via-gray-800/90 dark:to-gray-900/90">
              <CardHeader className="bg-gradient-to-r from-green-600 via-emerald-500 to-teal-600 py-4 md:py-5 px-4 md:px-6 m-0 rounded-t-lg border-0">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base text-white">
                  <IndianRupee className="h-4 w-4 text-white" />
                  Payment Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-4 space-y-2 md:space-y-3 !mt-0 !pt-0">
                <div className="text-center p-3 md:p-4 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400 mb-1">Amount Paid</p>
                  <p className="text-2xl md:text-3xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(studentData.paymentAmount || studentData.paymentInfo?.amountPaid || 0)}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400">Status</span>
                  <Badge className="bg-green-600 text-xs">
                    Approved
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400">Last paid on</span>
                  <span className="font-medium text-xs md:text-sm">{formatDate(studentData.paid_on) || 'Not Assigned'}</span>
                </div>
              </CardContent>
            </Card>

            {/* Compact Account Information */}
            <Card className="shadow-md hover:shadow-lg transition-shadow overflow-y-hidden p-0 bg-gradient-to-br from-indigo-50/80 via-blue-50/60 to-cyan-50/80 dark:from-gray-900/90 dark:via-gray-800/90 dark:to-gray-900/90">
              <CardHeader className="bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-600 py-4 md:py-5 px-4 md:px-6 m-0 rounded-t-lg border-0">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base text-white">
                  <Shield className="h-4 w-4 text-white" />
                  Account Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 !mt-0 !pt-0">
                <div className="grid grid-cols-2 gap-4 md:gap-6">
                  <div className="space-y-4 md:space-y-5">
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Status</p>
                      <Badge className={`text-xs ${studentData.status === 'active' ? 'bg-green-600' : 'bg-yellow-600'}`}>
                        {studentData.status === 'active' ? 'Active' : (studentData.status === 'inactive' ? 'Inactive' : studentData.status || 'Unknown')}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Valid Until</p>
                      <p className="font-medium text-xs md:text-sm">{formatDate(studentData.validUntil)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Account Type</p>
                      <p className="font-medium text-xs md:text-sm">Student Account</p>
                    </div>
                  </div>
                  <div className="space-y-4 md:space-y-5">
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Approved By</p>
                      <p className="font-medium text-xs md:text-sm">{studentData.approvedBy || 'Not approved yet'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Approved On</p>
                      <p className="font-medium text-xs md:text-sm">{formatDate(studentData.approvedAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mb-1">Account Status</p>
                      <p className="font-medium text-xs md:text-sm">Active & Verified</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Bus Pass QR Modal */}
      {showQRModal && (
        <StudentQRDisplay
          isOpen={showQRModal}
          onClose={() => setShowQRModal(false)}
          studentUid={studentData.uid || currentUser?.uid || ''}
          studentName={studentData.fullName || studentData.name || 'Student'}
          enrollmentId={studentData.enrollmentId}
          busNumber={studentData.busId || studentData.busId}
          routeName={studentData.routeId || studentData.routeId}
          validUntil={studentData.validUntil}
          isActive={hasTransportEntitlement(studentData)}
        />
      )}

      {/* Profile Image Update Modal */}
      <ProfileImageUpdateModal
        isOpen={showProfileUpdateModal}
        onClose={() => setShowProfileUpdateModal(false)}
        currentImageUrl={studentData.profilePhotoUrl}
        onConfirm={handleProfileImageUpdate}
        requiresApproval={true}
      />
    </div>
  );
}
