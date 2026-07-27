'use client';

/**
 * TransactionCard Component
 * 
 * Premium transaction card for displaying payment records in transaction history.
 * Used in both Student and Admin views with appropriate variants.
 * 
 * Features:
 * - Premium glassmorphism design
 * - Status badges with gradient colors
 * - Clickable Manual badge for approver details (admin view)
 * - Responsive design for mobile and desktop
 * - Micro-animations for enhanced UX
 */

import { Badge } from '@/components/ui/badge';
import {
	PaymentMethod,
	PaymentStatus,
	getMethodBadgeClass,
	getStatusBadgeClass
} from '@/lib/types/payment';
import {
	Calendar,
	CheckCircle,
	Clock,
	CreditCard,
	ExternalLink,
	IndianRupee,
	Loader2,
	Receipt,
	User
} from 'lucide-react';
import React from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface TransactionCardData {
    paymentId: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    durationYears: number;
    validUntil: Date;
    createdAt: Date;

    // Optional: For admin view
    studentName?: string;
    studentId?: string;
    approverName?: string;
    approverEmpId?: string;
    offlineTransactionId?: string;
}

export interface TransactionCardProps {
    data: TransactionCardData;
    variant?: 'student' | 'admin';
    onManualBadgeClick?: (paymentId: string) => void;
    className?: string;
}

// ============================================================================
// STATUS ICON COMPONENT
// ============================================================================

const StatusIcon: React.FC<{ status: PaymentStatus }> = ({ status }) => {
    switch (status) {
        case 'Completed':
            return <CheckCircle className="h-4 w-4" />;
        case 'Pending':
            return <Loader2 className="h-4 w-4 animate-spin" />;
        default:
            return <Receipt className="h-4 w-4" />;
    }
};

// ============================================================================
// TRANSACTION CARD COMPONENT
// ============================================================================

export const TransactionCard: React.FC<TransactionCardProps> = ({
    data,
    variant = 'student',
    onManualBadgeClick,
    className = ''
}) => {
    const {
        paymentId,
        amount,
        method,
        status,
        durationYears,
        validUntil,
        createdAt,
        studentName,
        studentId,
        approverName,
        approverEmpId,
        offlineTransactionId
    } = data;

    const handleManualClick = () => {
        if (method === 'Offline' && onManualBadgeClick) {
            onManualBadgeClick(paymentId);
        }
    };

    // Format date helper
    const formatDateTime = (date: Date) => {
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <div
            className={`
        group relative overflow-hidden rounded-2xl
        bg-gradient-to-br from-slate-50/80 via-white/90 to-slate-50/80
        dark:from-gray-900/90 dark:via-gray-800/95 dark:to-gray-900/90
        border border-gray-200/60 dark:border-gray-700/60
        shadow-lg hover:shadow-xl
        backdrop-blur-md
        transition-all duration-300 ease-out
        hover:scale-[1.01] hover:border-purple-300 dark:hover:border-purple-600
        ${className}
      `}
        >
            {/* Decorative gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/3 via-transparent to-blue-500/3 dark:from-purple-500/5 dark:to-blue-500/5 pointer-events-none" />

            {/* Top accent line */}
            <div className={`
        absolute top-0 left-0 right-0 h-1
        ${status === 'Completed'
                    ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500'
                    : 'bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500'
                }
      `} />

            {/* Card Content */}
            <div className="relative p-4 sm:p-5">

                {/* Header Row: Payment ID + Status */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                        {/* Payment ID with Icon */}
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className={`
                p-1.5 rounded-lg shadow-sm
                ${status === 'Completed'
                                    ? 'bg-green-100 dark:bg-green-900/40'
                                    : 'bg-yellow-100 dark:bg-yellow-900/40'
                                }
              `}>
                                <Receipt className={`
                  h-4 w-4
                  ${status === 'Completed'
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-yellow-600 dark:text-yellow-400'
                                    }
                `} />
                            </div>
                            <span className="font-bold text-sm sm:text-base text-gray-900 dark:text-gray-100 truncate font-mono">
                                {paymentId}
                            </span>
                        </div>

                        {/* Date & Time */}
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 pl-9">
                            <Clock className="h-3 w-3" />
                            <span>{formatDateTime(createdAt)}</span>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <Badge className={`
            ${getStatusBadgeClass(status)}
            text-xs sm:text-sm px-2.5 py-1 
            shadow-md font-semibold
            flex items-center gap-1.5
            border-0
          `}>
                        <StatusIcon status={status} />
                        {status}
                    </Badge>
                </div>

                {/* Student Info (Admin variant only) */}
                {variant === 'admin' && studentName && (
                    <div className="flex items-center gap-2 mb-4 p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                            <User className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{studentName}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{studentId}</p>
                        </div>
                    </div>
                )}

                {/* Main Info Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">

                    {/* Amount */}
                    <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                            <IndianRupee className="h-3.5 w-3.5 text-green-100" />
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-green-100">Amount</span>
                        </div>
                        <p className="text-lg sm:text-xl font-black text-white">
                            ₹{amount.toLocaleString()}
                        </p>
                    </div>

                    {/* Method */}
                    <div className="p-3 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                            <CreditCard className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Method</span>
                        </div>
                        <div className="flex items-center">
                            <Badge
                                onClick={method === 'Offline' && onManualBadgeClick ? handleManualClick : undefined}
                                className={`
                  ${getMethodBadgeClass(method)}
                  text-xs px-2 py-0.5 font-semibold border-0
                  ${method === 'Offline' && onManualBadgeClick ? 'cursor-pointer' : ''}
                `}
                            >
                                {method}
                                {method === 'Offline' && onManualBadgeClick && (
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                )}
                            </Badge>
                        </div>
                    </div>

                    {/* Duration */}
                    <div className="p-3 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Clock className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Duration</span>
                        </div>
                        <p className="text-base sm:text-lg font-bold text-purple-700 dark:text-purple-300">
                            {durationYears} Year{durationYears > 1 ? 's' : ''}
                        </p>
                    </div>

                    {/* Valid Until */}
                    <div className="p-3 bg-white dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Calendar className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Valid Until</span>
                        </div>
                        <p className="text-sm sm:text-base font-bold text-blue-700 dark:text-blue-300">
                            {formatDate(validUntil)}
                        </p>
                    </div>
                </div>

                {/* Approver Info (for completed offline payments) */}
                {method === 'Offline' && status === 'Completed' && approverName && (
                    <div className="mt-3 flex items-center gap-2 p-2.5 bg-green-50/50 dark:bg-green-900/20 rounded-xl border border-green-200/50 dark:border-green-700/30">
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <span className="text-xs text-green-800 dark:text-green-200 font-medium">
                            Approved by:
                        </span>
                        <span className="text-xs text-green-900 dark:text-green-100 font-semibold truncate">
                            {approverName} {approverEmpId ? `(${approverEmpId})` : ''}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TransactionCard;
