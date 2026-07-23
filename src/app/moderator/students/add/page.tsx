"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { DEFAULT_BUS_FEE } from '@/config/runtime';
import FacultyDepartmentSelector from '@/components/faculty-department-selector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/contexts/toast-context';
import { Info, Camera, PenSquare, Trash2, Loader2 } from "lucide-react";
import { getAllRoutes, getAllBuses, getModeratorById } from '@/lib/dataService';
import { Route } from '@/lib/types';
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import enhancedDatePicker from "@/components/enhanced-date-picker";
import ProfileImageAddModal from '@/components/ProfileImageAddModal';
import Image from 'next/image';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';
import { checkBusCapacity, type BusCapacityInfo, type CapacityCheckResult } from '@/lib/bus-capacity-checker';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { uploadImage } from '@/lib/upload';
import AddStudentPaymentSection from '@/components/AddStudentPaymentSection';

import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { OptimizedInput, OptimizedSelect, OptimizedTextarea } from '@/components/forms';

// Define the form data type
type StudentFormData = {
  name: string;
  email: string;
  phone: string;
  alternatePhone: string;
  enrollmentId: string;
  gender: string;
  dob: string; // Add date of birth field
  faculty: string;
  department: string;
  semester: string;
  parentName: string;
  parentPhone: string;
  busAssigned: string;
  busId?: string;
  routeId: string;
  profilePhoto: File | null;
  address: string;
  bloodGroup: string;
  shift: string;
  approvedBy: string;
  // Bus Session System Fields
  sessionDuration: string; // 1, 2, 3, 4 years or custom
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string;
  pickupPoint: string; // Stop ID from route
};

import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

