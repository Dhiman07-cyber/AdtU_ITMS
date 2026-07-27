"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Avatar,AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from '@/contexts/toast-context';
import { deleteDriver,getDriverById } from '@/lib/dataService';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { formatDateFlexible } from '@/lib/utils/date-utils';
import {
	AlertCircle,
	ArrowLeft,
	Award,
	Briefcase,
	Bus,
	Calendar,
	CreditCard,
	Edit,
	IdCard,
	Mail,
	Phone,
	Trash2,
	User
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use,useEffect,useState } from "react";

const formatDate = formatDateFlexible;

const calculateAge = (dob: string | undefined) => {
  if (!dob) return null;
  try {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch (error) {
    return null;
  }
};

const calculateExperience = (joiningDate: string | undefined) => {
  if (!joiningDate) return null;
  try {
    const joinDate = new Date(joiningDate);
    const today = new Date();
    let years = today.getFullYear() - joinDate.getFullYear();
    const monthDiff = today.getMonth() - joinDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < joinDate.getDate())) {
      years--;
    }
    return years;
  } catch (error) {
    return null;
  }
};

const formatId = (id: string | undefined) => {
  if (!id) return 'Not Assigned';
  // Convert bus_6 to Bus-6, route_6 to Route-6, etc.
  return id.replace(/^(\w+)_(\d+)$/i, (match, prefix, number) => {
    return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)}-${number}`;
  });
};

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    inactive: { bg: 'bg-gray-500/10 border-gray-500/30', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-500' },
    expired: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.inactive;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
      <span className="text-xs font-medium capitalize">{status || 'Unknown'}</span>
    </div>
  );
};

const InfoCard = ({ icon: Icon, label, value, gradient }: any) => (
  <div className="group relative overflow-hidden rounded-xl bg-white dark:bg-gray-800/50 p-3 shadow-md hover:shadow-lg transition-all duration-300 border border-gray-100 dark:border-gray-700/50">
    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}></div>
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradient} shadow-md`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
      <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 break-words leading-tight">{value}</p>
    </div>
  </div>
);

