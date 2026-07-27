"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Avatar,AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { getStudentById as getStudentByUid } from "@/lib/dataService";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { formatDateFlexible } from '@/lib/utils/date-utils';
import {
	AlertCircle,
	ArrowLeft,
	Bus,
	Calendar,
	Hash,
	Heart,
	Mail,
	MapPin,
	Phone,
	School,
	User,
	Users
} from "lucide-react";
import { useRouter } from "next/navigation";
import { use,useEffect,useState } from "react";

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    inactive: { bg: 'bg-gray-500/10 border-gray-500/30', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-500' },
    expired: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  };
  const config = statusConfig[status?.toLowerCase()] || statusConfig.active;
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text} backdrop-blur-sm`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`}></span>
      <span className="text-xs font-medium capitalize">{status || 'Active'}</span>
    </div>
  );
};

const formatDate = formatDateFlexible;

const calculateAgeFromDob = (dobValue: any): string => {
  if (!dobValue) return 'N/A';
  try {
    let date: Date;
    if (typeof dobValue === 'object' && dobValue !== null && 'seconds' in dobValue) {
      date = new Date(dobValue.seconds * 1000);
    } else if (dobValue && dobValue.toDate && typeof dobValue.toDate === 'function') {
      date = dobValue.toDate();
    } else {
      date = new Date(dobValue);
    }
    if (isNaN(date.getTime())) return 'N/A';
    const currentYear = new Date().getFullYear();
    const birthYear = date.getFullYear();
    return (currentYear - birthYear).toString();
  } catch (error) {
    return 'N/A';
  }
};

