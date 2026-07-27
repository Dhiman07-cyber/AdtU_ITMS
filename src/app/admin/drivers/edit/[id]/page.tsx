"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import ProfileImageAddModal from "@/components/ProfileImageAddModal";
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/contexts/toast-context';
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import { getAllBuses,getAllDrivers,getAllRoutes,getDriverById,updateDriver } from '@/lib/dataService';
import { Route } from '@/lib/types';
import { uploadImage } from '@/lib/upload';
import { AlertTriangle,Camera,Info } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use,useEffect,useRef,useState } from 'react';

// Define the form data type
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
  routeId: string;
  busAssigned: string;
  busId?: string;
  employeeId: string;
  address: string;
  approvedBy: string;
  shift: string;
};

export default function EditDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { id: driverId } = use(params);

  // State for routes and buses
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [busOptions, setBusOptions] = useState<any[]>([]);
  const [driversList, setDriversList] = useState<any[]>([]);
  const [availableShifts, setAvailableShifts] = useState<string[]>(['Morning', 'Evening', 'Both']);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictDriver, setConflictDriver] = useState<any>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [driver, setDriver] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
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
    routeId: '',
    busAssigned: '',
    employeeId: '',
    address: '',
    approvedBy: '',
    shift: 'Both',
  });

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<DriverFormData>('driverEditFormData', {
    debounceMs: 500,
    excludeFields: ['profilePhoto'],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  // Save form data to localStorage whenever it changes (except sensitive fields)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      storage.save(formData);
    }
  }, [formData, storage]);

  // Fetch driver data and pre-fill form
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [routesData, busesData, foundDriver, driversData] = await Promise.all([
          getAllRoutes(),
          getAllBuses(),
          getDriverById(driverId),
          getAllDrivers()
        ]);

        setRoutes(routesData);
        setBuses(busesData);
        setDriversList(driversData);

        if (foundDriver) {
          setDriver(foundDriver);

          const initialFormData: DriverFormData = {
            name: foundDriver.fullName || foundDriver.name || '',
            email: foundDriver.email || '',
            phone: foundDriver.phoneNumber || foundDriver.phone || '',
            alternatePhone: foundDriver.alternatePhone || foundDriver.altPhone || '',
            licenseNumber: foundDriver.licenseNumber || '',
            aadharNumber: foundDriver.aadharNumber || '',
            dob: foundDriver.dob || '',
            joiningDate: foundDriver.joiningDate || foundDriver.joinDate || '',
            profilePhoto: null,
            routeId: foundDriver.routeId || foundDriver.routeId || (foundDriver.isReserved ? 'Reserved' : ''),
            busAssigned: foundDriver.busAssigned || foundDriver.busId || '',
            busId: foundDriver.busId || (foundDriver.busId && !foundDriver.busId.includes('Bus-') ? foundDriver.busId : '') || '',
            employeeId: foundDriver.employeeId || foundDriver.driverId || '',
            address: foundDriver.address || foundDriver.location || '',
            approvedBy: foundDriver.approvedBy || '',
            shift: foundDriver.shift || 'Both',
          };

          // If busAssigned is derived from ID (legacy), format it correctly and recover ID
          if (initialFormData.busAssigned && !initialFormData.busAssigned.includes('Bus-')) {
            const bus = busesData.find(b => b.id === initialFormData.busAssigned || b.busId === initialFormData.busAssigned);
            if (bus) {
              const busIdStr = bus.busId || bus.id || '';
              const busNum = busIdStr.includes('_') ? busIdStr.split('_')[1] : busIdStr;
              initialFormData.busAssigned = `Bus-${busNum} (${bus.busNumber})`;
              initialFormData.busId = bus.id || bus.busId;
            }
          } else if (!initialFormData.busId && initialFormData.busAssigned) {
            // Try to recover ID from display string if possible, or wait for useEffect
          }

          setFormData(initialFormData);
          if (foundDriver.profilePhotoUrl) {
            setPreviewUrl(foundDriver.profilePhotoUrl);
            setFinalImageUrl(foundDriver.profilePhotoUrl);
          }
        } else {
          addToast('Driver not found', 'error');
          router.push("/admin/drivers");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        addToast('Error fetching driver data', 'error');
        router.push("/admin/drivers");
      } finally {
        setLoading(false);
        setLoadingRoutes(false);
      }
    };

    if (driverId) {
      fetchData();
    }
  }, [driverId, router, addToast]);

  const fetchDriverData = async () => {
    // This is now redundant but kept for any specific manual refreshes
    try {
      setLoading(true);
      const [foundDriver, busesData] = await Promise.all([
        getDriverById(driverId),
        getAllBuses()
      ]);

      if (foundDriver) {
        setDriver(foundDriver);
        const initialFormData: DriverFormData = {
          name: foundDriver.fullName || foundDriver.name || '',
          email: foundDriver.email || '',
          phone: foundDriver.phoneNumber || foundDriver.phone || '',
          alternatePhone: foundDriver.alternatePhone || foundDriver.altPhone || '',
          licenseNumber: foundDriver.licenseNumber || '',
          aadharNumber: foundDriver.aadharNumber || '',
          dob: foundDriver.dob || '',
          joiningDate: foundDriver.joiningDate || foundDriver.joinDate || '',
          profilePhoto: null,
          routeId: foundDriver.routeId || foundDriver.routeId || (foundDriver.isReserved ? 'Reserved' : ''),
          busAssigned: foundDriver.busAssigned || foundDriver.busId || '',
          employeeId: foundDriver.employeeId || foundDriver.driverId || '',
          address: foundDriver.address || foundDriver.location || '',
          approvedBy: foundDriver.approvedBy || '',
          shift: foundDriver.shift || 'Both',
        };

        if (initialFormData.busAssigned && !initialFormData.busAssigned.includes('Bus-')) {
          const bus = busesData.find(b => b.id === initialFormData.busAssigned || b.busId === initialFormData.busAssigned);
          if (bus) {
            const busIdStr = bus.busId || bus.id || '';
            const busNum = busIdStr.includes('_') ? busIdStr.split('_')[1] : busIdStr;
            initialFormData.busAssigned = `Bus-${busNum} (${bus.busNumber})`;
          }
        }
        setFormData(initialFormData);
      }
    } finally {
      setLoading(false);
    }
  };
  // Update bus options logic
  useEffect(() => {
    if (routes.length > 0 && buses.length > 0 && formData.routeId && formData.routeId !== 'Reserved') {
      const associatedBuses = buses.filter(bus =>
        bus.routeId === formData.routeId ||
        (routes.find(r => r.routeId === formData.routeId) as any)?.busId === bus.id
      );
      setBusOptions(associatedBuses);
    } else {
      setBusOptions([]);
    }
  }, [routes, buses, formData.routeId]);

  useEffect(() => {
    if (!formData.busId || formData.routeId?.toLowerCase() === 'reserved' || formData.routeId?.toLowerCase() === 'none') {
      setAvailableShifts(['Morning', 'Evening', 'Both']);
      return;
    }

    const existingDriver = driversList.find(d => 
      (d.busId === formData.busId || d.busId === formData.busId) && 
      !d.isReserved && 
      (d.driverId || d.id) !== driverId
    );

    if (existingDriver) {
      const existingShift = (existingDriver.shift || '').toLowerCase();
      
      // Update available shifts base on what's occupied
      if (existingShift === 'both') {
        // Bus is fully covered, but we allow editing if user confirms later
        setAvailableShifts(['Morning', 'Evening']); 
        setConflictDriver(existingDriver);
      } else if (existingShift === 'morning') {
        setAvailableShifts(['Morning', 'Evening']);
        setConflictDriver(null);
      } else if (existingShift === 'evening') {
        setAvailableShifts(['Morning', 'Evening']);
        setConflictDriver(null);
      }
    } else {
      setAvailableShifts(['Morning', 'Evening', 'Both']);
      setConflictDriver(null);
    }
  }, [formData.busId, driversList, driverId]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Full name is required";
    }

    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\d{10,}$/.test(formData.phone)) {
      newErrors.phone = "Phone number must be at least 10 digits";
    }

    if (formData.alternatePhone && !/^\d{10,}$/.test(formData.alternatePhone)) {
      newErrors.alternatePhone = "Alternate phone number must be at least 10 digits";
    }

    if (!formData.dob) {
      newErrors.dob = "Date of birth is required";
    }

    if (!formData.licenseNumber.trim()) {
      newErrors.licenseNumber = "License number is required";
    }

    if (!formData.joiningDate) {
      newErrors.joiningDate = "Joining date is required";
    }

    if (!formData.aadharNumber.trim()) {
      newErrors.aadharNumber = "AADHAR number is required";
    } else if (!/^\d{8,}$/.test(formData.aadharNumber)) {
      newErrors.aadharNumber = "AADHAR number must be at least 8 digits";
    }

    if (!formData.routeId) {
      newErrors.routeId = "Route is required";
    }


    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let { name, value } = e.target;

    // Numeric-only restriction for phone number fields
    if (name === 'phone' || name === 'alternatePhone') {
      value = value.replace(/[^0-9]/g, '');
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle route selection
  const handleRouteSelect = (routeId: string) => {
    // Handle "Reserved" drivers
    if (routeId.toLowerCase() === 'reserved') {
      setBusOptions([]);
      setFormData(prev => ({
        ...prev,
        routeId: routeId,
        busAssigned: 'Reserved (No Bus Assigned)',
        busId: ''
      }));
      return;
    }

    // Find all buses associated with this route
    const associatedBuses = buses.filter(bus =>
      bus.routeId === routeId ||
      (routes.find(r => r.routeId === routeId) as any)?.busId === bus.id
    );
    setBusOptions(associatedBuses);

    setFormData(prev => {
      let newBusAssigned = '';
      let newBusId = '';

      if (associatedBuses.length === 1) {
        const bus = associatedBuses[0];
        const busIdStr = bus.busId || bus.id || '';
        const busNum = busIdStr.includes('_') ? busIdStr.split('_')[1] : busIdStr;
        newBusAssigned = `Bus-${busNum} (${bus.busNumber})`;
        newBusId = bus.id || bus.busId;
      }

      return {
        ...prev,
        routeId: routeId,
        busAssigned: newBusAssigned,
        busId: newBusId
      };
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

  // Format route display text - Show first, fourth, second-last, and last stops
  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName || route.route} (No stops)`;
    if (route.stops.length <= 4) {
      return `${route.routeName || route.route} → ${route.stops.map((stop: any) => stop.name || stop).join(', ')}`;
    }

    // Get first, fourth, second-last, and last stops
    const first = route.stops[0];
    const fourth = route.stops[3];
    const secondLast = route.stops[route.stops.length - 2];
    const last = route.stops[route.stops.length - 1];

    return `${route.routeName || route.route} → ${first.name || first}, ${fourth.name || fourth}, ${secondLast.name || secondLast}, ${last.name || last}`;
  };

  // Get selected route for display
  const selectedRoute = routes.find(route => route.routeId === formData.routeId);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }

    if (e) {
      const existingDriver = driversList.find(d => 
        (d.busId === formData.busId || d.busId === formData.busId) && 
        !d.isReserved && 
        (d.driverId || d.id) !== driverId
      );
      
      if (existingDriver) {
        const eShift = (existingDriver.shift || '').toLowerCase();
        const fShift = formData.shift.toLowerCase();
        
        // CONFLICT: Either already Both, or same shift
        if (eShift === 'both' || eShift === fShift) {
          setConflictDriver(existingDriver);
          setShowConflictModal(true);
          return; 
        }
      }
    }

    setLoadingSubmit(true);
    setResult(null);

    try {
      let profilePhotoUrl = driver?.profilePhotoUrl || '';

      // Upload profile photo to Cloudinary if new photo provided
      // Upload profile photo to Cloudinary if new photo provided
      if (formData.profilePhoto) {
        try {
          const originalProfilePhotoUrl = driver?.profilePhotoUrl || '';
          const uploadResult = await uploadImage(formData.profilePhoto);
          if (uploadResult && typeof uploadResult === 'string') {
            profilePhotoUrl = uploadResult;

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
        } catch (uploadError: any) {
          addToast(`Failed to upload profile photo: ${uploadError.message}`, 'error');
          setLoadingSubmit(false);
          return;
        }
      }

      // Handle Reserved drivers vs regular route assignments
      let busId = null;
      let routeId = null;

      if (formData.routeId === 'Reserved') {
        // Reserved driver - no bus or route assignment
      } else if (formData.routeId) {
        // Use selected bus ID
        busId = formData.busId || null;
        routeId = formData.routeId;
      }

      // Prepare data for update
      const updateData: any = {
        name: formData.name,
        fullName: formData.name,
        phone: formData.phone,
        alternatePhone: formData.alternatePhone,
        profilePhotoUrl: profilePhotoUrl,
        licenseNumber: formData.licenseNumber,
        aadharNumber: formData.aadharNumber,
        dob: formData.dob,
        joiningDate: formData.joiningDate,
        employeeId: formData.employeeId,
        address: formData.address,
        busId: busId,
        routeId: routeId,
        approvedBy: formData.approvedBy,
        shift: formData.shift,
        updatedAt: new Date().toISOString()
      };

      const updatedDriver = await updateDriver(driverId, updateData);

      if (updatedDriver) {
        // Clear saved form data on successful submission
        if (typeof window !== 'undefined') {
          localStorage.removeItem('driverEditFormData');
        }

        setResult({ success: true });
        addToast('Driver updated successfully!', 'success');
        // Signal the drivers list page to refresh when it's rendered
        signalCollectionRefresh('drivers');
        router.push('/admin/drivers');
      } else {
        setResult({ error: 'Failed to update driver' });
        addToast('Failed to update driver', 'error');
      }
    } catch (error: any) {
      console.error('Error updating driver:', error);
      setResult({ error: error.message || 'Unknown error' });
      addToast(`Failed to update driver: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleReset = () => {
    // Reset back to original driver data
    if (driverId) {
      fetchDriverData();
    }

    // setImagePosition call removed


    setErrors({});

    // Clear saved form data
    if (typeof window !== 'undefined') {
      localStorage.removeItem('driverEditFormData');
    }

    addToast('Form reset successfully', 'info');
  };

  if (loading) {
    return <PremiumPageLoader message="Loading driver profile..." subMessage="Preparing editing tools..." />;
  }

  if (!driver) {
    return (
      <div className="mt-10 min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Driver not found</h1>
          <Link href="/admin/drivers" className="text-blue-500 hover:text-blue-700 mt-4 inline-block">
            Back to Drivers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Driver</h1>
            <p className="text-gray-400 text-xs">Update driver information and route assignments</p>
          </div>
          <Link
            href="/admin/drivers"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-colors"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-xl border border-white/10 p-4 sm:p-10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Profile Photo Section - Modal Position Picker */}
            {/* Profile Photo Section - Modal Position Picker */}
            <div className="flex flex-col items-center mb-8">
              <div
                className="relative cursor-pointer group"
                onClick={() => setIsImageModalOpen(true)}
              >
                <div className="relative">
                  {finalImageUrl ? (
                    <div className="h-36 w-36 rounded-full overflow-hidden border-2 border-white/10 shadow-lg bg-gradient-to-br from-[#16171d] to-[#0e0f12]">
                      <img
                        src={finalImageUrl}
                        alt="Profile Preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-36 w-36 rounded-full bg-gradient-to-br from-gray-800/50 to-gray-900/50 flex items-center justify-center border-2 border-dashed border-white/20 shadow-lg group-hover:border-white/40 transition-colors">
                      <Camera className="h-10 w-10 text-gray-500 group-hover:text-gray-300 transition-colors" />
                    </div>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
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
                  <Label htmlFor="name" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Full name"
                    required
                  />
                  {errors.name && <p className="text-red-500 text-[10px] mt-0.5">{errors.name}</p>}
                </div>

                <div>
                  <Label htmlFor="email" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address
                  </Label>
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    disabled
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Contact support to change email</p>
                </div>

                <div>
                  <Label htmlFor="phone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10-digit phone"
                    required
                  />
                  {errors.phone && <p className="text-red-500 text-[10px] mt-0.5">{errors.phone}</p>}
                </div>

                <div>
                  <Label htmlFor="alternatePhone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Alternate Phone
                  </Label>
                  <Input
                    type="tel"
                    id="alternatePhone"
                    name="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={handleInputChange}
                    placeholder="Optional"
                  />
                  {errors.alternatePhone && <p className="text-red-500 text-[10px] mt-0.5">{errors.alternatePhone}</p>}
                </div>

                <div>
                  <Label htmlFor="employeeId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Employee ID
                  </Label>
                  <Input
                    type="text"
                    id="employeeId"
                    name="employeeId"
                    value={formData.employeeId}
                    onChange={handleInputChange}
                    placeholder="Employee ID"
                    required
                  />
                  {errors.employeeId && <p className="text-red-500 text-[10px] mt-0.5">{errors.employeeId}</p>}
                </div>

                <div>
                  <Label htmlFor="address" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Address
                  </Label>
                  <Textarea
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleTextareaChange}
                    placeholder="Full address"
                    className="resize-none min-h-[148px]"
                  />
                  {errors.address && <p className="text-red-500 text-[10px] mt-0.5">{errors.address}</p>}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="licenseNumber" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    License Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="licenseNumber"
                    name="licenseNumber"
                    value={formData.licenseNumber}
                    onChange={handleInputChange}
                    placeholder="License number"
                    required
                  />
                  {errors.licenseNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.licenseNumber}</p>}
                </div>

                <div>
                  <Label htmlFor="aadharNumber" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    AADHAR Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="aadharNumber"
                    name="aadharNumber"
                    value={formData.aadharNumber}
                    onChange={handleInputChange}
                    placeholder="AADHAR number"
                    required
                  />
                  {errors.aadharNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.aadharNumber}</p>}
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Date of Birth <span className="text-red-500">*</span></Label>
                  <EnhancedDatePicker
                    id="dob"
                    label=""
                    value={formData.dob}
                    onChange={(value) => handleDateChange('dob', value)}
                    required
                    validationType="dob-driver"
                  />
                  {errors.dob && <p className="text-red-500 text-[10px] mt-0.5">{errors.dob}</p>}
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Joining Date <span className="text-red-500">*</span></Label>
                  <EnhancedDatePicker
                    id="joiningDate"
                    label=""
                    value={formData.joiningDate}
                    onChange={(value) => handleDateChange('joiningDate', value)}
                    required
                    validationType="joining"
                  />
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
                    <p className="text-[10px] text-blue-500/80 mt-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Routes are assigned dynamically when the driver initiates a trip.
                    </p>
                  </div>

                  {/* Bus Field - Dynamic QR / Manual trip initiation */}
                  <div>
                    <Label htmlFor="busId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Bus Assignment
                    </Label>
                    <div>
                      <Input
                        type="text"
                        id="busAssigned"
                        name="busAssigned"
                        value="Dynamic (Selected on Start Trip / QR Scan)"
                        readOnly
                        className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed border-dashed"
                      />
                    </div>
                    <p className="text-[10px] text-blue-500/80 mt-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Drivers select or scan their bus QR code at trip start time.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="shift" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Shift <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.shift}
                      onValueChange={(value) => handleSelectChange('shift', value)}
                    >
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Select Shift" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableShifts.map(shift => (
                          <SelectItem key={shift} value={shift}>{shift}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-gray-500 mt-1">Driver's working shift</p>
                  </div>

                  <div>
                    <Label htmlFor="approvedBy" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Approved By
                    </Label>
                    <Input
                      type="text"
                      id="approvedBy"
                      name="approvedBy"
                      value={formData.approvedBy}
                      readOnly
                      className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed"
                      disabled
                    />
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Admin authorized only</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[80px]"
              >
                Reset
              </Button>
              <Link href="/admin/drivers">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[80px]">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loadingSubmit}
                className="bg-green-600 hover:bg-green-700 text-white min-w-[120px]"
              >
                {loadingSubmit ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Updating...</span>
                  </div>
                ) : (
                  "Update Driver"
                )}
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

      {/* Conflict Resolution Modal */}
      {showConflictModal && conflictDriver && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-300">
          <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] border border-white/10 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl transform animate-in zoom-in-95 duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Shift Overlap Warning</h3>
            </div>
            
            <div className="space-y-4 mb-6">
              <p className="text-gray-300 text-sm leading-relaxed">
                There already exists a driver named <span className="text-blue-400 font-semibold">{conflictDriver.fullName || conflictDriver.name || 'Unknown'}</span> who is looking for <span className="text-amber-400 font-semibold">{conflictDriver.shift === 'Both' ? 'Both' : conflictDriver.shift}</span> shift(s).
              </p>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">Impact Analysis</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Target Bus:</span>
                  <span className="text-xs text-white font-medium">{formData.busAssigned}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-400">Current Occupancy:</span>
                  <span className="text-xs text-amber-500 font-bold">{conflictDriver.shift === 'Both' ? 'Full' : 'Partial'}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowConflictModal(false)}
                className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setShowConflictModal(false);
                  handleSubmit(); // Proceed with null event to bypass check
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-900/20"
              >
                Assign Anyways
              </Button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
}