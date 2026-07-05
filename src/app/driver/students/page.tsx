"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  User,
  Phone,
  Mail,
  MapPin,
  Bus,
  Clock,
  CheckCircle,
  XCircle,
  Flag,
  ChevronRight,
  Search,
  Filter,
  X
} from "lucide-react";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { useWaitingFlags } from "@/hooks/useWaitingFlags";
import { getDriverById as getDriverByUid, getStudentsByBusId } from "@/lib/dataService";
import { safeImageSrc } from "@/lib/security/url-sanitizer";

// Custom Image component with fallback
const StudentImage = ({
  src,
  alt,
  size = 64,
  className = ""
}: {
  src?: string;
  alt: string;
  size?: number;
  className?: string;
}) => {
  const sanitizeOptionalImage = (value: string | undefined) => value ? safeImageSrc(value) : undefined;
  const [imgSrc, setImgSrc] = useState(sanitizeOptionalImage(src));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setImgSrc(sanitizeOptionalImage(src));
    setHasError(false);
  }, [src]);

  // Handle Cloudinary URLs properly with minimal optimization
  const processImageUrl = (url: string | undefined) => {
    if (!url) return url;
    const trimmedUrl = url.trim();

    // If it's already a full URL, use it as is
    if (trimmedUrl.startsWith('http')) {
      const safeUrl = safeImageSrc(trimmedUrl);
      // If it's a Cloudinary URL, add minimal optimization parameters
      if (safeUrl.includes('cloudinary.com')) {
        // Only add quality optimization, don't force dimensions
        const separator = safeUrl.includes('?') ? '&' : '?';
        return `${safeUrl}${separator}q_auto,f_auto`;
      }
      return safeUrl;
    }

    // If it's a relative path, it might be from Cloudinary
    if (trimmedUrl.startsWith('/')) {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (cloudName) {
        return safeImageSrc(`https://res.cloudinary.com/${cloudName}/image/upload/q_auto,f_auto${trimmedUrl}`);
      }
    }

    // If it looks like a Cloudinary public ID (no extension or path)
    if (/^[A-Za-z0-9_-]{1,200}$/.test(trimmedUrl)) {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (cloudName) {
        return safeImageSrc(`https://res.cloudinary.com/${cloudName}/image/upload/q_auto,f_auto/${trimmedUrl}`);
      }
    }

    return sanitizeOptionalImage(trimmedUrl);
  };

  const processedSrc = processImageUrl(imgSrc);

  if (!processedSrc || hasError) {
    return (
      <div
        className={`rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center border-2 border-blue-200 dark:border-blue-700 ${className}`}
        style={{ width: size, height: size }}
      >
        <User className={`text-blue-600 dark:text-blue-400`} style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Image
        src={processedSrc}
        alt={alt}
        fill
        sizes={`${size}px`}
        quality={100}
        priority={size > 100}
        unoptimized={false}
        className={`rounded-full object-cover ${className}`}
        style={{
          objectFit: 'cover',
          objectPosition: 'center'
        }}
        onError={() => {
          console.error('❌ Image failed to load:', processedSrc);
          setHasError(true);
        }}
        onLoad={() => {
          console.log('✅ Image loaded successfully:', processedSrc);
        }}
      />
    </div>
  );
};

