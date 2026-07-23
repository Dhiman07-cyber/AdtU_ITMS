"use client";

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { useToast } from '@/contexts/toast-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, Camera } from "lucide-react";
import ProfileImageAddModal from "@/components/ProfileImageAddModal";
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import { getAllRoutes, getAllBuses, getDriverById, updateDriver } from '@/lib/dataService';
import { Route, Driver } from '@/lib/types';
import RouteSelect from '@/components/RouteSelect';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';

type DriverFormData = {
  name: string;
  email: string;
  phone: string;
  alternatePhone: string;
  licenseNumber: string;
  aadharNumber: string;
  dob: string;
  joiningDate: string;
  profilePhoto: File | null;
  profilePhotoUrl: string;
  routeId: string;
  busAssigned: string;
  employeeId: string;
  address: string;
  status: 'active' | 'inactive' | 'suspended';
  approvedBy: string;
  shift: string;
};

import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

export default function EditDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: driverId } = use(params);
  const { addToast } = useToast();
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { canDriverEdit, loading: permsLoading } = useModeratorPermissions();

  const [driver, setDriver] = useState<any>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  const [formData, setFormData] = useState<DriverFormData>({
    name: '',
    email: '',
    phone: '',
    alternatePhone: '',
    licenseNumber: '',
    aadharNumber: '',
    dob: '',
    joiningDate: '',
    profilePhoto: null,
    profilePhotoUrl: '',
    routeId: '',
    busAssigned: '',
    employeeId: '',
    address: '',
    status: 'active',
    approvedBy: '',
    shift: 'Both'
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role))) {
      router.push('/login');
    }
  }, [authLoading, currentUser, userData, router]);

  const fetchDriverData = async () => {
    try {
      setLoading(true);
      const [routesData, busesData, foundDriver] = await Promise.all([
        getAllRoutes(),
        getAllBuses(),
        getDriverById(driverId)
      ]);

      setRoutes(routesData);
      setBuses(busesData);

      if (foundDriver) {
        setDriver(foundDriver);

        const initialFormData: DriverFormData = {
          name: foundDriver.fullName || foundDriver.name || '',
          email: foundDriver.email || '',
          phone: foundDriver.phoneNumber || foundDriver.phone || '',
          alternatePhone: foundDriver.alternatePhone || foundDriver.altPhone || '',
          dob: foundDriver.dob || '',
          licenseNumber: foundDriver.licenseNumber || '',
          joiningDate: foundDriver.joiningDate || foundDriver.joinDate || '',
          aadharNumber: foundDriver.aadharNumber || '',
          profilePhoto: null,
          profilePhotoUrl: foundDriver.profilePhotoUrl || '',
          routeId: foundDriver.routeId || foundDriver.routeId || (foundDriver.isReserved ? 'Reserved' : ''),
          busAssigned: foundDriver.busAssigned || foundDriver.busId || '',
          employeeId: foundDriver.employeeId || foundDriver.driverId || '',
          address: foundDriver.address || foundDriver.location || '',
          status: foundDriver.status || 'active',
          approvedBy: foundDriver.approvedBy || '',
          shift: foundDriver.shift || 'Both'
        };

        // If busAssigned is derived from ID, format it correctly
        if (initialFormData.busAssigned && !initialFormData.busAssigned.includes('Bus-')) {
          const bus = busesData.find(b => b.id === initialFormData.busAssigned || b.busId === initialFormData.busAssigned);
          if (bus) {
            const busIdStr = bus.busId || bus.id || '';
            const busNum = busIdStr.includes('_') ? busIdStr.split('_')[1] : busIdStr;
            initialFormData.busAssigned = `Bus-${busNum} (${bus.busNumber})`;
          }
        }

        setFormData(initialFormData);
        if (foundDriver.profilePhotoUrl) {
          setPreviewUrl(foundDriver.profilePhotoUrl);
          setFinalImageUrl(foundDriver.profilePhotoUrl);
        }
      } else {
        addToast('Driver not found', 'error');
        router.push('/moderator/drivers');
      }
    } catch (error) {
      console.error("Error fetching driver:", error);
      addToast('Error fetching driver data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchDriverData();
    }
  }, [driverId, currentUser]);

  const handleInputChange = (field: keyof DriverFormData, value: string) => {
    let sanitizedValue = value;
    if (field === 'phone' || field === 'alternatePhone') {
      sanitizedValue = value.replace(/[^0-9]/g, '');
    }
    setFormData(prev => ({ ...prev, [field]: sanitizedValue }));
    if (errors[field]) {
      setErrors(prev => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  const handleRouteSelect = (val: string) => {
    setFormData(prev => {
      if (val.toLowerCase() === 'reserved') {
        return { ...prev, routeId: val, busAssigned: 'Reserved (No Bus Assigned)' };
      }
      const assignedBus = buses.find(bus => (bus.routeId === val || bus.id === val));

      let busDisplay = '';
      if (assignedBus) {
        const busIdStr = assignedBus.busId || assignedBus.id || '';
        const busNum = busIdStr.includes('_') ? busIdStr.split('_')[1] : busIdStr;
        busDisplay = `Bus-${busNum} (${assignedBus.busNumber})`;
      }

      return { ...prev, routeId: val, busAssigned: busDisplay };
    });
  };

  const handleImageConfirm = (newImageUrl: string, file?: File) => {
    setPreviewUrl(newImageUrl);
    setFinalImageUrl(newImageUrl);
    if (file) {
      setFormData(prev => ({ ...prev, profilePhoto: file }));
    }
    setIsImageModalOpen(false);
  };

  const handleImageRemove = () => {
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setFormData(prev => ({ ...prev, profilePhoto: null }));
  };

  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName || route.route} (No stops)`;
    const stopNames = route.stops.map(s => typeof s === 'string' ? s : s.name || s.toString());
    if (stopNames.length <= 4) return `${route.routeName || route.route} → ${stopNames.join(', ')}`;
    return `${route.routeName || route.route} → ${stopNames[0]}, ${stopNames[3]}, ${stopNames[stopNames.length - 2]}, ${stopNames[stopNames.length - 1]}`;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Full name is required";
    if (!formData.phone.trim()) newErrors.phone = "Phone number is required";
    else if (!/^\d{10,}$/.test(formData.phone)) newErrors.phone = "Phone number must be at least 10 digits";
    if (!formData.licenseNumber.trim()) newErrors.licenseNumber = "License number is required";
    if (!formData.aadharNumber.trim()) newErrors.aadharNumber = "AADHAR number is required";
    if (!formData.dob) newErrors.dob = "Date of birth is required";
    if (!formData.joiningDate) newErrors.joiningDate = "Joining date is required";
    if (!formData.routeId) newErrors.routeId = "Route assignment is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }

    setSubmitting(true);
    try {
      let profilePhotoUrl = formData.profilePhotoUrl;
      if (formData.profilePhoto) {
        const originalProfilePhotoUrl = driver?.profilePhotoUrl || '';
        const upFormData = new FormData();
        upFormData.append('file', formData.profilePhoto);

        // SECURITY: Get auth token for the secured upload route
        const { auth: firebaseAuth } = await import('@/lib/firebase');
        const idToken = await firebaseAuth.currentUser?.getIdToken();

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {},
          body: upFormData,
        });
        if (!res.ok) throw new Error('Photo upload failed');
        const data = await res.json();
        profilePhotoUrl = data.url;

        // Delete old Cloudinary image if photo changed and old image exists
        if (originalProfilePhotoUrl && originalProfilePhotoUrl !== profilePhotoUrl) {
          try {
            const { auth } = await import('@/lib/firebase');
            const { currentUser } = auth;
            if (currentUser) {
              const idToken = await currentUser.getIdToken();
              await fetch('/api/update-profile-photo', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  idToken,
                  targetType: 'driver',
                  targetId: driverId,
                  newImageUrl: profilePhotoUrl,
                  oldImageUrl: originalProfilePhotoUrl,
                }),
              });
            }
          } catch (cleanupError) {
            console.warn('Failed to cleanup old profile image:', cleanupError);
            // Continue with the update even if cleanup fails
          }
        }
      }

      const updateData = {
        fullName: formData.name,
        phone: formData.phone,
        alternatePhone: formData.alternatePhone,
        dob: formData.dob,
        licenseNumber: formData.licenseNumber,
        joiningDate: formData.joiningDate,
        aadharNumber: formData.aadharNumber,
        address: formData.address,
        profilePhotoUrl,

        status: formData.status,
        employeeId: formData.employeeId,
        shift: formData.shift,
        updatedAt: new Date().toISOString()
      };

      const success = await updateDriver(driverId, updateData);
      if (success) {
        addToast('Driver updated successfully!', 'success');
        signalCollectionRefresh('drivers');
        router.push("/moderator/drivers");
      } else {
        throw new Error('Update failed');
      }
    } catch (error: any) {
      console.error(error);
      addToast(error.message || 'Error updating driver', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    fetchDriverData();
    addToast('Form reset successfully', 'info');
  };

  if (loading || authLoading) {
    return <PremiumPageLoader message="Loading driver profile..." subMessage="Preparing editing tools..." />;
  }

  if (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role)) return null;

  if (!permsLoading && !canDriverEdit) {
    return <PermissionDeniedCard title="Editing Driver Restricted" actionName="Editing Drivers" />;
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Driver</h1>
            <p className="text-gray-400 text-xs">Update driver details, license information and assigned route</p>
          </div>
          <Link
            href="/moderator/drivers"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg backdrop-blur-sm"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] backdrop-blur-sm rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex flex-col items-center mb-8">
              <div
                className="relative cursor-pointer group"
                onClick={() => setIsImageModalOpen(true)}
              >
                {/* Glow Effect */}
                <div className="absolute -inset-4 bg-gradient-to-br from-purple-600/30 via-pink-600/20 to-indigo-600/10 rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition-all duration-500"></div>

                <div className="relative">
                  {finalImageUrl ? (
                    <div className="h-36 w-36 rounded-full overflow-hidden border-2 border-white/10 shadow-2xl bg-gradient-to-br from-[#16171d] to-[#0e0f12]">
                      <img
                        src={finalImageUrl}
                        alt="Profile Preview"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                    </div>
                  ) : (
                    <div className="h-36 w-36 rounded-full bg-gradient-to-br from-gray-800/50 to-gray-900/50 flex items-center justify-center border-2 border-dashed border-white/20 shadow-2xl backdrop-blur-sm group-hover:border-white/40 transition-all duration-300">
                      <Camera className="h-10 w-10 text-gray-500 group-hover:text-gray-300 transition-colors" />
                    </div>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]">
                    <div className="flex flex-col items-center">
                      <Camera className="h-8 w-8 text-white mb-1" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wider">Change Photo</span>
                    </div>
                  </div>
                </div>
              </div>

              {finalImageUrl && (
                <button
                  type="button"
                  onClick={handleImageRemove}
                  className="mt-3 text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove Photo
                </button>
              )}

              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">Click to upload or adjust profile photo</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name <span className="text-red-500">*</span></Label>
                  <Input id="name" value={formData.name} onChange={(e) => handleInputChange('name', e.target.value)} required />
                  {errors.name && <p className="text-red-500 text-[10px] mt-0.5">{errors.name}</p>}
                </div>

                <div>
                  <Label htmlFor="email" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address (Read-only)</Label>
                  <Input id="email" value={formData.email} disabled className="bg-gray-800/50 cursor-not-allowed opacity-70" />
                </div>

                <div>
                  <Label htmlFor="phone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number <span className="text-red-500">*</span></Label>
                  <Input id="phone" value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} required />
                  {errors.phone && <p className="text-red-500 text-[10px] mt-0.5">{errors.phone}</p>}
                </div>

                <div>
                  <Label htmlFor="alternatePhone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Alternate Phone</Label>
                  <Input id="alternatePhone" value={formData.alternatePhone} onChange={(e) => handleInputChange('alternatePhone', e.target.value)} />
                </div>

                <div>
                  <Label htmlFor="employeeId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Employee ID</Label>
                  <Input id="employeeId" value={formData.employeeId} onChange={(e) => handleInputChange('employeeId', e.target.value)} required />
                </div>

                <div>
                  <Label htmlFor="address" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Address</Label>
                  <Textarea id="address" value={formData.address} onChange={(e) => handleInputChange('address', e.target.value)} className="resize-none min-h-[148px]" />
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="licenseNumber" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">License Number <span className="text-red-500">*</span></Label>
                  <Input id="licenseNumber" value={formData.licenseNumber} onChange={(e) => handleInputChange('licenseNumber', e.target.value)} required />
                  {errors.licenseNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.licenseNumber}</p>}
                </div>

                <div>
                  <Label htmlFor="aadharNumber" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">AADHAR Number <span className="text-red-500">*</span></Label>
                  <Input id="aadharNumber" value={formData.aadharNumber} onChange={(e) => handleInputChange('aadharNumber', e.target.value)} required />
                  {errors.aadharNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.aadharNumber}</p>}
                </div>

                <div>
                  <EnhancedDatePicker id="dob" label="Date of Birth" value={formData.dob} onChange={(val) => handleInputChange('dob', val)} required validationType="dob-driver" />
                  {errors.dob && <p className="text-red-500 text-[10px] mt-0.5">{errors.dob}</p>}
                </div>

                <div>
                  <EnhancedDatePicker id="joiningDate" label="Joining Date" value={formData.joiningDate} onChange={(val) => handleInputChange('joiningDate', val)} required validationType="joining" />
                  {errors.joiningDate && <p className="text-red-500 text-[10px] mt-0.5">{errors.joiningDate}</p>}
                </div>

                <div className="p-4 bg-white/5 rounded-xl border border-white/5 space-y-4">
                  {/* Route Selection - LOCKED for editing, must use Driver Reassignment */}
                  <div>
                    <Label htmlFor="routeId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Assigned Route <span className="text-red-500">*</span>
                    </Label>
                    <div
                      onClick={() => addToast('To reassign drivers to a different route, please visit the Driver Reassignment page.', 'info')}
                      className="cursor-default"
                    >
                      <Input
                        type="text"
                        value={formData.routeId === 'Reserved' ? 'Reserved (No Route)' : (routes.find(r => r.routeId === formData.routeId)?.routeName || formData.routeId || 'No route assigned')}
                        readOnly
                        className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed border-dashed"
                      />
                    </div>
                    <p className="text-[10px] text-amber-500/80 mt-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Visit <Link href="/moderator/driver-assignment" className="underline hover:text-amber-400">Driver Reassignment</Link> to change route assignment
                    </p>
                  </div>

                  {/* Bus Field - LOCKED for editing, must use Driver Reassignment */}
                  <div>
                    <Label htmlFor="bus" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Assigned Bus</Label>
                    <div
                      onClick={() => addToast('To reassign drivers to a different bus, please visit the Driver Reassignment page.', 'info')}
                      className="cursor-default"
                    >
                      <Input
                        id="bus"
                        value={formData.busAssigned || (formData.routeId === 'Reserved' ? 'Reserved (No Bus)' : 'No bus assigned')}
                        readOnly
                        className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed border-dashed"
                      />
                    </div>
                    <p className="text-[10px] text-amber-500/80 mt-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Visit <Link href="/moderator/driver-assignment" className="underline hover:text-amber-400">Driver Reassignment</Link> to change bus assignment
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="shift" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Shift <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.shift}
                      onValueChange={(value) => handleInputChange('shift', value)}
                    >
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Select Shift" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Morning">Morning</SelectItem>
                        <SelectItem value="Evening">Evening</SelectItem>
                        <SelectItem value="Both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-gray-500 mt-1">Driver's working shift</p>
                  </div>

                  <div>
                    <Label htmlFor="approvedBy" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Approved By</Label>
                    <Input id="approvedBy" value={formData.approvedBy || ''} readOnly className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed" disabled />
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Admin authorized only</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <Button type="button" onClick={handleReset} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[80px]">Reset</Button>
              <Link href="/moderator/drivers">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[80px]">Cancel</Button>
              </Link>
              <Button type="submit" disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]">
                {submitting ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Updating...</span>
                  </div>
                ) : "Update Driver"}
              </Button>
            </div>
          </form>
        </div>
      </div>
      <ProfileImageAddModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onConfirm={handleImageConfirm}
        immediateUpload={false}
      />
    </div>
  );
}
