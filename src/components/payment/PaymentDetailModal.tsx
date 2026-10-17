'use client';

/**
 * PaymentDetailModal Component
 * 
 * Premium modal for displaying detailed payment information including:
 * - Student details
 * - Payment information
 * - Approval/Rejection details with full audit trail
 * 
 * Triggered when clicking "Manual" badge in admin transaction history.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import { PaymentDetailModalData,formatPaymentStatusDisplay,getMethodBadgeClass,getStatusBadgeClass } from '@/lib/types/payment';
import { AlertCircle,AlertTriangle,Calendar,Check,CheckCircle,Clock,Copy,CreditCard,FileText,IndianRupee,Loader2,Receipt,Shield,User,X,XCircle } from 'lucide-react';
import React,{ useEffect,useState } from 'react';
import { toast } from 'sonner';

// ============================================================================
// TYPES
// ============================================================================

export interface PaymentDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    paymentId: string | null;
}

// ============================================================================
// INFO ROW COMPONENT
// ============================================================================

interface InfoRowProps {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    copyable?: boolean;
    className?: string;
}

const InfoRow: React.FC<InfoRowProps> = ({ icon, label, value, copyable = false, className = '' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (typeof value === 'string') {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success('Copied to clipboard');
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className={`flex items-start gap-3 ${className}`}>
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg flex-shrink-0">
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                    {label}
                </p>
                <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 break-all">
                        {value}
                    </p>
                    {copyable && typeof value === 'string' && (
                        <button
                            onClick={handleCopy}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                            title="Copy to clipboard"
                        >
                            {copied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <Copy className="h-3.5 w-3.5 text-gray-400" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// SECTION HEADER COMPONENT
// ============================================================================

interface SectionHeaderProps {
    title: string;
    icon: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, icon }) => (
    <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg shadow-sm">
            {icon}
        </div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
    </div>
);

// ============================================================================
// PAYMENT DETAIL MODAL
// ============================================================================

export const PaymentDetailModal: React.FC<PaymentDetailModalProps> = ({
    isOpen,
    onClose,
    paymentId,
}) => {
    const { currentUser, userData } = useAuth();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<PaymentDetailModalData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Administrative action state
    const [actionType, setActionType] = useState<'none' | 'reconcile' | 'confirm_refund' | 'deny_refund'>('none');
    const [actionLoading, setActionLoading] = useState(false);
    const [reconcileStartYear, setReconcileStartYear] = useState<number>(new Date().getFullYear());
    const [reconcileEndYear, setReconcileEndYear] = useState<number>(new Date().getFullYear() + 1);
    const [reconcileEvidence, setReconcileEvidence] = useState('');
    const [refundRef, setRefundRef] = useState('');
    const [refundAmount, setRefundAmount] = useState<number>(0);
    const [refundReason, setRefundReason] = useState('');
    const [denyReason, setDenyReason] = useState('');

    useEffect(() => {
        if (data) {
            setRefundAmount(data.amount || 0);
            if (data.sessionStartYear) setReconcileStartYear(data.sessionStartYear);
            if (data.sessionEndYear) setReconcileEndYear(data.sessionEndYear);
        }
    }, [data]);

    const handleExecuteAdminAction = async () => {
        if (!data || !currentUser) return;
        setActionLoading(true);
        try {
            const token = await currentUser.getIdToken();
            const body: any = { paymentId: data.paymentId, action: actionType };
            if (actionType === 'reconcile') {
                if (Number(reconcileStartYear) >= Number(reconcileEndYear)) {
                    throw new Error('Start year must be strictly less than end year.');
                }
                if (!reconcileEvidence.trim()) {
                    throw new Error('Evidence is required for reconciliation.');
                }
                body.sessionStartYear = Number(reconcileStartYear);
                body.sessionEndYear = Number(reconcileEndYear);
                body.evidence = reconcileEvidence.trim();
            } else if (actionType === 'confirm_refund') {
                if (!refundRef.trim()) {
                    throw new Error('External refund reference is required.');
                }
                if (Number(refundAmount) <= 0) {
                    throw new Error('Refund amount must be positive.');
                }
                body.refundReference = refundRef.trim();
                body.refundedAmount = Number(refundAmount);
                body.reason = refundReason.trim() || 'Manual refund confirmed by university finance';
            } else if (actionType === 'deny_refund') {
                if (!denyReason.trim()) {
                    throw new Error('Denial reason is required.');
                }
                body.reason = denyReason.trim();
            }

            const res = await fetch('/api/admin/payments/reconcile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body),
            });

            const resJson = await res.json();
            if (!res.ok || !resJson.success) {
                throw new Error(resJson.error || 'Action failed');
            }

            toast.success(resJson.message || 'Action executed successfully');
            setActionType('none');
            // Re-fetch details
            const refreshRes = await fetch(`/api/payments/${data.paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const refreshJson = await refreshRes.json();
            if (refreshJson.success && refreshJson.data) {
                setData({
                    ...refreshJson.data,
                    validUntil: new Date(refreshJson.data.validUntil),
                    createdAt: new Date(refreshJson.data.createdAt),
                    updatedAt: new Date(refreshJson.data.updatedAt),
                    approver: refreshJson.data.approver ? {
                        ...refreshJson.data.approver,
                        approvedAt: new Date(refreshJson.data.approver.approvedAt)
                    } : undefined
                });
            }
        } catch (err: any) {
            toast.error(err?.message || 'Failed to execute action');
        } finally {
            setActionLoading(false);
        }
    };

    // Fetch payment details when modal opens
    useEffect(() => {
        const fetchDetails = async () => {
            if (!paymentId || !isOpen) return;

            setLoading(true);
            setError(null);

            try {
                const token = currentUser ? await currentUser.getIdToken() : null;
                const response = await fetch(`/api/payments/${paymentId}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error('Authentication required: Please sign in to view payment details');
                    }
                    if (response.status === 403) {
                        throw new Error('Access denied: You do not have permission to view this payment record');
                    }
                    if (response.status === 404) {
                        throw new Error('Payment record not found');
                    }
                    const errJson = await response.json().catch(() => null);
                    throw new Error(errJson?.error || 'Failed to fetch payment details');
                }

                const result = await response.json();

                if (result.success && result.data) {
                    // Convert date strings back to Date objects
                    setData({
                        ...result.data,
                        validUntil: new Date(result.data.validUntil),
                        createdAt: new Date(result.data.createdAt),
                        updatedAt: new Date(result.data.updatedAt),
                        approver: result.data.approver ? {
                            ...result.data.approver,
                            approvedAt: new Date(result.data.approver.approvedAt)
                        } : undefined
                    });
                } else {
                    throw new Error(result.error || 'Payment not found');
                }
            } catch (err) {
                console.error('Error fetching payment details:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [paymentId, isOpen, currentUser]);

    // Format helpers
    const formatDateTime = (date: Date) => {
        return date.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <div className="p-1.5 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg shadow-md">
                            <Receipt className="h-4 w-4 text-white" />
                        </div>
                        Payment Details
                    </DialogTitle>
                    <DialogDescription className="text-gray-500 dark:text-gray-400">
                        Complete audit trail for this payment
                    </DialogDescription>
                </DialogHeader>

                {/* Body */}
                <div className="mt-4 space-y-5">

                    {/* Loading State */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-600 mb-3" />
                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading payment details...</p>
                        </div>
                    )}

                    {/* Error State */}
                    {error && !loading && (
                        <div className="text-center py-8">
                            <div className="inline-flex items-center justify-center w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full mb-3">
                                <X className="h-6 w-6 text-red-600 dark:text-red-400" />
                            </div>
                            <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                                className="mt-4"
                            >
                                Close
                            </Button>
                        </div>
                    )}

                    {/* Data Display */}
                    {data && !loading && (
                        <>
                            {/* Status & Method Badges */}
                            <div className="flex items-center gap-2">
                                <Badge className={`${getStatusBadgeClass(data.status)} text-xs px-2.5 py-1 border-0`}>
                                    {data.status === 'Completed' && <CheckCircle className="h-3.5 w-3.5 mr-1" />}
                                    {data.status === 'Duplicate_Pending_Refund' && <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
                                    {data.status === 'Captured_Pending_Review' && <AlertCircle className="h-3.5 w-3.5 mr-1" />}
                                    {data.status === 'Refunded' && <CheckCircle className="h-3.5 w-3.5 mr-1" />}
                                    {data.status === 'Refund_Denied' && <XCircle className="h-3.5 w-3.5 mr-1" />}
                                    {formatPaymentStatusDisplay(data.status)}
                                </Badge>
                                <Badge className={`${getMethodBadgeClass(data.method)} text-xs px-2.5 py-1 border-0`}>
                                    {data.method}
                                </Badge>
                            </div>

                            {/* Duplicate Payment Notice for Staff */}
                            {data.status === 'Duplicate_Pending_Refund' && (
                                <div className="p-4 bg-amber-500/10 dark:bg-amber-950/30 rounded-xl border border-amber-500/30">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-amber-500/20 text-amber-500 dark:text-amber-400 rounded-lg shrink-0 mt-0.5">
                                            <AlertTriangle className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                                                Duplicate Session Capture — Manual Review Required
                                            </p>
                                            <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80 mt-1 leading-relaxed">
                                                A valid transport fee had already been captured for this student for academic session {data.sessionStartYear}–{data.sessionEndYear}. This transaction was durably preserved in the ledger as <code className="bg-amber-500/20 px-1 py-0.5 rounded text-[10px]">Duplicate_Pending_Refund</code> to prevent duplicate seat allocation. This record is flagged for manual administrative review. No automated refund has been issued.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Unresolved Session Notice for Staff */}
                            {data.status === 'Captured_Pending_Review' && (
                                <div className="p-4 bg-indigo-500/10 dark:bg-indigo-950/30 rounded-xl border border-indigo-500/30">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 rounded-lg shrink-0 mt-0.5">
                                            <AlertCircle className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                                                Unresolved Academic Session — Staff Review Required
                                            </p>
                                            <p className="text-[11px] text-indigo-800/90 dark:text-indigo-300/80 mt-1 leading-relaxed">
                                                This transaction was successfully captured by Razorpay, but its academic session association could not be automatically established. It is durably recorded in the ledger without granting transport entitlements. An administrator must verify student identity and assign the valid academic session or route to finance.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Refunded Notice for Staff */}
                            {data.status === 'Refunded' && (
                                <div className="p-4 bg-slate-500/10 dark:bg-slate-950/30 rounded-xl border border-slate-500/30">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-slate-500/20 text-slate-500 dark:text-slate-400 rounded-lg shrink-0 mt-0.5">
                                            <CheckCircle className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-slate-900 dark:text-slate-200">
                                                Refund Completed Externally
                                            </p>
                                            <p className="text-[11px] text-slate-800/90 dark:text-slate-300/80 mt-1 leading-relaxed">
                                                This payment was formally refunded to the payer. The external refund reference and finance approval audit trail are permanently recorded in the ledger.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Refund Denied Notice for Staff */}
                            {data.status === 'Refund_Denied' && (
                                <div className="p-4 bg-rose-500/10 dark:bg-rose-950/30 rounded-xl border border-rose-500/30">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-rose-500/20 text-rose-500 dark:text-rose-400 rounded-lg shrink-0 mt-0.5">
                                            <XCircle className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-rose-900 dark:text-rose-200">
                                                Refund Request Denied — Financial Retention
                                            </p>
                                            <p className="text-[11px] text-rose-800/90 dark:text-rose-300/80 mt-1 leading-relaxed">
                                                The refund request for this captured transaction was formally reviewed by university finance and denied per institution policy. The captured funds remain in the university financial ledger. No transport entitlement is active for this record.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Administrative Action Panel for Admin role */}
                            {userData?.role === 'admin' && (data.status === 'Duplicate_Pending_Refund' || data.status === 'Captured_Pending_Review') && (
                                <div className="p-4 bg-purple-500/10 dark:bg-purple-950/30 rounded-xl border border-purple-500/30 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Shield className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                            <p className="text-xs font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider">
                                                Administrative Ledger Actions
                                            </p>
                                        </div>
                                        {actionType !== 'none' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setActionType('none')}
                                                className="h-7 text-xs text-gray-500"
                                            >
                                                Cancel
                                            </Button>
                                        )}
                                    </div>

                                    {actionType === 'none' ? (
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            {data.status === 'Captured_Pending_Review' && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => setActionType('reconcile')}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                                                >
                                                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                                    Reconcile to Completed
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                onClick={() => setActionType('confirm_refund')}
                                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
                                            >
                                                <IndianRupee className="h-3.5 w-3.5 mr-1" />
                                                Confirm External Refund
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => setActionType('deny_refund')}
                                                variant="destructive"
                                                className="text-xs h-8"
                                            >
                                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                                Deny Refund Request
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3 pt-2">
                                            {actionType === 'reconcile' && (
                                                <>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Start Year</label>
                                                            <Input
                                                                type="number"
                                                                value={reconcileStartYear}
                                                                onChange={(e) => setReconcileStartYear(parseInt(e.target.value) || 2026)}
                                                                className="h-8 text-xs"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">End Year</label>
                                                            <Input
                                                                type="number"
                                                                value={reconcileEndYear}
                                                                onChange={(e) => setReconcileEndYear(parseInt(e.target.value) || 2027)}
                                                                className="h-8 text-xs"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Audit Evidence</label>
                                                        <Input
                                                            type="text"
                                                            placeholder="e.g. Verified admission record & assigned route"
                                                            value={reconcileEvidence}
                                                            onChange={(e) => setReconcileEvidence(e.target.value)}
                                                            className="h-8 text-xs"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {actionType === 'confirm_refund' && (
                                                <>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Refund Ref (Razorpay/UTR)</label>
                                                            <Input
                                                                type="text"
                                                                placeholder="e.g. rfnd_xxx or UTR12345"
                                                                value={refundRef}
                                                                onChange={(e) => setRefundRef(e.target.value)}
                                                                className="h-8 text-xs"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Amount (₹)</label>
                                                            <Input
                                                                type="number"
                                                                value={refundAmount}
                                                                onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
                                                                className="h-8 text-xs"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Reason / Notes</label>
                                                        <Input
                                                            type="text"
                                                            placeholder="Reason for manual refund approval"
                                                            value={refundReason}
                                                            onChange={(e) => setRefundReason(e.target.value)}
                                                            className="h-8 text-xs"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {actionType === 'deny_refund' && (
                                                <div>
                                                    <label className="text-[10px] font-semibold uppercase text-gray-600 dark:text-gray-300">Denial Reason</label>
                                                    <Input
                                                        type="text"
                                                        placeholder="e.g. Non-refundable bus fee per university policy"
                                                        value={denyReason}
                                                        onChange={(e) => setDenyReason(e.target.value)}
                                                        className="h-8 text-xs"
                                                    />
                                                </div>
                                            )}

                                            <div className="flex justify-end gap-2 pt-1">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setActionType('none')}
                                                    disabled={actionLoading}
                                                    className="h-8 text-xs"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    onClick={handleExecuteAdminAction}
                                                    disabled={actionLoading}
                                                    className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                                                >
                                                    {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                                                    Confirm Action
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Student Information */}
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                                <SectionHeader title="Student Information" icon={<User className="h-3.5 w-3.5 text-white" />} />
                                <div className="space-y-3">
                                    <InfoRow
                                        icon={<User className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                                        label="Name"
                                        value={data.studentName}
                                    />
                                    <InfoRow
                                        icon={<FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
                                        label="Enrollment ID"
                                        value={data.studentId}
                                        copyable
                                    />
                                </div>
                            </div>

                            {/* Payment Information */}
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                                <SectionHeader title="Payment Information" icon={<CreditCard className="h-3.5 w-3.5 text-white" />} />
                                <div className="space-y-3">
                                    <InfoRow
                                        icon={<Receipt className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
                                        label="Payment ID"
                                        value={data.paymentId}
                                        copyable
                                    />
                                    {data.offlineTransactionId && (
                                        <InfoRow
                                            icon={<FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
                                            label="Transaction ID (UPI/Bank)"
                                            value={data.offlineTransactionId}
                                            copyable
                                        />
                                    )}
                                    <InfoRow
                                        icon={<IndianRupee className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                        label="Amount"
                                        value={`₹${data.amount.toLocaleString()}`}
                                    />
                                    <InfoRow
                                        icon={<Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
                                        label="Duration"
                                        value={`${data.durationYears} Year${data.durationYears > 1 ? 's' : ''}`}
                                    />
                                    <InfoRow
                                        icon={<Calendar className="h-4 w-4 text-pink-600 dark:text-pink-400" />}
                                        label="Session"
                                        value={`${data.sessionStartYear} - ${data.sessionEndYear}`}
                                    />
                                    <InfoRow
                                        icon={<Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                                        label="Valid Until"
                                        value={formatDate(data.validUntil)}
                                    />
                                    <InfoRow
                                        icon={<Clock className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
                                        label="Created At"
                                        value={formatDateTime(data.createdAt)}
                                    />
                                </div>
                            </div>

                            {/* Approval Information (for completed offline payments) */}
                            {data.approver && (
                                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200/50 dark:border-green-700/50">
                                    <SectionHeader title="Approval Details" icon={<Shield className="h-3.5 w-3.5 text-white" />} />
                                    <div className="space-y-3">
                                        <InfoRow
                                            icon={<User className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                            label="Approved By"
                                            value={data.approver.name}
                                        />
                                        <InfoRow
                                            icon={<FileText className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                            label="Employee ID"
                                            value={data.approver.empId}
                                        />
                                        <InfoRow
                                            icon={<Shield className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                            label="Role"
                                            value={data.approver.role}
                                        />
                                        <InfoRow
                                            icon={<Clock className="h-4 w-4 text-green-600 dark:text-green-400" />}
                                            label="Approved At"
                                            value={formatDateTime(data.approver.approvedAt)}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* System Approval (for online payments) */}
                            {data.method === 'Online' && data.status === 'Completed' && (
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200/50 dark:border-blue-700/50">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                                            <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">System Verified</p>
                                            <p className="text-xs text-blue-700 dark:text-blue-300">Payment verified via secure webhook</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {data && !loading && (
                    <div className="mt-6 flex justify-end">
                        <Button
                            onClick={onClose}
                            variant="outline"
                            className="px-6"
                        >
                            Close
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default PaymentDetailModal;
