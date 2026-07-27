"use client";

import EnhancedDatePicker from "@/components/enhanced-date-picker";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import ProfileImageAddModal from '@/components/ProfileImageAddModal';
import RouteSelect from '@/components/RouteSelect';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { signalCollectionRefresh } from "@/hooks/useEventDrivenRefresh";
import { getAllBuses,getAllDrivers,getAllRoutes,getModeratorById,updateDriver } from '@/lib/dataService';
import { Route } from '@/lib/types';
import { uploadImage } from '@/lib/upload';
import { Camera,RefreshCw,Trash2 } from "lucide-react";
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';

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
  driverId: string;
  address: string;
  approvedBy: string;
  shift: string;
};

import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';

export default function AddDriver() {
  const { currentUser, userData, loading } = useAuth();
  const { canDriverAdd, loading: permsLoading } = useModeratorPermissions();
  const { addToast } = useToast();
  const router = useRouter();

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

  // Default form data
  const defaultFormData: DriverFormData = {
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
    busId: '',
    driverId: '',
    address: '',
    approvedBy: '',
    shift: 'Both',
  };

  // Always initialize with empty form data - no auto-fill
  const getInitialFormData = (): DriverFormData => {
    // Try to load from localStorage first
    if (typeof window !== 'undefined') {
      const savedData = localStorage.getItem('driverFormData');
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData);
          // Ensure sensitive fields are not auto-filled and missing fields are defaulted
          return {
            ...defaultFormData,
            ...parsedData,
            email: '',
            profilePhoto: null
          };
        } catch (e) {
          console.error('Error parsing saved form data:', e);
        }
      }
    }

    return defaultFormData;
  };

  const [formData, setFormData] = useState<DriverFormData>(getInitialFormData);

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<DriverFormData>('driverFormData', {
    debounceMs: 500,
    excludeFields: ['profilePhoto', 'email'],
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showImageModal, setShowImageModal] = useState(false);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [autoFilledId, setAutoFilledId] = useState("");

  // Auto-fill approvedBy field with current admin's details
  useEffect(() => {
    const fetchApproverDetails = async () => {
      if (userData && (userData.name || userData.fullName)) {
        const approverName = userData.fullName || userData.name;
        let idSuffix = '';

        if (userData.role === 'admin') {
          idSuffix = 'Admin';
        } else if (userData.role === 'moderator') {
          // Try to get from current userData first
          idSuffix = (userData as any).employeeId || (userData as any).empId || (userData as any).staffId || (userData as any).id || (userData as any).uid || 'MODERATOR';

          // If it's a default/generic suffix, try fetching full data
          if (['MODERATOR', 'MOD'].includes(idSuffix) && currentUser?.uid) {
            try {
              const modData = await getModeratorById(currentUser.uid);
              if (modData) {
                idSuffix = (modData as any).employeeId || (modData as any).empId || (modData as any).staffId || idSuffix;
              }
            } catch (err) {
              console.error('Error fetching moderator ID:', err);
            }
          }
        } else {
          idSuffix = userData.role?.charAt(0).toUpperCase() + userData.role?.slice(1) || 'Unknown';
        }

        const approvedByValue = `${approverName} (${idSuffix})`;

        setFormData(prev => {
          if (!prev.approvedBy || prev.approvedBy === '' || prev.approvedBy.includes('undefined')) {
            return { ...prev, approvedBy: approvedByValue };
          }
          return prev;
        });
      }
    };
    fetchApproverDetails();
  }, [userData, currentUser]);

  // Save form data to localStorage whenever it changes (except sensitive fields)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Trigger debounced save (non-blocking)
      storage.save(formData);
    }
  }, [formData, storage]);

  // Fetch routes and buses when component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [routesData, busesData, driversData] = await Promise.all([
          getAllRoutes(),
          getAllBuses(),
          getAllDrivers()
        ]);
        setRoutes(routesData);
        setBuses(busesData);
        setDriversList(driversData);

        // Logic for Driver ID: DB-XY
        const nextCount = driversData.length + 1;
        const xy = nextCount < 10 ? `0${nextCount}` : `${nextCount}`;
        const newDriverId = `DB-${xy}`;
        setAutoFilledId(newDriverId);
        setFormData(prev => ({ ...prev, driverId: newDriverId }));

        console.log('Fetched routes:', routesData);
        console.log('Fetched buses:', busesData);
      } catch (error) {
        console.error('Error fetching data:', error);
        addToast('Failed to load routes and buses', 'error');
      } finally {
        setLoadingRoutes(false);
      }
    };

    fetchData();
  }, [addToast]);

  useEffect(() => {
    if (!formData.busId || formData.routeId === 'reserved') {
      setAvailableShifts(['Morning', 'Evening', 'Both']);
      return;
    }

    const existingDriver = driversList.find(d => 
      (d.busId === formData.busId || d.busId === formData.busId) && !d.isReserved
    );

    if (existingDriver) {
      setAvailableShifts(['Morning', 'Evening']); 
      
      const existingShift = existingDriver.shift?.toLowerCase();
      if (existingShift === 'morning') {
        setFormData(prev => ({ ...prev, shift: 'Evening' }));
      } else if (existingShift === 'evening') {
        setFormData(prev => ({ ...prev, shift: 'Morning' }));
      } else if (existingShift === 'both' && formData.shift === 'Both') {
        setFormData(prev => ({ ...prev, shift: 'Morning' })); 
      }
    } else {
      setAvailableShifts(['Morning', 'Evening', 'Both']);
    }
  }, [formData.busId, driversList]);

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin' && userData.role !== 'moderator') {
      router.push(`/${userData.role}`);
    }

    // Force clear any auto-filled values after component mounts
    setTimeout(() => {
      setFormData(prev => ({
        ...prev,
        email: ''
      }));
    }, 100);
  }, [currentUser, userData, loading, router]);

  // Completely disable localStorage for email
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Force clear any existing localStorage data for sensitive fields
      const savedData = localStorage.getItem('driverFormData');
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData);
          if (parsedData.email) {
            // Remove sensitive fields from saved data - handled by storage hook now
            storage.clear();
            storage.save(parsedData);
          }
        } catch (e) {
          console.error('Error cleaning saved form data:', e);
        }
      }
    }
  }, []);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Full name is required";
    }
    // Name cannot contain symbols check removed

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
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

    if (!formData.driverId.trim()) {
      newErrors.driverId = "Driver ID is required";
    }

    if (!formData.address.trim()) {
      newErrors.address = "Address is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLSelectElement>) => {
    let { name, value } = e.target;

    // Numeric-only restriction for phone number fields
    if (name === 'phone' || name === 'alternatePhone') {
      value = value.replace(/[^0-9]/g, '');
    }

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
    console.log('Route selected:', routeId);

    if (routeId === 'reserved') {
      console.log('Driver set as Reserved - no bus assignment');
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
      // Fallback for potential legacy structure or mismatched IDs
      (routes.find(r => r.routeId === routeId) as any)?.busId === bus.id
    );

    setBusOptions(associatedBuses);
    console.log('Available buses for route:', associatedBuses);

    setFormData(prev => {
      let newBusAssigned = '';
      let newBusId = '';

      if (associatedBuses.length === 1) {
        // EXACTLY ONE BUS: Auto-select
        const bus = associatedBuses[0];

        // Fix: prioritize bus's own number over route number (which caused duplicates)
        const isDistinctBusNum = bus.busNumber && bus.busNumber.length < 5 && !isNaN(Number(bus.busNumber));
        const busIdParts = (bus.id || bus.busId || '').split('_');
        const busIdNum = busIdParts.length > 1 ? busIdParts[1] : '';

        const busNumberValue = bus.displayIndex || bus.sequenceNumber || (isDistinctBusNum ? bus.busNumber : null) || busIdNum || bus.busNumber || '?';
        const licensePlate = bus.licensePlate || bus.plateNumber || (bus.busNumber !== busNumberValue ? bus.busNumber : 'N/A');

        newBusAssigned = `Bus-${busNumberValue} (${licensePlate})`;
        newBusId = bus.id || bus.busId;
      }
      // If > 1, we clear and show select. If 0, we clear.

      return {
        ...prev,
        routeId: routeId,
        busAssigned: newBusAssigned,
        busId: newBusId
      };
    });
  };

  const handleImageConfirm = (file: File) => {
    // Legacy support
  };

  const handleProfileImageAdd = (url: string, file?: File) => {
    setFinalImageUrl(url);
    if (file) {
      setFormData(prev => ({ ...prev, profilePhoto: file }));
    }
    setPreviewUrl(url);
    setShowImageModal(false);
    addToast('Profile photo set successfully (will upload on save)', 'success');
  };

  const handleImageRemove = () => {
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setFormData(prev => ({ ...prev, profilePhoto: null }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (!validateForm()) {
      return;
    }

    if (e) {
      const existingDriver = driversList.find(d => 
        (d.busId === formData.busId || d.busId === formData.busId) && !d.isReserved
      );
      
      if (existingDriver) {
        let isConflict = false;
        const eShift = existingDriver.shift?.toLowerCase();
        const fShift = formData.shift.toLowerCase();
        
        if (eShift === 'both' || eShift === fShift) {
          isConflict = true;
        }

        if (isConflict) {
          setConflictDriver(existingDriver);
          setShowConflictModal(true);
          return; 
        }
      }
    }

    setLoadingSubmit(true);
    setResult(null);

    try {
      let profilePhotoUrl = finalImageUrl || '';

      // Upload profile photo if present
      if (formData.profilePhoto) {
        try {
          const uploadedUrl = await uploadImage(formData.profilePhoto);
          if (uploadedUrl) {
            profilePhotoUrl = uploadedUrl;
          }
        } catch (err) {
          console.error('Failed to upload profile photo', err);
          addToast('Failed to upload profile photo, continuing without it', 'warning');
        }
      }

      // Get Firebase ID token for authentication
      const idToken = await currentUser?.getIdToken();

      // Handle Reserved drivers vs regular route assignments
      let busId = null;
      let routeId = null;

      if (formData.routeId === 'reserved') {
        // Reserved driver - no bus or route assignment
        console.log('Creating Reserved driver - no bus/route assignment');
      } else if (formData.routeId) {
        // Use selected bus ID
        busId = formData.busId || null;
        routeId = formData.routeId;
      }

      const response = await fetch('/api/moderator/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
          role: 'driver',
          phone: formData.phone,
          alternatePhone: formData.alternatePhone,
          profilePhotoUrl: profilePhotoUrl,
          licenseNumber: formData.licenseNumber,
          aadharNumber: formData.aadharNumber,
          dob: formData.dob,
          joiningDate: formData.joiningDate,
          driverId: formData.driverId,
          address: formData.address,
          busId: busId,
          routeId: routeId,
          approvedBy: formData.approvedBy,
          shift: formData.shift
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear saved form data on successful submission
        if (typeof window !== 'undefined') {
          storage.clear();
        }

        addToast('Driver created successfully!', 'success');
        signalCollectionRefresh('drivers');
        setTimeout(() => {
          router.push('/moderator/drivers');
        }, 2000);
      } else {
        addToast(data.error || 'Failed to create driver', 'error');
      }
    } catch (error: any) {
      console.error('Error creating driver:', error);
      addToast(`Failed to create driver: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleReset = () => {
    const driverId = (userData as any)?.driverId || (userData as any)?.employeeId || 'ADMIN';
    const approvedByValue = userData?.name ? `${userData.name} (${driverId})` : '';

    setFormData({
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
      driverId: '',
      address: '',
      approvedBy: approvedByValue,
      shift: 'Both',
    });
    setPreviewUrl(null);
    setErrors({});

    // Clear saved form data
    if (typeof window !== 'undefined') {
      storage.clear();
    }

    addToast('Form reset successfully', 'info');
  };

  if (loading) {
    return <PremiumPageLoader message="Preparing driver form..." subMessage="Loading resources..." />;
  }

  if (!currentUser || !userData || (userData.role !== 'admin' && userData.role !== 'moderator')) {
    return null;
  }

  if (!permsLoading && !canDriverAdd) {
    return <PermissionDeniedCard title="Adding Driver Restricted" actionName="Adding Drivers" />;
  }

  // Format route display text - Show first, fourth, second-last, and last stops
  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName} (No stops)`;
    if (route.stops.length <= 4) {
      return `${route.routeName} → ${route.stops.map((stop: any) => stop.name || stop).join(', ')}`;
    }

    // Get first, fourth, second-last, and last stops
    const first = route.stops[0];
    const fourth = route.stops[3];
    const secondLast = route.stops[route.stops.length - 2];
    const last = route.stops[route.stops.length - 1];

    return `${route.routeName} → ${first.name || first}, ${fourth.name || fourth}, ${secondLast.name || secondLast}, ${last.name || last}`;
  };

  // Get selected route for display
  const selectedRoute = routes.find(route => route.routeId === formData.routeId);

  return (
    <div className="mt-10 py-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Driver</h1>
            <p className="text-gray-400 text-xs">Register a new driver in the system</p>
          </div>
          <Link
            href="/moderator/drivers"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg backdrop-blur-sm"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content - Card container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] backdrop-blur-sm rounded-2xl shadow-2xl border border-white/10 p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Profile Photo Section - Moved to top center */}
            <div className="flex flex-col items-center mb-6">
              <div className="relative group cursor-pointer" onClick={() => setShowImageModal(true)}>
                {finalImageUrl ? (
                  <div className="relative h-24 w-24 rounded-full overflow-hidden border-4 border-white dark:border-gray-800 shadow-xl ring-2 ring-blue-100 dark:ring-blue-900">
                    <Image
                      src={finalImageUrl}
                      alt="Profile"
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-24 w-24 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center border-4 border-white dark:border-gray-800 shadow-xl ring-2 ring-slate-100 dark:ring-slate-800 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                    <Camera className="h-8 w-8 text-slate-400 group-hover:scale-110 transition-transform duration-300" />
                  </div>
                )}

                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]">
                  <Camera className="h-6 w-6 text-white drop-shadow-md transform scale-90 group-hover:scale-100 transition-transform" />
                </div>

                {finalImageUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleImageRemove();
                    }}
                    className="absolute -top-1 -right-1 p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors z-10"
                    title="Remove photo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <p className="mt-3 text-sm text-gray-500 font-medium">Click to upload photo</p>

              <ProfileImageAddModal
                isOpen={showImageModal}
                onClose={() => setShowImageModal(false)}
                onConfirm={handleProfileImageAdd}
                immediateUpload={false}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-6">
                <div>
                  <Label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Enter full name"
                    required
                    className="h-9 text-sm"
                  />
                  {errors.name && <p className="text-red-500 text-sm">{errors.name}</p>}
                </div>

                <div>
                  <Label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="driver@example.com"
                    required
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    className="h-9 text-sm"
                  />
                  {errors.email && <p className="text-red-500 text-sm">{errors.email}</p>}
                </div>

                <div>
                  <Label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10-digit phone number"
                    required
                    className="h-9 text-sm"
                  />
                  {errors.phone && <p className="text-red-500 text-sm">{errors.phone}</p>}
                </div>

                <div>
                  <Label htmlFor="alternatePhone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Alternate Phone Number
                  </Label>
                  <Input
                    type="tel"
                    id="alternatePhone"
                    name="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={handleInputChange}
                    placeholder="Optional"
                    className="h-9 text-sm"
                  />
                  {errors.alternatePhone && <p className="text-red-500 text-sm">{errors.alternatePhone}</p>}
                </div>

                <div>
                  <Label htmlFor="driverId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Driver ID <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      type="text"
                      id="driverId"
                      name="driverId"
                      value={formData.driverId}
                      onChange={handleInputChange}
                      placeholder="Driver ID"
                      required
                      className="h-9 text-sm pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, driverId: autoFilledId }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-blue-500"
                      title="Restore auto-filled ID"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {errors.driverId && <p className="text-red-500 text-sm">{errors.driverId}</p>}
                </div>

                <div>
                  <Label htmlFor="address" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Address <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleTextareaChange}
                    placeholder="Full address"
                    required
                    className="resize-none min-h-[110px]"
                  />
                  {errors.address && <p className="text-red-500 text-sm">{errors.address}</p>}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                <div>
                  <Label htmlFor="licenseNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                    className="h-9 text-sm"
                  />
                  {errors.licenseNumber && <p className="text-red-500 text-sm">{errors.licenseNumber}</p>}
                </div>

                <div>
                  <Label htmlFor="aadharNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                    className="h-9 text-sm"
                  />
                  {errors.aadharNumber && <p className="text-red-500 text-sm">{errors.aadharNumber}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="dob"
                    label="Date of Birth"
                    value={formData.dob}
                    placeholder="YYYY-MM-DD"
                    onChange={(value) => handleDateChange('dob', value)}
                    required
                    validationType="dob-driver"
                    className="h-9"
                  />
                  {errors.dob && <p className="text-red-500 text-sm">{errors.dob}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="joiningDate"
                    label="Joining Date"
                    value={formData.joiningDate}
                    placeholder="YYYY-MM-DD"
                    onChange={(value) => handleDateChange('joiningDate', value)}
                    required
                    validationType="joining"
                    className="h-9"
                  />
                  {errors.joiningDate && <p className="text-red-500 text-sm">{errors.joiningDate}</p>}
                </div>

                {/* Route Selection */}
                <div>
                  <Label htmlFor="routeId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Assigned Route <span className="text-red-500">*</span>
                  </Label>
                  <RouteSelect
                    routes={routes}
                    value={formData.routeId}
                    onChange={handleRouteSelect}
                    isLoading={loadingRoutes}
                    allowReserved={true}
                  />
                  {errors.routeId && <p className="text-red-500 text-sm mt-1">{errors.routeId}</p>}
                </div>

                <div>
                  <Label htmlFor="busId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bus (Auto-assigned)
                  </Label>
                  {busOptions.length > 1 ? (
                    <Select
                      value={formData.busId || ''}
                      onValueChange={(value) => {
                        const selectedBus = busOptions.find(b => (b.id === value || b.busId === value));
                        if (selectedBus) {
                          const isDistinctBusNum = selectedBus.busNumber && selectedBus.busNumber.length < 5 && !isNaN(Number(selectedBus.busNumber));
                          const busIdParts = (selectedBus.id || selectedBus.busId || '').split('_');
                          const busIdNum = busIdParts.length > 1 ? busIdParts[1] : '';

                          const busNumberValue = selectedBus.displayIndex || selectedBus.sequenceNumber || (isDistinctBusNum ? selectedBus.busNumber : null) || busIdNum || selectedBus.busNumber || '?';
                          const licensePlate = selectedBus.licensePlate || selectedBus.plateNumber || (selectedBus.busNumber !== busNumberValue ? selectedBus.busNumber : 'N/A');

                          const displayStr = `Bus-${busNumberValue} (${licensePlate})`;

                          setFormData(prev => ({
                            ...prev,
                            busId: value,
                            busAssigned: displayStr
                          }));
                        } else {
                          setFormData(prev => ({ ...prev, busId: value }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Select Bus" />
                      </SelectTrigger>
                      <SelectContent>
                        {busOptions.map(bus => {
                          const isDistinctBusNum = bus.busNumber && bus.busNumber.length < 5 && !isNaN(Number(bus.busNumber));
                          const busIdParts = (bus.id || bus.busId || '').split('_');
                          const busIdNum = busIdParts.length > 1 ? busIdParts[1] : '';

                          const busNumberValue = bus.displayIndex || bus.sequenceNumber || (isDistinctBusNum ? bus.busNumber : null) || busIdNum || bus.busNumber || '?';
                          const licensePlate = bus.licensePlate || bus.plateNumber || (bus.busNumber !== busNumberValue ? bus.busNumber : 'N/A');

                          const display = `Bus-${busNumberValue} (${licensePlate})`;
                          return (
                            <SelectItem key={bus.id || bus.busId} value={bus.id || bus.busId}>
                              {display}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="text"
                      id="busAssigned"
                      name="busAssigned"
                      value={formData.busAssigned || (formData.routeId === 'reserved' ? 'Reserved (No Bus)' : 'No bus assigned')}
                      readOnly
                      className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed border-dashed"
                    />
                  )}
                  {busOptions.length === 0 && formData.routeId && formData.routeId !== 'reserved' && (
                    <p className="text-[10px] text-amber-500 mt-1">No buses found for this route</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="shift" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Shift <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.shift}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, shift: value }))}
                    disabled={!formData.busId && formData.routeId !== 'reserved'}
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Select Shift" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableShifts.includes('Morning') && <SelectItem value="Morning">Morning</SelectItem>}
                      {availableShifts.includes('Evening') && <SelectItem value="Evening">Evening</SelectItem>}
                      {availableShifts.includes('Both') && <SelectItem value="Both">Both</SelectItem>}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {!formData.busId && formData.routeId !== 'reserved' ? "Select a bus first" : "Driver's working shift"}
                  </p>
                </div>

                <div>
                  <Label htmlFor="approvedBy" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Approved By
                  </Label>
                  <Input
                    type="text"
                    id="approvedBy"
                    name="approvedBy"
                    value={formData.approvedBy}
                    readOnly
                    className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed h-9 text-sm"
                    disabled
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This field is auto-filled</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                onClick={handleReset}
                className="h-9 text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                Reset
              </Button>
              <Link href="/moderator/drivers">
                <Button type="button" className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loadingSubmit}
                className="h-9 text-sm bg-green-600 hover:bg-green-700 text-white"
              >
                {loadingSubmit ? 'Creating...' : 'Create Driver'}
              </Button>
            </div>
          </form>

          {result && (
            <div className={`mt-4 p-4 rounded-md ${result.success ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"}`}>
              <p><strong>{result.success ? "Success!" : "Error:"}</strong></p>
              <p>{result.success ? "Driver created successfully! Redirecting..." : result.error}</p>
            </div>
          )}
        </div>
    </div>

      {showConflictModal && conflictDriver && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1A1B23] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-3">Shift Conflict Detected</h3>
            <p className="text-sm text-gray-300 mb-6">
              There already exists a driver named <strong className="text-white">{conflictDriver.fullName || conflictDriver.name}</strong> who is looking for <strong className="text-white">{conflictDriver.shift}</strong> shift(s).
            </p>
            <div className="flex flex-col gap-3">
              <Button
                onClick={async () => {
                  const newShiftForExisting = formData.shift === 'Morning' ? 'Evening' : 'Morning';
                  try {
                    await updateDriver(conflictDriver.driverId || conflictDriver.id, { shift: newShiftForExisting });
                    addToast(`Updated ${conflictDriver.fullName || conflictDriver.name} to ${newShiftForExisting} shift`, 'success');
                  } catch (e) {
                    console.error("Failed to auto-update existing driver", e);
                  }
                  setShowConflictModal(false);
                  handleSubmit();
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white w-full py-2 h-auto whitespace-normal text-left break-words block leading-snug"
              >
                Assign {conflictDriver.fullName || conflictDriver.name} to {formData.shift === 'Morning' ? 'Evening' : 'Morning'}
              </Button>
              <Button
                onClick={() => {
                  setShowConflictModal(false);
                  handleSubmit();
                }}
                variant="outline"
                className="text-gray-300 bg-transparent hover:bg-white/5 border-white/20 w-full h-10"
              >
                Continue without changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
