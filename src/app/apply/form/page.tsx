"use client";

import FormStepper from './components/FormStepper';
import Step1Personal from './steps/Step1Personal';
import Step2Academic from './steps/Step2Academic';
import Step3Bus from './steps/Step3Bus';
import Step4ServicePayment from './steps/Step4ServicePayment';
import Step5Review from './steps/Step5Review';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2,
  CheckCircle,
  Info,
  RotateCcw,
  Camera,
  Building2,
  Calendar,
  MapPin,
  CreditCard
} from 'lucide-react';
import { trackEvent } from '@/components/Analytics';
import ProfileImageAddModal from '@/components/ProfileImageAddModal';
import { ApplicationFormData, ApplicationState } from '@/lib/types/application';
import Image from 'next/image';
import { getAllRoutes, getAllBuses } from '@/lib/dataService';
import { Route } from '@/lib/types';
import ApplyFormNavbar from '@/components/ApplyFormNavbar';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  hasCompletedPayment,
  getCurrentPaymentSession,
  clearPaymentSession,
  calculateSessionDates
} from '@/lib/payment/application-payment.service';
import {
  type CapacityCheckResult
} from '@/lib/bus-capacity-checker';
import { useToast } from '@/contexts/toast-context';
import { uploadImage } from '@/lib/upload';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { isMobileDevice, compressImageForMobile } from '@/lib/mobile-utils';
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';

const STEP_LABELS = [
  { num: 1, title: "Personal Information" },
  { num: 2, title: "Academic Information" },
  { num: 3, title: "Bus Information" },
  { num: 4, title: "Payment Information" },
  { num: 5, title: "Review Information" }
];

const APPLICATION_DRAFT_EXCLUDED_FIELDS = ['profilePhotoUrl', 'paymentInfo.paymentEvidenceUrl'];

