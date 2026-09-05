"use client";

import { useSidebar } from '@/components/AppShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import MonthDayPicker,{ MonthDayValue,fromConfigFormat,toConfigFormat } from '@/components/month-day-picker';
import TimePicker,{ TimeValue,fromConfigTime } from '@/components/time-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import {
	AlertTriangle,
	Bell,
	Calendar,
	FileText,
	IndianRupee,
	Info,
	Layers,
	Loader2,
	Lock,
	Plus,
	RotateCcw,
	Save,
	ScrollText,
	Settings2,
	Shield,
	Sparkles,
	Trash2,
	XCircle
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

// ============================================================================
// TYPES
// ============================================================================



// Removed UIConfig since onboarding and landing pages config are removed

interface TermsSection {
    id: string;
    title: string;
    content: string;
}

interface TermsConfig {
    title: string;
    sections: TermsSection[];
}

interface EditableDates {
    academicSessionStart: MonthDayValue | null;
    academicYearEnd: MonthDayValue | null;
    renewalNotificationStart: MonthDayValue | null;
    renewalDeadline: MonthDayValue | null;
    softBlockDate: MonthDayValue | null;
    hardDeleteDate: MonthDayValue | null;
    urgentWarningDays: number;
}

interface EditableTimes {
    renewalNotificationTime: TimeValue | null;
    renewalDeadlineTime: TimeValue | null;
    softBlockTime: TimeValue | null;
    hardDeleteTime: TimeValue | null;
}

// ============================================================================
// UTILITIES
// ============================================================================

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const getOrdinal = (day: number): string => {
    if (day > 3 && day < 21) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
};

type TabType = 'system' | 'deadline' | 'terms' | 'privacy';

// ============================================================================
// FIELD COMPONENTS
// ============================================================================

function DateTimeField({
    id,
    label,
    dateValue,
    timeValue,
    originalDateValue,
    originalTimeValue,
    onDateChange,
    onTimeChange
}: {
    id: string;
    label: string;
    dateValue: MonthDayValue | null;
    timeValue: TimeValue | null;
    originalDateValue: MonthDayValue | null;
    originalTimeValue: TimeValue | null;
    onDateChange: (value: MonthDayValue) => void;
    onTimeChange: (value: TimeValue) => void;
}) {
    const dateChanged = dateValue?.month !== originalDateValue?.month || dateValue?.day !== originalDateValue?.day;
    const timeChanged = timeValue?.hour !== originalTimeValue?.hour || timeValue?.minute !== originalTimeValue?.minute;
    const hasChanged = dateChanged || timeChanged;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-gray-300">{label}</Label>
                <div className="flex items-center h-6">
                    <span className={`px-2 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400 rounded transition-opacity duration-200 ${hasChanged ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        Modified
                    </span>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <MonthDayPicker
                    id={`${id}-date`}
                    value={dateValue}
                    onChange={onDateChange}
                    placeholder="Date..."
                    showHelperText={false}
                    className="!bg-[#0A0B10] !border-white/10"
                />
                <TimePicker
                    id={`${id}-time`}
                    value={timeValue}
                    onChange={onTimeChange}
                    placeholder="Time..."
                    showHelperText={false}
                    className="!bg-[#0A0B10] !border-white/10"
                />
            </div>
        </div>
    );
}

function TextField({
    id,
    label,
    value,
    originalValue,
    onChange,
    type = 'text',
    placeholder,
    prefix,
    multiline = false
}: {
    id: string;
    label: string;
    value: string | number;
    originalValue: string | number;
    onChange: (value: string | number) => void;
    type?: 'text' | 'number' | 'tel' | 'email';
    placeholder?: string;
    prefix?: string;
    multiline?: boolean;
}) {
    const hasChanged = String(value) !== String(originalValue);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label htmlFor={id} className="text-sm font-medium text-gray-300">{label}</Label>
                <div className="flex items-center gap-2 h-6">
                    <span className={`px-2 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400 rounded transition-opacity duration-200 ${hasChanged ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        Modified
                    </span>
                    <button
                        type="button"
                        onClick={() => onChange(originalValue)}
                        className={`p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-all duration-200 ${hasChanged ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
                        title="Restore"
                        disabled={!hasChanged}
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            <div className="relative">
                {prefix && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">{prefix}</span>
                )}
                {multiline ? (
                    <Textarea
                        id={id}
                        value={String(value)}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        className="bg-[#0A0B10] border-white/10 text-white min-h-[80px] resize-none focus:border-indigo-500"
                    />
                ) : (
                    <Input
                        id={id}
                        type={type}
                        value={String(value)}
                        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
                        placeholder={placeholder}
                        className={`bg-[#0A0B10] border-white/10 text-white focus:border-indigo-500 h-11 ${prefix ? 'pl-8' : ''}`}
                    />
                )}
            </div>
        </div>
    );
}

function SectionHeader({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: string }) {
    return (
        <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/5 rounded-lg">
                {icon}
            </div>
            <h2 className="text-white font-semibold text-lg">{title}</h2>
            {badge && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded uppercase">
                    {badge}
                </span>
            )}
        </div>
    );
}

// ============================================================================
// TAB COMPONENTS
// ============================================================================

