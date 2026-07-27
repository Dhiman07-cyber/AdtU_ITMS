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
import { PaymentDetailModalData,getMethodBadgeClass,getStatusBadgeClass } from '@/lib/types/payment';
import { Calendar,Check,CheckCircle,Clock,Copy,CreditCard,FileText,IndianRupee,Loader2,Receipt,Shield,User,X } from 'lucide-react';
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
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<PaymentDetailModalData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch payment details when modal opens
    useEffect(() => {
        const fetchDetails = async () => {
            if (!paymentId || !isOpen) return;

            setLoading(true);
            setError(null);

            try {
                const response = await fetch(`/api/payments/${paymentId}`);

                if (!response.ok) {
                    throw new Error('Failed to fetch payment details');
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
    }, [paymentId, isOpen]);

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
                                    {data.status}
                                </Badge>
                                <Badge className={`${getMethodBadgeClass(data.method)} text-xs px-2.5 py-1 border-0`}>
                                    {data.method}
                                </Badge>
                            </div>

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
