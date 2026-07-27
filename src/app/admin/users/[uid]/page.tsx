"use client";

import {
	ActionButtons,
	InfoRow,
	ProfileHeaderCard,
	ProfileSectionCard,
	ProfileShell
} from "@/components/profile/ProfileComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import {
	DriverProfile,
	formatCurrency,
	formatDate,
	getUserProfile,
	isSessionExpired,
	Profile,
	StudentProfile,
	UserRole
} from "@/lib/profile-service";
import {
	Briefcase,
	Building,
	Bus,
	Calendar,
	CheckCircle,
	Clock,
	CreditCard,
	GraduationCap,
	Hash,
	Heart,
	Home,
	IndianRupee,
	Mail,
	MapPin,
	Phone,
	Route as RouteIcon,
	Shield,
	User,
	Users
} from "lucide-react";
import { useParams,useRouter } from "next/navigation";
import { useEffect,useState } from "react";

export default function AdminViewUserProfile() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const params = useParams();
  const uid = params?.uid as string;
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (userData && userData.role !== "admin") {
      router.push(`/${userData.role}`);
      return;
    }
  }, [userData, router]);

  // Fetch the user profile
  useEffect(() => {
    async function fetchProfile() {
      if (!uid) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Try to fetch from all collections
        let data: Profile | null = null;
        for (const role of ['student', 'driver', 'moderator', 'admin'] as UserRole[]) {
          data = await getUserProfile(uid, role);
          if (data) break;
        }
        
        if (!data) {
          setNotFound(true);
        } else {
          setProfile(data);
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
        setError('Failed to load profile. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [uid]);

  const handleEdit = () => {
    // Implement edit functionality
    alert('Edit functionality - to be implemented');
  };

  const handleApprove = () => {
    // Implement approve functionality
    alert('Approve functionality - to be implemented');
  };

  const handleReject = () => {
    // Implement reject functionality
    alert('Reject functionality - to be implemented');
  };

  const handleAssignBus = () => {
    // Implement assign bus functionality
    alert('Assign bus functionality - to be implemented');
  };

  const handleGenerateQR = () => {
    // Implement QR generation
    alert('QR generation - to be implemented');
  };

  // Render based on role
  const renderStudentProfile = (student: StudentProfile) => {
    const sessionExpired = isSessionExpired(student.validUntil);
    
    const quickStats = [
      {
        label: 'Session',
        value: student.sessionStartYear && student.sessionEndYear 
          ? `${student.sessionStartYear}-${student.sessionEndYear}`
          : 'Not set',
        icon: Calendar,
      },
      {
        label: 'Valid Until',
        value: formatDate(student.validUntil),
        icon: Clock,
      },
      {
        label: 'Shift',
        value: student.assignedShift || 'Not assigned',
        icon: Clock,
      },
      {
        label: 'Status',
        value: student.status ? (
          <Badge className={student.status === 'active' ? 'bg-green-600' : 'bg-yellow-600'}>
            {student.status}
          </Badge>
        ) : 'Unknown',
        icon: Shield,
      },
    ];

    const headerActions = (
      <>
        <ActionButtons
          currentUserRole="admin"
          targetRole="student"
          onEdit={handleEdit}
          onApprove={handleApprove}
          onReject={handleReject}
          onAssignBus={handleAssignBus}
          onGenerateQR={handleGenerateQR}
          status={student.status}
        />
        <Button onClick={() => router.push('/admin/students')} variant="outline">
          Back to Students
        </Button>
      </>
    );

    const statusBadge = student.status === 'active' ? (
      <div className="bg-green-500 h-8 w-8 rounded-full border-4 border-white dark:border-gray-900 flex items-center justify-center">
        <CheckCircle className="h-4 w-4 text-white" />
      </div>
    ) : null;

    return (
      <div className="mt-15 min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
        <div className="max-w-7xl mx-auto space-y-6">
          
          <ProfileHeaderCard
            name={student.fullName}
            role={student.role}
            email={student.email}
            profilePhotoUrl={student.profilePhotoUrl}
            roleBadgeColor="bg-blue-600"
            quickStats={quickStats}
            actions={headerActions}
            statusBadge={statusBadge}
          />

          {sessionExpired && (
            <div className="bg-red-50 dark:bg-red-950 border-2 border-red-500 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
                <Clock className="h-5 w-5" />
                <span className="font-semibold">
                  Session Expired — Valid until {formatDate(student.validUntil)}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              
              <ProfileSectionCard title="Personal Information" description="Basic personal details" icon={User}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="space-y-3">
                    <InfoRow label="Email" value={student.email} icon={Mail} />
                    <InfoRow label="Phone" value={student.phone} icon={Phone} />
                    <InfoRow label="Date of Birth" value={formatDate(student.dob)} icon={Calendar} />
                    <InfoRow label="Gender" value={student.gender} icon={User} />
                  </div>
                  <div className="space-y-3">
                    <InfoRow 
                      label="Age" 
                      value={(() => {
                        if (!student.dob) return 'N/A';
                        const birthDate = new Date(student.dob);
                        if (isNaN(birthDate.getTime())) return 'N/A';
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const monthDiff = today.getMonth() - birthDate.getMonth();
                        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                          age--;
                        }
                        return age.toString();
                      })()} 
                      icon={Hash} 
                    />
                    <InfoRow label="Blood Group" value={student.bloodGroup} icon={Heart} />
                    <InfoRow label="Address" value={student.address} icon={Home} />
                  </div>
                </div>
              </ProfileSectionCard>

              <ProfileSectionCard title="Academic Information" description="Student academic details" icon={GraduationCap}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="space-y-3">
                    <InfoRow label="Enrollment ID" value={student.enrollmentId} icon={Hash} />
                    <InfoRow label="Faculty" value={student.faculty} icon={Building} />
                    <InfoRow label="Department" value={student.department} icon={Building} />
                    <InfoRow label="Semester" value={student.semester} icon={GraduationCap} />
                  </div>
                  <div className="space-y-3">
                    <InfoRow 
                      label="Session" 
                      value={student.sessionStartYear && student.sessionEndYear 
                        ? `${student.sessionStartYear}-${student.sessionEndYear}`
                        : 'Not set'
                      } 
                      icon={Calendar} 
                    />
                    <InfoRow 
                      label="Duration" 
                      value={student.durationYears ? `${student.durationYears} years` : 'Not set'} 
                      icon={Clock} 
                    />
                    <InfoRow label="Shift" value={student.assignedShift} icon={Clock} />
                  </div>
                </div>
              </ProfileSectionCard>

              <ProfileSectionCard title="Bus & Route Information" description="Assigned transportation details" icon={Bus}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="space-y-3">
                    <InfoRow 
                      label="Assigned Bus" 
                      value={student.busNumber || student.busId || 'Not assigned'} 
                      icon={Bus}
                      valueClassName={student.busNumber ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''}
                    />
                    <InfoRow label="Bus ID" value={student.busId} icon={Hash} />
                    <InfoRow label="Bus Capacity" value={student.busCapacity} icon={Users} />
                  </div>
                  <div className="space-y-3">
                    <InfoRow 
                      label="Route" 
                      value={student.routeName || student.routeId || 'Not assigned'} 
                      icon={RouteIcon}
                      valueClassName={student.routeName ? 'text-green-600 dark:text-green-400 font-semibold' : ''}
                    />
                    <InfoRow label="Route ID" value={student.routeId} icon={Hash} />
                    <InfoRow label="Stop ID" value={student.stop_name} icon={MapPin} />
                  </div>
                </div>
                {student.route_stops && student.route_stops.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <p className="text-sm text-muted-foreground mb-2">Route Stops:</p>
                    <div className="flex flex-wrap gap-2">
                      {student.route_stops.map((stop, idx) => (
                        <Badge key={idx} variant="outline">{stop}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </ProfileSectionCard>

              <ProfileSectionCard title="Family Information" description="Parent/guardian contact details" icon={Users}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <InfoRow label="Parent Name" value={student.parentName} icon={User} />
                  <InfoRow label="Parent Phone" value={student.parentPhone} icon={Phone} />
                </div>
              </ProfileSectionCard>
            </div>

            <div className="space-y-6">
              <ProfileSectionCard title="Payment Summary" description="Fee payment details" icon={IndianRupee} className="border-l-4 border-l-green-500">
                <div className="space-y-3">
                  <InfoRow 
                    label="Amount Paid" 
                    value={formatCurrency(student.paymentAmount, student.paymentCurrency)} 
                    icon={IndianRupee}
                    valueClassName="text-green-600 dark:text-green-400 font-bold text-lg"
                  />
                  <InfoRow 
                    label="Payment Status" 
                    value={
                      <Badge className={student.paymentVerified ? 'bg-green-600' : 'bg-yellow-600'}>
                        {student.paymentVerified ? 'Verified' : 'Pending verification'}
                      </Badge>
                    }
                    icon={Shield}
                  />
                  <InfoRow label="Currency" value={student.paymentCurrency || 'INR'} icon={Hash} />
                </div>
              </ProfileSectionCard>

              <ProfileSectionCard title="Account Information" description="Account and approval details" icon={Shield}>
                <div className="space-y-3">
                  <InfoRow label="User ID" value={student.uid} icon={Hash} />
                  <InfoRow label="Status" value={
                    <Badge className={student.status === 'active' ? 'bg-green-600' : 'bg-yellow-600'}>
                      {student.status || 'Unknown'}
                    </Badge>
                  } icon={Shield} />
                  <InfoRow label="Valid Until" value={formatDate(student.validUntil)} icon={Calendar} />
                  <InfoRow label="Approved By" value={student.approvedBy} icon={User} />
                  <InfoRow label="Approved At" value={formatDate(student.approvedAt)} icon={Calendar} />
                  <InfoRow label="Created At" value={formatDate(student.createdAt)} icon={Calendar} />
                </div>
              </ProfileSectionCard>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDriverProfile = (driver: DriverProfile) => {
    const quickStats = [
      {
        label: 'Years of Service',
        value: driver.yearsOfService || 'Not available',
        icon: Clock,
      },
      {
        label: 'Shift',
        value: driver.shift || 'Not assigned',
        icon: Clock,
      },
      {
        label: 'Assigned Buses',
        value: driver.busNumbers?.length || 0,
        icon: Bus,
      },
      {
        label: 'Joined',
        value: formatDate(driver.joiningDate),
        icon: Calendar,
      },
    ];

    const headerActions = (
      <>
        <ActionButtons
          currentUserRole="admin"
          targetRole="driver"
          onEdit={handleEdit}
        />
        <Button onClick={() => router.push('/admin/drivers')} variant="outline">
          Back to Drivers
        </Button>
      </>
    );

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
        <div className="max-w-7xl mx-auto space-y-6">
          <ProfileHeaderCard
            name={driver.fullName}
            role={driver.role}
            email={driver.email}
            profilePhotoUrl={driver.profilePhotoUrl}
            roleBadgeColor="bg-purple-600"
            quickStats={quickStats}
            actions={headerActions}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <ProfileSectionCard title="Personal Information" description="Basic personal details" icon={User}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="space-y-3">
                    <InfoRow label="Email" value={driver.email} icon={Mail} />
                    <InfoRow label="Phone" value={driver.phone} icon={Phone} />
                    <InfoRow label="Alternate Phone" value={driver.altPhone} icon={Phone} />
                  </div>
                  <div className="space-y-3">
                    <InfoRow label="Date of Birth" value={formatDate(driver.dob)} icon={Calendar} />
                    <InfoRow label="Driver ID" value={driver.driverId || driver.employeeId} icon={Hash} />
                  </div>
                </div>
              </ProfileSectionCard>

              <ProfileSectionCard title="Driver Information" description="License and service details" icon={CreditCard}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="space-y-3">
                    <InfoRow label="License Number" value={driver.licenseNumber} icon={CreditCard} />
                    <InfoRow label="Joining Date" value={formatDate(driver.joiningDate)} icon={Calendar} />
                    <InfoRow label="Years of Service" value={driver.yearsOfService} icon={Clock} />
                  </div>
                  <div className="space-y-3">
                    <InfoRow label="Shift" value={driver.shift} icon={Clock} />
                    <InfoRow label="Driver ID" value={driver.driverId || driver.employeeId} icon={Briefcase} />
                  </div>
                </div>
              </ProfileSectionCard>

              <ProfileSectionCard title="Assigned Buses" description="Buses under operation" icon={Bus}>
                {driver.busNumbers && driver.busNumbers.length > 0 ? (
                  <div className="space-y-3">
                    {driver.busNumbers.map((busNumber, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Bus className="h-4 w-4 text-blue-600" />
                          <span className="font-semibold text-blue-600 dark:text-blue-400">{busNumber}</span>
                        </div>
                        <Badge variant="outline">Active</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No buses assigned</div>
                )}
              </ProfileSectionCard>

              <ProfileSectionCard title="Assigned Routes" description="Routes under operation" icon={RouteIcon}>
                {driver.routeNames && driver.routeNames.length > 0 ? (
                  <div className="space-y-3">
                    {driver.routeNames.map((routeName, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div className="flex items-center gap-2">
                          <RouteIcon className="h-4 w-4 text-green-600" />
                          <span className="font-semibold text-green-600 dark:text-green-400">{routeName}</span>
                        </div>
                        <Badge variant="outline">Active</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No routes assigned</div>
                )}
              </ProfileSectionCard>
            </div>

            <div className="space-y-6">
              <ProfileSectionCard title="Account Information" description="Account details" icon={Shield}>
                <div className="space-y-3">
                  <InfoRow label="User ID" value={driver.uid} icon={Hash} />
                  <InfoRow label="Role" value="Driver" icon={User} />
                  <InfoRow label="Created At" value={formatDate(driver.createdAt)} icon={Calendar} />
                  <InfoRow label="Last Updated" value={formatDate(driver.updatedAt)} icon={Calendar} />
                </div>
              </ProfileSectionCard>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ProfileShell loading={loading} error={error} notFound={notFound}>
      {profile && (
        <>
          {profile.role === 'student' && renderStudentProfile(profile as StudentProfile)}
          {profile.role === 'driver' && renderDriverProfile(profile as DriverProfile)}
          {profile.role === 'moderator' && <div>Moderator profile view - similar to driver</div>}
          {profile.role === 'admin' && <div>Admin profile view - similar to driver</div>}
        </>
      )}
    </ProfileShell>
  );
}