function TabButton({
    active,
    onClick,
    icon,
    label,
    badge
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-w-fit cursor-pointer ${active
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
        >
            {icon}
            <span>{label}</span>
            {badge && (
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${active ? 'bg-white/20' : 'bg-red-500/20 text-red-400'
                    }`}>
                    {badge}
                </span>
            )}
        </button>
    );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function SystemRenewalConfigPage() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const { showToast } = useToast();
    const router = useRouter();
    const sidebarContext = useSidebar();
    const isCollapsed = sidebarContext?.collapsed ?? false;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('system');

    // System Config State
    const [systemConfig, setSystemConfig] = useState<{
        appName: string;
        busFee: number;
        paymentExport: { startYear: number; interval: number };
        version?: string;
        mapProvider?: 'guwahati';
    }>({
        appName: 'AdtU Bus Services',
        busFee: 0,
        paymentExport: { startYear: new Date().getFullYear(), interval: 1 },
        version: 'v2.4.0',
        mapProvider: 'guwahati'
    });
    const [originalSystemConfig, setOriginalSystemConfig] = useState<{
        appName: string;
        busFee: number;
        paymentExport: { startYear: number; interval: number };
        version?: string;
        mapProvider?: 'guwahati';
    }>({
        appName: 'AdtU Bus Services',
        busFee: 0,
        paymentExport: { startYear: new Date().getFullYear(), interval: 1 },
        version: 'v2.4.0',
        mapProvider: 'guwahati'
    });

    // Deadline Config State
    const [originalDeadlineConfig, setOriginalDeadlineConfig] = useState<DeadlineConfig | null>(null);
    const [dates, setDates] = useState<EditableDates>({
        academicSessionStart: null,
        academicYearEnd: null,
        renewalNotificationStart: null,
        renewalDeadline: null,
        softBlockDate: null,
        hardDeleteDate: null,
        urgentWarningDays: 15
    });
    const [originalDates, setOriginalDates] = useState<EditableDates>({
        academicSessionStart: null,
        academicYearEnd: null,
        renewalNotificationStart: null,
        renewalDeadline: null,
        softBlockDate: null,
        hardDeleteDate: null,
        urgentWarningDays: 15
    });
    const [hasDependencies, setHasDependencies] = useState<boolean>(false);

    const calculateDerivedMilestones = (sessionStart: MonthDayValue) => {
        const startMonth = sessionStart.month;
        const startDay = sessionStart.day;
        const referenceYear = new Date().getFullYear();

        const lifecycle = deriveAcademicLifecycle(startMonth, startDay, referenceYear);

        return {
            academicYearEnd: { month: lifecycle.expiry.getUTCMonth() + 1, day: lifecycle.expiry.getUTCDate() },
            renewalNotificationStart: { month: lifecycle.reminder1.getUTCMonth() + 1, day: lifecycle.reminder1.getUTCDate() },
            renewalDeadline: { month: lifecycle.deadline.getUTCMonth() + 1, day: lifecycle.deadline.getUTCDate() },
            softBlockDate: { month: lifecycle.softBlock.getUTCMonth() + 1, day: lifecycle.softBlock.getUTCDate() },
            hardDeleteDate: { month: lifecycle.hardDelete.getUTCMonth() + 1, day: lifecycle.hardDelete.getUTCDate() }
        };
    };

    const handleSessionStartChange = (val: MonthDayValue) => {
        if (hasDependencies) return; // Guard against editing when locked
        const derived = calculateDerivedMilestones(val);
        setDates(prev => ({
            ...prev,
            academicSessionStart: val,
            academicYearEnd: derived.academicYearEnd,
            renewalNotificationStart: derived.renewalNotificationStart,
            renewalDeadline: derived.renewalDeadline,
            softBlockDate: derived.softBlockDate,
            hardDeleteDate: derived.hardDeleteDate
        }));
    };
    const [times, setTimes] = useState<EditableTimes>({
        renewalNotificationTime: null,
        renewalDeadlineTime: null,
        softBlockTime: null,
        hardDeleteTime: null
    });
    const [originalTimes, setOriginalTimes] = useState<EditableTimes>({
        renewalNotificationTime: null,
        renewalDeadlineTime: null,
        softBlockTime: null,
        hardDeleteTime: null
    });
    // Warning and UI config states removed since they are no longer editable or used

    // Terms Config State
    const [termsConfig, setTermsConfig] = useState<TermsConfig>({
        title: '',
        sections: []
    });
    const [originalTermsConfig, setOriginalTermsConfig] = useState<TermsConfig | null>(null);

    // Privacy Config State
    const [privacyConfig, setPrivacyConfig] = useState<TermsConfig>({
        title: '',
        sections: []
    });
    const [originalPrivacyConfig, setOriginalPrivacyConfig] = useState<TermsConfig | null>(null);

    // Timestamp metadata from PostgreSQL (replaces JSON-level lastUpdated)
    const [termsUpdatedAt, setTermsUpdatedAt] = useState<string | null>(null);
    const [privacyUpdatedAt, setPrivacyUpdatedAt] = useState<string | null>(null);

    // Load configurations
    const loadConfigs = async () => {
        try {
            setLoading(true);

            // Fetch all configs in parallel to drastically improve load time
            const [deadlineResponse, systemResponse, termsResponse, privacyResponse] = await Promise.all([
                fetch('/api/settings/deadline-config'),
                fetch('/api/settings/system-config'),
                fetch('/api/settings/terms-config'),
                fetch('/api/settings/privacy-config')
            ]);

            // Process deadline config
            if (deadlineResponse.ok) {
                const data = await deadlineResponse.json();
                const config = data.config as DeadlineConfig;
                setOriginalDeadlineConfig(config);
                setHasDependencies(data.hasDependencies ?? false);

                const startConfig = config.academicSessionStart || { month: 6, day: 1 };

                // Set dates
                const editableDates: EditableDates = {
                    academicSessionStart: fromConfigFormat(startConfig),
                    academicYearEnd: fromConfigFormat({ month: config.academicYear.anchorMonth, day: config.academicYear.anchorDay }),
                    renewalNotificationStart: fromConfigFormat({ month: config.renewalNotification.month, day: config.renewalNotification.day }),
                    renewalDeadline: fromConfigFormat({ month: config.renewalDeadline.month, day: config.renewalDeadline.day }),
                    softBlockDate: fromConfigFormat({ month: config.softBlock.month, day: config.softBlock.day }),
                    hardDeleteDate: fromConfigFormat({ month: config.hardDelete.month, day: config.hardDelete.day }),
                    urgentWarningDays: config.urgentWarningThreshold.days
                };
                setDates(editableDates);
                setOriginalDates({ ...editableDates });

                // Set times
                const editableTimes: EditableTimes = {
                    renewalNotificationTime: fromConfigTime({ hour: config.renewalNotification.hour, minute: config.renewalNotification.minute }),
                    renewalDeadlineTime: fromConfigTime({ hour: config.renewalDeadline.hour, minute: config.renewalDeadline.minute }),
                    softBlockTime: fromConfigTime({ hour: config.softBlock.hour, minute: config.softBlock.minute }),
                    hardDeleteTime: fromConfigTime({ hour: config.hardDelete.hour, minute: config.hardDelete.minute })
                };
                setTimes(editableTimes);
                setOriginalTimes({ ...editableTimes });
            }

            // Process system config
            if (systemResponse.ok) {
                const data = await systemResponse.json();
                const config = data.config;
                const newSystemConfig = {
                    appName: config.appName || 'AdtU Bus Services',
                    busFee: config.busFee?.amount ?? 0,
                    paymentExport: {
                        startYear: config.paymentExport?.startYear || new Date().getFullYear(),
                        interval: config.paymentExport?.interval || 1
                    },
                    version: config.version || 'v2.4.0',
                    mapProvider: 'guwahati' as const
                };
                setSystemConfig(newSystemConfig);
                setOriginalSystemConfig(newSystemConfig);
            }

            // Process Terms config
            if (termsResponse.ok) {
                const termsData = await termsResponse.json();
                const config = termsData.config as TermsConfig;
                setTermsConfig(config);
                setOriginalTermsConfig(JSON.parse(JSON.stringify(config)));
                setTermsUpdatedAt(termsData.updatedAt);
            }

            // Process Privacy config
            if (privacyResponse.ok) {
                const privacyData = await privacyResponse.json();
                const config = privacyData.config as TermsConfig;
                setPrivacyConfig(config);
                setOriginalPrivacyConfig(JSON.parse(JSON.stringify(config)));
                setPrivacyUpdatedAt(privacyData.updatedAt);
            }

        } catch (error) {
            console.error('Error loading configs:', error);
            showToast('Failed to load configuration', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadConfigs();
    }, []);

    // Check for unsaved changes
    const hasSystemChanges = () => {
        return JSON.stringify(systemConfig) !== JSON.stringify(originalSystemConfig);
    };

    const hasDeadlineChanges = () => {
        return dates.academicSessionStart?.month !== originalDates.academicSessionStart?.month ||
            dates.academicSessionStart?.day !== originalDates.academicSessionStart?.day ||
            dates.urgentWarningDays !== originalDates.urgentWarningDays;
    };

    const hasTermsChanges = () => {
        return JSON.stringify(termsConfig) !== JSON.stringify(originalTermsConfig);
    };

    const hasPrivacyChanges = () => {
        return JSON.stringify(privacyConfig) !== JSON.stringify(originalPrivacyConfig);
    };

    const hasChanges = hasSystemChanges() || hasDeadlineChanges() || hasTermsChanges() || hasPrivacyChanges();

    const handleSave = async () => {
        if (!currentUser) return;

        setSaving(true);
        try {
            const token = await currentUser.getIdToken();

            // Save system config if changed
            if (hasSystemChanges()) {
                const updatedSystemConfig = {
                    appName: systemConfig.appName,
                    busFee: { amount: systemConfig.busFee },
                    paymentExport: systemConfig.paymentExport,
                    version: systemConfig.version,
                    mapProvider: 'guwahati' as const
                };

                const systemResponse = await fetch('/api/settings/system-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ config: updatedSystemConfig })
                });

                if (!systemResponse.ok) throw new Error('Failed to save system configuration');
                setOriginalSystemConfig({ ...systemConfig });
            }

            // Save deadline config if changed
            if (hasDeadlineChanges() && originalDeadlineConfig && dates.academicSessionStart) {

                const startConfig = toConfigFormat(dates.academicSessionStart);

                const updatedDeadlineConfig: DeadlineConfig = {
                    ...originalDeadlineConfig,
                    academicSessionStart: startConfig,
                    softBlock: {
                        ...originalDeadlineConfig.softBlock,
                        warningText: originalDeadlineConfig.softBlock?.warningText || "Your bus service has expired. Please renew."
                    },
                    hardDelete: {
                        ...originalDeadlineConfig.hardDelete,
                        criticalWarningText: originalDeadlineConfig.hardDelete?.criticalWarningText || "Warning: Account will be permanently deleted."
                    },
                    urgentWarningThreshold: {
                        ...originalDeadlineConfig.urgentWarningThreshold,
                        days: dates.urgentWarningDays
                    }
                };

                // Explicitly remove legacy testingMode if it exists in original (sanitization)
                if ('testingMode' in updatedDeadlineConfig) {
                    delete (updatedDeadlineConfig as any).testingMode;
                }

                const deadlineResponse = await fetch('/api/settings/deadline-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ config: updatedDeadlineConfig })
                });
                if (!deadlineResponse.ok) {
                    const err = await deadlineResponse.json().catch(() => ({}));
                    throw new Error(err.message || 'Failed to save deadline configuration');
                }

                setOriginalDeadlineConfig(updatedDeadlineConfig);
                setOriginalDates({ ...dates });
                setOriginalTimes({ ...times });
            }

            // Save Terms config if changed
            if (hasTermsChanges()) {
                const termsResponse = await fetch('/api/settings/terms-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ config: termsConfig })
                });
                if (!termsResponse.ok) throw new Error('Failed to save Terms configuration');
                setOriginalTermsConfig(JSON.parse(JSON.stringify(termsConfig)));
            }

            // Save Privacy config if changed
            if (hasPrivacyChanges()) {
                const privacyResponse = await fetch('/api/settings/privacy-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ config: privacyConfig })
                });
                if (!privacyResponse.ok) throw new Error('Failed to save Privacy configuration');
                setOriginalPrivacyConfig(JSON.parse(JSON.stringify(privacyConfig)));
            }

            showToast('Configuration saved successfully!', 'success');
            setShowConfirmDialog(false);
        } catch (error: any) {
            console.error('Error saving:', error);
            showToast(error.message || 'Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRestoreAll = () => {
        setSystemConfig({ ...originalSystemConfig });
        setDates({ ...originalDates });
        setTimes({ ...originalTimes });
        if (originalTermsConfig) {
            setTermsConfig(JSON.parse(JSON.stringify(originalTermsConfig)));
        }
        if (originalPrivacyConfig) {
            setPrivacyConfig(JSON.parse(JSON.stringify(originalPrivacyConfig)));
        }
        showToast('All changes reverted', 'info');
    };

    // Auth check
    if (authLoading || loading) {
        return <PremiumPageLoader message="Loading configuration..." />;
    }

    if (!currentUser || userData?.role !== 'admin') {
        return (
            <div className="min-h-screen bg-card flex items-center justify-center">
                <div className="text-center">
                    <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <p className="text-white mb-4">Admin access required</p>
                    <Button onClick={() => router.push('/admin')}>Go to Dashboard</Button>
                </div>
            </div>
        );
    }
    return (
        <div className="min-h-screen bg-card">
            <div className="pt-20 pb-32 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto">
                    {/* Header */}
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl">
                            <Settings2 className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">System Configuration</h1>
                            <p className="text-gray-500 text-sm sm:text-base">Manage deadlines, UI content, and landing page</p>
                        </div>
                    </div>

                    {/* Desktop Tab Navigation (Hidden on Mobile) */}
                    <div className="hidden md:flex flex-wrap items-stretch gap-2 mb-6">
                        <TabButton
                            active={activeTab === 'system'}
                            onClick={() => setActiveTab('system')}
                            icon={<Settings2 className="h-4 w-4" />}
                            label="System Config"
                            badge={hasSystemChanges() ? '•' : undefined}
                        />
                        <TabButton
                            active={activeTab === 'deadline'}
                            onClick={() => setActiveTab('deadline')}
                            icon={<Calendar className="h-4 w-4" />}
                            label="Deadline Config"
                            badge={hasDeadlineChanges() ? '•' : undefined}
                        />
                        <TabButton
                            active={activeTab === 'terms'}
                            onClick={() => setActiveTab('terms')}
                            icon={<ScrollText className="h-4 w-4" />}
                            label="Terms & Conditions"
                            badge={hasTermsChanges() ? '•' : undefined}
                        />
                        <TabButton
                            active={activeTab === 'privacy'}
                            onClick={() => setActiveTab('privacy')}
                            icon={<Shield className="h-4 w-4" />}
                            label="Privacy Policy"
                            badge={hasPrivacyChanges() ? '•' : undefined}
                        />
                    </div>

                    {/* Mobile Navigation Removed as requested */}
                    <div className="md:hidden"></div>

                    {/* Content Area */}
                    <div className="bg-transparent md:bg-[#12131A] rounded-3xl md:border md:border-white/5 md:shadow-2xl">
                        <div className="p-0 md:p-8 space-y-16 md:space-y-0">

                            {/* SYSTEM CONFIG SECTION */}
                            <div id="system-section" className={`${activeTab === 'system' ? 'block' : 'block md:hidden'} animate-in fade-in duration-300`}>
                                <div className="md:hidden flex items-center gap-2 mb-4 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                                    <Settings2 className="h-4 w-4 text-indigo-400" />
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">System Config</h2>
                                </div>
                                <div className="bg-[#0E0F12] border border-white/10 rounded-2xl p-5 md:bg-transparent md:border-none md:p-0 md:rounded-none">
                                    <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-2 md:gap-6">
                                        {/* Global Bus Fee */}
                                        <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10">
                                            <SectionHeader icon={<IndianRupee className="h-5 w-5 text-green-400" />} title="Global Bus Fee" />
                                            <div className="space-y-4 pt-4 md:pt-0">
                                                <TextField
                                                    id="busFee"
                                                    label="Annual Fee Amount"
                                                    type="number"
                                                    value={systemConfig.busFee}
                                                    originalValue={originalSystemConfig.busFee}
                                                    onChange={(v) => setSystemConfig(prev => ({ ...prev, busFee: Number(v) }))}
                                                    prefix="₹"
                                                    placeholder="5000"
                                                />
                                            </div>
                                        </section>

                                        {/* Payment Export Config */}
                                        <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10">
                                            <SectionHeader icon={<IndianRupee className="h-5 w-5 text-purple-400" />} title="Payment Export" />
                                            <div className="pt-4 md:pt-0">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <TextField
                                                        id="exportStartYear"
                                                        label="Start Year"
                                                        type="number"
                                                        value={systemConfig.paymentExport.startYear}
                                                        originalValue={originalSystemConfig.paymentExport.startYear}
                                                        onChange={(v) => setSystemConfig(prev => ({ ...prev, paymentExport: { ...prev.paymentExport, startYear: Number(v) } }))}
                                                    />
                                                    <TextField
                                                        id="exportInterval"
                                                        label="Interval (Years)"
                                                        type="number"
                                                        value={systemConfig.paymentExport.interval}
                                                        originalValue={originalSystemConfig.paymentExport.interval}
                                                        onChange={(v) => setSystemConfig(prev => ({ ...prev, paymentExport: { ...prev.paymentExport, interval: Number(v) } }))}
                                                    />
                                                </div>
                                                <div className="mt-4 text-xs text-slate-500">
                                                    Next export scheduled for: <span className="text-white font-medium">{systemConfig.paymentExport.startYear + systemConfig.paymentExport.interval}</span>
                                                </div>
                                            </div>
                                        </section>

                                        {/* App Name Config - Occupies full width on desktop if not in grid */}
                                        <section className="col-span-1 md:col-span-2 space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10">
                                            <SectionHeader icon={<Settings2 className="h-5 w-5 text-blue-400" />} title="Application Settings" />
                                            <div className="space-y-4 pt-4 md:pt-0">
                                                <TextField
                                                    id="appName"
                                                    label="Application Name"
                                                    value={systemConfig.appName}
                                                    originalValue={originalSystemConfig.appName}
                                                    onChange={(v) => setSystemConfig(prev => ({ ...prev, appName: String(v) }))}
                                                    placeholder="AdtU Bus Services"
                                                />
                                                <TextField
                                                    id="version"
                                                    label="System Version"
                                                    value={systemConfig.version || ''}
                                                    originalValue={originalSystemConfig.version || ''}
                                                    onChange={(v) => setSystemConfig(prev => ({ ...prev, version: String(v) }))}
                                                    placeholder="v2.4.0"
                                                />
                                                <p className="text-xs text-gray-500 mb-4">
                                                    This name appears in the navbar, page titles, and system emails.
                                                </p>
                                                {/* Map provider is locked to guwahati.pmtiles vector map */}
                                            </div>
                                        </section>
                                    </div>
                                </div>
                            </div>

                            {/* DEADLINE CONFIG SECTION */}
                            <div id="deadline-section" className={`${activeTab === 'deadline' ? 'block' : 'block md:hidden'} pt-10 md:pt-0`}>
                                <div className="md:hidden flex items-center gap-2 mb-4 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                                    <Calendar className="h-4 w-4 text-emerald-400" />
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Deadline Config</h2>
                                </div>

                                {hasDependencies && (
                                    <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3 animate-in fade-in duration-300">
                                        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Academic Calendar Locked</h4>
                                            <p className="text-xs text-gray-400 mt-1">
                                                Active students, soft-blocked students, or verified upcoming applications exist in the system.
                                                The Academic Session Start date cannot be modified to prevent data corruption.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {(() => {
                                    const startVal = dates.academicSessionStart;

                                    const displaySessionStart = startVal ? `${MONTH_NAMES[startVal.month - 1]} ${startVal.day}` : 'July 1st';
                                    const displaySessionInterval = startVal
                                        ? `${startVal.day} ${MONTH_NAMES[startVal.month - 1].slice(0, 3)} → ${dates.academicYearEnd ? `${dates.academicYearEnd.day} ${MONTH_NAMES[dates.academicYearEnd.month - 1].slice(0, 3)}` : '30 Jun'}`
                                        : '1 Jul → 30 Jun';

                                    const displayReminder1 = dates.renewalNotificationStart
                                        ? `${MONTH_NAMES[dates.renewalNotificationStart.month - 1]} ${dates.renewalNotificationStart.day}`
                                        : 'April 1st';

                                    const r2Month = dates.academicYearEnd ? (dates.academicYearEnd.month - 2 + 12) % 12 : 4; // May (4)
                                    const displayReminder2 = dates.academicYearEnd ? `${MONTH_NAMES[r2Month]} 1st` : 'May 1st';

                                    const finalRemDate = dates.academicYearEnd ? new Date(2026, dates.academicYearEnd.month - 1, dates.academicYearEnd.day - 15) : new Date(2026, 5, 15);
                                    const displayFinalReminder = `${finalRemDate.getDate()} ${MONTH_NAMES[finalRemDate.getMonth()]}`;

                                    const displayDeadline = dates.renewalDeadline
                                        ? `${dates.renewalDeadline.day} ${MONTH_NAMES[dates.renewalDeadline.month - 1]}`
                                        : 'June 30th';

                                    const displaySoftBlock = dates.softBlockDate
                                        ? `${dates.softBlockDate.day} ${MONTH_NAMES[dates.softBlockDate.month - 1]}`
                                        : 'July 1st';

                                    const displayActivation = dates.softBlockDate
                                        ? `${dates.softBlockDate.day} ${MONTH_NAMES[dates.softBlockDate.month - 1]}`
                                        : 'July 1st';

                                    const displayHardDelete = "+2 Academic Sessions";

                                    return (
                                        <div className="bg-[#0E0F12] border border-white/10 rounded-2xl p-5 md:bg-transparent md:border-none md:p-0 md:rounded-none">
                                            <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-2 md:gap-6">

                                                {/* Card 1: Academic Session */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10 flex flex-col justify-between">
                                                    <div>
                                                        <SectionHeader icon={<Calendar className="h-5 w-5 text-emerald-400" />} title="Academic Session" />

                                                        {/* Center-aligned Interval Card within the section */}
                                                        <div className="mb-4 p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                                                            <span className="text-xs text-gray-400">Current Academic Session Interval</span>
                                                            <p className="text-lg font-bold text-white mt-1">
                                                                {displaySessionInterval}
                                                            </p>
                                                        </div>

                                                        <div className="pt-4 md:pt-0">
                                                            <MonthDayPicker
                                                                id="academicSessionStart"
                                                                value={dates.academicSessionStart}
                                                                onChange={(v) => handleSessionStartChange(v)}
                                                                label="Academic Session Start"
                                                                showHelperText={true}
                                                            />
                                                            {hasDependencies && (
                                                                <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
                                                                    <Lock className="h-3 w-3" /> Locked: Dependent records exist.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </section>

                                                {/* Card 2: Renewal Timeline */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10 flex flex-col justify-between">
                                                    <div>
                                                        <SectionHeader icon={<Bell className="h-5 w-5 text-blue-400" />} title="Renewal Reminder" />
                                                        <div className="pt-4 space-y-3">
                                                            <div className="flex items-center justify-between p-2 bg-white/5 rounded-xl border border-white/5">
                                                                <div>
                                                                    <p className="text-xs font-semibold text-white">Renewal Reminder 1</p>
                                                                    <p className="text-[10px] text-gray-500">Auto Calculated</p>
                                                                </div>
                                                                <span className="text-xs font-bold text-blue-400">{displayReminder1}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between p-2 bg-white/5 rounded-xl border border-white/5">
                                                                <div>
                                                                    <p className="text-xs font-semibold text-white">Renewal Reminder 2</p>
                                                                    <p className="text-[10px] text-gray-500">Auto Calculated</p>
                                                                </div>
                                                                <span className="text-xs font-bold text-blue-400">{displayReminder2}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between p-2 bg-white/5 rounded-xl border border-white/5">
                                                                <div>
                                                                    <p className="text-xs font-semibold text-white">Final Reminder</p>
                                                                    <p className="text-[10px] text-gray-500">Auto Calculated</p>
                                                                </div>
                                                                <span className="text-xs font-bold text-blue-400">{displayFinalReminder}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </section>

                                                {/* Card 3: Renewal Deadline */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10 flex flex-col justify-between">
                                                    <div>
                                                        <SectionHeader icon={<Calendar className="h-5 w-5 text-amber-400" />} title="Renewal Deadline" />
                                                        <div className="pt-4 space-y-4">
                                                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
                                                                <div>
                                                                    <p className="text-sm font-bold text-amber-400">{displayDeadline}</p>
                                                                    <p className="text-xs text-amber-500/70 font-semibold">11:59 PM</p>
                                                                </div>
                                                                <span className="text-xs text-amber-400 flex items-center gap-1 font-medium bg-amber-500/10 px-2.5 py-1 rounded-full">
                                                                    <Lock className="h-3 w-3" /> Auto Calculated
                                                                </span>
                                                            </div>
                                                            <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                                                                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">At this deadline:</p>
                                                                <ul className="text-xs text-gray-300 space-y-1 list-disc pl-4">
                                                                    <li>Final date for students to renew current bus services</li>
                                                                    <li>Automatic reminders are sent to all unrenewed students</li>
                                                                    <li>After 11:59 PM, the Soft Block phase begins immediately</li>
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </section>

                                                {/* Card 4: Soft Block */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10">
                                                    <SectionHeader icon={<Lock className="h-5 w-5 text-orange-400" />} title="Soft Block" />
                                                    <div className="space-y-4 pt-4">
                                                        <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center justify-between">
                                                            <div>
                                                                <p className="text-sm font-bold text-orange-400">{displaySoftBlock}</p>
                                                                <p className="text-xs text-orange-500/70 font-semibold">12:00 AM</p>
                                                            </div>
                                                            <span className="text-xs text-orange-400 flex items-center gap-1 font-medium bg-orange-500/10 px-2.5 py-1 rounded-full">
                                                                <Lock className="h-3 w-3" /> Auto Calculated
                                                            </span>
                                                        </div>
                                                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                                                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">At this point:</p>
                                                            <ul className="text-xs text-gray-300 space-y-1 list-disc pl-4">
                                                                <li>Student becomes Soft Blocked</li>
                                                                <li>Seat is released & bus capacity updated</li>
                                                                <li>Transport entitlement is removed</li>
                                                            </ul>
                                                        </div>
                                                    </div>
                                                </section>

                                                {/* Card 5: Future Session Activation */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10 flex flex-col justify-between">
                                                    <div>
                                                        <SectionHeader icon={<Sparkles className="h-5 w-5 text-indigo-400" />} title="Future Session Activation" />
                                                        <div className="space-y-4 pt-4">
                                                            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-between">
                                                                <div>
                                                                    <p className="text-sm font-bold text-indigo-400">{displayActivation}</p>
                                                                    <p className="text-xs text-indigo-500/70 font-semibold">Only after successful Soft Block</p>
                                                                </div>
                                                                <span className="text-xs text-indigo-400 flex items-center gap-1 font-medium bg-indigo-500/10 px-2.5 py-1 rounded-full">
                                                                    <Lock className="h-3 w-3" /> Auto Calculated
                                                                </span>
                                                            </div>
                                                            <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                                                                <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">Activation Process Flow:</p>
                                                                <div className="text-xs text-gray-300 space-y-2 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="h-4 w-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] flex items-center justify-center font-bold">1</span>
                                                                        <span>Verified upcoming students processed</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="h-4 w-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] flex items-center justify-center font-bold">2</span>
                                                                        <span>Automatic seat allocation runs</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="h-4 w-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] flex items-center justify-center font-bold">3</span>
                                                                        <span>Alternative bus search if full</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="h-4 w-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] flex items-center justify-center font-bold">4</span>
                                                                        <span>Push to pending_seat_allocation if no space</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </section>

                                                {/* Card 6: Hard Delete */}
                                                <section className="space-y-4 md:space-y-0 md:p-6 md:bg-[#0E0F12] md:rounded-2xl md:border md:border-white/10">
                                                    <SectionHeader icon={<Trash2 className="h-5 w-5 text-red-400" />} title="Hard Delete" badge="CRITICAL" />
                                                    <div className="space-y-4 pt-4">
                                                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
                                                            <div>
                                                                <p className="text-sm font-bold text-red-400">{displayHardDelete}</p>
                                                                <p className="text-[10px] text-red-500/70 font-semibold">Permanently deletes inactive records</p>
                                                            </div>
                                                            <span className="text-xs text-red-400 flex items-center gap-1 font-medium bg-red-500/10 px-2.5 py-1 rounded-full">
                                                                <Lock className="h-3 w-3" /> Auto Calculated
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-4">
                                                            <TextField
                                                                id="urgentWarningDays"
                                                                label="Critical Warning Days (Before Delete)"
                                                                type="number"
                                                                value={dates.urgentWarningDays}
                                                                originalValue={originalDates.urgentWarningDays}
                                                                onChange={(v) => setDates(prev => ({ ...prev, urgentWarningDays: Number(v) }))}
                                                            />
                                                        </div>
                                                        <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                                                            <p className="text-xs text-gray-300">
                                                                Students still inactive after two complete academic sessions are permanently removed. This process is automatic.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </section>

                                            </div>

                                            {/* Visual System Lifecycle Timeline at bottom */}
                                            <div className="mt-8 p-6 bg-[#0E0F12] rounded-2xl border border-white/10 space-y-6">
                                                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                                    <Layers className="h-4 w-4 text-indigo-400" /> Complete System Lifecycle Timeline
                                                </h3>
                                                <div className="relative pl-6 sm:pl-0 sm:flex sm:items-center sm:justify-between sm:space-x-4 space-y-6 sm:space-y-0 sm:overflow-x-auto pb-4 scrollbar-thin">
                                                    {/* Line for desktop */}
                                                    <div className="hidden sm:block absolute top-6 left-4 right-4 h-0.5 bg-white/10 -z-10" />
                                                    {/* Line for mobile */}
                                                    <div className="sm:hidden absolute top-0 bottom-0 left-[29px] w-0.5 bg-white/10 -z-10" />

                                                    {[
                                                        { label: 'Session Starts', date: displaySessionStart, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Reminder 1', date: displayReminder1, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Reminder 2', date: displayReminder2, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Final Reminder', date: displayFinalReminder, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Renewal Deadline', date: displayDeadline, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Soft Block', date: displaySoftBlock, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Activation', date: displayActivation, color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' },
                                                        { label: 'Hard Delete', date: '2 years later', color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500' }
                                                    ].map((item, idx) => (
                                                        <div key={idx} className="flex sm:flex-col items-center gap-4 sm:gap-2 sm:text-center sm:flex-1 min-w-[100px]">
                                                            <div className={`h-8 w-8 rounded-full border-2 ${item.bg} flex items-center justify-center text-xs font-bold text-white z-10 bg-black`}>
                                                                {idx + 1}
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-semibold text-white">{item.label}</p>
                                                                <p className={`text-[10px] ${item.color} font-medium mt-0.5`}>{item.date}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                        </div>
                                    );
                                })()}
                            </div>

                            {/* TERMS & CONDITIONS SECTION */}
                            <div id="terms-section" className={`${activeTab === 'terms' ? 'block' : 'block md:hidden'} pt-10 md:pt-0`}>
                                <div className="md:hidden flex items-center gap-2 mb-4 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                                    <ScrollText className="h-4 w-4 text-indigo-400" />
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Terms & Conditions</h2>
                                </div>
                                <div className="bg-[#0E0F12] border border-white/10 rounded-2xl p-5 md:bg-transparent md:border-none md:p-0 md:rounded-none">
                                    <div className="space-y-6 animate-in fade-in duration-300">
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                                            {/* Page Header Edit */}
                                            <div className="lg:col-span-2 p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 flex flex-col">
                                                <SectionHeader icon={<FileText className="h-5 w-5 text-indigo-400" />} title="Page Header" />
                                                <div className="mt-2">
                                                    <TextField
                                                        id="terms-title"
                                                        label="Document Title"
                                                        value={termsConfig.title}
                                                        originalValue={originalTermsConfig?.title || ''}
                                                        onChange={(val) => setTermsConfig(prev => ({ ...prev, title: String(val) }))}
                                                        placeholder="e.g. Terms & Conditions"
                                                    />
                                                </div>
                                            </div>

                                            {/* Preview Card */}
                                            <div className="p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 flex flex-col justify-between">
                                                <div>
                                                    <SectionHeader icon={<Info className="h-5 w-5 text-blue-400" />} title="Quick Information" />
                                                    <div className="space-y-4 text-sm text-gray-400 mt-2">
                                                        <p>
                                                            The Terms & Conditions page is a public page accessible to all users.
                                                            Currently, it has <strong>{termsConfig.sections.length}</strong> sections.
                                                        </p>
                                                        <p>
                                                            Last Updated: <span className="text-white">{termsUpdatedAt || 'Not set'}</span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    className="w-full mt-4 border-white/10 text-white hover:bg-white/5"
                                                    onClick={() => window.open('/terms-and-conditions', '_blank')}
                                                >
                                                    View Live Page
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Sections Editor */}
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between px-2">
                                                <h3 className="text-lg font-semibold text-white">Content Sections</h3>
                                                <span className="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-md">
                                                    Total Sections: {termsConfig.sections.length}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4">
                                                {termsConfig.sections.map((section, index) => (
                                                    <div key={index} className="p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 space-y-4 relative group">
                                                        <div className="absolute top-4 right-4 z-10">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => {
                                                                    const newSections = [...termsConfig.sections];
                                                                    newSections.splice(index, 1);
                                                                    setTermsConfig(prev => ({ ...prev, sections: newSections }));
                                                                }}
                                                                className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                                                title="Delete Section"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>

                                                        <TextField
                                                            id={`section-title-${index}`}
                                                            label="Section Title"
                                                            value={section.title}
                                                            originalValue={originalTermsConfig?.sections[index]?.title || ''}
                                                            onChange={(val) => {
                                                                const newSections = [...termsConfig.sections];
                                                                newSections[index].title = String(val);
                                                                setTermsConfig(prev => ({ ...prev, sections: newSections }));
                                                            }}
                                                            placeholder="e.g. 1. Introduction"
                                                        />

                                                        <div className="space-y-2">
                                                            <span className="text-sm font-medium text-gray-400">Content</span>
                                                            <Textarea
                                                                value={section.content}
                                                                onChange={(e) => {
                                                                    const newSections = [...termsConfig.sections];
                                                                    newSections[index].content = e.target.value;
                                                                    setTermsConfig(prev => ({ ...prev, sections: newSections }));
                                                                }}
                                                                className="bg-black/40 border-white/5 text-slate-300 min-h-[140px] resize-y focus:border-indigo-500/50 font-sans text-sm leading-relaxed"
                                                                placeholder="Enter section content..."
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <Button
                                                variant="outline"
                                                onClick={() => {
                                                    setTermsConfig(prev => ({
                                                        ...prev,
                                                        sections: [
                                                            ...prev.sections,
                                                            { id: `section-${Date.now()}`, title: `${prev.sections.length + 1}. New Section`, content: '' }
                                                        ]
                                                    }));
                                                }}
                                                className="w-full border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5 text-gray-400 hover:text-indigo-400 py-8"
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Add New Content Section
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>


                            {/* PRIVACY SECTION */}
                            <div id="privacy-section" className={`${activeTab === 'privacy' ? 'block' : 'block md:hidden'} pt-10 md:pt-0`}>
                                <div className="md:hidden flex items-center gap-2 mb-4 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                                    <Shield className="h-4 w-4 text-emerald-400" />
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Privacy Policy</h2>
                                </div>

                                <div className="bg-[#0E0F12] border border-white/10 rounded-2xl p-5 md:bg-transparent md:border-none md:p-0 md:rounded-none">
                                    <div className="space-y-6 animate-in fade-in duration-300">
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                                            {/* Page Header Edit */}
                                            <div className="lg:col-span-2 p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 flex flex-col">
                                                <SectionHeader icon={<Shield className="h-5 w-5 text-emerald-400" />} title="Page Header" />
                                                <div className="mt-2">
                                                    <TextField
                                                        id="privacy-title"
                                                        label="Document Title"
                                                        value={privacyConfig.title}
                                                        originalValue={originalPrivacyConfig?.title || ''}
                                                        onChange={(val) => setPrivacyConfig(prev => ({ ...prev, title: String(val) }))}
                                                        placeholder="e.g. Privacy Policy"
                                                    />
                                                </div>
                                            </div>

                                            {/* Preview Card */}
                                            <div className="p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 flex flex-col justify-between">
                                                <div>
                                                    <SectionHeader icon={<Info className="h-5 w-5 text-blue-400" />} title="Quick Information" />
                                                    <div className="space-y-4 text-sm text-gray-400 mt-2">
                                                        <p>
                                                            The Privacy Policy is a public document outlining how user data is handled.
                                                            Currently, it has <strong>{privacyConfig.sections.length}</strong> sections.
                                                        </p>
                                                        <p>
                                                            Last Updated: <span className="text-white">{privacyUpdatedAt || 'Not set'}</span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    className="w-full mt-4 border-white/10 text-white hover:bg-white/5"
                                                    onClick={() => window.open('/privacy-policy', '_blank')}
                                                >
                                                    View Live Page
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Sections Editor */}
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between px-2">
                                                <h3 className="text-lg font-semibold text-white">Content Sections</h3>
                                                <span className="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-md">
                                                    Total Sections: {privacyConfig.sections.length}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4">
                                                {privacyConfig.sections.map((section, index) => (
                                                    <div key={index} className="p-6 rounded-2xl bg-white/5 border border-white/5 md:bg-[#0E0F12] md:border-white/10 space-y-4 relative group">
                                                        <div className="absolute top-4 right-4 z-10">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => {
                                                                    const newSections = [...privacyConfig.sections];
                                                                    newSections.splice(index, 1);
                                                                    setPrivacyConfig(prev => ({ ...prev, sections: newSections }));
                                                                }}
                                                                className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                                                title="Delete Section"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>

                                                        <TextField
                                                            id={`privacy-section-title-${index}`}
                                                            label="Section Title"
                                                            value={section.title}
                                                            originalValue={originalPrivacyConfig?.sections[index]?.title || ''}
                                                            onChange={(val) => {
                                                                const newSections = [...privacyConfig.sections];
                                                                newSections[index].title = String(val);
                                                                setPrivacyConfig(prev => ({ ...prev, sections: newSections }));
                                                            }}
                                                            placeholder="e.g. 1. Introduction"
                                                        />

                                                        <div className="space-y-2">
                                                            <span className="text-sm font-medium text-gray-400">Content</span>
                                                            <Textarea
                                                                value={section.content}
                                                                onChange={(e) => {
                                                                    const newSections = [...privacyConfig.sections];
                                                                    newSections[index].content = e.target.value;
                                                                    setPrivacyConfig(prev => ({ ...prev, sections: newSections }));
                                                                }}
                                                                className="bg-black/40 border-white/5 text-slate-300 min-h-[140px] resize-y focus:border-indigo-500/50 font-sans text-sm leading-relaxed"
                                                                placeholder="Enter section content..."
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <Button
                                                variant="outline"
                                                onClick={() => {
                                                    setPrivacyConfig(prev => ({
                                                        ...prev,
                                                        sections: [
                                                            ...prev.sections,
                                                            { id: `section-${Date.now()}`, title: `${prev.sections.length + 1}. New Section`, content: '' }
                                                        ]
                                                    }));
                                                }}
                                                className="w-full border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5 text-gray-400 hover:text-indigo-400 py-8"
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Add New Content Section
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            {/* Floating Save Bar */}
            {hasChanges && (
                <div 
                    className="fixed bottom-0 left-0 right-0 md:left-[var(--save-bar-left)] bg-[#12131A]/95 backdrop-blur-xl border-t border-white/10 p-4 z-50 transition-all duration-300"
                    style={{
                        '--save-bar-left': isCollapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width-expanded)'
                    } as React.CSSProperties}
                >
                    <div className="max-w-5xl mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                            <span className="text-white font-medium">Unsaved Changes</span>
                        </div>
                        <div className="flex gap-3">
                            <Button variant="outline" onClick={handleRestoreAll} className="border-white/20 text-white hover:bg-white/10">
                                <RotateCcw className="h-4 w-4 mr-2" />Restore
                            </Button>
                            <Button
                                onClick={() => setShowConfirmDialog(true)}
                                disabled={saving}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Save Configuration
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            <ConfirmDialog
                open={showConfirmDialog}
                onOpenChange={setShowConfirmDialog}
                onConfirm={handleSave}
                title="Save Configuration"
                description="Are you sure you want to save these changes? This will update the system configuration immediately."
                confirmLabel={saving ? 'Saving...' : 'Save'}
                cancelLabel="Cancel"
                variant="warning"
            />
        </div >
    );
}