export default function AddStudentForm() {
  const { currentUser, userData, loading } = useAuth();
  const { canStudentAdd, loading: permsLoading } = useModeratorPermissions();
  const { addToast } = useToast();
  const router = useRouter();

  // Helper function to get initial form data from localStorage
  const getInitialFormData = (): StudentFormData => {
    const currentYear = new Date().getUTCFullYear();
    // Use a transient default for the very first render, it will be updated by the useEffect once config is fetched
    const defaultValidUntil = calculateValidUntilDate(currentYear, 1, { month: 5, day: 30 }).toISOString();

    const defaultData: StudentFormData = {
      name: '',
      email: '',
      phone: '',
      alternatePhone: '',
      enrollmentId: '',
      gender: '',
      dob: '',
      faculty: '',
      department: '',
      semester: '',
      parentName: '',
      parentPhone: '',
      busAssigned: '',
      busId: '',
      routeId: '',
      profilePhoto: null,
      address: '',
      bloodGroup: '',
      shift: '',
      approvedBy: '',
      sessionDuration: '1',
      sessionStartYear: currentYear,
      sessionEndYear: currentYear + 1,
      validUntil: defaultValidUntil,
      pickupPoint: '',
    };

    // Try to load from localStorage synchronously
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('moderatorStudentFormData');
        if (stored) {
          const parsed = JSON.parse(stored);
          console.log('📬 [Moderator Students] Loaded draft from localStorage on init');
          return {
            ...defaultData,
            ...parsed,
            profilePhoto: null,
            sessionStartYear: parsed.sessionStartYear || currentYear,
            sessionEndYear: parsed.sessionEndYear || currentYear + 1,
            validUntil: parsed.validUntil || defaultValidUntil
          };
        }
      } catch (error) {
        console.error('❌ [Moderator Students] Error loading draft:', error);
      }
    }

    return defaultData;
  };

  const [formData, setFormData] = useState<StudentFormData>(getInitialFormData);

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<StudentFormData>('moderatorStudentFormData', {
    debounceMs: 500,
    excludeFields: ['profilePhoto'],
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showImageModal, setShowImageModal] = useState(false);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);

  // State for routes and buses
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [busOptions, setBusOptions] = useState<any[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [loadingBuses, setLoadingBuses] = useState(true);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [facultySelected, setFacultySelected] = useState(false);

  // Bus capacity state
  const [busCapacity, setBusCapacity] = useState<BusCapacityInfo | null>(null);
  const [checkingCapacity, setCheckingCapacity] = useState(false);
  const [capacityCheckResult, setCapacityCheckResult] = useState<CapacityCheckResult | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get bus fee from system config dynamically
  const [busFee, setBusFee] = useState<number>(DEFAULT_BUS_FEE);
  const [academicDeadline, setAcademicDeadline] = useState<{ month: number; day: number }>({ month: 5, day: 30 }); // Default June 30

  useEffect(() => {
    const fetchSystemConfig = async () => {
      try {
        const response = await fetch('/api/settings/system-config');
        if (response.ok) {
          const data = await response.json();
          if (data.config?.busFee?.amount) {
            setBusFee(data.config.busFee.amount);
            console.log('💰 [Moderator] Fetched dynamic bus fee:', data.config.busFee.amount);
          }
        }

        // Fetch academic deadline from canonical deadline config endpoint
        const dlResponse = await fetch('/api/settings/deadline-config');
        if (dlResponse.ok) {
          const dlData = await dlResponse.json();
          if (dlData.config?.academicYear) {
            setAcademicDeadline({
              month: dlData.config.academicYear.anchorMonth,
              day: dlData.config.academicYear.anchorDay
            });
            console.log('📅 [Moderator] Fetched academic deadline from canonical config:', dlData.config.academicYear.anchorMonth, dlData.config.academicYear.anchorDay);
          }
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchSystemConfig();
  }, []);

  // Recalculate validUntil when academicDeadline changes
  useEffect(() => {
    handleSessionStartYearChange(formData.sessionStartYear);
  }, [academicDeadline]);


  // Enable auto-save ONLY after data dependencies (routes/buses) are loaded
  useEffect(() => {
    if (!loadingRoutes && !loadingBuses) {
      // Add a small delay after data load to ensure child components (Selectors) have hydrated and stabilized
      const timer = setTimeout(() => {
        setIsLoaded(true);
        console.log('🚀 [Moderator] Auto-save ENABLED');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [loadingRoutes, loadingBuses]);

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
    if (typeof window !== 'undefined' && isLoaded) {
      storage.save(formData);
    }
  }, [formData, isLoaded]); // Removed storage from deps - it's stable

  // Fetch routes and buses when component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [routesData, busesData] = await Promise.all([
          getAllRoutes(),
          getAllBuses()
        ]);
        setRoutes(routesData);
        setBuses(busesData);
      } catch (error) {
        console.error('Error fetching routes/buses:', error);
        addToast('Failed to load routes and buses', 'error');
      } finally {
        setLoadingRoutes(false);
        setLoadingBuses(false);
      }
    };

    fetchData();
  }, [addToast]);



  // Handle capacity check results and toast notifications
  useEffect(() => {
    if (!capacityCheckResult) return;

    const { isFull, hasAlternatives, alternativeBuses, isNearCapacity, selectedBus } = capacityCheckResult;

    // 1. Handle Full Bus Scenario
    if (isFull) {
      if (hasAlternatives && alternativeBuses.length > 0) {
        if (alternativeBuses.length === 1) {
          // Alternative available
        } else {
          // Multiple alternatives
        }
      } else {
        // No alternatives - Critical
      }
    }

    // 2. Handle Near Capacity (but not full)
    else if (isNearCapacity && selectedBus) {
      // User can proceed but warn them
    }

    // 3. Available - Silence is golden (no toast needed)

  }, [capacityCheckResult, addToast]);

  const handleFacultySelect = (faculty: string) => {
    setFormData(prev => ({ ...prev, faculty }));
    setFacultySelected(true);
  };

  const handleRefChange = (field: string, value: any) => {
    // Map 'stop_name' to 'pickupPoint' as per form data structure
    if (field === 'sessionStartYear') {
      handleSessionStartYearChange(value);
    } else if (field === 'stop_name') {
      setFormData(prev => ({ ...prev, pickupPoint: value }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  const handleDepartmentSelect = (department: string) => {
    setFormData(prev => ({ ...prev, department }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;

    // Numeric-only restriction for phone number fields
    if (name === 'phone' || name === 'alternatePhone' || name === 'parentPhone') {
      value = value.replace(/[^0-9]/g, '');
    }

    console.log(`✍️ [Moderator] Input change: ${name} =`, value);
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // Calculate session end year and validUntil date using canonical deadline config
  const calculateSessionEnd = (startYear: number, durationYears: number) => {
    // Ensure valid numbers
    const validStartYear = isNaN(startYear) ? new Date().getUTCFullYear() : startYear;
    const validDuration = isNaN(durationYears) ? 1 : durationYears;

    const endYear = validStartYear + validDuration;
    // Calculate validUntil using dynamic academic deadline
    const validUntil = calculateValidUntilDate(validStartYear, validDuration, academicDeadline).toISOString();
    return { endYear, validUntil };
  };

  // Handle session duration change
  const handleSessionDurationChange = (duration: string) => {
    const durationNum = parseInt(duration) || 1;
    const { endYear, validUntil } = calculateSessionEnd(formData.sessionStartYear, durationNum);

    setFormData(prev => ({
      ...prev,
      sessionDuration: duration,
      sessionEndYear: endYear,
      validUntil: validUntil
    }));
  };

  // Handle session start year change
  const handleSessionStartYearChange = (year: number | string) => {
    const yearNum = typeof year === 'string' ? parseInt(year) : year;
    const validYear = isNaN(yearNum) ? new Date().getUTCFullYear() : yearNum;
    const durationNum = parseInt(formData.sessionDuration) || 1;
    const { endYear, validUntil } = calculateSessionEnd(validYear, durationNum);

    setFormData(prev => ({
      ...prev,
      sessionStartYear: validYear,
      sessionEndYear: endYear,
      validUntil: validUntil
    }));
  };

  // Get available stops from selected route
  const getRouteStops = () => {
    const route = routes.find(r => r.routeId === formData.routeId);
    if (!route || !route.stops) return [];
    return Array.isArray(route.stops) ? route.stops : [];
  };

  const handleSelectChange = (name: string, value: string) => {
    console.log(`🔄 [Moderator] Select change: ${name} =`, value);
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error when user makes a selection
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // Renamed handler for RouteSelectionSection and Semester
  const handleReferenceChange = (field: string, value: any) => {
    console.log(`🔄 [Moderator] Ref change: ${field} =`, value);

    // Map 'stop_name' to 'pickupPoint' as per form data structure
    if (field === 'stop_name') {
      setFormData(prev => ({ ...prev, pickupPoint: value }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }

    // Clear error if exists
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Handle route selection
  const handleRouteChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const routeId = e.target.value;

    // Find all buses associated with this route
    const associatedBuses = buses.filter(bus =>
      bus.routeId === routeId ||
      (routes.find(r => r.routeId === routeId) as any)?.busId === bus.id
    );

    setBusOptions(associatedBuses);

    let newBusAssigned = '';
    let newBusId = '';

    if (associatedBuses.length === 1) {
      const bus = associatedBuses[0];
      const busNumber = bus.displayIndex || bus.sequenceNumber || bus.busNumber || '?';
      const licensePlate = bus.licensePlate || bus.plateNumber || bus.busNumber || 'N/A';
      newBusAssigned = `Bus-${busNumber} (${licensePlate})`;
      newBusId = bus.id || bus.busId;

      // Check capacity
      await checkBusCapacityAsync(newBusId);
    } else {
      // If 0 or >1, clear capacity (wait for selection)
      setBusCapacity(null);
    }

    setFormData(prev => ({
      ...prev,
      routeId: routeId,
      busAssigned: newBusAssigned,
      busId: newBusId
    }));
  };

  // Check bus capacity
  const checkBusCapacityAsync = async (busId: string) => {
    setCheckingCapacity(true);
    setBusCapacity(null);

    try {
      const capacityInfo = await checkBusCapacity(busId);
      console.log('🚌 Bus capacity check:', capacityInfo);
      setBusCapacity(capacityInfo);
    } catch (error) {
      console.error('Error checking bus capacity:', error);
    } finally {
      setCheckingCapacity(false);
    }
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error when user makes a selection
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
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
  };

  const handleImageRemove = () => {
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setFormData(prev => ({ ...prev, profilePhoto: null }));
  };

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

  // Validation function
  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Name validation - no special symbols check removed
    if (!formData.name.trim()) {
      newErrors.name = "Full name is required";
    }

    // Email validation
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    // Phone validation - minimum 10 digits, only numbers
    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\d{10,}$/.test(formData.phone)) {
      newErrors.phone = "Phone number must be at least 10 digits";
    }

    // Alternate phone validation - if provided, only numbers and minimum 10 digits
    if (formData.alternatePhone && !/^\d{10,}$/.test(formData.alternatePhone)) {
      newErrors.alternatePhone = "Alternate phone number must be at least 10 digits";
    }

    // Gender validation
    if (!formData.gender) {
      newErrors.gender = "Gender is required";
    }

    // Faculty validation
    if (!formData.faculty) {
      newErrors.faculty = "Faculty is required";
    } else if (/[^a-zA-Z\s&()-]/.test(formData.faculty)) {
      newErrors.faculty = "Faculty cannot contain special symbols except spaces, &, (, )";
    }

    // Department validation
    if (!formData.department) {
      newErrors.department = "Department is required";
    }

    // Semester validation
    if (!formData.semester) {
      newErrors.semester = "Semester is required";
    }

    // Parent name validation - no special symbols check removed
    if (!formData.parentName.trim()) {
      newErrors.parentName = "Parent name is required";
    }

    // Parent phone validation - minimum 10 digits, only numbers
    if (!formData.parentPhone.trim()) {
      newErrors.parentPhone = "Parent phone number is required";
    } else if (!/^\d{10,}$/.test(formData.parentPhone)) {
      newErrors.parentPhone = "Parent phone number must be at least 10 digits";
    }

    // Enrollment ID validation
    if (!formData.enrollmentId.trim()) {
      newErrors.enrollmentId = "Enrollment ID is required";
    }

    // Date of Birth validation
    if (!formData.dob) {
      newErrors.dob = "Date of birth is required";
    }

    // Shift validation
    if (!formData.shift) {
      newErrors.shift = "Shift is required";
    }

    // Session validation
    if (!formData.sessionDuration) {
      newErrors.sessionDuration = "Session duration is required";
    }

    // Route validation
    if (!formData.routeId) {
      newErrors.routeId = "Route is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      setIsSubmitting(true);
      try {
        console.log('Form data being submitted:', formData);

        // Get route details
        const selectedRoute = routes.find(route => route.routeId === formData.routeId);
        console.log('Selected route:', selectedRoute);

        // Upload profile photo if it exists as a file
        let profilePhotoUrl = finalImageUrl || '';
        if (formData.profilePhoto) {
          try {
            const uploadedUrl = await uploadImage(formData.profilePhoto);
            if (uploadedUrl) {
              profilePhotoUrl = uploadedUrl;
            }
          } catch (err) {
            console.error('Failed to upload profile photo', err);
            addToast('Failed to upload profile photo', 'error');
            setIsSubmitting(false);
            return;
          }
        }

        // Get Firebase ID token for authentication
        const idToken = await currentUser?.getIdToken();

        // Use selected bus ID
        const busId = formData.busId || null;
        console.log('Using busId:', busId);

        const response = await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + idToken
          },
          body: JSON.stringify({
            email: formData.email,
            name: formData.name,
            role: 'student',
            phone: formData.phone,
            alternatePhone: formData.alternatePhone,
            profilePhotoUrl: profilePhotoUrl,
            enrollmentId: formData.enrollmentId,
            gender: formData.gender,
            faculty: formData.faculty,
            department: formData.department,
            semester: formData.semester,
            parentName: formData.parentName,
            parentPhone: formData.parentPhone,
            dob: formData.dob,
            routeId: formData.routeId,
            busId: busId, // Selected bus ID
            address: formData.address,
            bloodGroup: formData.bloodGroup,
            shift: formData.shift,
            approvedBy: formData.approvedBy,
            // Session fields
            durationYears: parseInt(formData.sessionDuration), // Renamed from sessionDuration
            sessionStartYear: formData.sessionStartYear,
            sessionEndYear: formData.sessionEndYear,
            validUntil: formData.validUntil,
            stop_name: formData.pickupPoint // Renamed from pickupPoint
          }),
        });

        console.log('Create user response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Create user error:', errorData);
          throw new Error(errorData.error || 'Failed to create user');
        }

        const result = await response.json();

        // 1. Reset form data to initial state to prevent useEffect from re-saving draft
        setFormData(getInitialFormData());

        // 2. Clear saved form data on successful submission
        if (typeof window !== 'undefined') {
          storage.clear();
        }

        addToast(result.message || 'Student created successfully!', 'success');

        // Redirect to students list after successful creation
        setTimeout(() => {
          router.push('/moderator/students');
        }, 1500);
      } catch (error) {
        setIsSubmitting(false);
        console.error('Error adding student:', error);
        addToast(error instanceof Error ? error.message : 'Failed to add student. Please try again.', 'error');
      }
    } else {
      addToast('Please fix the errors in the form', 'error');
    }
  };

  const handleReset = () => {
    const approverName = userData?.fullName || userData?.name;
    let idSuffix = userData?.role === 'admin' ? 'Admin' : 'MODERATOR';
    if (userData?.role === 'moderator') {
      idSuffix = (userData as any).employeeId || (userData as any).empId || (userData as any).staffId || (userData as any).id || idSuffix;
    }
    const approvedByValue = approverName ? `${approverName} (${idSuffix})` : '';

    const currentYear = new Date().getUTCFullYear();
    const { endYear, validUntil } = calculateSessionEnd(currentYear, 1);

    setFormData({
      name: '',
      email: '',
      phone: '',
      alternatePhone: '',
      enrollmentId: '',
      gender: '',
      dob: '',
      faculty: '',
      department: '',
      semester: '',
      parentName: '',
      parentPhone: '',
      busAssigned: '',
      busId: '',
      routeId: '',
      profilePhoto: null,
      address: '',
      bloodGroup: '',
      shift: '',
      approvedBy: approvedByValue,
      // Reset session fields
      sessionDuration: '1',
      sessionStartYear: currentYear,
      sessionEndYear: endYear,
      validUntil: validUntil,
      pickupPoint: '',
    });
    setPreviewUrl(null);
    setErrors({});
    setFacultySelected(false);

    // Clear saved form data
    if (typeof window !== 'undefined') {
      storage.clear();
    }

    addToast('Form reset successfully', 'info');
  };

  if (!permsLoading && !canStudentAdd) {
    return <PermissionDeniedCard title="Adding Student Restricted" actionName="Adding Students" />;
  }

  return (
    <div className="mt-10 py-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Student</h1>
            <p className="text-gray-400 text-xs">Register a new student in the system</p>
          </div>
          <Link
            href="/moderator/students"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-10 hover:border-white/20 transition-all duration-300">
          <div>
            <form onSubmit={handleSubmit} className="space-y-4">
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

                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      className="h-10"
                    />
                    {errors.name && <p className="text-red-500 text-[10px]">{errors.name}</p>}
                  </div>

                  <div>
                    <OptimizedSelect
                      id="gender"
                      label="Gender"
                      value={formData.gender}
                      onChange={(value) => setFormData(prev => ({ ...prev, gender: value }))}
                      placeholder="Select Gender"
                      className="h-9 bg-blue-600/10 border-blue-500/20 text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </OptimizedSelect>
                    {errors.gender && <p className="text-red-500 text-[10px]">{errors.gender}</p>}
                  </div>

                  <div>
                    <EnhancedDatePicker
                      id="dob"
                      label="Date of Birth"
                      value={formData.dob}
                      onChange={(value) => handleDateChange('dob', value)}
                      required
                      validationType="dob-student"
                      className="h-9"
                    />
                    {errors.dob && <p className="text-red-500 text-[10px]">{errors.dob}</p>}
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
                      className="h-9"
                    />
                    {errors.phone && <p className="text-red-500 text-[10px]">{errors.phone}</p>}
                  </div>

                  <div>
                    <OptimizedInput
                      id="email"
                      label="Email Address"
                      type="email"
                      value={formData.email}
                      onChange={(value) => setFormData(prev => ({ ...prev, email: value }))}
                      placeholder="student@example.com"
                      required
                      className="h-9"
                    />
                    {errors.email && <p className="text-red-500 text-[10px]">{errors.email}</p>}
                  </div>

                  <div>
                    <OptimizedInput
                      id="alternatePhone"
                      label="Alternate Phone Number"
                      type="tel"
                      value={formData.alternatePhone}
                      onChange={(value) => setFormData(prev => ({ ...prev, alternatePhone: value }))}
                      placeholder="Optional alternate number"
                      transform={(val) => val.replace(/[^0-9]/g, '')}
                      className="h-9"
                    />
                    {errors.alternatePhone && <p className="text-red-500 text-[10px]">{errors.alternatePhone}</p>}
                  </div>

                  <div>
                    <OptimizedTextarea
                      id="address"
                      label="Address"
                      value={formData.address}
                      onChange={(value) => setFormData(prev => ({ ...prev, address: value }))}
                      placeholder="Enter full residential address"
                      rows={4}
                    />
                    {errors.address && <p className="text-red-500 text-[10px]">{errors.address}</p>}
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    {/* Faculty and Department Selector */}
                    <FacultyDepartmentSelector
                      onFacultySelect={handleFacultySelect}
                      onDepartmentSelect={handleDepartmentSelect}
                      initialFaculty={formData.faculty}
                      initialDepartment={formData.department}
                    />
                    {errors.faculty && <p className="text-red-500 text-[10px]">{errors.faculty}</p>}
                    {errors.department && <p className="text-red-500 text-[10px]">{errors.department}</p>}
                  </div>

                  <div>
                    <Label htmlFor="semester" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mt-3 mb-1">
                      Semester
                    </Label>
                    <Select
                      key={formData.semester}
                      value={formData.semester}
                      onValueChange={(value) => handleRefChange('semester', value)}
                    >
                      <SelectTrigger className="h-9 bg-blue-600/10 border-blue-500/20 text-gray-900 dark:text-gray-100 cursor-pointer">
                        <SelectValue placeholder="Select Semester" />
                      </SelectTrigger>
                      <SelectContent position="popper" side="bottom" align="start">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                          const label = sem === 1 ? '1st Semester' : sem === 2 ? '2nd Semester' : sem === 3 ? '3rd Semester' : `${sem}th Semester`;
                          return (
                            <SelectItem key={sem} value={label}>
                              {label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {errors.semester && <p className="text-red-500 text-[10px]">{errors.semester}</p>}
                  </div>



                  <div>
                    <OptimizedInput
                      id="enrollmentId"
                      label="Enrollment ID"
                      value={formData.enrollmentId}
                      onChange={(value) => setFormData(prev => ({ ...prev, enrollmentId: value }))}
                      placeholder="e.g. AU210001"
                      required
                      className="h-9"
                    />
                    {errors.enrollmentId && <p className="text-red-500 text-[10px]">{errors.enrollmentId}</p>}
                  </div>

                  <div>
                    <OptimizedSelect
                      id="bloodGroup"
                      label="Blood Group"
                      value={formData.bloodGroup}
                      onChange={(value) => setFormData(prev => ({ ...prev, bloodGroup: value }))}
                      placeholder="Select Blood Group"
                      className="h-9 bg-blue-600/10 border-blue-500/20 text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <SelectItem value="A+">A+</SelectItem>
                      <SelectItem value="A-">A-</SelectItem>
                      <SelectItem value="B+">B+</SelectItem>
                      <SelectItem value="B-">B-</SelectItem>
                      <SelectItem value="AB+">AB+</SelectItem>
                      <SelectItem value="AB-">AB-</SelectItem>
                      <SelectItem value="O+">O+</SelectItem>
                      <SelectItem value="O-">O-</SelectItem>
                    </OptimizedSelect>
                    {errors.bloodGroup && <p className="text-red-500 text-[10px]">{errors.bloodGroup}</p>}
                  </div>

                  <div>
                    <OptimizedInput
                      id="parentName"
                      label="Parent Name"
                      value={formData.parentName}
                      onChange={(value) => setFormData(prev => ({ ...prev, parentName: value }))}
                      placeholder="Enter parent name"
                      required
                      className="h-9"
                    />
                    {errors.parentName && <p className="text-red-500 text-[10px]">{errors.parentName}</p>}
                  </div>

                  <div>
                    <OptimizedInput
                      id="parentPhone"
                      label="Parent Phone Number"
                      type="tel"
                      value={formData.parentPhone}
                      onChange={(value) => setFormData(prev => ({ ...prev, parentPhone: value }))}
                      placeholder="Parent contact number"
                      required
                      transform={(val) => val.replace(/[^0-9]/g, '')}
                      className="h-9"
                    />
                    {errors.parentPhone && <p className="text-red-500 text-[10px]">{errors.parentPhone}</p>}
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
                      className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed h-9"
                      disabled
                    />
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">This field is auto-filled</p>
                  </div>
                </div>
              </div>

              {/* BUS & ROUTE DETAILS + TRANSACTION DETAILS (Combined Payment Section) */}
              <div className="mt-4">
                <AddStudentPaymentSection
                  formData={{
                    shift: formData.shift,
                    routeId: formData.routeId,
                    busId: formData.busId || '',
                    pickupPoint: formData.pickupPoint,
                    sessionDuration: formData.sessionDuration,
                    sessionStartYear: formData.sessionStartYear,
                    sessionEndYear: formData.sessionEndYear,
                    validUntil: formData.validUntil,
                    busAssigned: formData.busAssigned,
                  }}
                  onFormChange={handleRefChange}
                  routes={routes}
                  buses={buses}
                  busFee={busFee}
                  loadingRoutes={loadingRoutes}
                  loadingBuses={loadingBuses}
                />
              </div>

              <div className="flex justify-end space-x-2 mt-4">
                <Button
                  type="button"
                  onClick={handleReset}
                  className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-3 text-xs"
                >
                  Reset
                </Button>
                <Link href="/moderator/students">
                  <Button type="button" className="bg-red-600 hover:bg-red-700 text-white h-8 px-3 text-xs">
                    Cancel
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-xs flex items-center gap-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Student'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
