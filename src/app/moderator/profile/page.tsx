"use client";

import {
	InfoRow,
	ProfileHeaderCard,
	ProfileShell
} from "@/components/profile/ProfileComponents";
import ProfileImageUpdateModal from "@/components/ProfileImageUpdateModal";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import {
	formatDate,
	getUserProfile,
	ModeratorProfile
} from "@/lib/profile-service";
import {
	Briefcase,Building,
	Calendar,
	Camera,
	Clock,
	Hash,
	Mail,Phone,
	Shield,
	User
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";

export default function ModeratorProfilePage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const [profile, setProfile] = useState<ModeratorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showProfileUpdateModal, setShowProfileUpdateModal] = useState(false);

  useEffect(() => {
    if (userData && userData.role !== "moderator") {
      router.push(`/${userData.role}`);
      return;
    }

    async function fetchProfile() {
      if (!currentUser?.uid) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const data = await getUserProfile(currentUser.uid, 'moderator');

        if (!data) {
          setNotFound(true);
        } else {
          setProfile(data as ModeratorProfile);
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
        setError('Failed to load profile. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [currentUser, userData, router]);

  // Handle direct profile image update (no approval needed for moderators)
  const handleProfileImageUpdate = async (newImageUrl: string) => {
    if (!currentUser) {
      addToast('Please log in to update your profile', 'error');
      return;
    }

    try {
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/update-profile-photo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken,
          targetType: 'moderator',
          targetId: currentUser.uid,
          newImageUrl,
          oldImageUrl: profile?.profilePhotoUrl,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        addToast('Profile photo updated successfully!', 'success');
        // Update local state
        setProfile(prev => prev ? { ...prev, profilePhotoUrl: newImageUrl } : prev);
      } else {
        throw new Error(result.error || 'Failed to update profile photo');
      }
    } catch (error: any) {
      console.error('Error updating profile photo:', error);
      addToast(error.message || 'Failed to update profile photo', 'error');
      throw error;
    }
  };

  // Quick stats for header
  const quickStats = profile ? [
    {
      label: 'Years of Service',
      value: profile.yearsOfService || 'Not available',
      icon: Clock,
    },
    {
      label: 'Employee ID',
      value: profile.employeeId || 'Not set',
      icon: Briefcase,
    },
    {
      label: 'Managing Team',
      value: 'Transportation - AdtU',
      icon: Building,
    },
    {
      label: 'Joined',
      value: formatDate(profile.joiningDate),
      icon: Calendar,
    },
  ] : [];

  // Header actions
  const headerActions = (
    <div className="flex gap-2">
      <Button
        onClick={() => setShowProfileUpdateModal(true)}
        variant="outline"
      >
        <Camera className="h-4 w-4 mr-1" />
        Edit Photo
      </Button>
      <Button
        onClick={() => router.push('/moderator')}
        variant="outline"
      >
        Back to Dashboard
      </Button>
    </div>
  );

  return (
    <ProfileShell loading={loading} error={error} notFound={notFound}>
      {profile && (
        <div className="flex-1 bg-gray-50 dark:bg-gray-950 py-4 sm:py-8 px-2 sm:px-4 pb-12">
          <div className="max-w-7xl mx-auto space-y-0">

            {/* Header Card with Button - Full Width */}
            <div className="mb-6 sm:mb-8">
              <ProfileHeaderCard
                name={profile.fullName}
                role={profile.role}
                email={profile.email}
                profilePhotoUrl={profile.profilePhotoUrl}
                roleBadgeColor="bg-orange-600"
                quickStats={quickStats}
                actions={headerActions}
              />
            </div>

            {/* Main Content Grid - 2 Columns with Mobile Spacing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 px-2 sm:px-0">

              {/* Personal Information */}
              <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01] bg-white dark:bg-gray-900 -mt-2 mb-4 sm:mb-6">
                {/* Vibrant Orange-Red Header */}
                <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 relative -m-6 mb-0">
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-600/90 via-red-600/90 to-pink-600/90" />
                  <div className="relative p-4 sm:p-6 pt-6 sm:pt-8">
                    <div className="flex items-center gap-3 sm:gap-4 ml-4 sm:ml-6 lg:ml-8">
                      <div className="p-2 sm:p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                        <User className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">Personal Information</h3>
                        <p className="text-xs sm:text-sm text-white/90 mt-1">Basic personal details</p>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <InfoRow label="Email" value={profile.email} icon={Mail} />
                    <InfoRow label="Date of Birth" value={formatDate(profile.dob)} icon={Calendar} />
                    <InfoRow label="Phone" value={profile.phone} icon={Phone} />
                    <InfoRow label="Alternate Phone" value={profile.altPhone} icon={Phone} />
                  </div>
                </CardContent>
              </Card>

              {/* Moderator Information */}
              <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01] bg-white dark:bg-gray-900 -mt-2 mb-4 sm:mb-6">
                {/* Vibrant Purple Header */}
                <div className="bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 relative -m-6 mb-0">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-600/90 via-indigo-600/90 to-blue-600/90" />
                  <div className="relative p-4 sm:p-6 pt-6 sm:pt-8">
                    <div className="flex items-center gap-3 sm:gap-4 ml-4 sm:ml-6 lg:ml-8">
                      <div className="p-2 sm:p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                        <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">Moderator Information</h3>
                        <p className="text-xs sm:text-sm text-white/90 mt-1">Service details</p>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <InfoRow label="Joining Date" value={formatDate(profile.joiningDate)} icon={Calendar} />
                    <InfoRow label="Years of Service" value={profile.yearsOfService} icon={Clock} />
                    <InfoRow label="Managing Team" value="Transportation - AdtU" icon={Building} />
                    <InfoRow label="Employee ID" value={profile.employeeId} icon={Briefcase} />
                  </div>
                </CardContent>
              </Card>

              {/* Account Information */}
              <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01] bg-white dark:bg-gray-900 -mt-2 mb-4 sm:mb-6">
                {/* Vibrant Green Header */}
                <div className="bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 relative -m-6 mb-0">
                  <div className="absolute inset-0 bg-gradient-to-r from-green-600/90 via-emerald-600/90 to-teal-600/90" />
                  <div className="relative p-4 sm:p-6 pt-6 sm:pt-8">
                    <div className="flex items-center gap-3 sm:gap-4 ml-4 sm:ml-6 lg:ml-8">
                      <div className="p-2 sm:p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                        <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">Account Information</h3>
                        <p className="text-xs sm:text-sm text-white/90 mt-1">Account details</p>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                  <InfoRow label="Created At" value={formatDate(profile.createdAt)} icon={Calendar} />
                  <InfoRow label="Last Updated" value={formatDate(profile.updatedAt)} icon={Calendar} />
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01] bg-white dark:bg-gray-900 -mt-2 mb-4 sm:mb-6">
                {/* Vibrant Blue Header */}
                <div className="bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-500 relative -m-6 mb-0">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 via-cyan-600/90 to-indigo-600/90" />
                  <div className="relative p-4 sm:p-6 pt-6 sm:pt-8">
                    <div className="flex items-center gap-3 sm:gap-4 ml-4 sm:ml-6 lg:ml-8">
                      <div className="p-2 sm:p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                        <Briefcase className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-white">Service Summary</h3>
                        <p className="text-xs sm:text-sm text-white/90 mt-1">Moderator overview</p>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 rounded-xl border border-orange-200 dark:border-orange-800 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="p-1.5 sm:p-2 rounded-lg bg-orange-100 dark:bg-orange-900/50">
                          <Calendar className="h-3 w-3 sm:h-4 sm:w-4 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-bold text-orange-600 dark:text-orange-400 truncate">
                            {formatDate(profile.joiningDate)}
                          </div>
                          <div className="text-[10px] sm:text-xs text-orange-700 dark:text-orange-300">Joined Date</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 sm:p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-xl border border-green-200 dark:border-green-800 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="p-1.5 sm:p-2 rounded-lg bg-green-100 dark:bg-green-900/50">
                          <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-bold text-green-600 dark:text-green-400 truncate">
                            {profile.yearsOfService || 'N/A'}
                          </div>
                          <div className="text-[10px] sm:text-xs text-green-700 dark:text-green-300">Years of Service</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 sm:p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30 rounded-xl border border-purple-200 dark:border-purple-800 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="p-1.5 sm:p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                          <Building className="h-3 w-3 sm:h-4 sm:w-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-bold text-purple-600 dark:text-purple-400 truncate">
                            Transportation
                          </div>
                          <div className="text-[10px] sm:text-xs text-purple-700 dark:text-purple-300">Managing Team</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 sm:p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 rounded-xl border border-blue-200 dark:border-blue-800 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="p-1.5 sm:p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                          <Hash className="h-3 w-3 sm:h-4 sm:w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400 truncate">
                            {profile.employeeId || 'N/A'}
                          </div>
                          <div className="text-[10px] sm:text-xs text-blue-700 dark:text-blue-300">Employee ID</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Profile Image Update Modal */}
      <ProfileImageUpdateModal
        isOpen={showProfileUpdateModal}
        onClose={() => setShowProfileUpdateModal(false)}
        currentImageUrl={profile?.profilePhotoUrl}
        onConfirm={handleProfileImageUpdate}
        requiresApproval={false}
      />
    </ProfileShell>
  );
}