const formatId = (id: string | undefined) => {
  if (!id) return 'Not Assigned';
  return id.replace(/^(\w+)_(\d+)$/i, (match, prefix, number) => {
    return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)}-${number}`;
  });
};

export default function DriverStudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { currentUser, userData } = useAuth();
  const router = useRouter();

  // Unwrap the params promise using React's use function
  const { id: studentId } = use(params);

  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch student data
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid || !studentId) return;

      try {
        // Fetch student data
        const studentData = await getStudentByUid(studentId as string);
        if (studentData) {
          setStudent(studentData);
        } else {
          setError("Student data not found");
          return;
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, studentId]);

  // Redirect if user is not a driver
  useEffect(() => {
    if (userData && userData.role !== "driver") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  if (loading) {
    return <PremiumPageLoader message="Loading student profile..." subMessage="Fetching details..." />;
  }

  if (error || !student) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-8 inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Student Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">The student profile you're looking for doesn't exist or you don't have access.</p>
          <Button
            onClick={() => router.push("/driver/students")}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-xl hover:shadow-2xl transition-all duration-300 px-8 py-6 text-base rounded-2xl"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Students
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-[calc(100dvh-120px)] pb-12 bg-gradient-to-br from-background via-background to-muted/20">
      {/* Premium Header */}
      <div className="bg-gradient-to-r from-card via-card to-card/95 border-b border-border shadow-sm backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-accent transition-colors"
                onClick={() => router.push("/driver/students")}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              <div>
                <h1 className="text-lg font-black text-foreground tracking-tight">Student Profile</h1>
                <p className="text-xs text-muted-foreground mt-0">Detailed student information</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Magazine Style */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Hero Section - Enhanced */}
        <div className="mb-5 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 md:gap-6 items-start">
          {/* Large Avatar Section - Mobile Centered */}
          <div className="relative flex justify-center md:block">
            <div className="md:sticky md:top-6 w-full max-w-[240px]">
              <div className="relative group">
                <div className="absolute -inset-4 bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 rounded-3xl blur-2xl opacity-40 group-hover:opacity-60 transition-opacity"></div>
                {student.profilePhotoUrl || student.profilePicture ? (
                  <div className="relative w-full aspect-square rounded-2xl overflow-hidden shadow-2xl border-4 border-border bg-gradient-to-br from-card to-card/80">
                    <img
                      src={safeImageSrc(student.profilePhotoUrl || student.profilePicture)}
                      alt={student.fullName || student.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <Avatar className="relative w-full aspect-square shadow-2xl border-4 border-primary/20 rounded-2xl">
                    <AvatarFallback className="text-8xl font-bold bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground rounded-2xl">
                      {(student.fullName || student.name || 'S').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>

              {/* Quick Stats - Desktop Only */}
              <div className="mt-4 space-y-2 hidden md:flex md:flex-col">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-100 via-emerald-50 to-teal-50 dark:from-emerald-900/40 dark:via-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/60 dark:border-emerald-700/40 shadow-md hover:shadow-lg transition-all w-full">
                  <Hash className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Enrollment</p>
                    <p className="font-bold truncate text-xs text-foreground">{student.enrollmentId || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-100 via-violet-50 to-fuchsia-50 dark:from-violet-900/40 dark:via-violet-950/30 dark:to-fuchsia-950/20 border border-violet-200/60 dark:border-violet-700/40 shadow-md hover:shadow-lg transition-all w-full">
                  <Users className="w-4 h-4 flex-shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Gender</p>
                    <p className="font-bold capitalize text-xs text-foreground">{student.gender || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Info Section */}
          <div className="space-y-4">
            {/* Name & Title - Enhanced Mobile */}
            <div className="text-center md:text-left">
              <h2 className="text-4xl md:text-4xl lg:text-5xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-3 leading-tight">{student.fullName || student.name}</h2>

              {/* Mobile Only: Show Enrollment & Gender below name */}
              <div className="md:hidden flex flex-col items-center gap-2 mb-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-100 via-emerald-50 to-teal-50 dark:from-emerald-900/40 dark:via-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/60 dark:border-emerald-700/40 shadow-md w-full max-w-xs">
                  <Hash className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Enrollment</p>
                    <p className="font-bold truncate text-[10px] text-foreground bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md inline-block">{student.enrollmentId || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-100 via-violet-50 to-fuchsia-50 dark:from-violet-900/40 dark:via-violet-950/30 dark:to-fuchsia-950/20 border border-violet-200/60 dark:border-violet-700/40 shadow-md w-full max-w-xs">
                  <Users className="w-3.5 h-3.5 flex-shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Gender</p>
                    <p className="font-bold capitalize text-xs text-foreground">{student.gender || 'N/A'}</p>
                  </div>
                </div>
              </div>

              <p className="text-base md:text-lg font-bold mb-1">{student.courseDetails || student.department || 'Department'}</p>
              {student.faculty && (
                <p className="text-sm text-muted-foreground font-medium">{student.faculty}</p>
              )}
              <div className="mt-3 flex flex-col items-center md:items-start gap-2">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 shadow-md w-fit">
                  <Mail className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{student.email || 'Not provided'}</span>
                </div>
                {(student.phone || student.phoneNumber) && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-md w-fit">
                    <Phone className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-xs font-semibold text-foreground">{student.phone || student.phoneNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats Grid - Enhanced Mobile */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="text-center p-3 rounded-xl border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-lg transition-all shadow-md">
                <Calendar className="w-5 h-5 mx-auto mb-2 text-purple-600 dark:text-purple-400" />
                <p className="text-base font-bold text-foreground mb-1">{calculateAgeFromDob(student.dob)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Age</p>
              </div>
              <div className="text-center p-3 rounded-xl border-2 border-blue-200/50 dark:border-blue-800/50 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/30 hover:shadow-lg transition-all shadow-md">
                <Bus className="w-5 h-5 mx-auto mb-2 text-blue-600 dark:text-blue-400" />
                <p className="text-base font-bold text-foreground mb-1">{formatId(student.busId)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Bus</p>
              </div>
              <div className="text-center p-3 rounded-xl border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50/50 to-green-100/30 dark:from-green-950/20 dark:to-green-900/30 hover:shadow-lg transition-all shadow-md">
                <MapPin className="w-5 h-5 mx-auto mb-2 text-green-600 dark:text-green-400" />
                <p className="text-base font-bold text-foreground mb-1 capitalize">{student.shift || 'N/A'}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Shift</p>
              </div>
              <div className="text-center p-3 rounded-xl border-2 border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/20 dark:to-amber-900/30 hover:shadow-lg transition-all shadow-md">
                <Heart className="w-5 h-5 mx-auto mb-2 text-amber-600 dark:text-amber-400" />
                <p className="text-base font-bold text-foreground mb-1">{student.bloodGroup || 'N/A'}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Blood</p>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 flex items-center justify-center">
          <div className="relative inline-flex items-center gap-3">
            <div className="w-12 h-[1.5px] bg-gradient-to-r from-transparent to-primary/40"></div>
            <div className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border border-gradient-to-r from-blue-400/30 via-purple-400/30 to-pink-400/30 backdrop-blur-sm shadow-md">
              <span className="text-xs font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">Student Information</span>
            </div>
            <div className="w-12 h-[1.5px] bg-gradient-to-l from-transparent to-primary/40"></div>
          </div>
        </div>

        {/* Personal Details - Enhanced Card */}
        <div className="mb-5 overflow-hidden rounded-2xl border-2 border-purple-200/40 dark:border-purple-800/30 bg-gradient-to-br from-card via-purple-50/10 to-card dark:from-card dark:via-purple-950/10 dark:to-card shadow-xl hover:shadow-2xl transition-shadow">
          <div className="bg-gradient-to-r from-purple-100/60 via-purple-200/40 to-purple-100/60 dark:from-purple-900/30 dark:via-purple-800/20 dark:to-purple-900/30 px-5 py-3 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/50 shadow-md">
                <User className="w-5 h-5 text-purple-700 dark:text-purple-400" />
              </div>
              <h3 className="text-base font-bold text-foreground">Contact Information</h3>
            </div>
          </div>
          <div className="p-5 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Email</span>
                <span className="text-foreground font-bold text-sm break-words">{student.email || 'Not provided'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Phone</span>
                <span className="text-foreground font-bold text-sm">{student.phone || student.phoneNumber || 'Not provided'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Alternate Phone</span>
                <span className="text-foreground font-bold text-sm">{student.alternatePhone || student.alternateNumber || 'Not provided'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Parent Name</span>
                <span className="text-foreground font-bold text-sm">{student.parentName || student.guardianName || 'Not provided'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Parent Phone</span>
                <span className="text-foreground font-bold text-sm">{student.parentPhone || student.guardianPhone || 'Not provided'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-muted-foreground font-semibold text-sm mb-1 sm:mb-0">Address</span>
                <span className="text-foreground font-bold text-sm text-left sm:text-right">{student.address || 'Not provided'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Academic & Transportation Split - Enhanced */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Academic Details - Enhanced */}
          <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-card via-blue-50/10 to-card dark:from-card dark:via-blue-950/10 dark:to-card border-2 border-blue-200/40 dark:border-blue-800/30 shadow-xl hover:shadow-2xl transition-all">
            <div className="bg-gradient-to-r from-blue-100/60 via-blue-200/40 to-blue-100/60 dark:from-blue-900/30 dark:via-blue-800/20 dark:to-blue-900/30 px-5 py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/50 shadow-md">
                  <School className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">Academic Details</h3>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-2 sm:mb-0 uppercase tracking-wide">Faculty</span>
                <span className="text-sm font-bold text-foreground text-left sm:text-right">{student.faculty || 'N/A'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-2 sm:mb-0 uppercase tracking-wide">Department / Course</span>
                <span className="text-sm font-bold text-foreground text-left sm:text-right flex-1 sm:flex-initial sm:max-w-[65%]">{student.courseDetails || student.department || 'N/A'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-2 sm:mb-0 uppercase tracking-wide">Semester</span>
                <span className="text-sm font-bold text-foreground">{student.semester || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Transportation - Enhanced */}
          <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-card via-green-50/10 to-card dark:from-card dark:via-green-950/10 dark:to-card border-2 border-green-200/40 dark:border-green-800/30 shadow-xl hover:shadow-2xl transition-all">
            <div className="bg-gradient-to-r from-green-100/60 via-green-200/40 to-green-100/60 dark:from-green-900/30 dark:via-green-800/20 dark:to-green-900/30 px-5 py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-green-100 dark:bg-green-900/50 shadow-md">
                  <Bus className="w-5 h-5 text-green-700 dark:text-green-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">Transportation</h3>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-1 sm:mb-0">Bus</span>
                <span className="text-sm font-bold text-foreground">{formatId(student.busId)}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-1 sm:mb-0">Route</span>
                <span className="text-sm font-bold text-foreground">{formatId(student.routeId)}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-3 border-b border-border/50">
                <span className="text-sm text-muted-foreground font-semibold mb-1 sm:mb-0">Shift</span>
                <span className="text-sm font-bold text-foreground capitalize">{student.shift || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
