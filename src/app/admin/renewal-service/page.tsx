"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { useRouter } from 'next/navigation';
import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  CreditCard,
  IndianRupee,
  Info,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Receipt,
  History,
  Eye,
  FileText,
  User,
  XCircle,
  Download,
  Filter,
  TrendingUp,
  BarChart3,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Copy
} from 'lucide-react';
import { toast } from 'sonner';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Image from 'next/image';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

import { parseFirestoreDate, formatDate } from '@/lib/utils/date-utils';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import Avatar from '@/components/Avatar';
import { PaymentDetailModal } from '@/components/payment';

interface StudentData {
  fullName: string;
  email: string;
  phoneNumber: string;
  alternatePhone?: string;
  enrollmentId: string;
  faculty: string;
  course: string;
  semester: string;
  gender: string;
  busAssigned: string;
  busId?: string;
  shift: string;
  sessionStartYear: number;
  sessionEndYear: number;
  profilePhotoUrl?: string;
  status: string;
  address?: string;
  emergencyContact?: string;
}

interface RenewalRequest {
  id: string;
  studentId: string;
  studentName: string;
  enrollmentId: string;
  studentEmail?: string;
  durationYears: number;
  totalFee: number;
  transactionId?: string;
  receiptImageUrl?: string;
  paymentMode: string;
  paidAt?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: any;
  updatedAt: any;
  approvedBy?: string;
  approvedAt?: any;
  rejectedBy?: string;
  rejectedAt?: any;
  studentData?: StudentData;
}

interface Transaction {
  studentId: string;
  studentName: string;
  amount: number;
  paymentMethod: 'online' | 'offline' | 'manual';
  paymentId: string;
  timestamp: string;
  durationYears: number;
  validUntil: string;
  approvedBy?: string;
  status?: 'completed' | 'pending' | 'failed';
}

interface EnrichedTransaction extends Transaction {
  profilePhotoUrl: string;
  userId?: string; // Firestore document ID
}



