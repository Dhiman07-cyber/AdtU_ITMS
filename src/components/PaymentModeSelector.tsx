"use client";

import { OptimizedInput } from '@/components/forms';
import { PaymentStatusPanel } from '@/components/PaymentStatusPanel';
import { Alert,AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { usePaymentRecovery } from '@/hooks/usePaymentRecovery';
import { useRazorpay } from '@/hooks/useRazorpay';
import { isMobileDevice } from '@/lib/mobile-utils';
import {
	getCurrentPaymentSession,
	getPaymentSession,
	hasCompletedPayment,
	PaymentSession,
	savePaymentSession,
	storePaymentReceipt,
	updatePaymentSessionStatus
} from '@/lib/payment/application-payment.service';
import type { PaymentFrontendStatus } from '@/lib/payment/payment-state';
import { uploadImage } from '@/lib/upload';
import { AnimatePresence,motion } from 'framer-motion';
import {
	AlertCircle,
	ArrowLeft,
	Building2,
	Calendar,
	CheckCircle,
	Clock,
	CreditCard,
	FileText,
	IndianRupee,
	Info,
	Loader2,
	Lock,
	Receipt,
	ShieldCheck,
	Upload,
	Wallet,
	X,
	Zap
} from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';

interface PaymentModeSelectorProps {
  amount: number;
  duration: number;
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  enrollmentId?: string;
  purpose: 'new_registration' | 'renewal';
  showHeader?: boolean;
  initialPaymentId?: string;
  initialReceiptPreview?: string;
  initialPaidAt?: string;
  onPaymentComplete?: (paymentDetails: any) => void;
  onOfflineSelected?: (data: { paymentId?: string; receiptUrl?: string; paidAt?: string }) => void;
  onReceiptFileSelect?: (file: File) => void;
  onReceiptRemove?: () => void;
  onBack?: () => void;
  isFormComplete?: boolean;
  isReadOnly?: boolean;
  isVerified?: boolean;
}

export default function PaymentModeSelector({
  amount,
  duration,
  sessionStartYear,
  sessionEndYear,
  validUntil,
  userId,
  userName,
  userEmail,
  userPhone,
  enrollmentId,
  purpose,
  showHeader = true,
  initialPaymentId = '',
  initialReceiptPreview = '',
  initialPaidAt = '',
  onPaymentComplete,
  onOfflineSelected,
  onReceiptFileSelect,
  onReceiptRemove,
  onBack,
  isFormComplete = true,
  isReadOnly = false,
  isVerified = false
}: PaymentModeSelectorProps) {
  const { currentUser } = useAuth();
  const [paymentMode, setPaymentMode] = useState<'online' | 'offline'>('online');
  const [isProcessingPayment, _setIsProcessingPayment] = useState(false);
  const setIsProcessingPayment = (val: boolean | ((prev: boolean) => boolean)) => {
    const stack = new Error().stack;
    const stackLine = stack ? stack.split('\n')[2] : 'unknown';
    _setIsProcessingPayment((prev) => {
      const nextVal = typeof val === 'function' ? val(prev) : val;
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] setIsProcessingPayment changed: old=${prev} new=${nextVal} | source=${stackLine}`);
      return nextVal;
    });
  };

  const [isProcessingOffline, setIsProcessingOffline] = useState(false);
  
  const [paymentCompleted, _setPaymentCompleted] = useState(false);
  const setPaymentCompleted = (val: boolean | ((prev: boolean) => boolean)) => {
    const stack = new Error().stack;
    const stackLine = stack ? stack.split('\n')[2] : 'unknown';
    _setPaymentCompleted((prev) => {
      const nextVal = typeof val === 'function' ? val(prev) : val;
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] setPaymentCompleted changed: old=${prev} new=${nextVal} | source=${stackLine}`);
      return nextVal;
    });
  };

  const [paymentDetails, setPaymentDetails] = useState<any>(null);

  // Canonical payment status for the online-payment UI panel
  const [onlinePaymentStatus, _setOnlinePaymentStatus] = useState<PaymentFrontendStatus | null>(null);
  const setOnlinePaymentStatus = (val: PaymentFrontendStatus | null | ((prev: PaymentFrontendStatus | null) => PaymentFrontendStatus | null)) => {
    const stack = new Error().stack;
    const stackLine = stack ? stack.split('\n')[2] : 'unknown';
    _setOnlinePaymentStatus((prev) => {
      const nextVal = typeof val === 'function' ? val(prev) : val;
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] setOnlinePaymentStatus changed: old=${prev} new=${nextVal} | source=${stackLine}`);
      return nextVal;
    });
  };
  const [paymentErrorCode, setPaymentErrorCode] = useState<string | undefined>();
  const [paymentErrorReason, setPaymentErrorReason] = useState<string | undefined>();
  // Store IDs from in-progress session so recovery hook can query them
  const [sessionOrderId, setSessionOrderId] = useState<string | undefined>();
  const [sessionPaymentId, setSessionPaymentId] = useState<string | undefined>();

  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  // Get max date for input (today in local time)
  const maxDate = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  useEffect(() => {
    // Only attach programmatic click/focus showPicker on desktop to prevent mobile picker conflicts
    if (isMobileDevice()) return;
    if (paymentMode !== 'offline') return;

    const dateEl = dateInputRef.current;
    const timeEl = timeInputRef.current;

    const triggerDatePicker = () => {
      if (!dateEl || dateEl.disabled || dateEl.readOnly) return;
      try {
        if (typeof dateEl.showPicker === 'function') dateEl.showPicker();
      } catch (err) {}
    };

    const triggerTimePicker = () => {
      if (!timeEl || timeEl.disabled || timeEl.readOnly) return;
      try {
        if (typeof timeEl.showPicker === 'function') timeEl.showPicker();
      } catch (err) {}
    };

    if (dateEl) {
      dateEl.addEventListener('click', triggerDatePicker);
      dateEl.addEventListener('focus', triggerDatePicker);
    }
    if (timeEl) {
      timeEl.addEventListener('click', triggerTimePicker);
      timeEl.addEventListener('focus', triggerTimePicker);
    }

    return () => {
      if (dateEl) {
        dateEl.removeEventListener('click', triggerDatePicker);
        dateEl.removeEventListener('focus', triggerDatePicker);
      }
      if (timeEl) {
        timeEl.removeEventListener('click', triggerTimePicker);
        timeEl.removeEventListener('focus', triggerTimePicker);
      }
    };
  }, [paymentMode]);

  // Offline payment states
  const [offlinePaymentId, setOfflinePaymentId] = useState(initialPaymentId);
  const [offlinePaidDate, setOfflinePaidDate] = useState('');
  const [offlinePaidTime, setOfflinePaidTime] = useState('');
  const [offlinePaidAt, setOfflinePaidAt] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>(initialReceiptPreview);
  const [showOfflineSuccess, setShowOfflineSuccess] = useState(false);

  const { processPayment, isProcessing } = useRazorpay();

  // Helper to format ISO to date (YYYY-MM-DD)
  const formatISOToDate = (isoString: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const tzoffset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - tzoffset).toISOString().slice(0, 10);
    } catch (e) {
      return '';
    }
  };

  // Helper to format ISO to time (HH:MM)
  const formatISOToTime = (isoString: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const tzoffset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - tzoffset).toISOString().slice(11, 16);
    } catch (e) {
      return '';
    }
  };

  // Update local state when initial props change (for draft loading)
  useEffect(() => {
    if (initialPaymentId) {
      setOfflinePaymentId(initialPaymentId);
      // If we have data, switch to offline mode automatically
      setPaymentMode('offline');
    }
  }, [initialPaymentId]);

  useEffect(() => {
    if (initialPaidAt) {
      setOfflinePaidDate(formatISOToDate(initialPaidAt));
      setOfflinePaidTime(formatISOToTime(initialPaidAt));
    } else {
      // Default to current date & time formatted
      const tzoffset = (new Date()).getTimezoneOffset() * 60000;
      const currentLocal = new Date(Date.now() - tzoffset).toISOString();
      setOfflinePaidDate(currentLocal.slice(0, 10));
      setOfflinePaidTime(currentLocal.slice(11, 16));
    }
  }, [initialPaidAt]);

  // Sync date/time to offlinePaidAt state
  useEffect(() => {
    if (offlinePaidDate && offlinePaidTime) {
      setOfflinePaidAt(`${offlinePaidDate}T${offlinePaidTime}`);
    } else {
      setOfflinePaidAt('');
    }
  }, [offlinePaidDate, offlinePaidTime]);

  useEffect(() => {
    if (initialReceiptPreview) {
      setReceiptPreview(initialReceiptPreview);
      if (initialReceiptPreview && !paymentCompleted) {
        setPaymentMode('offline');
      }
    } else {
      setReceiptPreview('');
    }
  }, [initialReceiptPreview, paymentCompleted]);

  // ── Recovery hook (drives automatic polling & manual check) ──────────────
  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      return (await currentUser?.getIdToken()) ?? null;
    } catch {
      return null;
    }
  }, [currentUser]);

  const handleRecoverySuccess = useCallback(() => {
    const session = getCurrentPaymentSession();
    const verifiedDetails = {
      paymentId: session?.razorpayPaymentId || sessionPaymentId,
      orderId: session?.razorpayOrderId || sessionOrderId,
      amount: session?.amount || amount,
      paymentStatus: 'success',
      paymentMethod: 'online',
      paymentTime: new Date().toISOString(),
    };
    if (session) {
      session.status = 'completed';
      savePaymentSession(session);
    }
    setPaymentCompleted(true);
    setPaymentDetails(verifiedDetails);
    setOnlinePaymentStatus('success');
    if (onPaymentComplete) onPaymentComplete(verifiedDetails);
  }, [sessionPaymentId, sessionOrderId, amount, onPaymentComplete]);

  // Determine whether there is an unfinished online session that warrants polling
  const [hasOnlineSession, setHasOnlineSession] = useState(false);

  // ── Check for existing payment session on mount ───────────────────────────
  useEffect(() => {
    // 1. Check if payment is already completed (via hasCompletedPayment or currentSession)
    const isCompleted = hasCompletedPayment(userId, purpose);
    const existingSession = getCurrentPaymentSession();
    let isAlreadyCompleted = isCompleted;

    if (isCompleted) {
      setPaymentCompleted(true);
      const session = getPaymentSession(userId, purpose);
      if (session) {
        setPaymentDetails({
          paymentId: session.razorpayPaymentId,
          orderId: session.razorpayOrderId,
          amount: session.amount
        });
      }
      return; // Stop here, do not check for recovery or set status to processing
    }

    if (existingSession && existingSession.userId === userId && existingSession.purpose === purpose) {
      if (existingSession.status === 'completed') {
        isAlreadyCompleted = true;
        setPaymentCompleted(true);
        setPaymentDetails({
          paymentId: existingSession.razorpayPaymentId,
          orderId: existingSession.razorpayOrderId,
          amount: existingSession.amount
        });
      } else if (existingSession.paymentMode === 'online' && existingSession.status === 'processing') {
        // Unfinished active online session — surface IDs for recovery hook
        setSessionOrderId(existingSession.razorpayOrderId);
        setSessionPaymentId(existingSession.razorpayPaymentId);
        setHasOnlineSession(true);
        setOnlinePaymentStatus('processing');
      }
    }
  }, [userId, purpose]); // run once on mount

  // ── Recovery hook — auto-polls when session is unfinished ─────────────────
  const { state: recoveryState, triggerManualCheck } = usePaymentRecovery({
    getToken,
    onSuccess: handleRecoverySuccess,
    autoStart: hasOnlineSession,
    orderId: sessionOrderId,
    paymentId: sessionPaymentId,
  });

  // Sync recoveryState.status → onlinePaymentStatus when it changes.
  // GUARD: never overwrite the status while a live checkout is in progress —
  // the recovery hook may fire during that window (e.g. on a previous session)
  // and must not clobber the active checkout's 'processing' state.
  useEffect(() => {
    if (recoveryState.status && !paymentCompleted && !isProcessingPayment) {
      setOnlinePaymentStatus(recoveryState.status);
    }
  }, [recoveryState.status, paymentCompleted, isProcessingPayment]);

  const handleOnlinePayment = async () => {
    if (paymentCompleted) {
      toast.warning('Payment already completed');
      return;
    }

    setIsProcessingPayment(true);
    // Show processing state while modal is open (resilient to browser close)
    setOnlinePaymentStatus('processing');

    try {
      const session: PaymentSession = {
        userId,
        userName,
        userEmail,
        userPhone,
        enrollmentId,
        amount,
        purpose,
        duration,
        sessionStartYear,
        sessionEndYear,
        validUntil,
        paymentMode: 'online',
        status: 'processing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      savePaymentSession(session);
      setSessionOrderId(undefined);
      setSessionPaymentId(undefined);

      const result = await processPayment({
        amount,
        userId,
        userName,
        userEmail,
        userPhone,
        enrollmentId,
        durationYears: duration,
        purpose,
        notes: {
          enrollmentId: enrollmentId || 'N/A',
          sessionStartYear: String(sessionStartYear),
          sessionEndYear: String(sessionEndYear),
          duration: String(duration),
          durationYears: String(duration),
          purpose,
          type: purpose
        }
      });

      if (result.success) {
        updatePaymentSessionStatus(userId, purpose, 'completed', {
          razorpayOrderId: result.orderId,
          razorpayPaymentId: result.paymentId,
          paymentReceipt: result.signature
        });
        storePaymentReceipt(userId, purpose, {
          orderId: result.orderId!,
          paymentId: result.paymentId!,
          signature: result.signature!,
          amount,
          timestamp: new Date().toISOString()
        });
        setPaymentCompleted(true);
        setOnlinePaymentStatus('success');
        setPaymentDetails({
          paymentId: result.paymentId,
          orderId: result.orderId,
          amount,
          status: 'success',
          method: result.details?.method || 'card',
          time: new Date().toISOString()
        });
        if (onPaymentComplete) {
          onPaymentComplete({
            razorpayPaymentId: result.paymentId,
            razorpayOrderId: result.orderId,
            amount,
            paymentStatus: 'success',
            paymentMethod: result.details?.method || 'card',
            paymentTime: new Date().toISOString(),
            sessionInfo: { sessionStartYear, sessionEndYear, duration, validUntil }
          });
        }
      } else {
        // Checkout closed without success — the Promise resolved via ondismiss
        // with either the buffered pendingFailure or USER_CANCELLED.
        // Only finalize if we haven't already completed (race-safety).
        if (!paymentCompleted) {
          const mapped = result.frontendStatus || 'failed';
          setOnlinePaymentStatus(mapped);
          setPaymentErrorCode(result.errorCode);
          setPaymentErrorReason(result.errorReason);
          updatePaymentSessionStatus(userId, purpose, 'failed');
          if (process.env.NODE_ENV === 'development') {
            console.info(
              `[PaymentModeSelector] payment outcome: status=${mapped}, ` +
              `code=${result.errorCode || ''}, reason=${result.errorReason || ''}`
            );
          }
        }
      }
    } catch (error: any) {
      console.error('[PaymentModeSelector] unexpected error:', error);
      setOnlinePaymentStatus('verification_pending');
      updatePaymentSessionStatus(userId, purpose, 'failed');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only PNG, JPG, JPEG, and WebP files are allowed');
      e.target.value = '';
      return;
    }

    console.log('📁 Receipt file selected:', {
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      type: file.type
    });

    try {
      // Compress if file size > 1MB (mobile or desktop) to optimize and prevent connection resets
      let processedFile = file;
      if (file.size > 1 * 1024 * 1024) {
        console.log('Optimizing receipt image...');
        toast.info('Optimizing image for upload...', { duration: 2000 });

        // Import mobile utils dynamically to avoid SSR issues
        const { compressImageForMobile } = await import('@/lib/mobile-utils');
        processedFile = await compressImageForMobile(file, 2);
        console.log(`Receipt compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`);
      }

      // Validate file size on final processed image
      const maxSize = 5 * 1024 * 1024;
      if (processedFile.size > maxSize) {
        toast.error('File size must be less than 5MB');
        e.target.value = '';
        return;
      }

      // Clean up previous object URL if it exists
      if (receiptPreview && receiptPreview.startsWith('blob:')) {
        URL.revokeObjectURL(receiptPreview);
      }

      // Create local preview URL
      const previewUrl = URL.createObjectURL(processedFile);

      setReceiptFile(processedFile);
      setReceiptPreview(previewUrl);

      if (onReceiptFileSelect) {
        onReceiptFileSelect(processedFile);
      }

      if (purpose === 'new_registration') {
        toast.success('✅ Receipt attached to application');
        if (offlinePaymentId && onOfflineSelected) {
          onOfflineSelected({ 
            paymentId: offlinePaymentId,
            receiptUrl: previewUrl,
            paidAt: offlinePaidAt ? new Date(offlinePaidAt).toISOString() : new Date().toISOString()
          });
        }
      } else {
        toast.success('✅ Receipt ready! Click "Complete Offline Payment" below to submit.');
      }
    } catch (error) {
      console.error('Error processing receipt:', error);
      toast.error('Error processing image. Please try again.');
    } finally {
      // Always clear value so that user can select same file again if they remove and re-choose
      e.target.value = '';
    }
  };

  const handleOfflinePayment = async () => {
    if (paymentCompleted) {
      toast.warning('Payment already completed');
      return;
    }

    if (!offlinePaymentId.trim()) {
      toast.error('Please enter UPI Transaction ID');
      return;
    }

    if (!offlinePaidDate || !offlinePaidTime) {
      toast.error('Please select both the payment date and time');
      return;
    }

    // Validate that the payment date is not in the future
    const selectedDate = new Date(`${offlinePaidDate}T${offlinePaidTime}`);
    const now = new Date();
    if (selectedDate > now) {
      toast.error('Payment date and time cannot be in the future');
      return;
    }

    if (!receiptFile) {
      toast.error('Please upload payment receipt');
      return;
    }

    setIsProcessingOffline(true);

    try {
      console.log('📤 [Offline] Uploading receipt via mobile-optimized utility...');

      // Mobile optimization: Show progress for large files
      if (receiptFile.size > 2 * 1024 * 1024) {
        toast.info('Large file detected. Upload may take longer on mobile devices.');
      }

      // Use the mobile-optimized uploadImage utility
      const cloudinaryReceiptUrl = await uploadImage(receiptFile, 'receipts');

      if (!cloudinaryReceiptUrl) {
        throw new Error('Failed to upload receipt image. Please check your network or try a smaller file.');
      }

      console.log('✅ [Offline] Receipt uploaded successfully:', cloudinaryReceiptUrl);

      // Create offline payment session
      const session: PaymentSession = {
        userId,
        userName,
        userEmail,
        userPhone,
        enrollmentId,
        amount,
        purpose,
        duration,
        sessionStartYear,
        sessionEndYear,
        validUntil,
        paymentMode: 'offline',
        status: 'pending',
        offlinePaymentId,
        paidAt: offlinePaidAt ? new Date(offlinePaidAt).toISOString() : new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      savePaymentSession(session);

      // Store the Cloudinary URL for the callback
      setReceiptPreview(cloudinaryReceiptUrl);

      // AUTOMATIC SUBMISSION: Ensure parent receives data immediately to create the doc
      if (onOfflineSelected) {
        onOfflineSelected({
          paymentId: offlinePaymentId,
          receiptUrl: cloudinaryReceiptUrl,
          paidAt: offlinePaidAt ? new Date(offlinePaidAt).toISOString() : new Date().toISOString()
        });
      }

      // Show the premium success card
      setShowOfflineSuccess(true);

      toast.success('Offline payment request submitted successfully!');
    } catch (error: any) {
      console.error('Offline payment error:', error);
      let errorMessage = 'Failed to submit offline payment request';

      // Enhanced mobile-specific error handling
      if (error instanceof TypeError && error.message.includes('fetch')) {
        errorMessage = 'Network error during upload. Please check your internet connection and try again.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Upload timed out. Please try with a smaller image or better network connection.';
      } else if (error.message?.includes('File size too large')) {
        errorMessage = 'File size too large. Please compress the image or choose a smaller file.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    } finally {
      setIsProcessingOffline(false);
    }
  };

  return (
    <Card className="w-full border-0 shadow-xl sm:shadow-2xl bg-[#111117] border border-white/5 overflow-hidden flex flex-col h-full">
      {showHeader && (
        <CardHeader className="relative pb-4 sm:pb-6 pt-5 sm:pt-8 px-4 sm:px-6 bg-white/[0.02] bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.08),transparent_70%)] border-b border-white/5">
          <div className="relative">
            <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl sm:rounded-2xl blur-md opacity-50 animate-pulse"></div>
                  <div className="relative p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
                    <Wallet className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
                  </div>
                </div>
                <div className="min-w-0">
                  <CardTitle className="bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent font-black text-sm sm:text-2xl truncate">
                    Payment Information
                  </CardTitle>
                  <CardDescription className="text-[8px] sm:text-sm text-gray-500 mt-0.5 truncate">
                    Complete your transaction securely
                  </CardDescription>
                </div>
              </div>

              {onBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBack}
                  className="h-8 sm:h-10 px-2 sm:px-4 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 rounded-xl transition-all flex-shrink-0"
                >
                  <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider hidden sm:inline">Change Duration</span>
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider sm:hidden">Change</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent className="space-y-4 sm:space-y-6 p-4 sm:p-6">
        {/* Payment Summary Card - Compact */}
        <div className="relative overflow-hidden rounded-lg shadow-md">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600"></div>

          <div className="relative p-2.5 md:p-3 space-y-2">
            {/* Header */}
            <div className="flex items-center gap-1.5">
              <div className="p-1 bg-white/20 rounded-md">
                <Receipt className="h-3 w-3 text-white" />
              </div>
              <h3 className="font-bold text-xs text-white">Payment Summary</h3>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-3 gap-1 sm:gap-2">
              <div className="p-1 sm:p-2 bg-white/[0.12] rounded-lg lg:rounded-xl">
                <div className="flex items-center gap-0.5 mb-0.5">
                  <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-200" />
                  <span className="text-[7px] sm:text-[9px] text-blue-100 font-semibold uppercase tracking-wider">Duration</span>
                </div>
                <p className="font-black text-[9px] sm:text-xs text-white uppercase">{duration} Year{duration > 1 ? 's' : ''}</p>
              </div>

              <div className="p-1 sm:p-2 bg-white/[0.12] rounded-lg lg:rounded-xl">
                <div className="flex items-center gap-0.5 mb-0.5">
                  <Calendar className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-purple-200" />
                  <span className="text-[7px] sm:text-[9px] text-purple-100 font-semibold uppercase tracking-wider">Session</span>
                </div>
                <p className="font-black text-[9px] sm:text-xs text-white">{sessionStartYear}-{sessionEndYear}</p>
              </div>

              <div className="p-1 sm:p-2 bg-white/[0.12] rounded-lg lg:rounded-xl">
                <div className="flex items-center gap-0.5 mb-0.5">
                  <CheckCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-green-300" />
                  <span className="text-[7px] sm:text-[9px] text-green-100 font-semibold uppercase tracking-wider text-nowrap">Valid Until</span>
                </div>
                <p className="font-black text-[9px] sm:text-xs text-white">
                  {new Date(validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Total Amount */}
            <div className="relative overflow-hidden p-2 sm:p-3 bg-white/[0.10] rounded-lg sm:rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="p-1 sm:p-1.5 rounded-md lg:rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 shadow-lg">
                    <IndianRupee className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 text-white" />
                  </div>
                  <span className="text-[9px] sm:text-xs font-black text-white/80 uppercase tracking-widest">Total Amount</span>
                </div>
                <div className="flex items-baseline gap-0.5 sm:gap-1">
                  <span className="text-[10px] sm:text-sm font-black text-white/50 tracking-tighter">₹</span>
                  <span className="text-lg sm:text-2xl font-black text-white tracking-tight">{amount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Completed Status */}
        {paymentCompleted && (
          <div className="relative overflow-hidden rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-600"></div>
            <div className="relative p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4 mb-4 text-center sm:text-left">
                <div className="p-2 sm:p-2.5 bg-white/[0.08] rounded-xl">
                  <CheckCircle className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg sm:text-xl font-bold text-white mb-1">Payment Successful!</h3>
                  <p className="text-xs sm:text-sm text-green-50">Your transaction has been completed successfully</p>
                </div>
              </div>

              {paymentDetails && (
                <div className="space-y-3 bg-white/[0.12] rounded-xl p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-200/70">Payment ID</span>
                    <span className="font-mono font-medium text-white break-all text-left sm:text-right text-xs sm:text-sm">{paymentDetails.paymentId}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-200/70">Order ID</span>
                    <span className="font-mono font-medium text-white break-all text-left sm:text-right text-xs sm:text-sm">{paymentDetails.orderId}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-200/70">Amount</span>
                    <span className="font-bold text-white text-xs sm:text-sm text-left sm:text-right">₹{(paymentDetails.amount || amount).toLocaleString()}</span>
                  </div>
                  {paymentDetails.method && (
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-200/70">Method</span>
                      <span className="capitalize font-semibold text-white text-xs sm:text-sm text-left sm:text-right">{paymentDetails.method}</span>
                    </div>
                  )}
                  {paymentDetails.time && (
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-200/70">Time</span>
                      <span className="font-semibold text-white text-xs sm:text-sm text-left sm:text-right">
                        {new Date(paymentDetails.time).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!paymentCompleted && (
          <>
            {/* Payment Mode Selection - Completely Redesigned */}
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 sm:p-2 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg">
                    <ShieldCheck className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                  </div>
                  <h3 className="text-xs md:text-lg font-bold text-gray-900 dark:text-gray-100">
                    Choose Payment Method
                  </h3>
                </div>
                <Badge className="text-[9px] sm:text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-300 dark:border-violet-700">
                  Secure
                </Badge>
              </div>

              {/* Enhanced Payment Method Tabs */}
              <div className="relative p-1.5 bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl shadow-inner">
                {/* Sliding background indicator */}
                <div
                  className={`absolute top-1.5 h-[calc(100%-0.75rem)] w-[calc(50%-0.375rem)] rounded-xl shadow-xl transition-all duration-300 ease-out pointer-events-none ${paymentMode === 'online'
                    ? 'left-1.5 bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600'
                    : 'left-[calc(50%+0.1875rem)] bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600'
                    }`}
                ></div>

                <div className="relative grid grid-cols-2 gap-1.5 z-10">
                  {/* Online Payment Option */}
                  <button
                    type="button"
                    onClick={() => !isReadOnly && setPaymentMode('online')}
                    disabled={isReadOnly}
                    className={`relative group px-1.5 sm:px-4 py-2.5 sm:py-3.5 rounded-xl transition-all duration-300 select-none touch-manipulation ${isReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-center gap-1.5 sm:gap-2.5">
                      {/* Icon */}
                      <div className="relative">
                        <div className={`p-1.5 rounded-lg transition-all duration-300 ${paymentMode === 'online'
                          ? 'bg-white/[0.12] border border-white/10 shadow-lg'
                          : 'bg-white/5 border border-transparent'
                          }`}>
                          <CreditCard className={`h-3.5 w-3.5 sm:h-4.5 sm:w-4.5 transition-colors ${paymentMode === 'online' ? 'text-white' : 'text-gray-400'
                            }`} />
                        </div>
                        {paymentMode === 'online' && (
                          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center shadow-md">
                            <CheckCircle className="h-2 w-2 text-white fill-green-500" />
                          </div>
                        )}
                      </div>

                      {/* Label */}
                      <div className="text-left">
                        <p className={`font-bold text-[11px] sm:text-sm transition-colors ${paymentMode === 'online' ? 'text-white drop-shadow-sm' : 'text-gray-300'
                          }`}>
                          Pay Online
                        </p>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <Zap className={`h-2 w-2 ${paymentMode === 'online' ? 'text-amber-300' : 'text-gray-500'}`} />
                          <span className={`text-[8px] sm:text-[10px] font-semibold ${paymentMode === 'online' ? 'text-amber-200' : 'text-gray-500'
                            }`}>Instant</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Offline Payment Option */}
                  <button
                    type="button"
                    onClick={() => !isReadOnly && setPaymentMode('offline')}
                    disabled={isReadOnly}
                    className={`relative group px-1.5 sm:px-4 py-2.5 sm:py-3.5 rounded-xl transition-all duration-300 select-none touch-manipulation ${isReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-center gap-1.5 sm:gap-2.5">
                      {/* Icon */}
                      <div className="relative">
                        <div className={`p-1.5 rounded-lg transition-all duration-300 ${paymentMode === 'offline'
                          ? 'bg-white/[0.12] border border-white/10 shadow-lg'
                          : 'bg-white/5 border border-transparent'
                          }`}>
                          <Building2 className={`h-3.5 w-3.5 sm:h-4.5 sm:w-4.5 transition-colors ${paymentMode === 'offline' ? 'text-white' : 'text-gray-400'
                            }`} />
                        </div>
                        {paymentMode === 'offline' && (
                          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center shadow-md">
                            <CheckCircle className="h-2 w-2 text-white fill-green-500" />
                          </div>
                        )}
                      </div>

                      {/* Label */}
                      <div className="text-left">
                        <p className={`font-bold text-[11px] sm:text-sm transition-colors ${paymentMode === 'offline' ? 'text-white drop-shadow-sm' : 'text-gray-300'
                          }`}>
                          Pay Offline
                        </p>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <Receipt className={`h-2 w-2 ${paymentMode === 'offline' ? 'text-gray-300' : 'text-gray-500'}`} />
                          <span className={`text-[8px] sm:text-[10px] font-semibold ${paymentMode === 'offline' ? 'text-gray-200' : 'text-gray-500'
                            }`}>Manual</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

            </div>

            {/* Offline Payment Fields */}
            {paymentMode === 'offline' && (
              <div className="space-y-3 sm:space-y-4 p-3 sm:p-4 bg-white/[0.02] rounded-xl sm:rounded-2xl border border-white/10">
                {/* Payment Amount Display */}
                <div className="space-y-1.5 sm:space-y-2">
                  <Label className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 text-purple-300">
                    <div className="p-1 rounded-md bg-purple-500 shadow-md">
                      <IndianRupee className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
                    </div>
                    Payment Amount
                  </Label>
                  <div className="relative">
                    <Input
                      type="text"
                      value={`₹${amount.toLocaleString()}`}
                      readOnly
                      disabled
                      className="h-10 sm:h-11 bg-white/5 border-2 border-white/10 font-bold text-sm sm:text-base cursor-not-allowed text-white"
                    />
                  </div>
                </div>

                {/* Transaction ID Input */}
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="offlinePaymentId" className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 text-violet-300">
                    <div className="p-1 rounded-md bg-violet-500 shadow-md">
                      <FileText className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
                    </div>
                    UPI Transaction ID <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <OptimizedInput
                    id="offlinePaymentId"
                    type="text"
                    value={offlinePaymentId}
                    onChange={(value) => {
                      setOfflinePaymentId(value);
                      console.log('📝 Transaction ID entered:', value);

                      // For new registration, sync to parent immediately
                      if (purpose === 'new_registration' && onOfflineSelected) {
                        onOfflineSelected({ 
                          paymentId: value,
                          receiptUrl: receiptPreview,
                          paidAt: offlinePaidAt ? new Date(offlinePaidAt).toISOString() : new Date().toISOString()
                        });
                      }
                    }}
                    placeholder="e.g., 234567890123"
                    required
                    className={`h-10 sm:h-11 font-mono text-xs sm:text-sm bg-white/5 border-2 border-violet-500/30 text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${isReadOnly ? 'opacity-60 cursor-not-allowed border-gray-700' : ''}`}
                  />
                </div>

                {/* Split Date & Time Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {/* Date Input */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="offlinePaidDate" className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 text-blue-300">
                      <div className="p-1 rounded-md bg-blue-500 shadow-md">
                        <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
                      </div>
                      Payment Date <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <input
                      ref={dateInputRef}
                      id="offlinePaidDate"
                      type="date"
                      value={offlinePaidDate}
                      max={maxDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        
                        // Prevent future date
                        let finalVal = val;
                        if (val && val > maxDate) {
                          finalVal = maxDate;
                          toast.error('Payment date cannot be in the future');
                        }

                        setOfflinePaidDate(finalVal);

                        // Sync immediately for new registration
                        if (purpose === 'new_registration' && onOfflineSelected) {
                          const updatedPaidAt = finalVal && offlinePaidTime ? `${finalVal}T${offlinePaidTime}` : '';
                          onOfflineSelected({
                            paymentId: offlinePaymentId,
                            receiptUrl: receiptPreview,
                            paidAt: updatedPaidAt ? new Date(updatedPaidAt).toISOString() : ''
                          });
                        }
                      }}
                      required
                      disabled={isReadOnly}
                      className={`h-10 sm:h-11 w-full min-w-0 rounded-md border-2 px-3 py-2 shadow-sm transition-[color,box-shadow,border-color] outline-none hover:border-gray-400 dark:hover:border-gray-500 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-xs sm:text-sm bg-white/5 border-blue-500/30 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${isReadOnly ? 'opacity-60 cursor-not-allowed border-gray-700' : ''} cursor-pointer`}
                    />
                  </div>

                  {/* Time Input */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="offlinePaidTime" className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 text-blue-300">
                      <div className="p-1 rounded-md bg-blue-500 shadow-md">
                        <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
                      </div>
                      Payment Time <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <input
                      ref={timeInputRef}
                      id="offlinePaidTime"
                      type="time"
                      value={offlinePaidTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        let finalVal = val;
                        
                        // If selected date is today, prevent future time
                        if (offlinePaidDate === maxDate && val) {
                          const currentTime = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().slice(11, 16);
                          if (val > currentTime) {
                            finalVal = currentTime;
                            toast.error('Payment time cannot be in the future');
                          }
                        }

                        setOfflinePaidTime(finalVal);

                        // Sync immediately for new registration
                        if (purpose === 'new_registration' && onOfflineSelected) {
                          const updatedPaidAt = offlinePaidDate && finalVal ? `${offlinePaidDate}T${finalVal}` : '';
                          onOfflineSelected({
                            paymentId: offlinePaymentId,
                            receiptUrl: receiptPreview,
                            paidAt: updatedPaidAt ? new Date(updatedPaidAt).toISOString() : ''
                          });
                        }
                      }}
                      required
                      disabled={isReadOnly}
                      className={`h-10 sm:h-11 w-full min-w-0 rounded-md border-2 px-3 py-2 shadow-sm transition-[color,box-shadow,border-color] outline-none hover:border-gray-400 dark:hover:border-gray-500 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-xs sm:text-sm bg-white/5 border-blue-500/30 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${isReadOnly ? 'opacity-60 cursor-not-allowed border-gray-700' : ''} cursor-pointer`}
                    />
                  </div>
                </div>

                {/* Receipt Upload */}
                <div className="space-y-1.5 sm:space-y-2">
                  <Label className="text-xs sm:text-sm font-semibold flex items-center gap-1.5 text-fuchsia-300">
                    <div className="p-1 rounded-md bg-fuchsia-500 shadow-md">
                      <Upload className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
                    </div>
                    Upload Payment Receipt <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <div className={`relative border-2 border-dashed rounded-xl sm:rounded-2xl p-4 sm:p-6 text-center transition-all ${receiptPreview
                    ? 'border-green-400/50 bg-gradient-to-br from-green-950/20 to-emerald-950/20'
                    : 'border-fuchsia-500/30 bg-white/[0.02]'
                    }`}>
                    {receiptPreview ? (
                      <div className="space-y-3 sm:space-y-4">
                        <div className="relative inline-block group">
                          <img
                            src={receiptPreview}
                            alt="Payment receipt preview"
                            className="max-h-40 sm:max-h-48 rounded-xl object-contain shadow-xl border-2 border-green-500/50 mx-auto"
                          />
                          {!isReadOnly && (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="absolute -top-2 -right-2 h-7 w-7 sm:h-8 sm:w-8 rounded-full shadow-xl opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                if (receiptPreview.startsWith('blob:')) {
                                  URL.revokeObjectURL(receiptPreview);
                                }
                                setReceiptPreview('');
                                setReceiptFile(null);
                                // Clear file input element value by ID
                                const input = document.getElementById('receiptUploadOffline') as HTMLInputElement;
                                if (input) {
                                  input.value = '';
                                }
                                if (onReceiptRemove) {
                                  onReceiptRemove();
                                }
                              }}
                            >
                              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </Button>
                          )}
                        </div>
                        <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-300">
                          <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                          <span className="text-xs sm:text-sm font-semibold">Receipt uploaded successfully</span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="relative inline-block mb-3">
                          <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-fuchsia-500 rounded-full blur-lg opacity-20"></div>
                          <div className="relative p-3 bg-gradient-to-br from-purple-900/30 to-fuchsia-900/30 rounded-full">
                            <Upload className="h-10 w-10 sm:h-12 sm:w-12 text-purple-400" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center space-y-2 sm:space-y-3">
                          {!isReadOnly ? (
                            <>
                              <label
                                htmlFor="receiptUploadOffline"
                                className="cursor-pointer px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 hover:from-purple-700 hover:via-violet-700 hover:to-fuchsia-700 text-white font-bold text-xs sm:text-sm transition-all duration-200 shadow-lg hover:shadow-xl"
                              >
                                📸 Choose Receipt File
                              </label>
                              <input
                                id="receiptUploadOffline"
                                type="file"
                                accept="image/*"
                                onChange={handleReceiptUpload}
                                className="hidden"
                              />
                            </>
                          ) : (
                            <div className="px-4 py-2 rounded-lg bg-gray-800 text-gray-400 text-xs font-semibold flex items-center gap-2">
                              <Lock className="h-3 w-3" />
                              Verification Fixed
                            </div>
                          )}
                          <p className="text-[10px] sm:text-xs text-purple-400 font-medium">
                            PNG, JPG, JPEG • Max 5MB
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Submit Button for Offline Payment - Only show for renewals */}
                {purpose !== 'new_registration' && (
                  <Button
                    onClick={handleOfflinePayment}
                    disabled={isProcessingOffline || !offlinePaymentId.trim() || !receiptFile}
                    className="w-full h-11 sm:h-14 font-black bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 hover:from-violet-700 hover:via-purple-700 hover:to-fuchsia-700 text-white shadow-xl hover:shadow-2xl transition-all duration-200 mt-2"
                  >
                    {isProcessingOffline ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                        SUBMITTING...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                        COMPLETE OFFLINE PAYMENT
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Online Payment Section */}
            {paymentMode === 'online' && (
              <div className="space-y-3 sm:space-y-4">
                {/* Payment Flow info — only show before first attempt */}
                {!onlinePaymentStatus && (
                  <div className="p-3 sm:p-4 bg-white/[0.03] border border-white/10 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 bg-blue-600 rounded-lg">
                        <Info className="h-3.5 w-3.5 text-white" />
                      </div>
                      <h4 className="text-xs sm:text-sm font-bold text-blue-100">How Online Payment Works</h4>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-white text-[9px] font-bold">1</div>
                        <p className="text-[9px] text-gray-400 font-medium">Click the &quot;Pay Securely&quot; button below</p>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">2</div>
                        <p className="text-[9px] text-gray-400 font-medium">Complete payment via Razorpay</p>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 w-4 h-4 rounded-full bg-purple-600 flex items-center justify-center text-white text-[9px] font-bold">3</div>
                        <p className="text-[9px] text-gray-400 font-medium">Instant confirmation &amp; auto-activation</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Canonical Payment Status Panel */}
                {onlinePaymentStatus && onlinePaymentStatus !== 'success' && (
                  <PaymentStatusPanel
                    status={onlinePaymentStatus}
                    isPolling={recoveryState.isPolling}
                    timedOut={recoveryState.timedOut}
                    errorCode={paymentErrorCode}
                    errorReason={paymentErrorReason}
                    onManualCheck={triggerManualCheck}
                    onRetry={() => {
                      setOnlinePaymentStatus(null);
                      setPaymentErrorCode(undefined);
                      setPaymentErrorReason(undefined);
                    }}
                  />
                )}

                {/* Security Info — only show when no status yet and form is complete */}
                {!onlinePaymentStatus && !isFormComplete && (
                  <Alert className="border py-2 sm:py-3 border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 text-amber-500" />
                      <AlertDescription className="text-[9px] sm:text-sm text-amber-500 font-medium">
                        Please complete the application form (upload photo, fill all details) before making online payment.
                      </AlertDescription>
                    </div>
                  </Alert>
                )}
                {!onlinePaymentStatus && isFormComplete && (
                  <Alert className="border py-2 sm:py-3 border-blue-500/30 bg-blue-500/5">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <Lock className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 text-blue-400" />
                      <AlertDescription className="text-[9px] sm:text-sm text-blue-200">
                        You will be redirected to Razorpay secure payment gateway. Your payment is protected with industry-standard 256-bit encryption and instant confirmation.
                      </AlertDescription>
                    </div>
                  </Alert>
                )}

                {/* Online Payment Button — disabled while processing or success, re-enabled on failed/banking_issue for retry */}
                {(() => {
                  const isTerminalSuccess = onlinePaymentStatus === 'success';
                  const isActivelyProcessing =
                    isProcessingPayment ||
                    isProcessing ||
                    onlinePaymentStatus === 'processing' ||
                    onlinePaymentStatus === 'verification_pending' ||
                    recoveryState.isPolling;
                  const isRetryable =
                    onlinePaymentStatus === 'failed' ||
                    onlinePaymentStatus === 'banking_issue';
                  const disabled = isTerminalSuccess || (isActivelyProcessing && !isRetryable);

                  if (isTerminalSuccess) return null; // Success panel already shown above

                  return (
                    <Button
                      onClick={() => {
                        if (!isFormComplete) {
                          toast.error('Please fill out all required fields in steps 1, 2, and 3 before making payment.');
                          return;
                        }
                        handleOnlinePayment();
                      }}
                      disabled={disabled}
                      className={`w-full h-11 sm:h-14 text-xs sm:text-base font-bold bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-700 hover:via-teal-700 hover:to-cyan-700 text-white shadow-xl hover:shadow-2xl transition-all duration-200 cursor-pointer active:scale-[0.98] ${!isFormComplete ? 'opacity-50' : ''} ${disabled && !isRetryable ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {isActivelyProcessing && !isRetryable ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 sm:h-6 sm:w-6 animate-spin" />
                          Processing…
                        </>
                      ) : (
                        <>
                          <Lock className="mr-2 h-4 w-4 sm:h-6 sm:w-6" />
                          {isRetryable ? `Try Again — ₹${amount.toLocaleString()}` : `Pay ₹${amount.toLocaleString()} Securely`}
                          <Zap className="ml-2 h-4 w-4 sm:h-6 sm:w-6" />
                        </>
                      )}
                    </Button>
                  );
                })()}
              </div>
            )}

            {/* Offline Info Alert */}
            {paymentMode === 'offline' && (
              <Alert className="border py-2 sm:py-3 border-white/10 bg-white/[0.02]">
                <div className="flex items-start gap-2 sm:gap-3">
                  <Lock className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 text-gray-400" />
                  <AlertDescription className="text-[10px] sm:text-sm text-gray-300">
                    Verified Offline Payment • Authorized by Administration
                  </AlertDescription>
                </div>
              </Alert>
            )}
          </>
        )}
      </CardContent>

      {/* --- PREMIUM OFFLINE SUCCESS OVERLAY --- */}
      <AnimatePresence>
        {showOfflineSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-24 md:items-center md:pt-4 bg-[#0a0c10]/95 backdrop-blur-2xl"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-[400px] relative"
            >
              {/* Outer Glow Effects */}
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-[2.5rem] blur opacity-25 animate-pulse"></div>

              <Card className="relative border-0 shadow-2xl bg-[#161a22] border border-white/10 rounded-[2.5rem] overflow-hidden">
                <CardContent className="p-8 sm:p-12 flex flex-col items-center text-center">

                  {/* Premium Live Tick Animation */}
                  <div className="relative mb-10">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 20,
                        delay: 0.2
                      }}
                      className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-emerald-500/20 flex items-center justify-center bg-emerald-500/5 relative"
                    >
                      {/* Pulsing Back Glow */}
                      <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl"
                      ></motion.div>

                      <svg
                        className="w-12 h-12 sm:w-16 sm:h-16 text-emerald-500"
                        viewBox="0 0 52 52"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <motion.path
                          d="M14.1 27.2l7.1 7.2 16.7-16.8"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{
                            duration: 1,
                            ease: "easeInOut",
                            delay: 0.5
                          }}
                        />
                        <motion.circle
                          cx="26"
                          cy="26"
                          r="23"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{
                            duration: 1.5,
                            ease: "easeInOut",
                            delay: 0
                          }}
                        />
                      </svg>
                    </motion.div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.5 }}
                  >
                    <h2 className="text-2xl sm:text-3xl font-black text-white mb-4 uppercase tracking-tight">Request Received</h2>
                    <div className="space-y-4">
                      <p className="text-gray-400 text-sm sm:text-base font-medium leading-relaxed max-w-[320px] mx-auto">
                        We have received your payment request. Our team will verify and confirm your payment within <span className="text-emerald-400 font-bold italic text-nowrap">3-4 business working days</span>.
                      </p>

                      <div className="pt-6 space-y-3 w-full max-w-[280px] mx-auto">
                        {purpose === 'new_registration' ? (
                          // No buttons for new registration in success overlay (if ever shown)
                          null
                        ) : (
                          <>
                            <Button
                              onClick={() => {
                                // Navigate to dashboard as submission is already handled
                                window.location.href = '/student';
                              }}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-5 rounded-xl shadow-lg shadow-blue-500/20 transform hover:-translate-y-1 transition-all duration-300 text-xs uppercase tracking-wider"
                            >
                              Back to Dashboard
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setOfflinePaymentId('');
                                setReceiptFile(null);
                                setReceiptPreview('');
                                setShowOfflineSuccess(false);
                              }}
                              className="w-full text-red-500 hover:text-red-600 hover:bg-red-500/10 font-bold py-3 transition-all text-[10px] uppercase tracking-widest"
                            >
                              Cancel / Close
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
