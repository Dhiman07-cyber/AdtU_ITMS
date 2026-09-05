"use client";

import { PremiumPageLoader } from '@/components/LoadingSpinner';
import PaymentModeSelector from '@/components/PaymentModeSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import {
	calculateSessionDates,
	clearPaymentSession,
	hasCompletedPayment
} from '@/lib/payment/application-payment.service';
import { daysUntil,isDateExpired,parseFirestoreDate } from '@/lib/utils/date-utils';
import {
	AlertTriangle,
	ArrowLeft,
	Bus,
	Calendar,
	CheckCircle,
	Clock,
	Copy,
	Download,
	History,
	IndianRupee,
	Info,
	Loader2,
	Receipt,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	TrendingUp,
	User,
	Zap
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React,{ useEffect,useState } from 'react';
import { toast } from 'sonner';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import ErrorBoundary from '@/components/ErrorBoundary';
import { useApiCollection } from '@/hooks/useApiCollection';
import { safeImageSrc } from '@/lib/security/url-sanitizer';

interface Transaction {
  studentId: string;
  studentName: string;
  amount: number;
  paymentMethod: 'online' | 'offline';
  paymentId: string;
  timestamp: string;
  durationYears: number;
  validUntil: string;
  approvedBy?: string;
  status?: 'completed' | 'pending' | 'failed';
}

export default function StudentRenewalPage() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'renewal' | 'history'>('renewal');
  const [studentData, setStudentData] = useState<any>(null);
  const [loadingStudent, setLoadingStudent] = useState(true);
  const [selectedDuration, setSelectedDuration] = useState<number>(1);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [showPaymentSection, setShowPaymentSection] = useState(false);
  const [renewalCompleted, setRenewalCompleted] = useState(false);
  const [processingRenewal, setProcessingRenewal] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [isProceedingToPayment, setIsProceedingToPayment] = useState(false);
  const [baseFee, setBaseFee] = useState<number>(0);
  const [loadingFee, setLoadingFee] = useState(true);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const [deadlineConfig, setDeadlineConfig] = useState<any>(null);

  // Fetch deadline config
  useEffect(() => {
    const fetchDeadlineConfig = async () => {
      try {
        const response = await fetch('/api/settings/deadline-config');
        if (response.ok) {
          const data = await response.json();
          setDeadlineConfig(data.config || data);
          console.log("📅 [Renewal Page] Fetched deadline config:", data.config || data);
        }
      } catch (error) {
        console.error("Error fetching deadline config:", error);
      }
    };
    fetchDeadlineConfig();
  }, []);

  // Fetch buses data from PostgreSQL via API
  const { data: buses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false,
  });

  // Find bus data based on student's busId
  const studentBusId = studentData?.busId;
  const busData = (studentData && buses.length && studentBusId)
    ? buses.find((bus: any) => bus.busId === studentBusId || bus.id === studentBusId) || null
    : null;

  // Fetch bus fee from API endpoint
  useEffect(() => {
    const fetchBusFee = async () => {
      try {
        const response = await fetch('/api/get-bus-fee');
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data?.amount) {
            setBaseFee(result.data.amount);
          } else {
            setBaseFee(0);
          }
        } else {
          console.warn('Failed to fetch bus fee from API');
          setBaseFee(0);
        }
      } catch (error) {
        console.error('Error fetching bus fee:', error);
        setBaseFee(0);
      } finally {
        setLoadingFee(false);
      }
    };

    fetchBusFee();
  }, []);

  // Fetch student data
  useEffect(() => {
    if (loading) return; // Wait until auth state settles

    if (!currentUser || !userData) {
      setLoadingStudent(false);
      return;
    }

    // Optimization: Use userData from context instead of re-fetching student doc
    setStudentData(userData);

    if (userData.validUntil) {
      if (hasCompletedPayment(currentUser.uid, 'renewal')) {
        setRenewalCompleted(true);
      }
    }
    setLoadingStudent(false);
  }, [currentUser, userData, loading]);

  // Automatic Payment Recovery Trigger (Phase 4)
  useEffect(() => {
    if (!currentUser || !studentData || renewalCompleted) return;

    const triggerRecovery = async () => {
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/payment/recover', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          const { status } = data;
          if (status === 'success' || status === 'already_processed') {
            console.log('✅ Renewal recovered successfully!');
            toast.success('Your online payment was verified successfully!');
            setRenewalCompleted(true);
            setActiveTab('history');
          } else if (status === 'processing' || status === 'verification_pending') {
            // Silent — PaymentModeSelector is the active recovery surface
            console.log(`[Renewal Recovery] status=${status} — silent`);
          } else {
            // failed / not_found — do nothing
            console.log(`[Renewal Recovery] status=${status} — no action`);
          }
        }
      } catch (err) {
        console.error('[Renewal Recovery] failed:', err);
      }
    };

    triggerRecovery();
  }, [currentUser, studentData, renewalCompleted]);

  // Fetch transaction history
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!currentUser || activeTab !== 'history') return;

      setLoadingTransactions(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/payment/transactions', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setTransactions(data.transactions || []);
        }
      } catch (error) {
        console.error('Error fetching transactions:', error);
        toast.error('Failed to load transaction history');
      } finally {
        setLoadingTransactions(false);
      }
    };

    fetchTransactions();
  }, [currentUser, activeTab]);

  // Calculate session info - FIXED: Calculate from existing session, not current year
  useEffect(() => {
    if (selectedDuration && studentData && baseFee) {
      const currentYear = new Date().getFullYear();

      // Get existing session data from student
      const existingSessionEndYear = studentData.sessionEndYear || currentYear;
      const existingValidUntil = studentData.validUntil;

      // Determine base year for calculation
      let baseYear = currentYear;

      if (existingValidUntil) {
        // Parse existing validity date
        const existingDate = parseFirestoreDate(existingValidUntil);
        const now = new Date();

        if (existingDate && existingDate > now) {
          // Service is still active, student is paying for NEXT session
          // So start from existing session end year
          baseYear = existingSessionEndYear;
          console.log('✅ Service active - showing NEXT session starting from:', baseYear);
        } else {
          console.log('⚠️ Service expired - showing session from current year:', baseYear);
        }
      }

      // Calculate the NEW session they're paying for
      // Only calculate if deadlineConfig is loaded
      const info = deadlineConfig ? calculateSessionDates(baseYear, selectedDuration, deadlineConfig) : null;
      const fee = baseFee * selectedDuration;

      if (info) {
        console.log('📊 Renewal Summary Calculated:');
        console.log('- Duration:', selectedDuration, 'years');
        console.log('- Session:', info.sessionStartYear, '-', info.sessionEndYear);
        console.log('- Valid Until:', new Date(info.validUntil).toLocaleDateString());
        console.log('- Fee:', fee);

        setSessionInfo({
          ...info,
          fee,
          duration: selectedDuration
        });
      }
    }
  }, [selectedDuration, studentData, baseFee, deadlineConfig]);

  const handlePaymentComplete = async (paymentDetails: any) => {
    setProcessingRenewal(true);

    try {
      clearPaymentSession(currentUser!.uid, 'renewal');
      setRenewalCompleted(true);
      toast.success('Bus service renewed successfully!');
      setActiveTab('history');

      setTimeout(() => {
        router.push('/student');
      }, 2000);
    } catch (error) {
      console.error('Error processing renewal:', error);
      toast.error('Failed to complete renewal. Please contact support.');
    } finally {
      setProcessingRenewal(false);
    }
  };

  const handleDownloadReceipt = async (paymentId: string) => {
    if (!paymentId) {
      toast.error('Payment ID not found');
      return;
    }

    setDownloadingReceiptId(paymentId);
    const loadingToastId = toast.loading('Preparing your receipt...');
    try {
      if (!currentUser) {
        toast.dismiss(loadingToastId);
        toast.error('Authentication required');
        setDownloadingReceiptId(null);
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/payment/receipt/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to generate receipt');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Receipt_${paymentId}.pdf`;
      // For mobile compatibility: append to body, click, and cleanup
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Increased delay for mobile browsers to successfully trigger the download
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 500);

      toast.dismiss(loadingToastId);
      toast.success('Receipt downloaded successfully');
    } catch (error) {
      console.error('Error downloading receipt:', error);
      toast.dismiss(loadingToastId);
      toast.error('Failed to download receipt');
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const handleOfflinePayment = async (data?: { paymentId?: string; receiptUrl?: string }) => {
    if (!sessionInfo) {
      toast.error('Session information not ready. Please try again.');
      return;
    }

    try {
      const response = await fetch('/api/student/renew-service-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await currentUser?.getIdToken()}`
        },
        body: JSON.stringify({
          durationYears: selectedDuration,
          totalFee: sessionInfo.fee,
          paymentMode: 'offline',
          transactionId: data?.paymentId || '',
          receiptImageUrl: data?.receiptUrl || '' // Use the Cloudinary URL from the child component
        })
      });

      if (response.ok) {
        toast.success('Renewal application submitted. Please complete payment at the bus office.');
        // router.push('/student'); // Handled by PaymentModeSelector UI overlay
      } else {
        throw new Error('Failed to submit renewal application');
      }
    } catch (error) {
      console.error('Error submitting renewal:', error);
      toast.error('Failed to submit renewal application');
    }
  };

  if (loading || loadingStudent || loadingFee) {
    return <PremiumPageLoader message="Loading Renewal Service..." subMessage="Checking your service eligibility..." />;
  }

  if (!currentUser || userData?.role !== 'student') {
    router.push('/login');
    return null;
  }

  const validUntilDate = parseFirestoreDate(studentData?.validUntil);
  const isExpired = isDateExpired(validUntilDate);
  const daysUntilExpiry = daysUntil(validUntilDate);

  return (
    <ErrorBoundary>
    <div className="relative flex-1 min-h-screen">
      <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 -z-10" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-25 lg:pt-25 pb-20">
        {/* Header Section */}
        <div className="flex items-center justify-between gap-4 mb-8 sm:mb-12">
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="p-2 sm:p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 shadow-inner shrink-0">
              <RefreshCw className="h-5 w-5 sm:h-8 sm:w-8 text-blue-500" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tighter truncate">
                Renew Bus Service
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] sm:text-[11px] font-black uppercase tracking-widest px-2 py-0.5 shrink-0">
                  Official Service
                </Badge>
                <p className="text-[11px] sm:text-sm font-medium text-gray-500 truncate hidden xs:block">Extend your pass seamlessly</p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push('/student')}
            className="shrink-0 bg-white hover:bg-gray-100 text-gray-900 border-0 shadow-xl font-bold rounded-xl h-9 sm:h-11 px-3 sm:px-6 transition-all active:scale-95 text-xs sm:text-sm"
          >
            <ArrowLeft className="mr-1 sm:mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">Back to Dashboard</span>
          </Button>
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-[340px_1fr] gap-6 lg:gap-8 items-start">

          {/* Left Column - Redesigned Unified Identity Sidebar */}
          <div className="h-full flex flex-col">
            <Card className="flex-1 border-0 shadow-2xl overflow-hidden bg-[#0d1117] text-white rounded-[2rem] border border-white/5 flex flex-col relative">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#a855f710_0%,transparent_70%)] opacity-70"></div>
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/10 blur-[80px] rounded-full"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-600/10 blur-[80px] rounded-full"></div>

              <CardContent className="relative p-0 flex flex-col">
                {/* Hero Section */}
                <div className="pt-6 sm:pt-6 pb-3 sm:pb-4 px-4 sm:px-6 text-center border-b border-white/[0.03]">
                  <div className="relative mx-auto mb-3 sm:mb-4 w-20 h-20 sm:w-24 sm:h-24">
                    {/* Multi-layered glow */}
                    <div className="absolute inset-[-4px] sm:inset-[-6px] rounded-full bg-gradient-to-tr from-purple-500 via-indigo-500 to-blue-500 blur-lg opacity-20 transition-opacity"></div>
                    <div className="absolute inset-[-1.5px] rounded-full bg-gradient-to-tr from-purple-500 via-indigo-500 to-blue-500 opacity-50 animate-spin-slow"></div>

                    <div className="relative w-full h-full rounded-full bg-[#0a0c12] border-[3px] border-[#0a0c12] p-1.5 flex items-center justify-center overflow-hidden z-10">
                      {studentData?.profilePhotoUrl ? (
                        <div className="w-full h-full rounded-full overflow-hidden border border-white/10 ring-1 ring-white/5">
                          <Image src={safeImageSrc(studentData.profilePhotoUrl)} alt="Profile" width={96} height={96} className="w-full h-full object-cover rounded-full" />
                        </div>
                      ) : (
                        <div className="w-full h-full rounded-full bg-white/5 flex items-center justify-center">
                          <User className="w-8 h-8 sm:w-12 sm:h-12 text-gray-700" />
                        </div>
                      )}
                    </div>

                    <div className={`absolute -bottom-0.5 -right-0.5 w-6 h-6 sm:w-7 sm:h-7 rounded-full border-[2.5px] sm:border-[3px] border-[#0a0c12] flex items-center justify-center shadow-2xl z-20 ${isExpired ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-emerald-400 to-teal-500'
                      }`}>
                      {isExpired ? <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" /> : <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
                    </div>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-1 sm:mb-1.5 uppercase">
                    {studentData?.fullName?.split(' ')[0] || userData?.name?.split(' ')[0]}
                  </h2>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl group/id cursor-pointer hover:bg-white/10 transition-all"
                    onClick={() => {
                      navigator.clipboard.writeText(studentData?.enrollmentId || '');
                      toast.success('Enrollment ID copied!');
                    }}>
                    <p className="text-blue-400 font-mono text-xs tracking-wider font-black uppercase">
                      {studentData?.enrollmentId}
                    </p>
                    <div className="p-1 rounded-md bg-blue-500/10 text-blue-400 opacity-100 transition-opacity">
                      <Copy className="h-3 w-3" />
                    </div>
                  </div>
                </div>

                {/* Service Details Group */}
                <div className="px-4 py-3 sm:p-4">
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/[0.02] border border-white/[0.05] flex flex-col items-center justify-center text-center hover:bg-white/[0.04] transition-all hover:border-blue-500/20 group/stat">
                      <div className="p-1.5 sm:p-1.5 rounded-lg sm:rounded-xl bg-blue-500/10 mb-1 sm:mb-1.5 group-hover/stat:scale-110 transition-transform">
                        <Bus className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-400" />
                      </div>
                      <p className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1">Bus ID</p>
                      <p className="text-sm sm:text-sm font-black text-white">
                        {busData ? `Bus-${busData.busId?.replace('bus_', '') || 'X'}` : (studentData?.busId ? `Bus-${studentData.busId.replace('bus_', '')}` : 'N/A')}
                      </p>
                    </div>
                    <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/[0.02] border border-white/[0.05] flex flex-col items-center justify-center text-center hover:bg-white/[0.04] transition-all hover:border-purple-500/20 group/stat">
                      <div className="p-1.5 sm:p-1.5 rounded-lg sm:rounded-xl bg-purple-500/10 mb-1 sm:mb-1.5 group-hover/stat:scale-110 transition-transform">
                        <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-purple-400" />
                      </div>
                      <p className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1">Shift</p>
                      <p className="text-sm sm:text-sm font-black text-white capitalize">{studentData?.shift || 'Morning'}</p>
                    </div>
                  </div>
                </div>

                {/* Validity Dashboard */}
                <div className="p-4 sm:p-5 bg-white/[0.01]">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <span className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-[0.3em]">Status Center</span>
                    <div className={`flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 rounded-full border ${isExpired ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                      }`}>
                      <div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full animate-pulse ${isExpired ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
                      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">{isExpired ? 'Expired' : 'Active'}</span>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-center mb-4 sm:mb-6">
                    <svg className="w-32 h-32 sm:w-36 sm:h-36 transform -rotate-90 drop-shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                      <defs>
                        <linearGradient id="statusGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor={isExpired ? "#ef4444" : "#10b981"} />
                          <stop offset="100%" stopColor={isExpired ? "#f43f5e" : "#34d399"} />
                        </linearGradient>
                      </defs>
                      <circle cx="64" cy="64" r="56" fill="transparent" stroke="currentColor" strokeWidth="8" className="text-white/5 sm:hidden" />
                      <circle cx="72" cy="72" r="62" fill="transparent" stroke="currentColor" strokeWidth="10" className="hidden sm:block text-white/5" />

                      {/* Mobile Progress Circle */}
                      <circle
                        cx="64" cy="64" r="56"
                        fill="transparent"
                        stroke="url(#statusGradient)"
                        strokeWidth="10"
                        strokeDasharray={352}
                        strokeDashoffset={352 - (Math.min(daysUntilExpiry, 365) / 365) * 352}
                        strokeLinecap="round"
                        className="sm:hidden transition-all duration-1000 ease-out"
                      />

                      {/* Desktop Progress Circle */}
                      <circle
                        cx="72" cy="72" r="62"
                        fill="transparent"
                        stroke="url(#statusGradient)"
                        strokeWidth="12"
                        strokeDasharray={390}
                        strokeDashoffset={390 - (Math.min(daysUntilExpiry, 365) / 365) * 390}
                        strokeLinecap="round"
                        className="hidden sm:block transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pt-2 gap-1">
                      <span className="text-2xl sm:text-3xl font-black tracking-tighter text-white leading-none">{isExpired ? '0' : daysUntilExpiry}</span>
                      <span className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none">Days Left</span>
                    </div>
                  </div>

                  <div className="p-3 sm:p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between group/validity hover:bg-white/[0.04] transition-all">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 group-hover/validity:scale-110 transition-transform">
                        <Calendar className="h-4 w-4 text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5">Valid Until</p>
                        <p className="text-base font-black text-white">
                          {(() => {
                            if (!validUntilDate) return 'Not Set';
                            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                            return `${months[validUntilDate.getMonth()]} ${validUntilDate.getDate()}, ${validUntilDate.getFullYear()}`;
                          })()}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/10 text-[9px] font-black text-white/40 uppercase tracking-widest px-2">Official</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Renewal Content */}
          <div className="gap-6 sm:gap-8 h-full flex flex-col">
            {/* Redesigned Tab Selector - Integrated with page background */}
            <div className="flex p-1 bg-gray-200/50 dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-2xl sm:rounded-[1.5rem] backdrop-blur-xl shadow-inner">
              <button
                onClick={() => setActiveTab('renewal')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 sm:py-4 rounded-xl sm:rounded-[1.2rem] font-bold text-xs sm:text-sm cursor-pointer uppercase tracking-widest transition-all duration-300 ${activeTab === 'renewal'
                  ? 'bg-white dark:bg-[#0A0B10] text-blue-600 dark:text-blue-400 shadow-2xl scale-100 ring-1 ring-blue-500/20'
                  : 'text-gray-500 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-white/10'
                  }`}
              >
                <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4`} />
                Renewal
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 sm:py-4 rounded-xl sm:rounded-[1.2rem] font-bold text-xs sm:text-sm cursor-pointer uppercase tracking-widest transition-all duration-300 ${activeTab === 'history'
                  ? 'bg-white dark:bg-[#0A0B10] text-purple-600 dark:text-purple-400 shadow-2xl scale-100 ring-1 ring-purple-500/20'
                  : 'text-gray-500 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-white/10'
                  }`}
              >
                <History className="h-3 w-3 sm:h-4 sm:w-4" />
                History
              </button>
            </div>

            {/* Renewal Tab Content */}
            {activeTab === 'renewal' && (
              <>
                {renewalCompleted ? (
                  <Card className="flex-1 border-0 shadow-lg sm:shadow-xl bg-gradient-to-br from-green-950/20 to-emerald-950/20 border border-emerald-500/20 overflow-hidden flex flex-col items-center justify-center p-8 text-center min-h-[400px]">
                    <CardContent className="pt-6 sm:pt-8 px-4 sm:px-6 pb-6 sm:pb-8 text-center">
                      <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-green-500 rounded-full mb-4 sm:mb-6 shadow-xl">
                        <CheckCircle className="h-7 w-7 sm:h-10 sm:w-10 text-white" />
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold text-green-900 dark:text-green-100 mb-1 sm:mb-2 text-center">
                        Renewal Completed!
                      </h2>
                      <p className="text-sm sm:text-base text-green-700 dark:text-green-300 mb-4 sm:mb-6 text-center">
                        Your bus service has been successfully renewed.
                      </p>
                      <Button
                        onClick={() => router.push('/student')}
                        className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg px-6 sm:px-8 text-sm sm:text-base h-10 sm:h-11"
                      >
                        Go to Dashboard
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {!showPaymentSection ? (
                      <Card className="flex-1 border-0 shadow-2xl bg-[#0e0e12] rounded-[2rem] overflow-hidden border border-white/5">
                        {/* Premium Header */}
                        <div className="relative p-5 sm:p-6 border-b border-white/5 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-r from-violet-600/10 to-fuchsia-600/10"></div>
                          <div className="relative flex items-center gap-3 sm:gap-5">
                            <div className="p-3 sm:p-4 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl sm:rounded-2xl shadow-xl shadow-indigo-500/20">
                              <Calendar className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
                            </div>
                            <div>
                              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">Renewal Plan</h3>
                              <p className="text-xs sm:text-sm font-medium text-gray-400">Configure your extension duration</p>
                            </div>
                          </div>
                        </div>

                        <CardContent className="p-4 sm:p-6 space-y-6 sm:space-y-8">
                          {/* Duration Selector */}
                          <div className="space-y-3 sm:space-y-4">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] sm:text-[11px] font-black text-gray-400 uppercase tracking-[0.3em]">
                                1. Select Duration
                              </Label>
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-none px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest cursor-default">
                                <Sparkles className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                                Standard Plan
                              </Badge>
                            </div>

                            <Select
                              value={selectedDuration.toString()}
                              onValueChange={(value) => {
                                setSelectedDuration(parseInt(value));
                                setShowPaymentSection(false);
                              }}
                              disabled={true} // Locked to 1 year
                            >
                              <SelectTrigger className="h-11 sm:h-14 border-2 border-white/10 bg-white/5 text-sm sm:text-base font-black rounded-xl sm:rounded-2xl focus:ring-4 focus:ring-violet-500/20 focus:border-violet-500 transition-all px-4 sm:px-6 cursor-not-allowed opacity-80 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#12141C] border-white/10 shadow-2xl rounded-xl sm:rounded-2xl p-1 sm:p-2">
                                <SelectItem
                                  value="1"
                                  className="text-xs sm:text-base font-bold py-2.5 sm:py-4 rounded-lg sm:rounded-xl cursor-default focus:bg-violet-500/10 focus:text-violet-500 text-white hover:bg-white/10"
                                >
                                  <div className="flex items-center gap-2 sm:gap-3">
                                    <Calendar className="h-3.5 w-3.5 sm:h-5 sm:w-5 opacity-50" />
                                    1 Year
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-gray-500 pl-1">Standard renewal duration is 1 year.</p>
                          </div>

                          {/* Summary Grid */}
                          <div className="space-y-3 sm:space-y-4">
                            <Label className="text-[10px] sm:text-[11px] font-black text-gray-400 uppercase tracking-[0.3em]">
                              2. Review Summary
                            </Label>

                            {sessionInfo ? (
                              <div className="grid grid-cols-2 gap-2 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                {/* Duration Sub-Card */}
                                <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-2 sm:gap-4 cursor-default hover:bg-white/[0.06] transition-colors">
                                  <div className="p-1.5 sm:p-3 bg-blue-500/10 rounded-lg sm:rounded-xl">
                                    <Clock className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-blue-500" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] sm:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Duration</p>
                                    <p className="text-xs sm:text-sm font-black text-white">{sessionInfo.duration} Year{sessionInfo.duration > 1 ? 's' : ''}</p>
                                  </div>
                                </div>

                                {/* Session Sub-Card */}
                                <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-2 sm:gap-4 cursor-default hover:bg-white/[0.06] transition-colors">
                                  <div className="p-1.5 sm:p-3 bg-purple-500/10 rounded-lg sm:rounded-xl">
                                    <Calendar className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-purple-500" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] sm:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Session</p>
                                    <p className="text-xs sm:text-sm font-black text-white">{sessionInfo.sessionStartYear}-{sessionInfo.sessionEndYear}</p>
                                  </div>
                                </div>

                                {/* Validity Sub-Card */}
                                <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-2 sm:gap-4 cursor-default hover:bg-white/[0.06] transition-colors">
                                  <div className="p-1.5 sm:p-3 bg-indigo-500/10 rounded-lg sm:rounded-xl">
                                    <ShieldCheck className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-indigo-500" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] sm:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Validity</p>
                                    <p className="text-xs sm:text-sm font-black text-white">{new Date(sessionInfo.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</p>
                                  </div>
                                </div>

                                {/* Fee Sub-Card - Highlighted */}
                                <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between relative overflow-hidden group/fee cursor-default hover:bg-white/[0.08] transition-colors">
                                  <div className="flex items-center gap-2.5 sm:gap-4 relative z-10">
                                    <div className="p-2 sm:p-3 bg-emerald-500 text-white rounded-lg sm:rounded-xl shadow-lg shadow-emerald-500/30">
                                      <IndianRupee className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
                                    </div>
                                    <div>
                                      <p className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5">Fee</p>
                                      <p className="text-xl sm:text-2xl font-black text-white">₹{sessionInfo.fee.toLocaleString()}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="p-6 sm:p-12 rounded-xl sm:rounded-2xl border-2 border-dashed border-white/5 flex flex-col items-center justify-center text-center">
                                <Loader2 className="h-5 w-5 sm:h-8 sm:w-8 animate-spin text-blue-500 mb-2 sm:mb-3 opacity-50" />
                                <p className="text-[9px] sm:text-xs font-black text-gray-400 uppercase tracking-widest">Calculating session details...</p>
                              </div>
                            )}
                          </div>

                          {/* Security Note */}
                          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-amber-500/5 border border-amber-500/10 flex gap-1.5 sm:gap-3">
                            <Info className="h-3.5 w-3.5 sm:h-6 sm:w-6 text-amber-500 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] sm:text-xs text-amber-200/60 font-medium leading-relaxed">
                              Payments are processed over a secure encrypted layer. Online renewals are activated instantly after payment confirmation.
                            </p>
                          </div>

                          {/* Proceed Button */}
                          <Button
                            onClick={() => {
                              if (!sessionInfo) return;
                              setIsProceedingToPayment(true);
                              setTimeout(() => {
                                setShowPaymentSection(true);
                                setIsProceedingToPayment(false);
                              }, 300);
                            }}
                            disabled={isProceedingToPayment || !sessionInfo}
                            className="w-full h-12 sm:h-14 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-700 text-white font-black text-xs sm:text-sm uppercase tracking-[0.2em] shadow-[0_10px_40px_-10px_rgba(37,99,235,0.4)] transition-all duration-300 group rounded-xl sm:rounded-[1.2rem] border-0 cursor-pointer active:scale-[0.98]"
                          >
                            {isProceedingToPayment ? (
                              <div className="flex items-center gap-2 sm:gap-3">
                                <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                                <span>Verifying...</span>
                              </div>
                            ) : !sessionInfo ? (
                              <div className="flex items-center gap-2 sm:gap-3">
                                <Loader2 className="h-4 w-4 sm:h-4 sm:w-4 animate-spin opacity-50" />
                                <span>Synchronizing...</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 sm:gap-3">
                                PROCEED TO PAYMENT
                                <Zap className="h-4 w-4 sm:h-5 sm:w-5 fill-white animate-pulse" />
                              </div>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="flex-1 flex flex-col">
                        <div className="h-full">


                          <PaymentModeSelector
                            amount={sessionInfo.fee}
                            duration={sessionInfo.duration}
                            sessionStartYear={sessionInfo.sessionStartYear}
                            sessionEndYear={sessionInfo.sessionEndYear}
                            validUntil={sessionInfo.validUntil}
                            userId={currentUser!.uid}
                            userName={studentData?.fullName || userData?.name || ''}
                            userEmail={currentUser?.email || ''}
                            userPhone={studentData?.phoneNumber || ''}
                            enrollmentId={studentData?.enrollmentId}
                            purpose="renewal"
                            onPaymentComplete={handlePaymentComplete}
                            onOfflineSelected={handleOfflinePayment}
                            onBack={() => setShowPaymentSection(false)}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Transaction History Tab Content */}
            {activeTab === 'history' && (
              <div className="flex-1 space-y-4 sm:space-y-6 flex flex-col min-h-0">
                {loadingTransactions ? (
                  <Card className="flex-1 border-0 shadow-2xl bg-[#111117] border border-white/5 rounded-2xl sm:rounded-[2rem] p-8 sm:p-12 flex flex-col items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-4" />
                    <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs">Fetching records...</p>
                  </Card>
                ) : transactions.length === 0 ? (
                  <Card className="flex-1 border-0 shadow-2xl bg-[#111117] border border-white/5 rounded-2xl sm:rounded-[2rem] p-8 sm:p-12 flex flex-col items-center justify-center">
                    <Receipt className="h-12 w-12 sm:h-16 sm:w-16 text-gray-800 mx-auto mb-4 sm:mb-6 opacity-20" />
                    <h3 className="text-xl sm:text-2xl font-black text-white mb-1.5 sm:mb-2 uppercase tracking-tight">No records found</h3>
                    <p className="text-gray-500 text-xs sm:text-sm font-medium">Your renewal history will appear here once you make a payment.</p>
                  </Card>
                ) : (
                  <Card className="flex-1 border-0 shadow-2xl bg-[#111117] border border-white/5 rounded-2xl sm:rounded-[2rem] p-3 sm:p-6 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 sm:pr-2 scrollbar-thin scrollbar-track-white/5 scrollbar-thumb-white/20 px-2 pb-4">
                      {transactions.map((transaction: any) => (
                        <div key={transaction.paymentId} className="group relative overflow-hidden bg-white/[0.04] border border-white/10 rounded-[1.5rem] hover:bg-white/[0.06] transition-all duration-300">
                          <div className="relative p-4 sm:p-5">
                            <div className="flex items-center justify-between mb-4 sm:mb-6">
                              <div className="flex items-center gap-3 sm:gap-4">
                                <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-inner">
                                  <IndianRupee className="h-4 w-4 sm:h-6 sm:w-6" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                                    <h4 className="font-black text-xl sm:text-3xl text-white tracking-tight">₹{transaction.amount?.toLocaleString()}</h4>
                                    <Badge className="bg-emerald-500/10 text-emerald-400 border-none px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">
                                      COMPLETED
                                    </Badge>
                                  </div>
                                  <p className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5 sm:gap-2">
                                    <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                    {(() => {
                                      const d = new Date(transaction.timestamp);
                                      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                                      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
                                    })()}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadReceipt(transaction.paymentId)}
                                  disabled={downloadingReceiptId === transaction.paymentId}
                                  className="h-8 p-3 gap-1.5 text-[10px] font-black text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-3 rounded-lg transition-all tracking-widest disabled:opacity-70"
                                >
                                  {downloadingReceiptId === transaction.paymentId ? (
                                    <>
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Processing
                                    </>
                                  ) : (
                                    <>
                                      <Download className="h-3 w-3" />
                                      E-Receipt
                                    </>
                                  )}
                                </Button>
                                <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest pr-1">
                                  Type: {transaction.paymentMethod === 'online' ? 'Digital' : 'Manual'}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
                              <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-[#0d1117] border border-white/5 flex flex-col gap-0.5 sm:gap-1">
                                <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 flex items-center gap-1 sm:gap-1.5">
                                  <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-400" /> DURATION
                                </span>
                                <span className="text-sm sm:text-base font-black text-white">{transaction.durationYears} Year{transaction.durationYears > 1 ? 's' : ''}</span>
                              </div>
                              <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-[#0d1117] border border-white/5 flex flex-col gap-0.5 sm:gap-1">
                                <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 flex items-center gap-1 sm:gap-1.5">
                                  <ShieldCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-purple-400" /> VALIDITY
                                </span>
                                <span className="text-sm sm:text-base font-black text-white">
                                  {(() => {
                                    const vDate = parseFirestoreDate(transaction.validUntil);
                                    if (!vDate) return 'Pending';
                                    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                                    return `${months[vDate.getMonth()]} ${vDate.getDate()}, ${vDate.getFullYear()}`;
                                  })()}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-1.5 sm:space-y-2">
                              {transaction.paymentMethod === 'online' ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/5 rounded-lg sm:rounded-xl border border-white/5 flex flex-col">
                                    <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest">Order ID</span>
                                    <span className="text-[11px] sm:text-[11px] font-mono text-gray-400 truncate">{transaction.razorpayOrderId || 'N/A'}</span>
                                  </div>
                                  <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/5 rounded-lg sm:rounded-xl border border-white/5 flex flex-col">
                                    <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest">Payment ID</span>
                                    <span className="text-[11px] sm:text-[11px] font-mono text-gray-400 truncate">{transaction.razorpayPaymentId || transaction.paymentId}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/5 rounded-lg sm:rounded-xl border border-white/5 flex flex-col">
                                    <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest">Transaction ID</span>
                                    <span className="text-[11px] sm:text-[11px] font-mono text-gray-400 truncate">{transaction.offlineTransactionId || transaction.paymentId}</span>
                                  </div>
                                  {(transaction.paidAt || transaction.timestamp) && (
                                    <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/5 rounded-lg sm:rounded-xl border border-white/5 flex flex-col">
                                      <span className="text-[10px] sm:text-[10px] font-black text-gray-500 uppercase tracking-widest">Payment Date/Time</span>
                                      <span className="text-[11px] sm:text-[11px] font-mono text-gray-400 truncate">
                                        {(() => {
                                          try {
                                            return new Date(transaction.paidAt || transaction.timestamp).toLocaleString('en-IN', {
                                              day: '2-digit',
                                              month: 'short',
                                              year: 'numeric',
                                              hour: '2-digit',
                                              minute: '2-digit'
                                            });
                                          } catch (e) {
                                            return transaction.paidAt || transaction.timestamp || 'N/A';
                                          }
                                        })()}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {transaction.approvedBy && (
                                <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg sm:rounded-xl">
                                  <div className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                  <span className="text-[7px] sm:text-[9px] text-emerald-500/80 font-black uppercase tracking-widest">SYSTEM VERIFIED:</span>
                                  <span className="text-[8px] sm:text-[10px] text-gray-300 font-bold truncate">{transaction.approverName || (transaction.approvedBy?.includes('@') ? transaction.approvedBy : 'Administrator')}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