export default function AdminRenewalServicePage() {
  const { currentUser, userData, loading } = useAuth();
  const { canApproveOfflinePayment, canRejectOfflinePayment } = useModeratorPermissions();
  const router = useRouter();
  const isAdmin = userData?.role === 'admin';

  const [activeTab, setActiveTab] = useState('approval');
  
  // Set default tab based on role
  useEffect(() => {
    if (userData?.role === 'admin') {
      setActiveTab('dashboard');
    } else {
      setActiveTab('approval');
    }
  }, [userData?.role]);

  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RenewalRequest | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Transaction history states
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [enrichedTransactions, setEnrichedTransactions] = useState<EnrichedTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterYear, setFilterYear] = useState('default');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [buses, setBuses] = useState<any[]>([]);

  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [showPaymentDetailModal, setShowPaymentDetailModal] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);

  // Export states
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportSession, setExportSession] = useState('');
  const [exporting, setExporting] = useState(false);

  const exportSessionOptions = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currYear = currentMonth >= 7 ? now.getFullYear() : now.getFullYear() - 1;

    return [
      { value: `${currYear}-${currYear + 1}`, label: `${currYear}-${currYear + 1} (Current Session)`, start: currYear, end: currYear + 1 },
      { value: `${currYear - 1}-${currYear}`, label: `${currYear - 1}-${currYear} (Last Session)`, start: currYear - 1, end: currYear },
      { value: `${currYear - 2}-${currYear - 1}`, label: `${currYear - 2}-${currYear - 1}`, start: currYear - 2, end: currYear - 1 },
      { value: `${currYear - 3}-${currYear - 2}`, label: `${currYear - 3}-${currYear - 2}`, start: currYear - 3, end: currYear - 2 },
      { value: `${currYear - 4}-${currYear - 3}`, label: `${currYear - 4}-${currYear - 3}`, start: currYear - 4, end: currYear - 3 }
    ];
  }, []);

  useEffect(() => {
    if (exportSessionOptions.length > 0 && !exportSession) {
      setExportSession(exportSessionOptions[0].value);
    }
  }, [exportSessionOptions, exportSession]);

  const handleExportPayments = async () => {
    if (!currentUser || !exportSession) return;

    setExporting(true);
    const loadingToastId = toast.loading('Fetching payment data for export...');

    try {
      const selectedOption = exportSessionOptions.find(opt => opt.value === exportSession);
      if (!selectedOption) {
        toast.dismiss(loadingToastId);
        toast.error('Invalid session selected');
        setExporting(false);
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch(
        `/api/payment/export?startYear=${selectedOption.start}&endYear=${selectedOption.end}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to fetch export data');
      }

      const result = await response.json();
      const payments = result.payments || [];

      if (payments.length === 0) {
        toast.dismiss(loadingToastId);
        toast.error(`No payments found for session ${exportSession}`);
        setExporting(false);
        return;
      }

      // Business-friendly header names
      const headers = [
        'Sl No',
        'Payment ID',
        'Student Name',
        'Student / Enrollment ID',
        'Amount (INR)',
        'Transaction Date',
        'Payment Method',
        'Payment Status',
        'Academic Session',
        'Valid Until',
        'Offline Reference ID',
        'Razorpay Payment ID',
        'Razorpay Order ID',
        'Approved By (Name)',
        'Approved By (Role)',
        'Approved By (Employee ID)',
        'Approved At'
      ];

      const dataRows = payments.map((p: any, index: number) => {
        const formatDateStr = (dateStr: string) => {
          if (!dateStr) return 'N/A';
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return 'N/A';
          return d.toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        };

        return [
          (index + 1).toString(),
          p.paymentId || 'N/A',
          p.studentName || 'N/A',
          p.studentId || 'N/A',
          p.amount ? `₹${p.amount}` : 'N/A',
          formatDateStr(p.transactionDate),
          p.method || 'N/A',
          p.status || 'N/A',
          p.session || 'N/A',
          formatDateStr(p.validUntil),
          p.offlineTransactionId || 'N/A',
          p.razorpayPaymentId || 'N/A',
          p.razorpayOrderId || 'N/A',
          p.approvedByName || 'N/A',
          p.approvedByRole || 'N/A',
          p.approvedByEmpId || 'N/A',
          formatDateStr(p.approvedAt)
        ];
      });

      const exportData = [headers, ...dataRows];

      const { exportToExcel } = await import('@/lib/export-helpers');
      await exportToExcel(exportData, `ADTU_Payments_Report_${exportSession}_${new Date().toISOString().split('T')[0]}`, 'Payments');

      toast.dismiss(loadingToastId);
      toast.success(`Payments exported successfully for session ${exportSession}!`);
      setShowExportDialog(false);
    } catch (error: any) {
      console.error('Error exporting payments:', error);
      toast.dismiss(loadingToastId);
      toast.error(error.message || 'Failed to export payments');
    } finally {
      setExporting(false);
    }
  };

  // Payment Dashboard states (admin-only)
  const [dashboardStats, setDashboardStats] = useState<{
    totalRevenue: number;
    completedCount: number;
    pendingCount: number;
    monthlyData: { name: string; amount: number }[];
  } | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  // Handler for clicking on manual payment badge
  const handleManualPaymentClick = (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setShowPaymentDetailModal(true);
  };

  // Fetch dashboard analytics (admin-only)
  useEffect(() => {
    const fetchDashboardStats = async () => {
      if (!currentUser || !isAdmin || activeTab !== 'dashboard') return;
      setLoadingDashboard(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/admin/analytics/payments', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setDashboardStats(data.stats);
        }
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setLoadingDashboard(false);
      }
    };
    fetchDashboardStats();
  }, [currentUser, isAdmin, activeTab, searchTrigger]);

  // Manual refresh handler
  const handleManualRefresh = () => {
    setIsManualRefreshing(true);
    setSearchTrigger(prev => prev + 1);
    // Reset the flag after a short delay for visual feedback
    setTimeout(() => setIsManualRefreshing(false), 1500);
  };

  // Check admin access - REMOVED: Handled by AdminLayout/ModeratorLayout

  // Fetch renewal requests with student data
  useEffect(() => {
    const fetchRenewalRequests = async () => {
      if (!currentUser || activeTab !== 'approval') return;

      try {
        setLoadingRequests(true);
        const renewalRef = collection(db, 'renewal_requests');
        const q = query(renewalRef, where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        const requests: RenewalRequest[] = [];
        snapshot.forEach((doc) => {
          requests.push({ id: doc.id, ...doc.data() } as RenewalRequest);
        });

        // Fetch student data for each request
        const requestsWithStudentData = await Promise.all(
          requests.map(async (request) => {
            try {
              const studentDoc = await getDocs(
                query(collection(db, 'students'), where('enrollmentId', '==', request.enrollmentId), limit(1))
              );
              if (!studentDoc.empty) {
                const studentData = studentDoc.docs[0].data() as StudentData;
                return { ...request, studentData };
              }
              return request;
            } catch (error) {
              console.error(`Error fetching student data for request ${request.id?.substring(0,8)}...:`, error);
              return request;
            }
          })
        );

        setRenewalRequests(requestsWithStudentData);
      } catch (error) {
        console.error('Error fetching renewal requests:', error);
        toast.error('Failed to load renewal requests');
      } finally {
        setLoadingRequests(false);
      }
    };

    fetchRenewalRequests();
  }, [currentUser, activeTab, searchTrigger]);

  // Fetch transaction history
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!currentUser || activeTab !== 'history') return;

      setLoadingTransactions(true);
      try {
        const token = await currentUser.getIdToken();
        const params = new URLSearchParams({
          page: currentPage.toString(),
          limit: '20',
          year: (filterYear && filterYear !== 'default') ? filterYear : new Date().getFullYear().toString(),
          ...(filterStudentId && { studentId: filterStudentId }),
          ...(filterPaymentMethod !== 'all' && { paymentMethod: filterPaymentMethod })
        });

        const response = await fetch(`/api/payment/transactions?${params}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const rawTransactions = data.transactions || [];
          setTransactions(rawTransactions);
          setTotalPages(data.totalPages || 1);

          // Enrich transactions with student data (userId only)
          const enriched = await Promise.all(
            rawTransactions.map(async (transaction: any) => {
              try {
                const studentsRef = collection(db, 'students');
                const q = query(studentsRef, where('enrollmentId', '==', transaction.studentId), limit(1));
                const snapshot = await getDocs(q);

                if (!snapshot.empty) {
                  const studentDoc = snapshot.docs[0];
                  // We only need the ID for navigation
                  return {
                    ...transaction,
                    userId: studentDoc.id
                  };
                }
                return transaction;
              } catch (error) {
                console.error(`Error fetching student data for ${transaction.studentId}:`, error);
                return transaction;
              }
            })
          );
          setEnrichedTransactions(enriched);
        }
      } catch (error) {
        console.error('Error fetching transactions:', error);
        toast.error('Failed to load transaction history');
      } finally {
        setLoadingTransactions(false);
      }
    };

    fetchTransactions();
  }, [currentUser, activeTab, currentPage, searchTrigger]);

  // Fetch buses data
  useEffect(() => {
    const fetchBuses = async () => {
      if (!currentUser) return;

      try {
        const busesRef = collection(db, 'buses');
        const snapshot = await getDocs(busesRef);
        const busesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setBuses(busesData);
      } catch (error) {
        console.error('Error fetching buses:', error);
      }
    };

    fetchBuses();
  }, [currentUser]);

  // Fetch bus fee from settings via API




  // Helper function to format bus display with busNumber
  const getBusDisplay = (busId: string): string => {
    if (!busId || busId === 'Not Assigned') return 'Not Assigned';

    // Extract bus number from busId
    const extractNumber = (str: string): string => {
      const match = str.match(/\d+/);
      return match ? match[0] : '';
    };

    const busNum = extractNumber(busId);

    // Find the bus in the buses array
    const bus = buses.find(b =>
      b.id === busId ||
      b.busId === busId ||
      extractNumber(b.id || '') === busNum ||
      extractNumber(b.busId || '') === busNum
    );

    if (bus && bus.busNumber) {
      return `Bus-${busNum} (${bus.busNumber})`;
    }

    return `Bus-${busNum}`;
  };



  const handleApproveRequest = async () => {
    if (!selectedRequest || !currentUser) return;

    if (userData?.role === 'moderator' && !canApproveOfflinePayment) {
      toast.error('This moderator account is not allowed to approve offline payments');
      return;
    }

    setProcessing(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/renewal-requests/approve-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestId: selectedRequest.id
        })
      });

      if (response.ok) {
        toast.success('Renewal request approved successfully');
        // Remove from local state immediately
        setRenewalRequests(prev => prev.filter(r => r.id !== selectedRequest.id));
        setShowViewDialog(false);
        setSelectedRequest(null);
        // Refresh the list (optional, but local update is faster)
        // setActiveTab('approval');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to approve renewal request');
      }
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve renewal request');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectRequest = async () => {
    if (!selectedRequest || !currentUser || !rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    if (userData?.role === 'moderator' && !canRejectOfflinePayment) {
      toast.error('This moderator account is not allowed to reject offline payments');
      return;
    }

    setProcessing(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/renewal-requests/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestId: selectedRequest.id,
          reason: rejectionReason.trim(),
          rejectorName: userData?.displayName || userData?.fullName || 'Admin',
          rejectorId: currentUser.uid
        })
      });

      if (response.ok) {
        toast.success('Renewal request rejected');
        // Remove from local state immediately
        setRenewalRequests(prev => prev.filter(r => r.id !== selectedRequest.id));
        setShowRejectDialog(false);
        setSelectedRequest(null);
        setRejectionReason('');
        // Refresh the list (optional, but local update is faster)
        // setActiveTab('approval');
      } else {
        toast.error('Failed to reject renewal request');
      }
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Failed to reject renewal request');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadReceipt = async (paymentId: string) => {
    const loadingToastId = toast.loading('Preparing receipt...');
    setDownloadingReceiptId(paymentId);
    try {
      if (!currentUser) {
        toast.dismiss(loadingToastId);
        toast.error('Authentication required');
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
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

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

  if (loading) {
    return <PremiumPageLoader message="Initializing Renewal Console..." subMessage="Securing your payment environment..." />;
  }

  // Dashboard computed values
  const avgPayment = useMemo(() => {
    if (!dashboardStats) return 0;
    const total = dashboardStats.completedCount + dashboardStats.pendingCount;
    return total > 0 ? Math.round(dashboardStats.totalRevenue / total) : 0;
  }, [dashboardStats]);

  const onlinePayments = useMemo(() => {
    if (!enrichedTransactions.length) return 0;
    return enrichedTransactions.filter(t => t.paymentMethod === 'online').length;
  }, [enrichedTransactions]);

  const offlinePayments = useMemo(() => {
    if (!enrichedTransactions.length) return 0;
    return enrichedTransactions.filter(t => t.paymentMethod !== 'online').length;
  }, [enrichedTransactions]);

  const CHART_COLORS = ['#8b5cf6', '#f97316'];

  return (
    <div className="min-h-screen bg-transparent p-4">
      <div className="max-w-7xl mx-auto py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <RefreshCw className="h-4 w-4 text-white" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Renewal Management
              </h1>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage student renewal requests and view payment history
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleManualRefresh}
              disabled={isManualRefreshing}
              className="group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isManualRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
              Refresh
            </Button>
            <Button
              onClick={() => setShowExportDialog(true)}
              className="h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95"
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </div>

        {/* Tabs - Custom Gradient Tabs */}
        <div className="mb-4">
          <div className="flex gap-2 border-b border-gray-700/30 px-4">
            {/* Dashboard Tab - Admin Only */}
            {isAdmin && (
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-t-lg font-semibold text-[10px] sm:text-xs transition-all border-b-2 cursor-pointer ${activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 text-white shadow-md shadow-purple-500/30 border-purple-500'
                  : 'bg-transparent text-gray-400 hover:text-gray-200 border-transparent hover:bg-gray-800/30'
                  }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Dashboard
              </button>
            )}
            <button
              onClick={() => setActiveTab('approval')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-t-lg font-semibold text-[10px] sm:text-xs transition-all border-b-2 cursor-pointer ${activeTab === 'approval'
                ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 text-white shadow-md shadow-purple-500/30 border-purple-500'
                : 'bg-transparent text-gray-400 hover:text-gray-200 border-transparent hover:bg-gray-800/30'
                }`}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Payment Approval
              {renewalRequests.length > 0 && (
                <Badge className="ml-1.5 bg-yellow-500 text-white text-[10px] px-1.5 py-0">
                  {renewalRequests.length}
                </Badge>
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-t-lg font-semibold text-[10px] sm:text-xs transition-all border-b-2 cursor-pointer ${activeTab === 'history'
                ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 text-white shadow-md shadow-purple-500/30 border-purple-500'
                : 'bg-transparent text-gray-400 hover:text-gray-200 border-transparent hover:bg-gray-800/30'
                }`}
            >
              <History className="h-3.5 w-3.5" />
              Transaction History
            </button>
          </div>
        </div>

        <Tabs defaultValue={isAdmin ? "dashboard" : "approval"} value={activeTab} onValueChange={setActiveTab}>
          <div className="hidden">
            <TabsList>
              {isAdmin && <TabsTrigger value="dashboard">Dashboard</TabsTrigger>}
              <TabsTrigger value="approval">Approval</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>

          {/* Payment Dashboard Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="dashboard" className="mt-0 px-0 py-4">
              {loadingDashboard ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Total Revenue */}
                    <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/15 border border-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-300 group">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <IndianRupee className="h-4 w-4 text-emerald-400" />
                          </div>
                          <div className="flex items-center gap-1 text-emerald-400">
                            <ArrowUpRight className="h-3 w-3" />
                            <span className="text-[10px] font-bold">Revenue</span>
                          </div>
                        </div>
                        <p className="text-xl font-black text-white tracking-tight">
                          ₹{(dashboardStats?.totalRevenue || 0).toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider font-semibold">Total Collection</p>
                      </CardContent>
                    </Card>

                    {/* Completed Payments */}
                    <Card className="bg-gradient-to-br from-blue-500/10 to-indigo-500/15 border border-blue-500/25 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300 group">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-8 w-8 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <CheckCircle className="h-4 w-4 text-blue-400" />
                          </div>
                          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px] px-1.5 py-0">Verified</Badge>
                        </div>
                        <p className="text-xl font-black text-white tracking-tight">
                          {dashboardStats?.completedCount || 0}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider font-semibold">Completed</p>
                      </CardContent>
                    </Card>

                    {/* Pending Payments */}
                    <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/15 border border-amber-500/25 hover:shadow-lg hover:shadow-amber-500/10 transition-all duration-300 group">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-8 w-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Clock className="h-4 w-4 text-amber-400" />
                          </div>
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] px-1.5 py-0">Pending</Badge>
                        </div>
                        <p className="text-xl font-black text-white tracking-tight">
                          {dashboardStats?.pendingCount || 0}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider font-semibold">Awaiting</p>
                      </CardContent>
                    </Card>

                    {/* Avg Payment */}
                    <Card className="bg-gradient-to-br from-purple-500/10 to-fuchsia-500/15 border border-purple-500/25 hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-300 group">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-8 w-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Wallet className="h-4 w-4 text-purple-400" />
                          </div>
                          <div className="flex items-center gap-1 text-purple-400">
                            <TrendingUp className="h-3 w-3" />
                            <span className="text-[10px] font-bold">Avg</span>
                          </div>
                        </div>
                        <p className="text-xl font-black text-white tracking-tight">
                          ₹{avgPayment.toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-wider font-semibold">Per Student</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Monthly Revenue Trend */}
                    <Card className="lg:col-span-2 border border-zinc-800/50 shadow-xl bg-zinc-900/50">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-sm text-white flex items-center gap-2">
                              <TrendingUp className="h-4 w-4 text-purple-400" />
                              Monthly Revenue
                            </CardTitle>
                            <CardDescription className="text-[10px] text-gray-400 mt-0.5">
                              Payment collection trend for {new Date().getFullYear()}
                            </CardDescription>
                          </div>
                          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[9px]">
                            FY {new Date().getFullYear()}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {dashboardStats?.monthlyData && dashboardStats.monthlyData.some(d => d.amount > 0) ? (
                          <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height={220} minWidth={0} minHeight={0}>
                              <AreaChart data={dashboardStats.monthlyData}>
                                <defs>
                                  <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.4} />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #374151', borderRadius: '12px', fontSize: '11px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                                  labelStyle={{ color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}
                                  formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Revenue']}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="amount"
                                  stroke="#8b5cf6"
                                  strokeWidth={2.5}
                                  fillOpacity={1}
                                  fill="url(#dashRevGrad)"
                                  dot={{ fill: '#8b5cf6', strokeWidth: 0, r: 3 }}
                                  activeDot={{ fill: '#a78bfa', stroke: '#8b5cf6', strokeWidth: 2, r: 5 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <div className="h-[220px] flex flex-col items-center justify-center text-gray-500">
                            <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
                            <p className="text-sm font-medium">No revenue data yet</p>
                            <p className="text-[10px] text-gray-600 mt-1">Revenue chart will appear after payments are processed</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Payment Method Breakdown */}
                    <Card className="border border-zinc-800/50 shadow-xl bg-zinc-900/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-white flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-pink-400" />
                          Payment Methods
                        </CardTitle>
                        <CardDescription className="text-[10px] text-gray-400">Online vs Offline breakdown</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {(dashboardStats?.completedCount || 0) + (dashboardStats?.pendingCount || 0) > 0 ? (
                          <div className="space-y-4">
                            {/* Collection Rate */}
                            <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/50">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Collection Rate</span>
                                <span className="text-sm font-black text-emerald-400">
                                  {((dashboardStats?.completedCount || 0) / Math.max((dashboardStats?.completedCount || 0) + (dashboardStats?.pendingCount || 0), 1) * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div className="relative w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 rounded-full transition-all duration-700"
                                  style={{ width: `${(dashboardStats?.completedCount || 0) / Math.max((dashboardStats?.completedCount || 0) + (dashboardStats?.pendingCount || 0), 1) * 100}%` }}
                                />
                              </div>
                            </div>

                            {/* Stats Breakdown */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-700/30 hover:border-purple-500/30 transition-colors">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
                                  <span className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Completed</span>
                                </div>
                                <span className="text-sm font-black text-white">{dashboardStats?.completedCount || 0}</span>
                              </div>
                              <div className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-700/30 hover:border-amber-500/30 transition-colors">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                                  <span className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Pending</span>
                                </div>
                                <span className="text-sm font-black text-white">{dashboardStats?.pendingCount || 0}</span>
                              </div>
                              <div className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-700/30 hover:border-emerald-500/30 transition-colors">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                  <span className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Total Revenue</span>
                                </div>
                                <span className="text-sm font-black text-emerald-400">₹{(dashboardStats?.totalRevenue || 0).toLocaleString('en-IN')}</span>
                              </div>
                            </div>

                            {/* Revenue per completed */}
                            <div className="pt-2 border-t border-zinc-700/30">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-gray-500 font-medium">Avg Revenue / Payment</span>
                                <span className="text-xs font-bold text-purple-400">₹{avgPayment.toLocaleString('en-IN')}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="h-[200px] flex flex-col items-center justify-center text-gray-500">
                            <CreditCard className="h-10 w-10 mb-3 opacity-40" />
                            <p className="text-sm font-medium">No payments yet</p>
                            <p className="text-[10px] text-gray-600 mt-1">Method breakdown will appear after payments</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Monthly Detail Table */}
                  {dashboardStats?.monthlyData && dashboardStats.monthlyData.some(d => d.amount > 0) && (
                    <Card className="border border-zinc-800/50 shadow-xl bg-zinc-900/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-white flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-indigo-400" />
                          Monthly Breakdown
                        </CardTitle>
                        <CardDescription className="text-[10px] text-gray-400">Revenue collected per month</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
                          {dashboardStats.monthlyData.map((m, i) => (
                            <div
                              key={m.name}
                              className={`rounded-xl p-2.5 text-center border transition-all duration-200 hover:scale-105 ${m.amount > 0
                                ? 'bg-gradient-to-b from-purple-500/15 to-purple-500/5 border-purple-500/30 hover:border-purple-400/50'
                                : 'bg-zinc-800/30 border-zinc-700/30 opacity-60'
                                }`}
                            >
                              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">{m.name}</p>
                              <p className={`text-xs font-black ${m.amount > 0 ? 'text-purple-300' : 'text-gray-600'}`}>
                                {m.amount > 0 ? `₹${m.amount >= 1000 ? `${(m.amount / 1000).toFixed(1)}k` : m.amount}` : '—'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          )}

          {/* Payment Approval Tab */}
          <TabsContent value="approval" className="mt-0 px-0 py-4">
            <Card className="border border-zinc-800/50 shadow-xl bg-zinc-900/50 overflow-hidden p-0 max-w-[90vw] sm:max-w-full mx-auto">
              <CardHeader className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-t-2 border-t-green-500 pb-3 pt-3 m-0 rounded-t-lg">
                <CardTitle className="text-base text-gray-900 dark:text-gray-100">Pending Renewal Requests</CardTitle>
                <CardDescription className="text-xs text-gray-600 dark:text-gray-400">
                  Review and approve offline payment renewal requests
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 px-4 pb-4">
                {loadingRequests ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  </div>
                ) : renewalRequests.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-500">
                    No pending renewal requests
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-2 no-scrollbar">
                    <div className="min-w-[800px] lg:min-w-0 space-y-1.5">
                      {/* Header Row */}
                      <div className="grid grid-cols-[36px_1.4fr_1.5fr_1.5fr_0.8fr_0.5fr_85px_220px] gap-2 px-3 py-2 border-b border-gray-200/50 dark:border-gray-700/50 mb-1 items-center">
                        <div></div> {/* Avatar Space */}
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider pl-1 text-left">Student</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider pl-3 text-left">Enrollment</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider pl-3 text-left">Bus Assigned</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Session</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Shift</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Duration</div>
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right pr-4">Actions</div>
                      </div>

                      {/* Data Rows */}
                      {renewalRequests.map((request, index) => (
                        <div
                          key={request.id}
                          className="relative bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-2 hover:shadow-md hover:border-green-400 dark:hover:border-green-600 transition-all group grid grid-cols-[36px_1.4fr_1.5fr_1.5fr_0.8fr_0.5fr_85px_220px] gap-2 items-center"
                        >
                          {/* Student Number Badge */}
                          <div className="absolute -left-1.5 -top-1.5 w-5 h-5 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-[9px] shadow-lg border-2 border-white dark:border-gray-900 z-10">
                            {index + 1}
                          </div>

                          {/* Avatar Column */}
                          <div className="flex justify-center">
                            <Avatar
                              src={safeImageSrc(request.studentData?.profilePhotoUrl)}
                              name={request.studentName}
                              size="sm"
                              className="h-7 w-7 flex-shrink-0"
                            />
                          </div>

                          {/* Student Name & Email */}
                          <div className="pl-1 overflow-hidden">
                            <div className="max-w-[110px]">
                              <p className="font-semibold text-[11px] text-gray-900 dark:text-gray-100 truncate leading-tight" title={request.studentName}>
                                {request.studentName}
                              </p>
                            </div>
                            <div className="max-w-[110px]">
                              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate" title={request.studentData?.email}>
                                {request.studentData?.email || 'N/A'}
                              </p>
                            </div>
                          </div>

                          {/* Enrollment */}
                          <div className="overflow-hidden pl-2">
                            <p className="font-mono text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate" title={request.enrollmentId}>{request.enrollmentId}</p>
                          </div>

                          {/* Bus Assigned */}
                          <div className="overflow-hidden pl-2">
                            <p className="text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate" title={getBusDisplay(request.studentData?.busAssigned || request.studentData?.busId || 'N/A')}>
                              {getBusDisplay(request.studentData?.busAssigned || request.studentData?.busId || 'N/A')}
                            </p>
                          </div>

                          {/* Session */}
                          <div className="overflow-hidden">
                            <p className="text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate">
                              {request.studentData?.sessionStartYear || 'N/A'}-{request.studentData?.sessionEndYear || 'N/A'}
                            </p>
                          </div>

                          {/* Shift */}
                          <div className="overflow-hidden">
                            <p className="text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate">
                              {request.studentData?.shift || 'N/A'}
                            </p>
                          </div>

                          {/* Duration Badge */}
                          <div className="flex justify-center">
                            <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-[9px] h-5 px-2 whitespace-nowrap">
                              {request.durationYears} Year(s)
                            </Badge>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedRequest(request);
                                setShowViewDialog(true);
                              }}
                              className="h-6 w-6 p-0 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-md"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              size="sm"
                              onClick={() => handleApproveRequest()}
                              className="h-6 px-2 text-[10px] bg-green-600 hover:bg-green-700 text-white border-0"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Approve
                            </Button>

                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setSelectedRequest(request);
                                setShowRejectDialog(true);
                              }}
                              className="h-6 px-2 text-[10px] bg-red-600 hover:bg-red-700 text-white border-0"
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transaction History Tab */}
          <TabsContent value="history" className="mt-0 px-0 py-4 max-w-[90vw] sm:max-w-full mx-auto">
            <Card className="border border-zinc-200 dark:border-zinc-800 shadow-xl bg-white dark:bg-zinc-950 overflow-hidden p-0">
              <CardHeader className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/50 dark:to-pink-950/50 border-t-2 border-t-purple-500 pb-3 pt-3 m-0 rounded-t-lg px-4">
                <CardTitle className="text-base text-gray-900 dark:text-gray-100 font-bold">Transaction History</CardTitle>
                <CardDescription className="text-xs text-gray-600 dark:text-gray-400">
                  All payment transactions across the system
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 pb-6 px-6">
                {/* Filters */}
                {/* Filters */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 w-full">
                  <div>
                    <Label className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 block">Year</Label>
                    <Select value={filterYear} onValueChange={setFilterYear}>
                      <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900 text-gray-900 dark:text-gray-100 border-zinc-200 dark:border-zinc-800 h-8 text-[10px]">
                        <SelectValue placeholder="Select a year" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                        <SelectItem value="default" className="text-[10px]">Select a year</SelectItem>
                        {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i).map(year => (
                          <SelectItem key={year} value={year.toString()} className="text-[10px]">
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 block">Payment Method</Label>
                    <Select value={filterPaymentMethod} onValueChange={setFilterPaymentMethod}>
                      <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900 text-gray-900 dark:text-gray-100 border-zinc-200 dark:border-zinc-800 h-8 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                        <SelectItem value="all" className="text-[10px]">All Methods</SelectItem>
                        <SelectItem value="online" className="text-[10px]">Online (Razorpay)</SelectItem>
                        <SelectItem value="offline" className="text-[10px]">Offline (Manual)</SelectItem>
                        <SelectItem value="manual" className="text-[10px]">Manual (Admin)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 block">Student ID</Label>
                    <Input
                      placeholder="Enter enrollment ID"
                      value={filterStudentId}
                      onChange={(e) => setFilterStudentId(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-900 text-gray-900 dark:text-gray-100 border-zinc-200 dark:border-zinc-800 h-8 text-[10px] placeholder:text-gray-500"
                    />
                  </div>

                  <div>
                    <Label className="text-[10px] text-transparent mb-1 block select-none">Apply</Label>
                    <Button
                      onClick={() => {
                        setSearchTrigger(prev => prev + 1);
                        setCurrentPage(1);
                      }}
                      className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 h-8 text-[10px] text-white rounded-md"
                    >
                      <Filter className="mr-1.5 h-3 w-3" />
                      Apply Filters
                    </Button>
                  </div>
                </div>

                {loadingTransactions ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                  </div>
                ) : enrichedTransactions.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-gray-300 dark:border-zinc-800 mx-4">
                    <Receipt className="h-10 w-10 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm">No transactions found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-6 -mx-2 no-scrollbar">
                    <div className="w-full space-y-3 px-2 min-w-[800px]">
                      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-2 items-center w-full px-4 py-3 bg-gradient-to-r from-purple-50/50 via-pink-50/50 to-purple-50/50 dark:from-purple-950/20 dark:via-pink-950/20 dark:to-purple-950/20 border border-purple-200/50 dark:border-purple-800/30 rounded-xl mb-3 pl-5 shadow-sm">
                        <div className="col-span-5">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider pl-5">Student Information</p>
                        </div>
                        <div className="col-span-2 text-center">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider mr-3">Mode</p>
                        </div>
                        <div className="col-span-4">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider ml-6">Reference ID</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider ml-2">Date/Time</p>
                        </div>
                        <div className="col-span-3">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider ml-8">Amount</p>
                        </div>
                        <div className="col-span-4 text-left pl-2">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider whitespace-nowrap ml-2">Approved By</p>
                        </div>
                        <div className="col-span-4 text-right pr-2">
                          <p className="text-[9px] font-extrabold text-purple-700 dark:text-purple-300 uppercase tracking-wider mr-14">Actions</p>
                        </div>
                      </div>

                      {enrichedTransactions.map((transaction, index) => (
                        <div
                          key={index}
                          className="relative bg-gradient-to-br from-white via-purple-50/20 to-white dark:from-gray-800 dark:via-purple-950/10 dark:to-gray-800 border border-purple-200 dark:border-purple-800/50 rounded-lg shadow-sm hover:shadow-lg hover:border-purple-400 dark:hover:border-purple-500 transition-all duration-300 overflow-hidden"
                        >
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-500 via-pink-500 to-purple-500"></div>

                          <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-gradient-to-br from-purple-600 via-pink-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-[12px] shadow-xl border-4 border-white dark:border-gray-900 z-10 scale-110">
                            #{index + 1}
                          </div>

                          <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-2 items-center w-full px-5 py-4 pl-8">
                            {/* Student Details */}
                            <div className="col-span-5 flex items-center gap-2">
                              <div className="relative">
                                <Avatar
                                  name={transaction.studentName}
                                  size="sm"
                                  className="ring-1 ring-purple-100 dark:ring-purple-900/50 h-8 w-8"
                                />
                                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-white dark:border-gray-800"></div>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100 truncate">{transaction.studentName}</p>
                                <p className="text-[9px] font-mono font-medium text-purple-600 dark:text-purple-400 break-all leading-tight mt-0.5">{transaction.studentId}</p>
                              </div>
                            </div>

                            {/* Payment Method */}
                            <div className="col-span-2 text-center">
                              <Badge className={`${transaction.paymentMethod === 'online'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                                } text-[9px] font-black px-1.5 py-0 rounded-full capitalize mr-20`}>
                                {transaction.paymentMethod === 'online' ? 'Online' : 'Offline'}
                              </Badge>
                            </div>

                            {/* Payment ID */}
                            <div className="col-span-4">
                              <div className="group/id flex items-center gap-1.5 bg-gray-50 dark:bg-zinc-900/50 rounded-lg px-2 py-0.5 border border-zinc-200 dark:border-zinc-800 hover:border-purple-400 dark:hover:border-purple-500/50 transition-colors h-7 w-fit max-w-[130px]">
                                <p className="text-[8px] font-mono text-gray-500 dark:text-gray-400 truncate flex-1">{transaction.paymentId}</p>
                                <Copy className="h-2.5 w-2.5 text-gray-400 group-hover/id:text-purple-500 cursor-pointer flex-shrink-0" onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(transaction.paymentId);
                                  toast.success('Payment ID copied!');
                                }} />
                              </div>
                            </div>

                            {/* Date & Time */}
                            <div className="col-span-2">
                              <p className="text-[10px] font-bold text-gray-900 dark:text-gray-100">
                                {new Date(transaction.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </p>
                              <p className="text-[9px] text-gray-500 dark:text-gray-400 font-medium">{new Date(transaction.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>

                            {/* Amount */}
                            <div className="col-span-3">
                              <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-md px-1.5 py-0.5 border border-emerald-100 dark:border-emerald-900/50 shadow-sm inline-block ml-5">
                                <p className="text-[16px] font-black text-emerald-700 dark:text-emerald-400 leading-tight">₹{transaction.amount}</p>
                                <p className="text-[8px] text-orange-600 dark:text-orange-500 font-bold whitespace-nowrap ml-2">{transaction.durationYears} Yr Plan</p>
                              </div>
                            </div>

                            {/* Approved By */}
                            <div className="col-span-4 text-left pl-2 ml-1">
                              <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 truncate" title={transaction.approvedBy}>
                                {transaction.paymentMethod === 'online' ? 'AdtU ITMS System' : (transaction.approvedBy || '-')}
                              </p>
                            </div>

                            {/* Actions Buttons */}
                            <div className="col-span-4 flex flex-col items-end gap-1 pr-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadReceipt(transaction.paymentId)}
                                disabled={downloadingReceiptId === transaction.paymentId}
                                className="h-7 gap-1.5 text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 w-full shadow-sm px-2"
                              >
                                {downloadingReceiptId === transaction.paymentId ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Processing
                                  </>
                                ) : (
                                  <>
                                    <Download className="h-2.5 w-2.5" />
                                    DOWNLOAD
                                  </>
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (transaction.userId) {
                                    const baseRoute = userData?.role === 'moderator' ? '/moderator' : '/admin';
                                    router.push(`${baseRoute}/students/view/${transaction.userId}`);
                                  }
                                }}
                                className="h-5 text-[9px] font-bold w-full text-zinc-500 dark:text-zinc-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                              >
                                VIEW PROFILE
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-7 text-[10px]"
                    >
                      Previous
                    </Button>
                    <span className="text-[10px] font-medium text-gray-500">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="h-7 text-[10px]"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="w-[90%] sm:w-full max-w-3xl max-h-[90vh] overflow-y-auto border-zinc-800 bg-zinc-950/95 p-0 top-[8%] translate-y-0 shadow-2xl shadow-black/50 rounded-2xl gap-0 z-[150] mt-2">
            <DialogTitle className="sr-only">Renewal Request Details</DialogTitle>
            <DialogDescription className="sr-only">Review details for this renewal request.</DialogDescription>

            {/* Modal Header with Gradient */}
            <div className="relative bg-gradient-to-r from-slate-950 via-indigo-950/50 to-slate-950 border-b border-white/10 p-6">


              <div className="flex items-center gap-5">
                <div className="relative">
                  <div className="absolute -inset-1 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full opacity-70 blur-md"></div>
                  <Avatar
                    src={safeImageSrc(selectedRequest?.studentData?.profilePhotoUrl)}
                    name={selectedRequest?.studentName || 'Student'}
                    size="xl"
                    className="relative h-16 w-16 sm:h-20 sm:w-20 ring-4 ring-black/50 shadow-xl"
                  />
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                    <Badge className="bg-amber-500/90 hover:bg-amber-600 text-white border-0 shadow-lg px-2 py-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                      Pending
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{selectedRequest?.studentName}</h2>
                  <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3 text-xs sm:text-sm">
                    <span className="font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                      {selectedRequest?.enrollmentId}
                    </span>
                    <span className="text-zinc-400 flex items-center gap-1 hidden sm:flex">
                      <Clock className="h-3.5 w-3.5" />
                      {selectedRequest?.createdAt?.toDate ? new Date(selectedRequest.createdAt.toDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Just now'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Main Info Grid */}
              <div className="grid grid-cols-1 gap-4">
                {/* Personal Info */}
                <div className="space-y-4">
                  <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-widest pl-1">Personal Details</h3>
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-3 hover:bg-white/[0.07] transition-colors">
                    <div className="grid grid-cols-[24px_1fr] gap-3 items-start">
                      <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-400">
                        <User className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-xs text-zinc-500">Full Contact</p>
                        <p className="text-xs sm:text-sm font-medium text-zinc-200 truncate">{selectedRequest?.studentEmail || selectedRequest?.studentData?.email || 'No email'}</p>
                        <p className="text-[10px] sm:text-sm text-zinc-400 mt-0.5">{selectedRequest?.studentData?.phoneNumber || 'No phone'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-[24px_1fr] gap-3 items-start">
                      <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-400">
                        <FileText className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-xs text-zinc-500">Academic Info</p>
                        <p className="text-xs sm:text-sm font-medium text-zinc-200 line-clamp-1">{selectedRequest?.studentData?.faculty || 'N/A'}</p>
                        <p className="text-[10px] sm:text-sm text-zinc-400 mt-0.5">Session: {selectedRequest?.studentData?.sessionStartYear}-{selectedRequest?.studentData?.sessionEndYear}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Transport Info */}
                <div className="space-y-4">
                  <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-widest pl-1">Transport Allocation</h3>
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-3 hover:bg-white/[0.07] transition-colors h-fit">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-800 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[10px] sm:text-xs text-zinc-500">Assigned Bus</p>
                          <p className="text-xs sm:text-sm font-bold text-white">{getBusDisplay(selectedRequest?.studentData?.busAssigned || selectedRequest?.studentData?.busId || 'N/A')}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-zinc-800 border-zinc-700 text-zinc-300 text-[10px] sm:text-xs">
                        {selectedRequest?.studentData?.shift || 'Morning'} Shift
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Details Ticket */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800">
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 -mt-8 -mr-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -mb-8 -ml-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>

                <div className="relative p-5">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <IndianRupee className="h-4 w-4 text-emerald-500" />
                      Payment Summary
                    </h3>
                    {selectedRequest?.receiptImageUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(selectedRequest?.receiptImageUrl, '_blank')}
                        className="h-7 text-[10px] border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        <Eye className="h-3 w-3 mr-1.5" />
                        View Receipt
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-y-5 gap-x-4 border-t border-dashed border-zinc-800 pt-5">
                    {/* Duration */}
                    <div>
                      <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Duration</p>
                      <p className="text-lg sm:text-xl font-bold text-white">{selectedRequest?.durationYears} Year<span className="text-zinc-600 text-sm font-normal">(s)</span></p>
                    </div>

                    {/* Amount */}
                    <div className="text-right">
                      <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Amount Paid</p>
                      <p className="text-lg sm:text-xl font-bold text-emerald-400">₹{selectedRequest?.totalFee?.toLocaleString('en-IN')}</p>
                    </div>

                    {/* Date */}
                    <div>
                      <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Date</p>
                      <p className="text-xs sm:text-sm font-mono text-zinc-300">
                        {selectedRequest?.createdAt?.toDate ? new Date(selectedRequest.createdAt.toDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                      </p>
                    </div>

                    {/* Payment Mode */}
                    <div className="text-right">
                      <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Payment Mode</p>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-0 capitalize text-[10px] sm:text-xs">
                        {selectedRequest?.paymentMode || 'Offline'}
                      </Badge>
                    </div>

                    {/* Transaction Ref */}
                    <div className={selectedRequest?.paidAt ? "col-span-1 pt-2" : "col-span-2 pt-2"}>
                      <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Transaction Reference</p>
                      <p className="text-[10px] sm:text-sm font-mono text-zinc-400 break-all bg-zinc-900/50 p-2 rounded border border-zinc-800/50">
                        {selectedRequest?.transactionId || 'N/A'}
                      </p>
                    </div>

                    {/* Paid At (Offline only) */}
                    {selectedRequest?.paidAt && (
                      <div className="col-span-1 pt-2 text-right">
                        <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-600 mb-1">Payment Date/Time</p>
                        <p className="text-[10px] sm:text-sm font-mono text-amber-400 break-all bg-zinc-900/50 p-2 rounded border border-zinc-800/50">
                          {(() => {
                            try {
                              return new Date(selectedRequest.paidAt).toLocaleString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              });
                            } catch (e) {
                              return selectedRequest.paidAt;
                            }
                          })()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Footer */}
            <div className="p-4 bg-zinc-950/80 border-t border-white/5 flex gap-3 justify-end sticky bottom-0 z-10">
              <Button
                variant="outline"
                onClick={() => {
                  setShowViewDialog(false);
                  setShowRejectDialog(true);
                }}
                className="bg-red-700 text-white hover:bg-red-800 text-xs sm:text-sm"
              >
                Reject Request
              </Button>
              <Button
                onClick={() => handleApproveRequest()}
                disabled={processing}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/20 px-6 font-semibold text-xs sm:text-sm"
              >
                {processing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve Renewal
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
          <DialogContent className="w-[90%] sm:w-full max-w-md bg-zinc-950/95 border-zinc-800 shadow-2xl p-0 gap-0 rounded-2xl overflow-hidden">
            <DialogTitle className="sr-only">Reject Renewal Request</DialogTitle>
            <DialogDescription className="sr-only">Provide a reason for rejecting this renewal request.</DialogDescription>

            <div className="bg-gradient-to-r from-red-950/40 via-red-900/20 to-red-950/40 border-b border-red-500/20 p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">Reject Request</h3>
                  <p className="text-zinc-400 text-xs sm:text-sm leading-tight">
                    This action cannot be undone. Please provide a valid reason.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <Label className="text-zinc-300 text-xs sm:text-sm font-medium mb-2 block">Rejection Reason</Label>
                <Textarea
                  placeholder="e.g. Invalid payment receipt, Incorrect amount paid..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="bg-zinc-900/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-red-500/50 focus:ring-red-500/20 min-h-[120px] resize-none rounded-xl p-3 text-sm focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            <div className="p-4 bg-zinc-900/50 border-t border-white/5 flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectionReason('');
                }}
                className="bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-600 text-xs sm:text-sm h-9"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectRequest}
                disabled={processing || !rejectionReason.trim()}
                className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white shadow-lg shadow-red-900/20 text-xs sm:text-sm h-9 border-0"
              >
                {processing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Confirm Rejection
              </Button>
            </div>
          </DialogContent>
        </Dialog >

        {/* Payment Detail Modal for Manual Payments */}
        <PaymentDetailModal
          isOpen={showPaymentDetailModal}
          onClose={() => {
            setShowPaymentDetailModal(false);
            setSelectedPaymentId(null);
          }
          }
          paymentId={selectedPaymentId}
        />

        {/* Export Payments Dialog */}
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
          <DialogContent className="w-[90%] sm:w-full max-w-md bg-zinc-950/95 border-zinc-800 shadow-2xl p-6 rounded-2xl overflow-hidden">
            <DialogHeader>
              <DialogTitle className="text-white text-lg font-bold">Export Payment Data</DialogTitle>
              <DialogDescription className="text-zinc-400 text-xs sm:text-sm">
                Select the academic session you want to export. The export covers payments made from July (start year) to June (end year).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div>
                <Label className="text-zinc-300 text-xs sm:text-sm font-medium mb-2 block">Academic Session</Label>
                <Select value={exportSession} onValueChange={setExportSession}>
                  <SelectTrigger className="w-full bg-zinc-900 border-zinc-700 text-zinc-100 h-10 text-sm">
                    <SelectValue placeholder="Select a session" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
                    {exportSessionOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-sm">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowExportDialog(false)}
                className="bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-600 text-xs sm:text-sm h-9"
              >
                Cancel
              </Button>
              <Button
                onClick={handleExportPayments}
                disabled={exporting}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg text-xs sm:text-sm h-9 border-0"
              >
                {exporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Export to Excel
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}


