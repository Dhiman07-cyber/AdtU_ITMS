"use client";

import {
	InfoRow,
	ProfileHeaderCard,
	ProfileSectionCard,
	ProfileShell
} from "@/components/profile/ProfileComponents";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import {
	AdminProfile,
	formatDate,
	getUserProfile
} from "@/lib/profile-service";
import {
	Briefcase,Building,
	Calendar,Clock,
	Hash,
	Mail,Phone,
	Shield,
	User
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";

export default function AdminProfilePage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (userData && userData.role !== "admin") {
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
        const data = await getUserProfile(currentUser.uid, 'admin');
        
        if (!data) {
          setNotFound(true);
        } else {
          setProfile(data as AdminProfile);
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
      label: 'Assigned Faculty',
      value: profile.assignedFaculty || 'All',
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
    <Button
      onClick={() => router.push('/admin')}
      variant="outline"
    >
      Back to Dashboard
    </Button>
  );

  return (
    <ProfileShell loading={loading} error={error} notFound={notFound}>
      {profile && (
        <div className="mt-12 min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Header Card */}
            <ProfileHeaderCard
              name={profile.fullName}
              role={profile.role}
              email={profile.email}
              profilePhotoUrl={profile.profilePhotoUrl}
              roleBadgeColor="bg-red-600"
              quickStats={quickStats}
              actions={headerActions}
            />

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column - 2/3 width */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Personal Information */}
                <ProfileSectionCard
                  title="Personal Information"
                  description="Basic personal details"
                  icon={User}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    <div className="space-y-3">
                      <InfoRow label="Email" value={profile.email} icon={Mail} />
                      <InfoRow label="Phone" value={profile.phone} icon={Phone} />
                      <InfoRow label="Alternate Phone" value={profile.altPhone} icon={Phone} />
                    </div>
                    <div className="space-y-3">
                      <InfoRow label="Date of Birth" value={formatDate(profile.dob)} icon={Calendar} />
                      <InfoRow label="Employee ID" value={profile.employeeId} icon={Hash} />
                    </div>
                  </div>
                </ProfileSectionCard>

                {/* Administrative Information */}
                <ProfileSectionCard
                  title="Administrative Information"
                  description="Role and service details"
                  icon={Shield}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    <div className="space-y-3">
                      <InfoRow label="Employee ID" value={profile.employeeId} icon={Briefcase} />
                      <InfoRow label="Joining Date" value={formatDate(profile.joiningDate)} icon={Calendar} />
                      <InfoRow label="Years of Service" value={profile.yearsOfService} icon={Clock} />
                    </div>
                    <div className="space-y-3">
                      <InfoRow label="Assigned Faculty" value={profile.assignedFaculty || 'All faculties'} icon={Building} />
                      <InfoRow label="Role" value="Administrator" icon={Shield} />
                    </div>
                  </div>
                </ProfileSectionCard>

                {/* Recent Actions */}
                {profile.recentActions && profile.recentActions.length > 0 && (
                  <ProfileSectionCard
                    title="Recent Activity"
                    description="Last 10 actions performed"
                    icon={Clock}
                  >
                    <div className="space-y-2">
                      {profile.recentActions.map((action, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                          <div>
                            <p className="font-medium">{action.action}</p>
                            {action.target && (
                              <p className="text-xs text-muted-foreground">{action.target}</p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(action.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ProfileSectionCard>
                )}
              </div>

              {/* Right Column - 1/3 width */}
              <div className="space-y-6">
                
                {/* Account Information */}
                <ProfileSectionCard
                  title="Account Information"
                  description="Account details"
                  icon={Shield}
                >
                  <div className="space-y-3">
                    <InfoRow label="User ID" value={profile.uid} icon={Hash} />
                    <InfoRow label="Role" value="Admin" icon={User} />
                    <InfoRow label="Created At" value={formatDate(profile.createdAt)} icon={Calendar} />
                    <InfoRow label="Last Updated" value={formatDate(profile.updatedAt)} icon={Calendar} />
                  </div>
                </ProfileSectionCard>

                {/* Quick Stats */}
                <ProfileSectionCard
                  title="Service Summary"
                  description="Administrative overview"
                  icon={Briefcase}
                  className="border-l-4 border-l-red-500"
                >
                  <div className="space-y-4">
                    <div className="text-center p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {profile.yearsOfService || 'N/A'}
                      </div>
                      <div className="text-sm text-muted-foreground">Years of Service</div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                      <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                        {profile.assignedFaculty || 'All'}
                      </div>
                      <div className="text-sm text-muted-foreground">Assigned Faculty</div>
                    </div>
                  </div>
                </ProfileSectionCard>
              </div>
            </div>
          </div>
        </div>
      )}
    </ProfileShell>
  );
}