export default function DriverStudentsPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [driverData, setDriverData] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string>("all");

  // Use Supabase hook for waiting flags - hook expects routeId
  const { flags: waitingFlags, loading: waitingFlagsLoading, error: waitingFlagsError } = useWaitingFlags(driverData?.assignedRouteId || driverData?.routeId || '');

  // Fetch driver data and students on assigned bus
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid) return;

      try {
        // Fetch driver data
        const driver = await getDriverByUid(currentUser.uid);
        console.log('🔍 Driver data fetched:', driver);

        if (driver) {
          setDriverData(driver);

          // Fetch students on assigned bus
          if (driver.assignedBusId) {
            console.log('🚌 Fetching students for bus ID:', driver.assignedBusId);
            const busStudents = await getStudentsByBusId(driver.assignedBusId);
            console.log('👥 Fetched students with profile pictures:', busStudents.map(s => ({
              name: s.fullName || s.name,
              profilePicture: s.profilePicture,
              profilePhotoUrl: s.profilePhotoUrl
            })));
            setStudents(busStudents);
          } else {
            console.log('⚠️ No assigned bus ID for driver:', driver);
          }
        } else {
          console.log('❌ Driver data not found');
          setError("Driver data not found");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser]);

  // Redirect if user is not a driver
  useEffect(() => {
    if (userData && userData.role !== "driver") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  const acknowledgeWaitingFlag = async (flagId: string) => {
    if (!currentUser) return;

    setAcknowledging(flagId);
    try {
      // Get Firebase ID token
      const token = await currentUser.getIdToken();

      // Call ack-waiting API endpoint
      const response = await fetch('/api/ack-waiting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken: token,
          waitingFlagId: flagId
        })
      });

      const result = await response.json();

      if (!result.success) {
        console.error('Failed to acknowledge waiting flag:', result.error);
        // Handle error (show notification, etc.)
      }
    } catch (error) {
      console.error('Error acknowledging waiting flag:', error);
      // Handle error (show notification, etc.)
    } finally {
      setAcknowledging(null);
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading Students" subMessage="Fetching directory..." />;
  }

  if (error) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Students List</CardTitle>
            <CardDescription>Error loading student information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-red-500">
              {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!driverData) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Students List</CardTitle>
            <CardDescription>No driver assignment found</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground">
              You haven't been assigned to a bus yet. Please check back later or contact your administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 pb-24 md:pb-12 bg-gradient-to-br from-background via-blue-50/30 to-purple-50/30 dark:from-gray-950 dark:via-blue-950/20 dark:to-purple-950/20">
      {/* Premium Compact Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-border shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h1 className="text-sm md:text-lg font-bold text-foreground truncate">
                Bus-{driverData?.assignedBusId?.replace('bus_', '').replace('_', '-') || 'N/A'} <span className="text-muted-foreground font-medium ml-1">Directory</span>
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] sm:text-xs">
                <CheckCircle className="h-3 w-3 mr-1" />
                Active
              </Badge>
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-[10px] sm:text-xs font-bold whitespace-nowrap">
                {students.length} Students
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-2 pb-6 space-y-6">
        {/* Waiting Flags - Premium Alert Design */}
        {waitingFlags.length > 0 && (
          <Card className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 dark:from-orange-900/20 dark:via-red-900/20 dark:to-pink-900/20 border-2 border-orange-200 dark:border-orange-800 shadow-xl">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400/5 via-red-400/5 to-pink-400/5 animate-pulse"></div>
            <CardHeader className="bg-gradient-to-r from-orange-100/80 via-red-100/60 to-pink-100/80 dark:from-orange-900/40 dark:via-red-900/30 dark:to-pink-900/40 border-b border-orange-200 dark:border-orange-800 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 shadow-lg flex-shrink-0">
                    <Flag className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg font-bold text-orange-900 dark:text-orange-200">
                      🚨 Students Waiting
                    </CardTitle>
                    <CardDescription className="text-sm text-orange-700 dark:text-orange-300 mt-0.5">
                      {waitingFlags.length} student{waitingFlags.length > 1 ? 's are' : ' is'} waiting at pickup points
                    </CardDescription>
                  </div>
                </div>
                <div className="px-4 py-2 rounded-full bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white font-bold text-lg shadow-lg flex-shrink-0">
                  {waitingFlags.length}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="space-y-3 sm:space-y-4">
                {waitingFlags.map((flag: any) => {
                  const student = students.find(s => s.uid === flag.studentUid);
                  return (
                    <div
                      key={flag.id}
                      className="group/item flex items-center justify-between p-3 sm:p-4 border border-orange-200 dark:border-orange-800 rounded-xl bg-white dark:bg-gray-800 hover:shadow-md transition-all duration-300 gap-2 sm:gap-4"
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0">
                          <StudentImage
                            src={student?.profilePicture}
                            alt={student?.fullName || student?.name || "Student"}
                            size={56}
                            className="border-2 border-orange-300 dark:border-orange-600"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white truncate">{student?.fullName || student?.name || "Unknown"}</p>
                          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-3 mt-1">
                            <div className="flex items-center text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                              <MapPin className="h-3 w-3 sm:h-4 sm:w-4 mr-1 text-orange-500 flex-shrink-0" />
                              <span className="truncate">{flag.stopName || "Waiting"}</span>
                            </div>
                            <div className="flex items-center text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                              <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 text-blue-500 flex-shrink-0" />
                              <span className="truncate">{new Date(flag.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="cursor-pointer transition-all duration-300 whitespace-nowrap bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-lg text-xs sm:text-sm px-2 sm:px-4 py-1.5 sm:py-2 flex-shrink-0"
                        onClick={() => acknowledgeWaitingFlag(flag.id)}
                        disabled={acknowledging === flag.id}
                      >
                        {acknowledging === flag.id ? (
                          <>
                            <div className="h-3 w-3 sm:h-4 sm:w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                          </>
                        ) : (
                          <>
                            <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                            <span className="hidden sm:inline">Ack</span>
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}


        {/* Students List - Premium Grid Design */}
        <Card className="relative overflow-hidden bg-card border border-border shadow-xl">
          <CardHeader className="relative bg-gradient-to-br from-blue-600 via-indigo-700 to-purple-800 dark:from-blue-900 dark:via-indigo-950 dark:to-purple-900 p-6 sm:p-8">
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl"></div>
            </div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-md shadow-2xl flex-shrink-0 border border-white/20">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    Student Directory
                  </CardTitle>
                  <CardDescription className="text-blue-100/80 text-xs sm:text-sm mt-1 font-medium italic">
                    Managing {students.length} explorers on your route
                  </CardDescription>
                </div>
              </div>
              <Badge className="hidden sm:flex bg-white/10 backdrop-blur-md text-white border-white/20 px-4 py-2 text-lg font-black rounded-xl">
                {students.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {/* Search and Filter Section */}
            <div className="mb-4 space-y-3">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or enrollment ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10"
                />
              </div>

              {/* Shift Filter Tabs */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={shiftFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShiftFilter("all")}
                    className={`text-xs h-8 ${shiftFilter === "all" ? "bg-gradient-to-r from-blue-500 to-purple-500 text-white" : ""}`}
                  >
                    All Shifts
                  </Button>
                  <Button
                    variant={shiftFilter === "morning" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShiftFilter("morning")}
                    className={`text-xs h-8 ${shiftFilter === "morning" ? "bg-gradient-to-r from-orange-500 to-yellow-500 text-white" : ""}`}
                  >
                    Morning
                  </Button>
                  <Button
                    variant={shiftFilter === "evening" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShiftFilter("evening")}
                    className={`text-xs h-8 ${shiftFilter === "evening" ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white" : ""}`}
                  >
                    Evening
                  </Button>
                  {(shiftFilter !== "all" || searchTerm) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShiftFilter("all");
                        setSearchTerm("");
                      }}
                      className="h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {(() => {
              // Filter students based on search and shift
              const filteredStudents = students.filter(student => {
                const matchesSearch =
                  !searchTerm ||
                  (student.fullName && student.fullName.toLowerCase().includes(searchTerm.toLowerCase())) ||
                  (student.name && student.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                  (student.enrollmentId && student.enrollmentId.toLowerCase().includes(searchTerm.toLowerCase()));

                const matchesShift = shiftFilter === "all" ||
                  (student.shift && student.shift.toLowerCase().includes(shiftFilter.toLowerCase())) ||
                  (student.assignedShift && student.assignedShift.toLowerCase().includes(shiftFilter.toLowerCase())) ||
                  (student.busShift && student.busShift.toLowerCase().includes(shiftFilter.toLowerCase()));

                return matchesSearch && matchesShift;
              });

              return filteredStudents.length === 0 ? (
                <div className="text-center py-16">
                  <div className="inline-flex p-8 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-3xl mb-6 shadow-lg">
                    <Users className="h-20 w-20 text-gray-400 dark:text-gray-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-3">No Students Assigned</h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    There are no students currently assigned to your bus. Check back later or contact administration.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredStudents.map((student) => (
                    <div
                      key={student.uid}
                      className="group relative overflow-hidden rounded-2xl border border-border bg-card hover:shadow-2xl transition-all duration-300 cursor-pointer"
                      onClick={() => router.push(`/driver/students/${student.uid}`)}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-purple-500/0 to-pink-500/0 group-hover:from-blue-500/5 group-hover:via-purple-500/5 group-hover:to-pink-500/5 transition-all duration-300"></div>

                      {/* Card Content */}
                      <div className="relative p-3 md:p-4">
                        {/* Avatar Section - Compact */}
                        <div className="flex flex-col md:flex-row items-center md:items-start gap-2 md:gap-3 mb-3">
                          <div className="relative flex-shrink-0">
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full opacity-0 group-hover:opacity-100 blur transition-opacity duration-300"></div>
                            <div className="relative w-12 h-12 md:w-14 md:h-14">
                              <StudentImage
                                src={student.profilePicture}
                                alt={student.fullName || student.name || "Student"}
                                size={56}
                                className="border-2 border-border group-hover:border-primary/50 transition-colors"
                              />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 text-center md:text-left">
                            <h3 className="font-bold text-xs md:text-base text-foreground truncate group-hover:text-primary transition-colors">
                              {student.fullName || student.name || "Unknown"}
                            </h3>
                            <div className="inline-block mt-0.5 max-w-full">
                              <p className="text-[9px] md:text-[10px] text-muted-foreground truncate bg-muted/50 px-1.5 py-0.5 rounded-md border border-border/50">
                                {student.enrollmentId || student.studentId || "No ID"}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Info Grid - Compact */}
                        <div className="space-y-1.5 md:space-y-2">
                          <div className="flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
                            <div className="p-1 md:p-1.5 rounded-md bg-blue-500/10 flex-shrink-0">
                              <Mail className="h-3 w-3 md:h-3.5 md:w-3.5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <span className="text-[10px] md:text-xs text-foreground/80 truncate flex-1">{student.email || "No email"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
                            <div className="p-1 md:p-1.5 rounded-md bg-green-500/10 flex-shrink-0">
                              <Phone className="h-3 w-3 md:h-3.5 md:w-3.5 text-green-600 dark:text-green-400" />
                            </div>
                            <span className="text-[10px] md:text-xs text-foreground/80 truncate flex-1">{student.phone || student.phoneNumber || "N/A"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
                            <div className="p-1 md:p-1.5 rounded-md bg-purple-500/10 flex-shrink-0">
                              <MapPin className="h-3 w-3 md:h-3.5 md:w-3.5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <span className="text-[10px] md:text-xs text-foreground/80 truncate flex-1">{student.faculty || "Not specified"}</span>
                          </div>
                        </div>

                        {/* Action Button - Compact */}
                        <Button
                          size="sm"
                          className="w-full mt-2 md:mt-3 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg group-hover:shadow-xl transition-all duration-300 h-7 md:h-8 text-[10px] md:text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/driver/students/${student.uid}`);
                          }}
                        >
                          <span className="hidden md:inline">View Full Profile</span>
                          <span className="md:hidden">View Profile</span>
                          <ChevronRight className="h-3 w-3 md:h-4 md:w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
