"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Receipt,
    Clock,
    Calendar,
    CheckCircle,
    IndianRupee,
    Wallet,
    CreditCard,
    Route as RouteIcon,
    Bus,
    MapPin
} from 'lucide-react';
import { Route } from '@/lib/types';
import RouteSelectionSection from './RouteSelectionSection';

interface AddStudentPaymentSectionProps {
    // Form Data
    formData: {
        shift: string;
        routeId: string;
        busId: string;
        pickupPoint: string;
        sessionDuration: string;
        sessionStartYear: number;
        sessionEndYear: number;
        validUntil: string;
        busAssigned?: string;
    };
    // Handlers
    onFormChange: (field: string, value: any) => void;
    // Data sources
    routes: Route[];
    buses: any[];
    busFee: number;
    // Loading states
    loadingRoutes?: boolean;
    loadingBuses?: boolean;
}

export default function AddStudentPaymentSection({
    formData,
    onFormChange,
    routes,
    buses,
    busFee,
    loadingRoutes = false,
    loadingBuses = false
}: AddStudentPaymentSectionProps) {

    // Enforce fixed values on mount and updates
    React.useEffect(() => {
        const currentYear = new Date().getFullYear();
        if (formData.sessionDuration !== '1') {
            onFormChange('sessionDuration', '1');
        }
        // User request: allow current year and next year
        if (formData.sessionStartYear !== currentYear && formData.sessionStartYear !== currentYear + 1) {
            onFormChange('sessionStartYear', currentYear);
        }
    }, [formData.sessionDuration, formData.sessionStartYear, onFormChange]);

    // Calculate net payable amount - FIXED to 1 year as per requirements
    const durationYears = 1;
    const netPayableAmount = busFee * durationYears;

    // Format valid until date for display
    const formatValidUntil = (dateStr: string) => {
        if (!dateStr) return 'Select duration to calculate';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return 'Invalid date';
        }
    };

    // Handle updates from RouteSelectionSection (maps stopId -> pickupPoint)
    const handleReferenceChange = (field: string, value: any) => {
        if (field === 'stopId') {
            onFormChange('pickupPoint', value);
        } else {
            onFormChange(field, value);
        }
    };

    return (
        <div className="space-y-6">
            {/* ================== BUS & ROUTE DETAILS SECTION ================== */}
            <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg">
                        <Bus className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                        Bus & Route Details
                    </h3>
                </div>

                {/* Fixed card styling to remove flickering bar issue */}
                <Card className="border border-white/10 bg-slate-900 shadow-xl overflow-hidden relative group">
                    {/* Subtle accent line at top */}
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500/50 to-transparent"></div>

                    <CardContent className="p-4 relative z-10 pt-0">
                        <RouteSelectionSection
                            routes={routes}
                            buses={buses}
                            selectedRouteId={formData.routeId}
                            selectedBusId={formData.busId || ''}
                            selectedStopId={formData.pickupPoint}
                            selectedShift={formData.shift}
                            busAssigned={formData.busAssigned}
                            onReferenceChange={handleReferenceChange}
                            shiftContent={
                                <div className="space-y-1">
                                    <Label className="block text-xs font-medium text-gray-300 mb-0.5">
                                        Shift <span className="text-red-400">*</span>
                                    </Label>
                                    <Select
                                        key={formData.shift}
                                        value={formData.shift}
                                        onValueChange={(value) => onFormChange('shift', value)}
                                    >
                                        <SelectTrigger className="h-9 bg-blue-600/10 border-blue-500/20 text-gray-100 text-xs hover:border-blue-500/50 transition-colors cursor-pointer">
                                            <SelectValue placeholder="Select Shift" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Morning">Morning Shift</SelectItem>
                                            <SelectItem value="Evening">Evening Shift</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            }
                            extraLabelMargin={true}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* ================== TRANSACTION DETAILS SECTION ================== */}
            <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
                        <Wallet className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                        Transaction Details
                    </h3>
                </div>

                {/* Payment Summary Card */}
                <Card className="relative z-20 overflow-hidden shadow-2xl mb-6 bg-slate-900 border-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-indigo-700 to-fuchsia-800"></div>

                    <div className="relative p-5 space-y-4 pt-0 pb-0">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-white/20 rounded-xl">
                                <Receipt className="h-5 w-5 text-white" />
                            </div>
                            <h3 className="font-extrabold text-base text-white tracking-tight">Payment Summary</h3>
                            <span className="ml-auto px-3 py-1 rounded-full bg-emerald-500/30 border border-emerald-400/50 text-emerald-200 text-[10px] font-black uppercase tracking-widest backdrop-blur-md">
                                OFFLINE MODE
                            </span>
                        </div>

                        {/* Summary Grid with better separation */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 bg-white/10 rounded-2xl hover:bg-white/15 transition-all">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Clock className="h-4 w-4 text-blue-300" />
                                    <span className="text-[9px] text-blue-100/70 font-black uppercase tracking-wider">Duration</span>
                                </div>
                                <p className="font-black text-sm text-white uppercase tracking-tight">{durationYears} Year{durationYears > 1 ? 's' : ''}</p>
                            </div>

                            <div className="p-3 bg-white/10 rounded-2xl hover:bg-white/15 transition-all">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Calendar className="h-4 w-4 text-purple-300" />
                                    <span className="text-[9px] text-purple-100/70 font-black uppercase tracking-wider">Session</span>
                                </div>
                                <p className="font-black text-sm text-white tracking-tight">{formData.sessionStartYear}-{formData.sessionEndYear}</p>
                            </div>

                            <div className="p-3 bg-white/10 rounded-2xl hover:bg-white/15 transition-all">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <CheckCircle className="h-4 w-4 text-emerald-300" />
                                    <span className="text-[9px] text-emerald-100/70 font-black uppercase tracking-wider">Validity</span>
                                </div>
                                <p className="font-black text-sm text-white tracking-tight">
                                    {formData.validUntil ? new Date(formData.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                                </p>
                            </div>
                        </div>

                        {/* Calculation details */}
                        <div className="flex items-center justify-center gap-4 px-1 py-1">
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Fee Calculation</span>
                        </div>

                        {/* Total Amount area - Larger and more prominent */}
                        <div className="relative overflow-hidden p-4 bg-white/10 rounded-2xl shadow-inner">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em]">Net Payable</span>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[11px] font-bold text-white/80">₹{busFee.toLocaleString()}</span>
                                        <span className="text-white/40 text-[10px]">×</span>
                                        <span className="text-[11px] font-bold text-white/80">{durationYears}y</span>
                                    </div>
                                </div>
                                <div className="flex items-baseline gap-1 bg-transparent px-4 py-2 rounded-xl">
                                    <span className="text-lg font-black text-white/60 tracking-tighter">₹</span>
                                    <span className="text-3xl font-black text-white tracking-tighter">{netPayableAmount.toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Security/Instruction note */}
                            <div className="mt-4 flex items-center justify-center gap-2 p-2.5 bg-white/5 rounded-xl">
                                <CreditCard className="h-4 w-4 text-white/60" />
                                <span className="text-[10px] font-medium text-white/60">Amount will be marked as paid via offline transaction.</span>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Editable fields with improved styling to remove glitch issue */}
                <Card className="border border-white/10 bg-slate-900 shadow-xl overflow-hidden relative">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-violet-500/50 to-transparent"></div>

                    <CardContent className="p-4 relative z-10">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                            {/* Session Duration */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold flex items-center gap-1.5 text-fuchsia-300">
                                    <div className="p-1 rounded-md bg-fuchsia-600 shadow-lg">
                                        <Clock className="h-3 w-3 text-white" />
                                    </div>
                                    Session Duration <span className="text-red-400">*</span>
                                </Label>
                                <Input
                                    value="1 Year"
                                    readOnly
                                    className="h-9 bg-white/5 border-white/5 text-gray-400 text-xs cursor-not-allowed border-dashed"
                                />
                                <p className="text-[9px] text-gray-500 ml-1">Fixed subscription duration</p>
                            </div>

                            {/* Session Start Year */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold flex items-center gap-1.5 text-blue-300">
                                    <div className="p-1 rounded-md bg-blue-600 shadow-lg">
                                        <Calendar className="h-3 w-3 text-white" />
                                    </div>
                                    Session Start Year <span className="text-red-400">*</span>
                                </Label>
                                <Select
                                    value={formData.sessionStartYear.toString()}
                                    onValueChange={(value) => onFormChange('sessionStartYear', parseInt(value))}
                                >
                                    <SelectTrigger className="h-9 bg-white/5 border-white/5 text-gray-100 text-xs border-dashed hover:border-white/20 transition-colors">
                                        <SelectValue placeholder="Select Year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={new Date().getFullYear().toString()}>
                                            {new Date().getFullYear()}
                                        </SelectItem>
                                        <SelectItem value={(new Date().getFullYear() + 1).toString()}>
                                            {new Date().getFullYear() + 1}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-[9px] text-gray-500 ml-1">Academic cycle start</p>
                            </div>

                            {/* Session End Year (Auto-calculated) */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold flex items-center gap-1.5 text-purple-300">
                                    <div className="p-1 rounded-md bg-purple-600 shadow-lg">
                                        <Calendar className="h-3 w-3 text-white" />
                                    </div>
                                    Session End Year
                                </Label>
                                <Input
                                    type="number"
                                    value={formData.sessionEndYear}
                                    readOnly
                                    className="h-9 bg-white/5 border-white/5 text-gray-400 text-xs cursor-not-allowed border-dashed"
                                />
                                <p className="text-[9px] text-gray-500 ml-1 italic">Auto-calculated</p>
                            </div>

                            {/* Valid Until (Auto-calculated) */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold flex items-center gap-1.5 text-green-300">
                                    <div className="p-1 rounded-md bg-green-600 shadow-lg">
                                        <CheckCircle className="h-3 w-3 text-white" />
                                    </div>
                                    Valid Until
                                </Label>
                                <Input
                                    type="text"
                                    value={formatValidUntil(formData.validUntil)}
                                    readOnly
                                    className="h-9 bg-white/5 border-white/5 text-gray-400 text-xs cursor-not-allowed border-dashed"
                                />
                                <p className="text-[9px] text-gray-500 ml-1 italic">System calculated expiry</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
