"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import Link from 'next/link';
import { uploadImage } from '@/lib/upload';
import { useToast } from '@/contexts/toast-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, Info, Camera, Trash2, AlertTriangle } from "lucide-react";
import { OptimizedInput, OptimizedTextarea } from '@/components/forms';
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import ProfileImageAddModal from '@/components/ProfileImageAddModal';
import Image from 'next/image';
import { getAllRoutes, getAllBuses, getAllDrivers, getModeratorById, updateDriver } from '@/lib/dataService';
import { Route } from '@/lib/types';
import RouteSelect from '@/components/RouteSelect';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function AddDriver() {
  const { currentUser, userData, loading } = useAuth();
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

  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
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
  }, [formData]); // Removed storage from deps - it's stable

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

        // Logic for Employee ID: DB-XY
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
        const existingShift = (existingDriver.shift || '').toLowerCase();
        
        // Update available shifts base on what's occupied
        if (existingShift === 'both') {
          // Bus is fully covered, but we allow adding another if user confirms later
          setAvailableShifts(['Morning', 'Evening']); 
          setConflictDriver(existingDriver);
        } else if (existingShift === 'morning') {
          setAvailableShifts(['Morning', 'Evening']);
          // Auto-suggest the other shift
          if (formData.shift === 'Morning' || formData.shift === 'Both') {
            setFormData(prev => ({ ...prev, shift: 'Evening' }));
          }
          setConflictDriver(null);
        } else if (existingShift === 'evening') {
          setAvailableShifts(['Morning', 'Evening']);
          // Auto-suggest the other shift
          if (formData.shift === 'Evening' || formData.shift === 'Both') {
            setFormData(prev => ({ ...prev, shift: 'Morning' }));
          }
          setConflictDriver(null);
        }
    } else {
      setAvailableShifts(['Morning', 'Evening', 'Both']);
      setConflictDriver(null);
    }
  }, [formData.busId, driversList]);

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin') {
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

    // Numeric-only restriction for phone fields
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

        // Fix: prioritize bus's own number over route number
        // Check if busNumber is a valid distinct number (e.g. "1", "10", "101")
        // If it looks like a license plate or is missing, try other fields
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

        // If legacy fallback needed (e.g. if busId empty but only 1 bus exists?) 
        // Logic in handleRouteChange should have handled it.
      }

      const response = await fetch('/api/admin/create-user', {
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
        // Signal the drivers list page to refresh when it's rendered
        signalCollectionRefresh('drivers');
        setTimeout(() => {
          router.push('/admin/drivers');
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
    const employeeId = (userData as any)?.employeeId || 'ADMIN';
    const approvedByValue = userData?.name ? `${userData.name} (${employeeId})` : '';

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
    setFinalImageUrl(null);
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

  if (!currentUser || !userData || userData.role !== 'admin') {
    return null;
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Driver</h1>
            <p className="text-gray-400 text-xs">Register a new driver in the system</p>
          </div>
          <Link
            href="/admin/drivers"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-colors"
          >
            <span className="mr-1.5 text-sm">←</span>
            Back
          </Link>
        </div>
      </div>

      {/* Main Content - Card container */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-xl border border-white/10 p-4 sm:p-10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Profile Photo Section - Modal Position Picker */}
            <div className="flex flex-col items-center mb-8">
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
                    <Camera className="h-8 w-8 text-slate-400" />
                  </div>
                )}

                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-white" />
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
              <div className="space-y-3">
                <div>
                  <OptimizedInput
                    id="name"
                    label="Full Name"
                    value={formData.name}
                    onChange={(value) => setFormData(prev => ({ ...prev, name: value }))}
                    placeholder="Enter full name"
                    required
                  />
                  {errors.name && <p className="text-red-500 text-xs mt-0.5">{errors.name}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="email"
                    label="Email Address"
                    type="email"
                    value={formData.email}
                    onChange={(value) => setFormData(prev => ({ ...prev, email: value }))}
                    placeholder="driver@example.com"
                    required
                  />
                  {errors.email && <p className="text-red-500 text-xs mt-0.5">{errors.email}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="phone"
                    label="Phone Number"
                    type="tel"
                    value={formData.phone}
                    onChange={(value) => setFormData(prev => ({ ...prev, phone: value }))}
                    placeholder="10-digit phone number"
                    required
                    transform={(val) => val.replace(/[^0-9]/g, '')}
                  />
                  {errors.phone && <p className="text-xs text-red-500 mt-0.5">{errors.phone}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="alternatePhone"
                    label="Alternate Phone"
                    type="tel"
                    value={formData.alternatePhone}
                    onChange={(value) => setFormData(prev => ({ ...prev, alternatePhone: value }))}
                    placeholder="Optional"
                    transform={(val) => val.replace(/[^0-9]/g, '')}
                  />
                  {errors.alternatePhone && <p className="text-red-500 text-xs mt-0.5">{errors.alternatePhone}</p>}
                </div>

                <div>
                  <Label htmlFor="driverId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Driver ID <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <OptimizedInput
                      id="driverId"
                      value={formData.driverId}
                      onChange={(value) => setFormData(prev => ({ ...prev, driverId: value }))}
                      placeholder="Driver ID"
                      required
                      className="pr-9"
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
                  {errors.driverId && <p className="text-red-500 text-xs mt-0.5">{errors.driverId}</p>}
                </div>

                <div>
                  <OptimizedTextarea
                    id="address"
                    label="Address"
                    value={formData.address}
                    onChange={(value) => setFormData(prev => ({ ...prev, address: value }))}
                    placeholder="Full address"
                    required
                    rows={4}
                  />
                  {errors.address && <p className="text-red-500 text-xs mt-0.5">{errors.address}</p>}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-3 pt-[1px]">
                <div>
                  <OptimizedInput
                    id="licenseNumber"
                    label="License Number"
                    value={formData.licenseNumber}
                    onChange={(value) => setFormData(prev => ({ ...prev, licenseNumber: value }))}
                    placeholder="License number"
                    required
                  />
                  {errors.licenseNumber && <p className="text-red-500 text-xs mt-0.5">{errors.licenseNumber}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="aadharNumber"
                    label="AADHAR Number"
                    value={formData.aadharNumber}
                    onChange={(value) => setFormData(prev => ({ ...prev, aadharNumber: value }))}
                    placeholder="AADHAR number"
                    required
                  />
                  {errors.aadharNumber && <p className="text-red-500 text-xs mt-0.5">{errors.aadharNumber}</p>}
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
                    className="h-9"
                  />
                  {errors.dob && <p className="text-red-500 text-xs mt-0.5">{errors.dob}</p>}
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
                    className="h-9"
                  />
                  {errors.joiningDate && <p className="text-red-500 text-xs mt-0.5">{errors.joiningDate}</p>}
                </div>

                {/* Route Selection */}
                <div>
                  <Label htmlFor="routeId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Assigned Route <span className="text-red-500">*</span>
                  </Label>
                  <RouteSelect
                    routes={routes}
                    value={formData.routeId}
                    onChange={handleRouteSelect}
                    isLoading={loadingRoutes}
                    allowReserved={true}
                  />
                  {errors.routeId && <p className="text-red-500 text-xs mt-1">{errors.routeId}</p>}
                </div>

                {/* Bus Field - Auto-filled or Selectable */}
                <div>
                  <Label htmlFor="busId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bus (Auto-assigned)
                  </Label>
                  {busOptions.length > 1 ? (
                    <Select
                      value={formData.busId || ''}
                      onValueChange={(value) => {
                        const selectedBus = busOptions.find(b => (b.id === value || b.busId === value));
                        if (selectedBus) {
                          // Logic to generate display string (replicated from handleRouteSelect for consistency)
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
                  <Label htmlFor="shift" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {!formData.busId && formData.routeId !== 'reserved' ? "Select a bus first" : "Driver's working shift"}
                  </p>
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
                    className="h-9 text-sm bg-gray-100 dark:bg-gray-700 cursor-not-allowed"
                    disabled
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Auto-filled</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 w-full">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white w-full text-sm h-9"
              >
                Reset
              </Button>
              <Link href="/admin/drivers" className="w-full block">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white w-full text-sm h-9">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loadingSubmit}
                className="bg-green-600 hover:bg-green-700 text-white w-full text-sm h-9"
              >
                {loadingSubmit ? 'Creating...' : 'Create Driver'}
              </Button>
            </div>
          </form>

          {result && (
            <div className={`mt-3 p-3 rounded-md text-sm ${result.success ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"}`}>
              <p className="text-sm"><strong>{result.success ? "Success!" : "Error:"}</strong></p>
              <p className="text-sm">{result.success ? "Driver created successfully! Redirecting..." : result.error}</p>
            </div>
          )}
        </div>
    </div>

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
    </div>
  );
}