export default function ViewDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { id } = use(params);
  const [driver, setDriver] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const fetchDriver = async () => {
      try {
        const foundDriver = await getDriverById(id);
        if (foundDriver) {
          setDriver(foundDriver);
        }
      } catch (error) {
        console.error('Error fetching driver:', error);
        addToast('Error fetching driver data', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchDriver();
  }, [id, addToast]);

  const handleEdit = () => {
    router.push(`/admin/drivers/edit/${id}`);
  };

  const handleDelete = () => {
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const success = await deleteDriver(id);

      if (success) {
        addToast('Driver deleted successfully!', 'success');
        setIsDialogOpen(false);
        router.push("/admin/drivers");
      } else {
        addToast('Failed to delete driver', 'error');
      }
    } catch (error) {
      console.error('Error deleting driver:', error);
      addToast('Failed to delete driver', 'error');
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading driver profile..." subMessage="Fetching details..." />;
  }

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900/20 dark:to-indigo-900/20">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-8 inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Driver Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">The driver profile you're looking for doesn't exist or has been removed from the system.</p>
          <Link href="/admin/drivers">
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-xl hover:shadow-2xl transition-all duration-300 px-8 py-6 text-base rounded-2xl">
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Drivers
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12 mt-7 bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-lg md:text-xl font-black text-foreground tracking-tight">Driver Profile</h1>
                <p className="text-xs text-muted-foreground mt-0 hidden md:block">View and manage driver information</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link href="/admin/drivers">
                <Button variant="outline" className="h-7 px-2.5 py-1.5 rounded-lg text-xs shadow-sm bg-white text-black md:bg-transparent md:text-inherit">
                  &lt;- Back
                </Button>
              </Link>
              <Button
                onClick={handleEdit}
                className="hidden md:inline-flex bg-white hover:bg-gray-100 text-black border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Edit className="w-3 h-3 mr-1" />
                Edit Profile
              </Button>
              <Button
                onClick={handleDelete}
                className="hidden md:inline-flex bg-red-600 hover:bg-red-700 text-white px-2.5 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Hero Section - Magazine Style */}
        <div className="mb-5 grid md:grid-cols-[180px_1fr] gap-4 items-start">
          {/* Large Avatar Section */}
          <div className="relative w-32 md:w-full md:h-auto mx-auto md:mx-0">
            <div className="md:sticky md:top-6">
              <div className="relative group">
                {driver.profilePhotoUrl ? (
                  <div className="relative w-full aspect-square rounded-full overflow-hidden shadow-2xl border-2 border-border bg-gradient-to-br from-card to-card/80">
                    <img
                      src={safeImageSrc(driver.profilePhotoUrl)}
                      alt={driver.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <Avatar className="relative w-full aspect-square shadow-xl border-2 border-primary/20 rounded-full">
                    <AvatarFallback className="text-4xl md:text-6xl font-bold bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground rounded-full">
                      {driver.name?.charAt(0) || 'D'}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>

              {/* Mobile: Name & Status below image */}
              <div className="md:hidden mt-6 flex justify-center">
                <StatusBadge status={driver.status || 'active'} />
              </div>
              <div className="md:hidden mt-2 text-center">
                <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mb-1 leading-tight break-words">{driver.fullName || driver.name}</h2>
                <p className="text-sm text-primary font-medium mb-0.5">Professional Driver</p>
                {calculateExperience(driver.joiningDate) && (
                  <p className="text-xs text-muted-foreground">{calculateExperience(driver.joiningDate)} years of experience</p>
                )}
                <div className="mt-2 flex flex-col gap-1.5 items-center">
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 shadow-sm w-fit">
                    <Mail className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-medium text-foreground">{driver.email || 'Not provided'}</span>
                  </div>
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-sm w-fit">
                    <Phone className="w-3 h-3 text-green-600 dark:text-green-400" />
                    <span className="text-[10px] font-medium text-foreground">{driver.phone || 'Not provided'}</span>
                  </div>
                </div>
              </div>

              {/* Desktop: Quick Stats */}
              <div className="hidden md:block mt-3 space-y-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gradient-to-r from-blue-100 via-blue-50 to-cyan-50 dark:from-blue-900/40 dark:via-blue-950/30 dark:to-cyan-950/20 border border-blue-200/60 dark:border-blue-700/40 shadow-sm hover:shadow-md transition-all">
                  <CreditCard className="w-3 h-3 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-muted-foreground">License No.</p>
                    <p className="font-bold truncate text-[10px] text-foreground">{driver.licenseNumber || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gradient-to-r from-amber-100 via-amber-50 to-orange-50 dark:from-amber-900/40 dark:via-amber-950/30 dark:to-orange-950/20 border border-amber-200/60 dark:border-amber-700/40 shadow-sm hover:shadow-md transition-all">
                  <Bus className="w-3 h-3 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-muted-foreground">Assigned Bus</p>
                    <p className="font-bold truncate text-[10px] text-foreground">{formatId(driver.busId || driver.busId)}</p>
                  </div>
                </div>
                <StatusBadge status={driver.status || 'active'} />
              </div>
            </div>
          </div>

          {/* Main Info Section - Desktop only */}
          <div className="hidden md:block space-y-4">
            {/* Name & Title */}
            <div>
              <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mb-1 leading-tight">{driver.fullName || driver.name}</h2>
              <p className="text-sm text-primary font-medium mb-0.5">Professional Driver</p>
              {calculateExperience(driver.joiningDate) && (
                <p className="text-xs text-muted-foreground">{calculateExperience(driver.joiningDate)} years of experience</p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 shadow-sm w-fit">
                  <Mail className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-medium text-foreground">{driver.email || 'Not provided'}</span>
                </div>

                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-sm w-fit">
                  <Phone className="w-3 h-3 text-green-600 dark:text-green-400" />
                  <span className="text-[10px] font-medium text-foreground">{driver.phone || 'Not provided'}</span>
                </div>

              </div>
            </div>


            {/* Quick Stats Grid - Simple Gradients */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2">
              <div className="text-center p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
                <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
                <p className="text-sm font-bold text-foreground mb-0">{calculateAge(driver.dob) || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Age</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
                <Award className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
                <p className="text-sm font-bold text-foreground mb-0">{calculateExperience(driver.joiningDate) || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Years Exp</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50/50 to-rose-100/30 dark:from-rose-950/20 dark:to-rose-900/30 hover:shadow-md transition-all">
                <IdCard className="w-3.5 h-3.5 mx-auto mb-1 text-rose-600 dark:text-rose-400" />
                <p className="text-sm font-bold text-foreground mb-0">{driver.driverId || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Driver ID</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/20 dark:to-amber-900/30 hover:shadow-md transition-all">
                <Bus className="w-3.5 h-3.5 mx-auto mb-1 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-bold text-foreground mb-0">{formatId(driver.busId || driver.busId)}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Bus</p>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 flex items-center justify-center">
          <div className="relative inline-flex items-center gap-3">
            <div className="w-12 h-[1.5px] bg-gradient-to-r from-transparent to-primary/40"></div>
            <div className="px-4 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 shadow-sm">
              <span className="text-xs font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">Detailed Information</span>
            </div>
            <div className="w-12 h-[1.5px] bg-gradient-to-l from-transparent to-primary/40"></div>
          </div>
        </div>

        {/* Personal Details */}
        <div className="mb-4 overflow-hidden rounded-lg border border-purple-200/40 dark:border-purple-800/30 bg-gradient-to-br from-card via-purple-50/10 to-card dark:from-card dark:via-purple-950/10 dark:to-card shadow-md hover:shadow-lg transition-shadow">
          <div className="bg-gradient-to-r from-purple-100/60 via-purple-200/40 to-purple-100/60 dark:from-purple-900/30 dark:via-purple-800/20 dark:to-purple-900/30 px-4 py-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                <User className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" />
              </div>
              <h3 className="text-sm font-bold text-foreground">Personal Details</h3>
            </div>
          </div>
          <div className="p-4">
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Full Name</span>
                <span className="text-foreground font-semibold text-xs">{driver.fullName || driver.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Date of Birth</span>
                <span className="text-foreground font-semibold text-xs">{formatDate(driver.dob)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Email</span>
                <span className="text-foreground font-semibold truncate max-w-xs text-xs">{driver.email}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Phone</span>
                <span className="text-foreground font-semibold text-xs">{driver.phone || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Alternate Phone</span>
                <span className="text-foreground font-semibold text-xs">{driver.altPhone || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Address</span>
                <span className="text-foreground font-semibold text-right text-xs">{driver.address || 'Not Available'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Professional Details - Table Style */}
        <div className="mb-4 overflow-hidden rounded-lg border border-blue-200/40 dark:border-blue-800/30 bg-gradient-to-br from-card via-blue-50/10 to-card dark:from-card dark:via-blue-950/10 dark:to-card shadow-md hover:shadow-lg transition-shadow">
          <div className="bg-gradient-to-r from-blue-100/60 via-blue-200/40 to-blue-100/60 dark:from-blue-900/30 dark:via-blue-800/20 dark:to-blue-900/30 px-4 py-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <Briefcase className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-foreground">Professional Information</h3>
            </div>
          </div>
          <div>
            <div className="divide-y divide-border">
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">License Number</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{driver.licenseNumber || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Driver ID</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{driver.driverId || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Experience</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{calculateExperience(driver.joiningDate) ? `${calculateExperience(driver.joiningDate)} years` : 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Joining Date</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{formatDate(driver.joiningDate)}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Aadhar Number</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{driver.aadharNumber || 'Not provided'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Split Layout - Assignment Details */}
        <div className="mb-5 grid lg:grid-cols-2 gap-4">
          {/* Assignment Info - Compact List */}
          <div className="overflow-hidden rounded-lg bg-gradient-to-br from-card via-green-50/10 to-card dark:from-card dark:via-green-950/10 dark:to-card border border-green-200/40 dark:border-green-800/30 shadow-md hover:shadow-lg transition-all">
            <div className="bg-gradient-to-r from-green-100/60 via-green-200/40 to-green-100/60 dark:from-green-900/30 dark:via-green-800/20 dark:to-green-900/30 px-3 py-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg bg-green-100 dark:bg-green-900/50">
                  <IdCard className="w-3 h-3 text-green-700 dark:text-green-400" />
                </div>
                <h3 className="text-xs font-bold text-foreground">Employment Details</h3>
              </div>
            </div>
            <div className="p-3">
              <div className="space-y-1.5">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Driver ID</p>
                  <p className="text-xs font-bold text-foreground">{driver.driverId || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Joining Date</p>
                  <p className="text-xs font-bold text-foreground">{formatDate(driver.joiningDate)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Assignment - Compact List */}
          <div className="overflow-hidden rounded-lg bg-gradient-to-br from-card via-amber-50/10 to-card dark:from-card dark:via-amber-950/10 dark:to-card border border-amber-200/40 dark:border-amber-800/30 shadow-md hover:shadow-lg transition-all">
            <div className="bg-gradient-to-r from-amber-100/60 via-amber-200/40 to-amber-100/60 dark:from-amber-900/30 dark:via-amber-800/20 dark:to-amber-900/30 px-3 py-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                  <Bus className="w-3 h-3 text-amber-700 dark:text-amber-400" />
                </div>
                <h3 className="text-xs font-bold text-foreground">Assignment</h3>
              </div>
            </div>
            <div className="p-3">
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-xs text-muted-foreground">Assigned Bus</span>
                  <span className="text-xs font-bold text-foreground">{formatId(driver.busId || driver.busId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-muted-foreground">Route</span>
                  <span className="text-xs font-bold text-foreground">{formatId(driver.routeId || driver.routeId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-muted-foreground">Shift</span>
                  <span className="text-xs font-bold text-foreground text-right">{driver.shift || 'Not Assigned'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Admin Info - Minimal Footer Style */}
        <div className="relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-slate-100/50 via-slate-50 to-slate-100/50 dark:from-slate-900/30 dark:via-slate-950/20 dark:to-slate-900/30 border border-slate-200/50 dark:border-slate-700/40 shadow-md">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5"></div>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Approved By</p>
              <p className="text-sm font-semibold text-foreground">{driver.approvedBy || 'System'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created At</p>
              <p className="text-sm font-semibold text-foreground">{formatDate(driver.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Status</p>
              <p className="text-sm font-semibold text-foreground capitalize">{driver.status || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Experience</p>
              <p className="text-sm font-semibold text-foreground">
                {calculateExperience(driver.joiningDate) ? `${calculateExperience(driver.joiningDate)} year(s)` : 'Not Set'}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl rounded-3xl">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
              <AlertCircle className="h-10 w-10 text-white" />
            </div>
            <DialogTitle className="text-2xl font-bold">Delete Driver?</DialogTitle>
            <DialogDescription className="text-base mt-3">
              This will permanently delete <span className="font-semibold text-gray-900 dark:text-white">{driver.name}</span> from the system. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center gap-3 mt-4">
            <Button
              className="rounded-2xl px-6 bg-gray-100 hover:bg-gray-200 text-gray-900 dark:bg-gray-800 dark:hover:bg-gray-700"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-2xl px-6 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white shadow-lg"
              onClick={confirmDelete}
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