const revokeBlobUrl = (url?: string | null) => {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

function ApplicationFormContent() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 5;

  const scrollToFormTop = useCallback(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, []);

  // Helper function to get initial form data from localStorage
  const getInitialFormData = (): ApplicationFormData => {
    const defaultData: ApplicationFormData = {
      fullName: '',
      email: currentUser?.email || '',
      phoneNumber: '',
      alternatePhone: '',
      enrollmentId: '',
      gender: '',
      dob: '',
      age: '',
      profilePhotoUrl: '',
      faculty: '',
      department: '',
      semester: '',
      address: '',
      parentName: '',
      parentPhone: '',
      bloodGroup: '',
      routeId: '',
      stop_name: '',
      busId: '',
      busAssigned: '',
      shift: '',
      sessionInfo: {
        sessionStartYear: new Date().getFullYear(),
        durationYears: 1,
        sessionEndYear: new Date().getFullYear() + 1,
        feeEstimate: 0
      },
      paymentInfo: {
        paymentMode: 'offline',
        amountPaid: 0,
        paymentEvidenceProvided: false,
        paymentReference: '',
        paymentEvidenceUrl: ''
      },
      declarationAccepted: false
    };

    // Try to load from localStorage synchronously
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('applicationDraft');
        if (stored) {
          const parsed = JSON.parse(stored);
          console.log('“¬ [Apply Form] Loaded draft from localStorage on init', Object.keys(parsed).length, 'fields');
          return {
            ...defaultData,
            ...parsed,
            // Always reset sensitive/transient fields
            declarationAccepted: false,
            // Preserve email from currentUser
            email: currentUser?.email || parsed.email || '',
            // Reset session info to current year
            sessionInfo: {
              ...defaultData.sessionInfo,
              ...(parsed.sessionInfo || {}),
              durationYears: 1,
              sessionStartYear: new Date().getFullYear(),
              sessionEndYear: new Date().getFullYear() + 1
            }
          };
        }
      } catch (error) {
        console.error('❌ [Apply Form] Error loading draft from localStorage:', error);
      }
    }

    return defaultData;
  };

  const getInitialApplicationState = () => {
    if (typeof window !== 'undefined') {
      try {
        const storedState = localStorage.getItem('applicationState');
        return (storedState as ApplicationState) || 'noDoc';
      } catch (error) {
        console.error('❌ [Apply Form] Error loading application state:', error);
      }
    }
    return 'noDoc' as ApplicationState;
  };

  // Form state - Initialize with data from localStorage
  const [formData, setFormData] = useState<ApplicationFormData>(getInitialFormData);

  const goToNextStep = useCallback(() => {
    if (currentStep < TOTAL_STEPS) {
      localStorage.setItem('applicationDraft', JSON.stringify(formData));
      setCurrentStep(prev => prev + 1);
      scrollToFormTop();
    }
  }, [currentStep, formData, scrollToFormTop]);

  const goToPrevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
      scrollToFormTop();
    }
  }, [currentStep, scrollToFormTop]);

  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= TOTAL_STEPS) {
      setCurrentStep(step);
      scrollToFormTop();
    }
  }, [scrollToFormTop]);

  // Profile photo state
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0, scale: 1 });
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string>('');

  const [applicationId, setApplicationId] = useState<string>('');

  // Initialize application state from localStorage
  const [applicationState, setApplicationState] = useState<ApplicationState>(getInitialApplicationState());

  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [facultySelected, setFacultySelected] = useState(false);
  const [declarationAgreed, setDeclarationAgreed] = useState(false);
  const [paymentResetKey, setPaymentResetKey] = useState(0);
  const [busFees, setBusFees] = useState(0);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [assignedBusInfo, setAssignedBusInfo] = useState<any>(null);
  const [deadlineConfig, setDeadlineConfig] = useState<any>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingResources, setLoadingResources] = useState(true);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<any>(null);
  const [useOnlinePayment, setUseOnlinePayment] = useState(false);
  const [uploadingProfilePhoto, setUploadingProfilePhoto] = useState(false);
  const [showProfileUpdateModal, setShowProfileUpdateModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const toastShownRef = useRef(false);

  // Toggle .no-global-scrollbar class on HTML element for Apply Form page to prevent scrollbar shifting/shaking
  useEffect(() => {
    document.documentElement.classList.add('no-global-scrollbar');
    return () => {
      document.documentElement.classList.remove('no-global-scrollbar');
    };
  }, []);

  useEffect(() => {
    return () => revokeBlobUrl(profilePhotoUrl);
  }, [profilePhotoUrl]);

  useEffect(() => {
    return () => revokeBlobUrl(receiptPreview);
  }, [receiptPreview]);

  // Debounced auto-save to prevent excessive localStorage writes
  const debouncedAutoSave = useRef<NodeJS.Timeout | null>(null);

  // Import debounced storage hook
  const storage = useDebouncedStorage<ApplicationFormData>('applicationDraft', {
    debounceMs: 500,
    excludeFields: APPLICATION_DRAFT_EXCLUDED_FIELDS,
  });

  // Auto-save formData changes (debounced) - ONLY save, don't read
  const lastSavedData = useRef<string>('');

  useEffect(() => {
    if (debouncedAutoSave.current) {
      clearTimeout(debouncedAutoSave.current);
    }

    debouncedAutoSave.current = setTimeout(() => {
      const dataString = JSON.stringify(formData);
      // Only save if data actually changed
      if (dataString !== lastSavedData.current) {
        console.log('¾ [Apply Form] Auto-saving to localStorage...', {
          fullName: formData.fullName,
          phoneNumber: formData.phoneNumber,
          gender: formData.gender
        });
        storage.save(formData);
        lastSavedData.current = dataString;
      }
    }, 500);

    return () => {
      if (debouncedAutoSave.current) {
        clearTimeout(debouncedAutoSave.current);
      }
    };
  }, [formData, storage]);

  // Mobile detection
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);


  const [isSubmitted, setIsSubmitted] = useState(false);
  const [existingApplication, setExistingApplication] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshStatus = async () => {
    if (!currentUser) return;
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/applications/check', {
        headers: {
          'Authorization': `Bearer ${await currentUser.getIdToken()}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.hasApplication) {
          setApplicationState(data.state);
          if (data.state === 'approved') {
            router.push('/student');
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing status:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Persistence for application state and verification state
  useEffect(() => {
    if (applicationState !== 'noDoc' && applicationState !== 'submitted') {
      localStorage.setItem('applicationState', applicationState);
    }
  }, [applicationState]);



  // Bus capacity check state
  const [capacityCheckResult, setCapacityCheckResult] = useState<CapacityCheckResult | null>(null);
  const [checkingCapacity, setCheckingCapacity] = useState(false);
  const [showCapacityWarning, setShowCapacityWarning] = useState(false);





  // Cleanup function - CRITICAL for mobile
  useEffect(() => {
    return () => {
      if (debouncedAutoSave.current) {
        clearTimeout(debouncedAutoSave.current);
        debouncedAutoSave.current = null;
      }
    };
  }, []);

  // Step validation logic used by the always-mounted steppers.
  const completedSteps = useMemo(() => ({
    1: !!(formData.fullName && formData.gender && formData.dob &&
      formData.phoneNumber && formData.parentName && formData.parentPhone &&
      formData.address && (finalImageUrl || profilePhotoUrl)),
    2: !!(formData.faculty && formData.department && formData.semester && formData.enrollmentId),
    3: !!(formData.routeId && formData.stop_name && formData.shift),
    4: paymentCompleted,
  }), [
    formData.fullName,
    formData.gender,
    formData.dob,
    formData.phoneNumber,
    formData.parentName,
    formData.parentPhone,
    formData.address,
    formData.faculty,
    formData.department,
    formData.semester,
    formData.enrollmentId,
    formData.routeId,
    formData.stop_name,
    formData.shift,
    finalImageUrl,
    profilePhotoUrl,
    paymentCompleted,
  ]);

  const [visitedSteps, setVisitedSteps] = useState<number[]>([1]);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    setVisitedSteps(prev => {
      const nextVisited = [...prev];
      for (let i = 1; i <= currentStep; i++) {
        if (!nextVisited.includes(i)) {
          nextVisited.push(i);
        }
      }
      return nextVisited;
    });
  }, [currentStep]);


  // Auth check & redirection effect (stable dependencies)
  useEffect(() => {
    if (!loading && !currentUser) {
      console.log('🔄 No user, redirecting to login');
      router.push('/login');
      return;
    }

    if (userData && userData.role) {
      console.log('🔄 User has role, redirecting to dashboard');
      router.push(`/${userData.role}`);
      return;
    }
  }, [loading, currentUser, userData, router]);

  // Form initialization effect (guaranteed once via hasInitializedRef)
  useEffect(() => {
    const checkExistingApplication = async () => {
      if (!currentUser || loading || userData?.role || hasInitializedRef.current) return;
      hasInitializedRef.current = true;

      console.log('📋 Checking existing application for user:', currentUser.uid);

      try {
        const response = await fetch('/api/applications/check', {
          headers: {
            'Authorization': `Bearer ${await currentUser.getIdToken()}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          // If application exists and is not rejected/draft (so submitted, approved, verified), redirect to /student dashboard for canonical entitlement lifecycle messaging
          if (data.hasApplication && data.state !== 'rejected' && data.state !== 'draft' && data.state !== 'noDoc') {
            console.log('✅ User has existing application in state:', data.state, '-> Redirecting to /student');
            router.push('/student');
            return;
          }
        }
      } catch (error) {
        console.error('Error checking existing application:', error);
      }

      console.log('✅ Loading application form resources (once)...');
      loadResources();
      loadDraftOrExisting();
    };

    checkExistingApplication();
  }, [loading, currentUser, userData]);



  const loadResources = async () => {
    try {
      // Load routes, buses, fees and deadline config in parallel
      const [routesData, busesData, feesRes, deadlineRes] = await Promise.all([
        getAllRoutes(),
        getAllBuses(),
        fetch(`/api/settings/bus-fees?t=${Date.now()}`, { cache: 'no-store' }),
        fetch('/api/settings/deadline-config')
      ]);

      console.log('🛣️ Loaded routes:', routesData);
      setRoutes(routesData);
      setBuses(busesData);

      if (feesRes.ok) {
        const feesData = await feesRes.json();
        const fee = feesData.fees || feesData.amount || 0;
        console.log('💰 Loaded bus fee from API:', fee);
        setBusFees(fee);
      }

      if (deadlineRes.ok) {
        const deadlineData = await deadlineRes.json();
        setDeadlineConfig(deadlineData.config || deadlineData);
        console.log("📅 [Apply Form] Fetched deadline config:", deadlineData.config || deadlineData);
      }

    } catch (error) {
      console.error('Error loading resources:', error);
      showToast('Failed to load form resources', 'error');
    } finally {
      setLoadingResources(false);
    }
  };

  const loadDraftOrExisting = async () => {
    try {
      // Note: Draft data is now loaded synchronously during initialization
      // This function only handles loading existing applications from database

      console.log('“‹ Checking for existing application in database...');

      // Check for existing application in database
      const token = await currentUser?.getIdToken();
      const response = await fetch('/api/applications/my-application', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.application) {
          console.log('“‹ Loading existing application from database');
          setApplicationId(data.application.applicationId);
          setApplicationState(data.application.state);

          // Only update formData if there's an actual application (not just draft)
          if (data.application.state !== 'noDoc' && data.application.state !== 'draft') {
            setFormData(data.application.formData);
            setReceiptPreview(data.application.formData.paymentInfo.paymentEvidenceUrl || '');
            setReceiptFile(null);
            setProfilePhotoUrl(data.application.formData.profilePhotoUrl || '');



            if (data.application.state === 'verified' || data.application.state === 'submitted') {
              showToast('Application already submitted. Waiting for approval.', 'info');
              return;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading application:', error);
    }
  };

  // Optimized input change handler - immediate update, no batching
  const handleInputChange = useCallback((field: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev };
      const keys = field.split('.');
      let current: any = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;

      return updated;
    });
  }, []);

  const handleFacultySelect = useCallback((faculty: string) => {
    setFormData(prev => ({ ...prev, faculty }));
    setFacultySelected(true);
  }, []);

  const handleDepartmentSelect = useCallback((department: string) => {
    setFormData(prev => ({ ...prev, department }));
  }, []);

  const handleProfileImageUpdate = async (newImageUrl: string, file?: File) => {
    // Update local preview and form data
    setProfilePhotoUrl(newImageUrl);
    setFinalImageUrl(newImageUrl);

    if (file) {
      setProfilePhotoFile(file);
    } else {
      setProfilePhotoFile(null);
    }

    // We update the form data with the blob URL for now, but will replace it on submit if file exists
    setFormData(prev => ({ ...prev, profilePhotoUrl: newImageUrl }));
  };

  const handleImageRemove = () => {
    // Clean up the object URL to prevent memory leaks
    revokeBlobUrl(profilePhotoUrl);
    setProfilePhotoUrl('');
    setFinalImageUrl(null);
    setProfilePhotoFile(null);
    setImagePosition({ x: 0, y: 0, scale: 1 });
    setFormData(prev => ({ ...prev, profilePhotoUrl: '' }));
  };

  const handleRefChange = useCallback((field: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev };
      const keys = field.split('.');
      let current: any = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;

      return updated;
    });
  }, []);

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (file.size > 5 * 1024 * 1024) {
      showToast('File size must be less than 5MB', 'error');
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file', 'error');
      return;
    }

    // Clean up previous object URL if it exists
    revokeBlobUrl(receiptPreview);

    try {
      // Mobile optimization: Compress image if on mobile device
      let processedFile = file;
      if (isMobileDevice() && file.size > 1 * 1024 * 1024) { // 1MB threshold for mobile
        console.log('“± Mobile device detected, compressing image...');
        showToast('Optimizing image for mobile...', 'info');
        processedFile = await compressImageForMobile(file, 2);
        console.log(`“± Image compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB  ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      // Create local preview URL
      const previewUrl = URL.createObjectURL(processedFile);

      // Store file and preview
      setReceiptFile(processedFile);
      setReceiptPreview(previewUrl);
      setFormData(prev => ({
        ...prev,
        paymentInfo: { ...prev.paymentInfo, paymentEvidenceProvided: true }
      }));

      showToast('Receipt selected successfully', 'success');
    } catch (error) {
      console.error('Error processing receipt:', error);
      showToast('Error processing image. Please try again.', 'error');
    }
  };

  const handleSessionDurationChange = (duration: string) => {
    const durationNum = 1;
    const startYear = formData.sessionInfo.sessionStartYear;
    const endYear = startYear + durationNum;

    setFormData(prev => ({
      ...prev,
      sessionInfo: {
        ...prev.sessionInfo,
        durationYears: durationNum,
        sessionEndYear: endYear,
        feeEstimate: calculateTotalFee(durationNum, prev.shift)
      }
    }));

    // Also update the amount to be paid
    const newFee = calculateTotalFee(durationNum, formData.shift);
    setFormData(prev => ({
      ...prev,
      paymentInfo: { ...prev.paymentInfo, amountPaid: newFee }
    }));
  };

  const calculateTotalFee = (duration?: number, shift?: string) => {
    const dur = duration || formData.sessionInfo.durationYears;
    if (dur === 0) return 0; // No fee if no duration selected
    const shiftMultiplier = 1; // All shifts have the same fee now
    return busFees * dur * shiftMultiplier;
  };

  // Optimized fee sync effect with memoization to prevent excessive re-renders
  const previousFeeRef = useRef({ estimate: 0, paid: 0 });

  useEffect(() => {
    // Always calculate fee when busFees is available and durationYears is set (including 1)
    if (busFees > 0 && formData.sessionInfo.durationYears > 0) {
      const newFee = calculateTotalFee(formData.sessionInfo.durationYears, formData.shift);

      // Only update if changed to avoid loops and excessive re-renders
      if (newFee !== previousFeeRef.current.estimate || newFee !== previousFeeRef.current.paid) {
        console.log(`° Syncing fee: ${newFee} (was Est: ${previousFeeRef.current.estimate}, Paid: ${previousFeeRef.current.paid})`);

        previousFeeRef.current = { estimate: newFee, paid: newFee };

        setFormData(prev => ({
          ...prev,
          sessionInfo: {
            ...prev.sessionInfo,
            feeEstimate: newFee
          },
          paymentInfo: {
            ...prev.paymentInfo,
            amountPaid: newFee
          }
        }));
      }
    }
  }, [busFees, formData.sessionInfo.durationYears, formData.shift]);

  // Sync validUntil dynamically from academic calendar system config
  useEffect(() => {
    if (deadlineConfig && formData.sessionInfo.sessionStartYear && formData.sessionInfo.durationYears) {
      const dates = calculateSessionDates(
        formData.sessionInfo.sessionStartYear,
        formData.sessionInfo.durationYears,
        deadlineConfig
      );
      if (formData.sessionInfo.validUntil !== dates.validUntil) {
        setFormData(prev => ({
          ...prev,
          sessionInfo: {
            ...prev.sessionInfo,
            validUntil: dates.validUntil
          }
        }));
      }
    }
  }, [deadlineConfig, formData.sessionInfo.sessionStartYear, formData.sessionInfo.durationYears, formData.sessionInfo.validUntil]);

  const validateForm = useCallback(() => {
    // Personal Information validation
    if (!formData.fullName || !formData.phoneNumber || !formData.enrollmentId) {
      showToast('Please fill all required personal details', 'error');
      return false;
    }
    if (!formData.gender || !formData.dob || !formData.age) {
      showToast('Please fill all personal information fields', 'error');
      return false;
    }

    // Academic Information validation
    if (!formData.faculty || !formData.department || !formData.semester) {
      showToast('Please fill all academic information', 'error');
      return false;
    }

    // Contact Information validation
    if (!formData.address || !formData.parentName || !formData.parentPhone) {
      showToast('Please fill all contact information', 'error');
      return false;
    }

    // Medical Information validation
    if (!formData.bloodGroup) {
      showToast('Please select blood group', 'error');
      return false;
    }

    // Service Selection validation
    if (!formData.shift) {
      showToast('Please select a shift', 'error');
      return false;
    }
    if (!formData.routeId) {
      showToast('Please select a route', 'error');
      return false;
    }
    if (!formData.busId || !formData.busAssigned) {
      showToast('Please select a bus', 'error');
      return false;
    }
    if (!formData.stop_name) {
      showToast('Please select a pickup point / stop', 'error');
      return false;
    }

    // Session Duration validation
    if (!formData.sessionInfo.durationYears || formData.sessionInfo.durationYears === 0) {
      showToast('Please select session duration', 'error');
      return false;
    }

    // Profile Photo validation
    // Robust check: Check nested formData, standalone state, AND the raw file object
    const hasPhoto = formData.profilePhotoUrl || profilePhotoUrl || profilePhotoFile;
    if (!hasPhoto) {
      showToast('Please upload a profile photo', 'error');
      return false;
    }

    return true;
  }, [formData, profilePhotoUrl, profilePhotoFile, showToast]);

  const checkFormCompletion = useCallback(() => {
    // Personal Information
    if (!formData.fullName || !formData.phoneNumber || !formData.enrollmentId) return false;
    if (!formData.gender || !formData.dob || !formData.age) return false;

    // Academic Information
    if (!formData.faculty || !formData.department || !formData.semester) return false;

    // Contact Information
    if (!formData.address || !formData.parentName || !formData.parentPhone) return false;

    // Medical Information
    if (!formData.bloodGroup) return false;

    // Service Selection
    if (!formData.shift) return false;
    if (!formData.routeId) return false;

    // Session Duration
    if (!formData.sessionInfo.durationYears || formData.sessionInfo.durationYears === 0) return false;

    // Profile Photo
    if (!formData.profilePhotoUrl) return false;

    return true;
  }, [formData]);

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));

      const hasData = formData.fullName || formData.phoneNumber || formData.enrollmentId || formData.faculty;
      if (hasData) {
        showToast('œ… Draft auto-saved successfully!', 'success');
      } else {
        showToast('“  No data to save yet.', 'info');
      }
    } catch (error) {
      console.error('Error in save draft animation:', error);
      showToast('Draft save animation failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const [showClearPaymentConfirm, setShowClearPaymentConfirm] = useState(false);
  const [clearPaymentCountdown, setClearPaymentCountdown] = useState(7);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleClearStep = (stepNum: number) => {
    // Reset declaration status on any clear
    setDeclarationAgreed(false);

    // Reset application state to draft since form details are being cleared
    setApplicationState('draft');
    localStorage.setItem('applicationState', 'draft');

    // Remove verification flags if NOT a completed online payment
    const isOnlinePaymentCompleted = paymentCompleted && formData.paymentInfo?.paymentMode === 'online';
    if (!isOnlinePaymentCompleted) {
      localStorage.removeItem('verificationCompleted');
      localStorage.removeItem('backup_verification_state');
      localStorage.removeItem('verificationCompletedAt');
    }

    switch (stepNum) {
      case 1:
        setFormData(prev => ({
          ...prev,
          declarationAccepted: false,
          fullName: '',
          gender: '',
          dob: '',
          age: '',
          profilePhotoUrl: '',
          bloodGroup: '',
          phoneNumber: '',
          alternatePhone: '',
          parentName: '',
          parentPhone: '',
          address: ''
        }));
        setProfilePhotoUrl('');
        setFinalImageUrl(null);
        setProfilePhotoFile(null);
        showToast('Step 1 (Personal Information) cleared.', 'info');
        break;

      case 2:
        setFormData(prev => ({
          ...prev,
          declarationAccepted: false,
          faculty: '',
          department: '',
          semester: '',
          enrollmentId: ''
        }));
        setFacultySelected(false);
        showToast('Step 2 (Academic Information) cleared.', 'info');
        break;

      case 3:
        setFormData(prev => ({
          ...prev,
          declarationAccepted: false,
          routeId: '',
          stop_name: '',
          busId: '',
          busAssigned: '',
          shift: ''
        }));
        showToast('Step 3 (Bus Information) cleared.', 'info');
        break;

      case 4:
        if (isOnlinePaymentCompleted) {
          setClearPaymentCountdown(7);
          setShowClearPaymentConfirm(true);

          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }

          countdownIntervalRef.current = setInterval(() => {
            setClearPaymentCountdown(prev => {
              if (prev <= 1) {
                if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        } else {
          setPaymentCompleted(false);
          setPaymentDetails(null);
          setUseOnlinePayment(false);
          setReceiptPreview('');
          setReceiptFile(null);
          setPaymentResetKey(prev => prev + 1);

          // Clear all payment/verification related localStorage keys for offline clear
          localStorage.removeItem('verificationCompleted');
          localStorage.removeItem('backup_verification_state');
          localStorage.removeItem('verificationCompletedAt');
          if (currentUser?.uid) {
            localStorage.removeItem(`payment_receipt_${currentUser.uid}_new_registration`);
            clearPaymentSession(currentUser.uid, 'new_registration');
          }

          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes('payment') || key.toLowerCase().includes('verification'))) {
              if (key !== 'paymentSessions') {
                keysToRemove.push(key);
              }
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));

          setFormData(prev => ({
            ...prev,
            declarationAccepted: false,
            paymentInfo: {
              paymentMode: 'offline',
              amountPaid: 0,
              paymentEvidenceProvided: false,
              paymentReference: '',
              paymentEvidenceUrl: ''
            }
          }));
          showToast('Step 4 (Payment Information) cleared.', 'info');
        }
        break;
    }
  };

  const performClearPayment = () => {
    setPaymentCompleted(false);
    setPaymentDetails(null);
    setUseOnlinePayment(false);
    setReceiptPreview('');
    setReceiptFile(null);
    setDeclarationAgreed(false);
    setPaymentResetKey(prev => prev + 1);

    setFormData(prev => ({
      ...prev,
      declarationAccepted: false,
      paymentInfo: {
        paymentMode: 'offline',
        amountPaid: 0,
        paymentEvidenceProvided: false,
        paymentReference: '',
        paymentEvidenceUrl: ''
      }
    }));

    localStorage.removeItem('verificationCompleted');
    localStorage.removeItem('applicationState');
    localStorage.removeItem('backup_verification_state');
    localStorage.removeItem('verificationCompletedAt');

    if (currentUser?.uid) {
      localStorage.removeItem(`payment_receipt_${currentUser.uid}_new_registration`);
      clearPaymentSession(currentUser.uid, 'new_registration');
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.toLowerCase().includes('payment') || key.toLowerCase().includes('verification'))) {
        if (key !== 'paymentSessions') {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    setApplicationState('draft');
    setShowClearPaymentConfirm(false);
    showToast('Online payment information cleared successfully.', 'success');
  };

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const [showDeletePaymentDialog, setShowDeletePaymentDialog] = useState(false);

  const performFullReset = () => {
    // Clear form data
    setFormData({
      fullName: '',
      email: currentUser?.email || '',
      phoneNumber: '',
      alternatePhone: '',
      enrollmentId: '',
      gender: '',
      dob: '',
      age: '',
      profilePhotoUrl: '',
      faculty: '',
      department: '',
      semester: '',
      address: '',
      parentName: '',
      parentPhone: '',
      bloodGroup: '',
      routeId: '',
      stop_name: '',
      busId: '',
      busAssigned: '',
      shift: 'morning',
      sessionInfo: {
        sessionStartYear: new Date().getFullYear(),
        durationYears: 1,
        sessionEndYear: new Date().getFullYear() + 1,
        feeEstimate: 0
      },
      paymentInfo: {
        paymentMode: 'offline',
        amountPaid: 0,
        paymentEvidenceProvided: false,
        paymentEvidenceUrl: '',
        paymentReference: ''
      },
      declarationAccepted: false
    });

    // Clear all related state
    setPreviewUrl('');
    setFinalImageUrl(null);
    setImagePosition({ x: 0, y: 0, scale: 1 });
    setProfilePhotoFile(null);
    setProfilePhotoUrl('');
    setApplicationId('');
    setFacultySelected(false);
    setDeclarationAgreed(false);
    setPaymentCompleted(false);
    setPaymentDetails(null);
    setUseOnlinePayment(false);
    setReceiptPreview('');
    setReceiptFile(null);
    setPaymentResetKey(prev => prev + 1);

    localStorage.removeItem('applicationDraft');
    localStorage.removeItem('receiptPreview');
    localStorage.removeItem('profilePhotoPreview');

    // CRITICAL FIX: Never delete payment sessions on form reset
    // localStorage.removeItem('paymentSessions');
    // localStorage.removeItem('currentPaymentSession');

    if (currentUser?.uid) {
      localStorage.removeItem(`payment_receipt_${currentUser.uid}_new_registration`);
    }

    showToast('Form reset successfully', 'success');
    setShowDeletePaymentDialog(false);
  };

  const handleResetForm = () => {
    // Check if online payment is active/completed
    const isOnlinePaymentActive = paymentCompleted && formData.paymentInfo?.paymentMode === 'online';

    if (isOnlinePaymentActive) {
      // If payment exists, execute Partial Reset (preserve payment) regardless of dirty state
      const currentPaymentInfo = { ...formData.paymentInfo };

      setFormData({
        fullName: '',
        email: currentUser?.email || '',
        phoneNumber: '',
        alternatePhone: '',
        enrollmentId: '',
        gender: '',
        dob: '',
        age: '',
        profilePhotoUrl: '',
        faculty: '',
        department: '',
        semester: '',
        address: '',
        parentName: '',
        parentPhone: '',
        bloodGroup: '',
        routeId: '',
        stop_name: '',
        busId: '',
        busAssigned: '',
        shift: '',
        sessionInfo: {
          sessionStartYear: new Date().getFullYear(),
          durationYears: 0,
          sessionEndYear: new Date().getFullYear(),
          feeEstimate: 0
        },
        paymentInfo: currentPaymentInfo, // Key: Preserve this!
        declarationAccepted: false
      });

      // Reset most state, but KEEP payment state
      setPreviewUrl('');
      setFinalImageUrl(null);
      setImagePosition({ x: 0, y: 0, scale: 1 });
      setProfilePhotoFile(null);
      setProfilePhotoUrl('');

      // Force state to 'draft' so user can edit the form again
      setApplicationState('draft');

      setFacultySelected(false);
      setDeclarationAgreed(false);

      setReceiptPreview('');
      setReceiptFile(null);

      // Clear localStorage BUT preserve payment keys
      localStorage.removeItem('applicationDraft');
      localStorage.removeItem('');
      localStorage.removeItem('verificationExpiry');
      localStorage.removeItem('');

      // Do NOT remove paymentSessions, currentPaymentSession, etc.

      showToast('Form reset successful.', 'info');
    } else {
      // Case 3: No online payment -> Full Reset
      performFullReset();
    }
  };

  const handleSubmitApplication = async () => {
    if (submitting) return;
    console.log('š€ Starting application submission...');
    console.log('“‹ Current state:', {
      applicationState,
      hasReceiptFile: !!receiptFile,
      receiptFileName: receiptFile?.name,
      hasReceiptUrl: !!formData.paymentInfo?.paymentEvidenceUrl,
      receiptUrl: formData.paymentInfo?.paymentEvidenceUrl,
      hasProfilePhotoFile: !!profilePhotoFile,
      profilePhotoFileName: profilePhotoFile?.name,
      hasProfilePhotoUrl: !!formData.profilePhotoUrl,
      paymentMode: formData.paymentInfo?.paymentMode
    });

    if (!formData.declarationAccepted) {
      showToast('Please accept the declaration first', 'error');
      return;
    }

    // CRITICAL: Re-validate form data before final submission
    // Even if verified (via online payment), we must ensure all fields are filled
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    try {
      // First, handle profile photo upload if we have a file waiting
      // Uses priority: 1. Raw file (new upload), 2. Nested state, 3. Standalone state
      let finalProfilePhotoUrl = formData.profilePhotoUrl || profilePhotoUrl;

      if (profilePhotoFile) {
        // Show uploading toast - REMOVED per user request
        // const uploadToast = showToast('Uploading profile photo...', 'info');

        try {
          const uploadedUrl = await uploadImage(profilePhotoFile);
          if (uploadedUrl) {
            finalProfilePhotoUrl = uploadedUrl;
            console.log('œ… Profile photo uploaded successfully:', finalProfilePhotoUrl);
          } else {
            throw new Error('Upload returned empty URL');
          }
        } catch (uploadError) {
          console.error('Failed to upload profile photo:', uploadError);
          showToast('Failed to upload profile photo. Please try again.', 'error');
          setSubmitting(false);
          return;
        }
      }

      // Safety check: Ensure we never submit a blob URL
      if (finalProfilePhotoUrl && finalProfilePhotoUrl.startsWith('blob:')) {
        console.error('Attempted to submit blob URL for profile photo');
        showToast('Profile photo upload invalid. Please re-select your photo.', 'error');
        setSubmitting(false);
        return;
      }

      const applicationData = {
        ...formData,
        profilePhotoUrl: finalProfilePhotoUrl, // Use the uploaded URL, not the blob
        paymentInfo: {
          ...formData.paymentInfo,
          // Ensure payment status matches mode
          paymentStatus: formData.paymentInfo.paymentMode === 'online' ? 'completed' : 'pending'
        }
      };
      console.log('š€ Starting application submission process...');

      // Force token refresh to ensure authentication is valid (handles case where phone screen was off)
      let token;
      try {
        console.log('”„ Refreshing auth token...');
        token = await currentUser?.getIdToken(true);
      } catch (authError) {
        console.error('Failed to refresh auth token:', authError);
        // Fallback to existing token if refresh fails
        token = await currentUser?.getIdToken();
      }

      if (!token) {
        console.error('Failed to get auth token');
        throw new Error('Authentication session expired. Please refresh the page and sign in again.');
      }
      console.log('Auth token retrieved successfully');

      // Upload receipt file if there's one (using same /api/upload as profile photo)
      let receiptUrl = formData.paymentInfo.paymentEvidenceUrl || '';
      let receiptProvided = formData.paymentInfo.paymentEvidenceProvided;

      if (receiptFile) {
        console.log('“¤ Uploading receipt during form submission...');

        // Mobile optimization: Check file size and compress if needed
        if (receiptFile.size > 2 * 1024 * 1024) { // 2MB threshold for mobile
          console.log('š ï¸  Large file detected on mobile, this might cause issues');
          showToast('Large file detected. Upload may take longer on mobile.', 'info');
        }

        const formDataUpload = new FormData();
        formDataUpload.append('file', receiptFile);

        // Mobile-specific retry logic
        let uploadSuccess = false;
        let lastError: Error | null = null;
        const maxRetries = isMobileDevice() ? 2 : 1; // More retries on mobile

        for (let attempt = 1; attempt <= maxRetries && !uploadSuccess; attempt++) {
          try {
            console.log(`“¤ Upload attempt ${attempt}/${maxRetries}`);

            if (attempt > 1) {
              showToast(`Retrying upload (${attempt}/${maxRetries})...`, 'info');
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            // Mobile-specific timeout and retry logic
            const uploadResponse = await Promise.race([
              fetch('/api/upload', {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formDataUpload
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Upload timeout')), 30000) // 30 second timeout
              )
            ]) as Response;

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              receiptUrl = uploadData.url;
              receiptProvided = true; // Mark as provided when receipt is uploaded
              console.log('œ… Receipt uploaded successfully:', receiptUrl);
              uploadSuccess = true;
            } else {
              let errorMsg = `Upload failed with status ${uploadResponse.status}`;
              try {
                const errorData = await uploadResponse.json();
                if (errorData?.error) {
                  errorMsg = errorData.error;
                }
              } catch {
                // Ignore parsing error, fallback to status code
              }
              console.error(`Receipt upload failed (attempt ${attempt}):`, errorMsg);
              lastError = new Error(errorMsg);
            }
          } catch (uploadError: any) {
            console.error(`Receipt upload error (attempt ${attempt}):`, uploadError);
            lastError = uploadError;

            if (uploadError.message === 'Upload timeout') {
              lastError = new Error('Upload timed out. Please try with a smaller image or better network connection.');
            } else if (uploadError.name === 'TypeError' && uploadError.message.includes('fetch')) {
              lastError = new Error('Network error during upload. Please check your internet connection and try again.');
            }
          }
        }

        if (!uploadSuccess && lastError) {
          throw lastError;
        }
      }

      // Submit application with verification code ID
      console.log('“¤ Sending final application data to /api/applications/submit-final...');
      const response = await fetch('/api/applications/submit-final', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          formData: {
            ...formData,
            profilePhotoUrl: finalProfilePhotoUrl,
            paymentInfo: {
              ...formData.paymentInfo,
              paymentEvidenceUrl: receiptUrl,
              paymentEvidenceProvided: receiptProvided
            }
          },
          needsCapacityReview: capacityCheckResult?.needsCapacityReview || false
        })
      });

      console.log('“¥ Response received from submit-final:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });

      if (response.ok) {
        const data = await response.json();
        console.log('œ… Application submission confirmed by server');

        trackEvent('student_added');
        showToast('Application submitted successfully! Waiting for approval from the Managing Team.', 'success');

        // Clean up all localStorage data related to the application
        const cleanupKeys = [
          'applicationDraft', 'applicationState',
          'receiptPreview', 'profilePhotoPreview',
          'lastFormStep', 'form_start_time'
        ];

        cleanupKeys.forEach(key => localStorage.removeItem(key));

        // Use service to safely clear current user's payment data
        if (currentUser?.uid) {
          clearPaymentSession(currentUser.uid, 'new_registration');
          localStorage.removeItem(`payment_receipt_${currentUser.uid}_new_registration`);
        }

        // Deep cleanup of dynamic keys (excluding shared payment sessions)
        // Correctly collect keys FIRST before removing to avoid indexing issues
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;

          // Skip important cross-user data
          if (key === 'paymentSessions') continue;

          // Target application, form, draft, and payment related keys
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('application') ||
            lowerKey.includes('form') ||
            lowerKey.includes('draft') ||
            lowerKey.includes('payment')) {

            // Final safety check for shared storage
            if (key !== 'paymentSessions') {
              keysToRemove.push(key);
            }
          }
        }

        // Final execution of key removal
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log(`Cleared ${keysToRemove.length} application-related localStorage keys.`);

        // Clean up the object URLs if they were local previews
        if (formData.profilePhotoUrl && formData.profilePhotoUrl.startsWith('blob:')) {
          URL.revokeObjectURL(formData.profilePhotoUrl);
        }
        if (receiptPreview && receiptPreview.startsWith('blob:')) {
          URL.revokeObjectURL(receiptPreview);
        }

        // Redirect to welcome/info page
        router.push('/apply');
      } else {
        let errorData;
        try {
          const text = await response.text();
          try {
            errorData = JSON.parse(text);
          } catch (e) {
            console.error('Failed to parse error response as JSON:', text);
            errorData = { message: `Server error (${response.status}): ${text.substring(0, 100)}...` };
          }
        } catch (readError) {
          errorData = { message: `Critical server error (${response.status})` };
        }
        throw new Error(errorData.message || errorData.error || 'Failed to submit application');
      }
    } catch (error: any) {
      console.error('CRITICAL: Error submitting application:', error);
      console.error('Diagnostic Info:', {
        name: error.name,
        message: error.message,
        isTypeError: error instanceof TypeError,
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
        stack: error.stack
      });

      // Provide user-friendly error messages
      let errorMessage = 'Failed to submit application';

      if (error.message.includes('Cloudinary')) {
        errorMessage = 'Failed to upload payment receipt. Please check your internet connection and try again.';
      } else if (error.message.includes('profile photo')) {
        errorMessage = 'Failed to upload profile photo. Please try again or choose a different image.';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (error.message.includes('verification')) {
        errorMessage = error.message; // Use the specific verification error message
      } else {
        errorMessage = error.message || 'Failed to submit application. Please try again.';
      }

      showToast(errorMessage, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    console.log('CHECKING VERIFICATION STATE ON LOAD...');

    // Check for completed payment (both online and offline) and verification state
    if (currentUser) {
      console.log('Current user found, checking verification state...');

      // Log all relevant localStorage keys
      const verificationCompleted = localStorage.getItem('verificationCompleted');
      const savedApplicationState = localStorage.getItem('applicationState');
      const backupVerificationState = localStorage.getItem('backup_verification_state');
      const verificationCompletedAt = localStorage.getItem('verificationCompletedAt');

      console.log('localStorage verification data:', {
        verificationCompleted,
        savedApplicationState,
        backupVerificationState,
        verificationCompletedAt,
        allKeys: Object.keys(localStorage).filter(key =>
          key.includes('verification') || key.includes('application')
        )
      });

      // First check if verification was completed (most reliable)
      if (verificationCompleted === 'true' && savedApplicationState === 'verified') {
        console.log('œ… RESTORING VERIFICATION STATE from localStorage flags');
        setApplicationState('verified');
        setPaymentCompleted(true);
        return;
      }

      // Check backup verification state
      if (backupVerificationState) {
        try {
          const backupData = JSON.parse(backupVerificationState);
          if (backupData.verified && backupData.userId === currentUser.uid) {
            console.log('œ… RESTORING VERIFICATION STATE from backup data');
            setApplicationState('verified');
            setPaymentCompleted(true);
            // Restore primary flags if missing
            localStorage.setItem('verificationCompleted', 'true');
            localStorage.setItem('applicationState', 'verified');
            return;
          }
        } catch (e) {
          console.warn('š ï¸  Failed to parse backup verification state:', e);
        }
      }

      // Fallback to payment session check
      console.log('”„ Checking payment session as fallback...');
      const completedPayment = hasCompletedPayment(currentUser.uid, 'new_registration');
      if (completedPayment) {
        console.log('³ Found completed payment, checking session...');
        setPaymentCompleted(true);
        const session = getCurrentPaymentSession();
        if (session) {
          console.log('“¦ Payment session found:', session);
          // Handle online payment
          if (session.paymentMode === 'online' && session.razorpayPaymentId) {
            setPaymentDetails({
              paymentId: session.razorpayPaymentId,
              orderId: session.razorpayOrderId,
              amount: session.amount
            });
            setUseOnlinePayment(true);
            setApplicationState('verified');
            console.log('œ… Restored online payment verification from localStorage');
          }
          // Handle offline payment
          else if (session.paymentMode === 'offline' && session.offlinePaymentId) {
            setUseOnlinePayment(false);
            setApplicationState('verified');
            console.log('œ… Restored offline payment verification from localStorage');
          }
        } else {
          console.log('š ï¸  No payment session found despite completed payment flag');
        }
      } else {
        console.log('„¹ï¸  No completed payment found');
      }
    } else {
      console.log('⚠️ No current user found');
    }

    console.log('🔄 VERIFICATION STATE CHECK COMPLETED');
  }, [currentUser]);

  if (loading || (currentUser && loadingResources)) {
    return <PremiumPageLoader fullScreen message="Initializing Application Form..." subMessage="Loading resources and verification status..." />;
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-[#05060e] dark:bg-[#05060e] overflow-x-hidden">
        <ApplyFormNavbar />
        <div className="apply-received-container relative z-10 pt-20 sm:pt-28 pb-16 min-h-[calc(100vh-80px)] flex items-center justify-center px-4">

          <div className="w-full max-w-[420px] relative z-10">
            {/* Clean Card: larger sizing, solid styling, no heavy shadows or blurs */}
            <div className="apply-received-card bg-[#0c0e1a] border border-slate-900 rounded-[2rem] p-8 sm:p-10 shadow-2xl min-h-[560px] flex flex-col justify-between overflow-hidden">

              {/* Header Container */}
              <div className="flex flex-col items-center text-center pt-2">
                {/* Icon Container */}
                <div className="apply-received-icon-container mb-6">
                  <div className="apply-received-icon-box h-16 w-16 bg-[#161a30] border border-emerald-500/20 rounded-2xl flex items-center justify-center shadow-md">
                    <CheckCircle className="h-8 w-8 text-emerald-400" />
                  </div>
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
                  Application Received
                </h1>

                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-sm px-2">
                  Your registration has been securely submitted to the <span className="text-indigo-400 font-medium">AdtU Bus Services</span> team.
                </p>
              </div>

              {/* Status Progress Timeline */}
              <div className="apply-received-timeline w-full bg-[#080a13] border border-slate-900 rounded-2xl p-5 shadow-inner my-5">
                <div className="flex items-center justify-between relative px-2">
                  {/* Connecting Line */}
                  <div className="absolute top-[15px] left-8 right-8 h-[2px] bg-slate-800 z-0"></div>
                  <div className="absolute top-[15px] left-8 right-1/2 h-[2px] bg-gradient-to-r from-emerald-500 to-indigo-500 z-0"></div>

                  {/* Step 1: Submitted */}
                  <div className="relative z-10 flex flex-col items-start gap-1.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">Submitted</span>
                  </div>

                  {/* Step 2: Under Review - slow blink dot (animate-pulse) */}
                  <div className="relative z-10 flex flex-col items-center gap-1.5">
                    <div className="w-8 h-8 rounded-full bg-indigo-950/80 border-2 border-indigo-500/80 flex items-center justify-center animate-pulse">
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-400"></div>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-300 tracking-wider uppercase">Review</span>
                  </div>

                  {/* Step 3: Approved */}
                  <div className="relative z-10 flex flex-col items-end gap-1.5">
                    <div className="w-8 h-8 rounded-full bg-[#111322] border-2 border-slate-800 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-slate-700"></div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">Approved</span>
                  </div>
                </div>
              </div>

              {/* Next Steps Section */}
              <div className="apply-received-steps w-full bg-[#101326]/30 border border-slate-900 rounded-xl p-5 flex gap-3.5 items-start mb-5">
                <div className="p-2 bg-indigo-500/10 rounded-xl shrink-0 border border-indigo-500/20 shadow-inner mt-0.5">
                  <Info className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-left">
                  <h4 className="text-[10px] font-bold text-indigo-300 tracking-wider uppercase mb-1">Next Steps</h4>
                  <p className="text-xs sm:text-[13px] text-slate-400 leading-relaxed font-light">
                    Our team has received your application, and will review and verify it in the next <span className="text-indigo-200 font-semibold">2-3 business working days</span>. Once approved, you will get access to your student dashboard.
                  </p>
                </div>
              </div>

              {/* Clickable Refresh Footer */}
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs text-slate-400 hover:text-slate-200 font-medium bg-[#080a13] hover:bg-[#121528] active:scale-[0.98] transition-all rounded-full border border-slate-900 shadow-inner cursor-pointer"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                  </span>
                  <span>{isRefreshing ? 'Refreshing...' : 'Refreshed just now'}</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05060e] dark:bg-[#05060e] overflow-x-hidden">
      <ApplyFormNavbar />



      <div className="relative z-10 pt-16 sm:pt-24 pb-16 min-h-screen">
        <div className="flex flex-col md:flex-row justify-start px-4 sm:px-12 max-w-[1600px] mx-auto">
          {/* Left Sidebar - Fixed Vertical Navigation (Desktop) */}
          <div className="hidden md:flex fixed left-10 top-[calc(50%+28px)] -translate-y-1/2 w-72 flex-col gap-4 z-50">
            <div className="bg-[#0c0e1a]/90 border border-slate-800/70 rounded-3xl p-5 shadow-xl shadow-black/30 [contain:layout_paint]">
              <FormStepper
                steps={STEP_LABELS}
                currentStep={currentStep}
                onStepClick={goToStep}
                vertical={true}
                completedSteps={completedSteps}
                visitedSteps={visitedSteps}
              />
            </div>
          </div>

          {/* Mobile Stepper - Horizontal */}
          <div className="w-full md:hidden mb-8">
            <div className="bg-[#0c0e1a]/90 border border-slate-800/60 rounded-2xl p-4 py-8 shadow-lg shadow-black/25 [contain:layout_paint]">
              <FormStepper
                steps={STEP_LABELS}
                currentStep={currentStep}
                onStepClick={goToStep}
                completedSteps={completedSteps}
                visitedSteps={visitedSteps}
              />
            </div>
          </div>

          {/* Right Side - Form Content */}
          <div className="flex-1 w-full max-w-4xl lg:max-w-6xl ml-0 md:ml-[300px] lg:ml-[340px] flex flex-col gap-6">
            <div className="bg-[#0c0e1a]/95 md:bg-[#0c0e1a]/90 border border-slate-800/60 rounded-3xl shadow-xl shadow-black/30 overflow-hidden p-0 sm:p-8 flex flex-col [contain:layout_paint] md:min-h-[600px]">
              <div className="p-6 sm:p-2 flex-1 flex flex-col">
                {currentStep === 1 && (
                  <Step1Personal
                    formData={formData}
                    handleInputChange={handleInputChange}
                    onNext={goToNextStep}
                    currentUser={currentUser}
                    profilePhotoUrl={profilePhotoUrl}
                    finalImageUrl={finalImageUrl}
                    setShowProfileUpdateModal={setShowProfileUpdateModal}
                    handleImageRemove={handleImageRemove}
                    onClear={() => handleClearStep(1)}
                  />
                )}

                {currentStep === 2 && (
                  <Step2Academic
                    formData={formData}
                    handleInputChange={handleInputChange}
                    onNext={goToNextStep}
                    onPrev={goToPrevStep}
                    handleFacultySelect={handleFacultySelect}
                    handleDepartmentSelect={handleDepartmentSelect}
                    onClear={() => handleClearStep(2)}
                  />
                )}

                {currentStep === 3 && (
                  <Step3Bus
                    formData={formData}
                    handleInputChange={handleInputChange}
                    onNext={goToNextStep}
                    onPrev={goToPrevStep}
                    routes={routes}
                    buses={buses}
                    setCapacityCheckResult={setCapacityCheckResult}
                    handleRefChange={handleRefChange}
                    applicationState={applicationState}
                    onClear={() => handleClearStep(3)}
                  />
                )}

                {currentStep === 4 && (
                  <Step4ServicePayment
                    key={paymentResetKey}
                    formData={formData}
                    handleInputChange={handleInputChange}
                    onNext={goToNextStep}
                    onPrev={goToPrevStep}
                    currentUser={currentUser}
                    calculateTotalFee={calculateTotalFee}
                    handleSessionDurationChange={handleSessionDurationChange}
                    deadlineConfig={deadlineConfig}
                    applicationState={applicationState}
                    checkFormCompletion={checkFormCompletion}
                    setPaymentCompleted={setPaymentCompleted}
                    setPaymentDetails={setPaymentDetails}
                    setUseOnlinePayment={setUseOnlinePayment}
                    setApplicationState={setApplicationState}
                    setReceiptFile={setReceiptFile}
                    setReceiptPreview={setReceiptPreview}
                    showToast={showToast}
                    onClear={() => handleClearStep(4)}
                    receiptPreview={receiptPreview}
                  />
                )}

                {currentStep === 5 && (
                  <Step5Review
                    formData={formData}
                    handleInputChange={handleInputChange}
                    onPrev={goToPrevStep}
                    onNext={() => { }}
                    applicationState={applicationState}
                    handleSubmitApplication={handleSubmitApplication}
                    declarationAgreed={declarationAgreed}
                    setDeclarationAgreed={setDeclarationAgreed}
                    validateForm={validateForm}
                    saving={saving}
                    handleSaveDraft={handleSaveDraft}
                    submitting={submitting}
                    useOnlinePayment={useOnlinePayment}
                    finalImageUrl={finalImageUrl}
                  />
                )}
              </div>
            </div>

            {/* Mobile Actions area */}
            <div className="md:hidden flex justify-center mt-4 text-center">
              <Button variant="ghost" size="sm" onClick={scrollToFormTop} className="text-[10px] text-slate-500 hover:text-white">
                Back to top
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showDeletePaymentDialog} onOpenChange={setShowDeletePaymentDialog}>
        <DialogContent className="bg-slate-950 border-slate-900 max-w-sm rounded-xl py-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <RotateCcw className="w-8 h-8 text-red-500" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-white mb-2 text-center">Reset Application?</DialogTitle>
              <DialogDescription className="text-slate-400 text-sm text-center">
                This will delete all current payment data and reset your application progress. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="justify-center gap-3 pt-6 flex-row">
              <Button variant="outline" onClick={() => setShowDeletePaymentDialog(false)} className="flex-1 bg-transparent border-slate-800 text-slate-400 hover:bg-slate-900 h-11">Cancel</Button>
              <Button variant="destructive" onClick={performFullReset} className="flex-1 bg-red-600 hover:bg-red-700 font-bold h-11">Reset All</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showClearPaymentConfirm} onOpenChange={setShowClearPaymentConfirm}>
        <DialogContent className="bg-slate-950 border-slate-900 max-w-sm rounded-xl py-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <RotateCcw className="w-8 h-8 text-red-500" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-white mb-2 text-center">Clear payment information?</DialogTitle>
              <DialogDescription className="text-slate-400 text-sm text-center">
                This action can never be undone. Your completed online payment details will be cleared from this registration.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="justify-center gap-3 pt-6 flex-row">
              <Button variant="outline" onClick={() => setShowClearPaymentConfirm(false)} className="flex-1 bg-transparent border-slate-800 text-slate-400 hover:bg-slate-900 h-11">Cancel</Button>
              <Button
                variant="destructive"
                onClick={performClearPayment}
                disabled={clearPaymentCountdown > 0}
                className="flex-1 bg-red-600 hover:bg-red-700 font-bold h-11 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearPaymentCountdown > 0 ? `Clear (${clearPaymentCountdown}s)` : 'Clear'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {showProfileUpdateModal && (
        <ProfileImageAddModal
          isOpen={showProfileUpdateModal}
          onClose={() => setShowProfileUpdateModal(false)}
          onConfirm={handleProfileImageUpdate}
          immediateUpload={false}
        />
      )}
    </div>
  );
}

export default function ApplicationFormPage() {
  return (
    <ErrorBoundary>
      <ApplicationFormContent />
    </ErrorBoundary>
  );
}


