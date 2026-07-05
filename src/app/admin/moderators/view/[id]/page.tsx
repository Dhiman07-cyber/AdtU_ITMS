"use client";

import { useState, useEffect } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  User,
  Mail,
  Phone,
  Calendar,
  Hash,
  Building,
  Edit,
  Trash2,
  Loader2,
  ArrowLeft,
  Home,
  Briefcase,
  IdCard,
  Shield,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { useToast } from '@/contexts/toast-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getModeratorById, deleteModerator } from '@/lib/dataService';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { formatDateFlexible } from '@/lib/utils/date-utils';

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

const calculateYearsOfService = (joiningDate: string | undefined) => {
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

const StatusBadge = ({ status }: { status: string }) => {
  const currentStatus = (status || 'active').toLowerCase();

  const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    active: {
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-600 dark:text-emerald-400',
      dot: 'bg-emerald-500',
      label: 'Active'
    },
    inactive: {
      bg: 'bg-gray-500/10 border-gray-500/30',
      text: 'text-gray-600 dark:text-gray-400',
      dot: 'bg-gray-500',
      label: 'Inactive'
    },
  };

  const config = statusConfig[currentStatus] || statusConfig.inactive;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
      <span className="text-xs font-medium">{config.label}</span>
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

export default function ViewModeratorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  // Unwrap the params promise using React's use function
  const { id } = use(params);
  const [moderator, setModerator] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Fetch the moderator data
    const fetchModerator = async () => {
      try {
        // Fetch the moderator data from our data service
        const foundModerator = await getModeratorById(id);
        if (foundModerator) {
          setModerator(foundModerator);
        }
      } catch (error) {
        console.error('Error fetching moderator:', error);
        addToast('Error fetching moderator data', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchModerator();
  }, [id, addToast]);

  const handleEdit = () => {
    router.push(`/admin/moderators/edit/${id}`);
  };

  const handleDelete = () => {
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const success = await deleteModerator(id);

      if (success) {
        addToast('Moderator deleted successfully!', 'success');
        setIsDialogOpen(false);
        router.push("/admin/moderators");
      } else {
        addToast('Failed to delete moderator', 'error');
      }
    } catch (error) {
      console.error('Error deleting moderator:', error);
      addToast('Failed to delete moderator', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading moderator profile..." subMessage="Fetching details..." />;
  }

  if (!moderator) {
    return (
      <div className="mt-15 min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20">
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">Moderator not found</h1>
          <Link href="/admin/moderators">
            <Button variant="ghost" className="mt-3 text-sm">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to Moderators
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12 mt-15 bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-lg md:text-xl font-black text-foreground tracking-tight">Moderator Profile</h1>
                <p className="text-xs text-muted-foreground mt-0 hidden md:block">View and manage moderator information</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link href="/admin/moderators">
                <Button variant="outline" className="h-7 px-2.5 py-1.5 rounded-lg text-xs shadow-sm bg-white text-black md:bg-transparent md:text-inherit">
                  &lt;- Back
                </Button>
              </Link>
              <Button
                onClick={handleEdit}
                className="hidden md:inline-flex bg-white hover:bg-gray-100 text-black border border-gray-200 px-3 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Edit className="w-3 h-3 mr-1" />
                Edit Profile
              </Button>
              <Button
                onClick={handleDelete}
                className="hidden md:inline-flex bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Hero Section */}
        <div className="mb-5 grid md:grid-cols-[160px_1fr] gap-4 items-start">
          {/* Avatar Section */}
          <div className="relative w-32 md:w-full md:h-auto mx-auto md:mx-0">
            <div className="md:sticky md:top-6">
              <div className="relative group">
                <div className="relative rounded-full md:rounded-2xl overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 p-1.5 shadow-xl">
                  {moderator.profilePhotoUrl ? (
                    <img
                      src={safeImageSrc(moderator.profilePhotoUrl)}
                      alt={moderator.fullName || moderator.name}
                      className="w-full aspect-square object-cover rounded-full md:rounded-xl"
                    />
                  ) : (
                    <Avatar className="w-full aspect-square rounded-full">
                      <AvatarFallback className="text-4xl font-bold bg-gradient-to-br from-purple-500 to-pink-600 text-white rounded-full">
                        {(moderator.fullName || moderator.name).charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              </div>

              {/* Status Badge */}
              <div className="mt-2.5 flex justify-center">
                <StatusBadge status={moderator.status || 'active'} />
              </div>
            </div>
          </div>

          {/* Main Info Section */}
          <div className="space-y-3">
            {/* Name & Contact */}
            <div className="bg-gradient-to-br from-card via-purple-50/5 to-card dark:from-card dark:via-purple-950/5 dark:to-card rounded-xl p-4 shadow-md border border-border/50">
              <h2 className="text-2xl font-bold text-foreground mb-1">{moderator.fullName || moderator.name}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-r from-purple-50/50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/30 shadow-sm w-fit">
                  <Mail className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                  <span className="text-[10px] font-medium text-foreground">{moderator.email}</span>
                </div>
                {moderator.phone && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-sm w-fit">
                    <Phone className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
                    <span className="text-[10px] font-medium text-foreground">{moderator.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2">
              <div className="text-center p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
                <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
                <p className="text-sm font-bold text-foreground mb-0">{calculateAge(moderator.dob) || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Age</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
                <Briefcase className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
                <p className="text-sm font-bold text-foreground mb-0">{calculateYearsOfService(moderator.joiningDate || moderator.joinDate) || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Years</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50/50 to-rose-100/30 dark:from-rose-950/20 dark:to-rose-900/30 hover:shadow-md transition-all">
                <IdCard className="w-3.5 h-3.5 mx-auto mb-1 text-rose-600 dark:text-rose-400" />
                <p className="text-sm font-bold text-foreground mb-0">{moderator.employeeId || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Emp ID</p>
              </div>
              <div className="text-center p-2 rounded-lg border border-emerald-200/50 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 dark:from-emerald-950/20 dark:to-emerald-900/30 hover:shadow-md transition-all">
                <Shield className="w-3.5 h-3.5 mx-auto mb-1 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-bold text-foreground mb-0">
                  {(() => {
                    const status = moderator.status || 'active';
                    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
                  })()}
                </p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Status</p>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 flex items-center justify-center">
          <div className="relative inline-flex items-center gap-3">
            <div className="w-12 h-[1.5px] bg-gradient-to-r from-transparent to-primary/40"></div>
            <div className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border border-purple-400/30 shadow-md">
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
                <span className="text-foreground font-semibold text-xs">{moderator.fullName || moderator.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Date of Birth</span>
                <span className="text-foreground font-semibold text-xs">{formatDate(moderator.dob)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Email</span>
                <span className="text-foreground font-semibold truncate max-w-xs text-xs">{moderator.email}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">AADHAR Number</span>
                <span className="text-foreground font-semibold text-xs">{moderator.aadharNumber || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Phone</span>
                <span className="text-foreground font-semibold text-xs">{moderator.phone || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground font-medium text-xs">Alternate Phone</span>
                <span className="text-foreground font-semibold text-xs">{moderator.alternatePhone || moderator.altPhone || 'Not Available'}</span>
              </div>
              {moderator.address && (
                <div className="flex justify-between py-1.5 border-b border-border md:col-span-2">
                  <span className="text-muted-foreground font-medium text-xs">Address</span>
                  <span className="text-foreground font-semibold text-right text-xs">{moderator.address}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Professional Details */}
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
                <span className="text-muted-foreground font-medium text-xs">Employee ID</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{moderator.employeeId || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Joining Date</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{formatDate(moderator.joiningDate || moderator.joinDate)}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Years of Service</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{calculateYearsOfService(moderator.joiningDate || moderator.joinDate) ? `${calculateYearsOfService(moderator.joiningDate || moderator.joinDate)} years` : 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Approved By</span>
                <span className="md:col-span-2 text-foreground font-semibold text-xs">{moderator.approvedBy || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium text-xs">Status</span>
                <span className="md:col-span-2"><StatusBadge status={moderator.status || 'active'} /></span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the moderator &quot;{moderator.name}&quot; from the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700 font-medium"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
