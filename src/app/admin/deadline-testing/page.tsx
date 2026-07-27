'use client';

/**
 * Deadline Simulation Testing Page
 * 
 * Admin-only page to test soft block and hard delete functionality.
 * 
 * LOGIC:
 * - Soft Block: simYear == sessionEndYear && simDate >= softBlockDate
 * - Hard Delete: simYear >= sessionEndYear + 1 && simDate >= hardDeleteDate
 * 
 * MODES:
 * - Auto Mode (default): Automatically determines eligibility based on simulated date
 * - Manual Mode: Admin selects specific students with checkboxes
 */

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import {
	AlertTriangle,
	ArrowLeft,
	Calendar,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Eye,
	Lock,
	Play,
	RefreshCw,
	Settings,
	Trash2,
	Users,
	XCircle
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

interface StudentStatus {
    uid: string;
    name: string;
    enrollmentId: string;
    email: string;
    validUntil: string;
    sessionEndYear: number;
    status: string;
    softBlockDate: string;
    hardDeleteDate: string;
    shouldSoftBlock: boolean;
    shouldHardDelete: boolean;
    daysPastSoftBlock: number;
    daysPastHardDelete: number;
}

interface SimulationResult {
    simulatedDate: string;
    totalStudents: number;
    allStudents: StudentStatus[];
    eligibleForSoftBlock: StudentStatus[];
    eligibleForHardDelete: StudentStatus[];
    alreadyBlocked: StudentStatus[];
    safeStudents: number;
    errors: string[];
}

export default function DeadlineTestingPage() {
    const router = useRouter();
    const { userData, currentUser, loading } = useAuth();

    const [config, setConfig] = useState<DeadlineConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);

    // Simulation settings
    const [simulatedDate, setSimulatedDate] = useState('');
    const [simulatedTime, setSimulatedTime] = useState('00:05');
    const [syncSessionYear, setSyncSessionYear] = useState(true); // Default to true per request

    // Manual mode
    const [manualMode, setManualMode] = useState(false);
    const [selectedSoftBlock, setSelectedSoftBlock] = useState<Set<string>>(new Set());
    const [selectedHardDelete, setSelectedHardDelete] = useState<Set<string>>(new Set());

    // Custom deadline overrides for simulation
    const [useCustomDeadlines, setUseCustomDeadlines] = useState(false);
    const [customSoftBlockMonth, setCustomSoftBlockMonth] = useState(6); // July (0-indexed)
    const [customSoftBlockDay, setCustomSoftBlockDay] = useState(31);
    const [customHardDeleteMonth, setCustomHardDeleteMonth] = useState(7); // August
    const [customHardDeleteDay, setCustomHardDeleteDay] = useState(31);

    // Execution safety
    const [confirmHardDelete, setConfirmHardDelete] = useState(false);

    // Results
    const [scanning, setScanning] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState<SimulationResult | null>(null);
    const [executionResult, setExecutionResult] = useState<any>(null);
    const [expandedSection, setExpandedSection] = useState<string | null>('allStudents');

    // Redirect if not authenticated or not admin
    useEffect(() => {
        if (!loading) {
            if (!currentUser) {
                router.push('/login');
                return;
            }
            if (userData && userData.role !== 'admin') {
                router.push(`/${userData.role}`);
                return;
            }
        }
    }, [currentUser, userData, loading, router]);

    // Load config on mount
    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setConfigLoading(true);
        try {
            const res = await fetch('/api/admin/deadline-config');
            if (res.ok) {
                const data = await res.json();
                setConfig(data.config);

                // Initialize custom deadlines from config
                setCustomSoftBlockMonth(data.config.softBlock.month);
                setCustomSoftBlockDay(data.config.softBlock.day);
                setCustomHardDeleteMonth(data.config.hardDelete.month);
                setCustomHardDeleteDay(data.config.hardDelete.day);

                // Set default simulated date to today
                const today = new Date();
                setSimulatedDate(today.toISOString().split('T')[0]);
            }
        } catch (err) {
            console.error('Failed to load config:', err);
        } finally {
            setConfigLoading(false);
        }
    };

    const runSimulation = async () => {
        if (!simulatedDate || !currentUser) return;

        setScanning(true);
        setResult(null);
        setSelectedSoftBlock(new Set());
        setSelectedHardDelete(new Set());

        try {
            const simDate = new Date(`${simulatedDate}T${simulatedTime}:00`);
            const token = await currentUser.getIdToken();

            const requestBody: any = {
                simulatedDate: simDate.toISOString(),
                dryRun: true,
                manualMode: manualMode,
                syncSessionYear: syncSessionYear,
            };

            // Add custom deadline overrides if enabled
            if (useCustomDeadlines) {
                requestBody.customDeadlines = {
                    softBlock: { month: customSoftBlockMonth, day: customSoftBlockDay },
                    hardDelete: { month: customHardDeleteMonth, day: customHardDeleteDay },
                };
            }

            const res = await fetch('/api/admin/simulate-deadlines', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(requestBody),
            });

            const data = await res.json();
            if (data.success) {
                setResult(data.result);
            } else {
                setResult({
                    simulatedDate: simDate.toISOString(),
                    totalStudents: 0,
                    allStudents: [],
                    eligibleForSoftBlock: [],
                    eligibleForHardDelete: [],
                    alreadyBlocked: [],
                    safeStudents: 0,
                    errors: [data.error || 'Simulation failed'],
                });
            }
        } catch (err: any) {
            setResult({
                simulatedDate: new Date().toISOString(),
                totalStudents: 0,
                allStudents: [],
                eligibleForSoftBlock: [],
                eligibleForHardDelete: [],
                alreadyBlocked: [],
                safeStudents: 0,
                errors: [err.message || 'Network error'],
            });
        } finally {
            setScanning(false);
        }
    };

    const executeActions = async () => {
        if (!result || !currentUser) return;

        // Determine what to execute based on mode
        const softBlockList = manualMode
            ? Array.from(selectedSoftBlock)
            : result.eligibleForSoftBlock.map(s => s.uid);
        const hardDeleteList = manualMode
            ? Array.from(selectedHardDelete)
            : result.eligibleForHardDelete.map(s => s.uid);

        if (hardDeleteList.length > 0 && !confirmHardDelete) {
            alert('You must check "Confirm Hard Delete" to execute hard deletions.');
            return;
        }

        const confirmed = window.confirm(
            `⚠️ EXECUTION WARNING ⚠️\n\n` +
            `You are about to:\n` +
            `- Soft Block: ${softBlockList.length} students\n` +
            `- Hard Delete: ${hardDeleteList.length} students\n\n` +
            `${hardDeleteList.length > 0 ? 'Hard delete will PERMANENTLY remove:\n- Firebase Auth accounts\n- All Firestore documents\n- Cloudinary images\n- Bus capacity updates\n\n' : ''}` +
            `This action is IRREVERSIBLE!\n\n` +
            `Continue?`
        );

        if (!confirmed) return;

        if (hardDeleteList.length > 0) {
            const confirmText = window.prompt('Type "DELETE" to confirm permanent deletion:');
            if (confirmText !== 'DELETE') {
                alert('Deletion cancelled. Text did not match.');
                return;
            }
        }

        setExecuting(true);
        try {
            const simDate = new Date(`${simulatedDate}T${simulatedTime}:00`);
            const token = await currentUser.getIdToken();

            const requestBody: any = {
                simulatedDate: simDate.toISOString(),
                dryRun: false,
                execute: true,
                manualMode,
                selectedForSoftBlock: softBlockList,
                selectedForHardDelete: hardDeleteList,
            };

            if (useCustomDeadlines) {
                requestBody.customDeadlines = {
                    softBlock: { month: customSoftBlockMonth, day: customSoftBlockDay },
                    hardDelete: { month: customHardDeleteMonth, day: customHardDeleteDay },
                };
            }

            const res = await fetch('/api/admin/simulate-deadlines', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(requestBody),
            });

            const data = await res.json();
            setExecutionResult(data);

            // Refresh simulation to show updated state
            if (data.success) {
                setTimeout(() => runSimulation(), 1000);
            }
        } catch (err: any) {
            setExecutionResult({ success: false, error: err.message });
        } finally {
            setExecuting(false);
        }
    };

    const toggleSoftBlockSelection = (uid: string) => {
        const newSet = new Set(selectedSoftBlock);
        if (newSet.has(uid)) {
            newSet.delete(uid);
        } else {
            newSet.add(uid);
            // Remove from hard delete if selected there
            const hdSet = new Set(selectedHardDelete);
            hdSet.delete(uid);
            setSelectedHardDelete(hdSet);
        }
        setSelectedSoftBlock(newSet);
    };

    const toggleHardDeleteSelection = (uid: string) => {
        const newSet = new Set(selectedHardDelete);
        if (newSet.has(uid)) {
            newSet.delete(uid);
        } else {
            newSet.add(uid);
            // Remove from soft block if selected there
            const sbSet = new Set(selectedSoftBlock);
            sbSet.delete(uid);
            setSelectedSoftBlock(sbSet);
        }
        setSelectedHardDelete(newSet);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr || dateStr === 'N/A' || dateStr === 'Not Set') return dateStr;
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Loading state
    if (loading || !userData) {
        return <PremiumPageLoader message="Loading Simulation..." subMessage="Preparing test parameters..." />;
    }

    if (!currentUser || userData.role !== 'admin') {
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6 pb-32">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Link href="/admin/cron-jobs">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                            <Calendar className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-white">Deadline Simulation</h1>
                            <p className="text-xs text-gray-400">Simulate any date to test soft block & hard delete</p>
                        </div>
                    </div>

                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/50">
                        🔬 Simulation Console
                    </Badge>
                </div>

                {/* Explanation Card */}
                <Card className="bg-blue-900/20 border-blue-700/50">
                    <CardContent className="p-4">
                        <div className="flex gap-3">
                            <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-blue-300 space-y-1">
                                <p className="font-medium text-sm text-blue-200">How This Works:</p>
                                <p>1. <strong>Set "Simulated Today"</strong> - This date acts as the current date for the simulation</p>
                                <p>2. <strong>Configure Deadline Dates</strong> - Month/day for when soft block and hard delete occur</p>
                                <p>3. <strong>Soft Block</strong>: If simulated year = student's session end year AND simulated date ≥ soft block date</p>
                                <p>4. <strong>Hard Delete</strong>: If simulated year ≥ session end year + 2 AND simulated date ≥ hard delete date</p>
                                <p className="text-blue-400 italic">Example: Student valid until Jun 30, 2025 → Soft block Jul 31, 2025 → Hard delete Aug 31, 2027</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Config Summary Cards */}
                {config && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="bg-yellow-900/20 border-yellow-700/50">
                            <CardContent className="p-3">
                                <p className="text-[10px] text-yellow-400 font-medium">Renewal Deadline</p>
                                <p className="text-sm font-bold text-white">
                                    {MONTHS[config.renewalDeadline.month]} {config.renewalDeadline.day}
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="bg-orange-900/20 border-orange-700/50">
                            <CardContent className="p-3">
                                <p className="text-[10px] text-orange-400 font-medium">Soft Block (Same Year)</p>
                                <p className="text-sm font-bold text-white">
                                    {MONTHS[useCustomDeadlines ? customSoftBlockMonth : config.softBlock.month]} {useCustomDeadlines ? customSoftBlockDay : config.softBlock.day}
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="bg-red-900/20 border-red-700/50">
                            <CardContent className="p-3">
                                <p className="text-[10px] text-red-400 font-medium">Hard Delete (+2 Years)</p>
                                <p className="text-sm font-bold text-white">
                                    {MONTHS[useCustomDeadlines ? customHardDeleteMonth : config.hardDelete.month]} {useCustomDeadlines ? customHardDeleteDay : config.hardDelete.day}
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="bg-purple-900/20 border-purple-700/50">
                            <CardContent className="p-3">
                                <p className="text-[10px] text-purple-400 font-medium">Academic Year End</p>
                                <p className="text-sm font-bold text-white">
                                    {MONTHS[config.academicYear.anchorMonth]} {config.academicYear.anchorDay}
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Custom Deadline Overrides */}
                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm text-white flex items-center gap-2">
                                <Settings className="w-4 h-4 text-indigo-400" />
                                Custom Deadline Overrides (For This Simulation Only)
                            </CardTitle>
                            <button
                                type="button"
                                onClick={() => setUseCustomDeadlines(!useCustomDeadlines)}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useCustomDeadlines ? 'bg-indigo-500' : 'bg-gray-600'}`}
                            >
                                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${useCustomDeadlines ? 'translate-x-5' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </CardHeader>
                    {useCustomDeadlines && (
                        <CardContent className="pt-0">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label className="text-xs text-orange-400">Soft Block Month</Label>
                                    <select
                                        value={customSoftBlockMonth}
                                        onChange={(e) => setCustomSoftBlockMonth(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-md p-2 text-sm text-white"
                                    >
                                        {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-orange-400">Soft Block Day</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={31}
                                        value={customSoftBlockDay}
                                        onChange={(e) => setCustomSoftBlockDay(Number(e.target.value))}
                                        className="bg-slate-900 border-slate-600"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-red-400">Hard Delete Month</Label>
                                    <select
                                        value={customHardDeleteMonth}
                                        onChange={(e) => setCustomHardDeleteMonth(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-md p-2 text-sm text-white"
                                    >
                                        {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-red-400">Hard Delete Day</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={31}
                                        value={customHardDeleteDay}
                                        onChange={(e) => setCustomHardDeleteDay(Number(e.target.value))}
                                        className="bg-slate-900 border-slate-600"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* Simulation Controls */}
                <Card className="bg-amber-900/20 border-amber-700/50">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base text-white flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-400" />
                            Step 1: Set "Simulated Today"
                        </CardTitle>
                        <CardDescription className="text-xs text-amber-300/70">
                            This date acts as the current date for the simulation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs text-amber-400 font-medium whitespace-nowrap">📅 Simulated Today</Label>
                                <Input
                                    type="date"
                                    value={simulatedDate}
                                    onChange={(e) => setSimulatedDate(e.target.value)}
                                    className="bg-slate-900 border-amber-600/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-amber-400 font-medium">🕐 Time</Label>
                                <Input
                                    type="time"
                                    value={simulatedTime}
                                    onChange={(e) => setSimulatedTime(e.target.value)}
                                    className="bg-slate-900 border-amber-600/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-blue-400 font-medium whitespace-nowrap">🔄 Sync Session Year</Label>
                                <div className="flex items-center gap-2 h-10">
                                    <button
                                        type="button"
                                        onClick={() => setSyncSessionYear(!syncSessionYear)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${syncSessionYear ? 'bg-blue-500' : 'bg-gray-600'}`}
                                    >
                                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${syncSessionYear ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                    <span className="text-sm text-white">{syncSessionYear ? 'Yes' : 'No'}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-cyan-400 font-medium">Manual Mode</Label>
                                <div className="flex items-center gap-2 h-10">
                                    <button
                                        type="button"
                                        onClick={() => setManualMode(!manualMode)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${manualMode ? 'bg-cyan-500' : 'bg-gray-600'}`}
                                    >
                                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${manualMode ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                    <span className="text-sm text-white">{manualMode ? 'Yes' : 'No'}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-gray-400 invisible">Action</Label>
                                <Button
                                    onClick={runSimulation}
                                    disabled={scanning || !simulatedDate}
                                    className="w-full bg-amber-600 hover:bg-amber-500 text-white"
                                >
                                    {scanning ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Scanning...
                                        </>
                                    ) : (
                                        <>
                                            <Eye className="w-4 h-4 mr-2" />
                                            Scan Students
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Quick Date Buttons */}
                        {config && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700/50 mt-4">
                                <span className="text-xs text-gray-500 self-center">Quick Set:</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-6"
                                    onClick={() => setSimulatedDate(new Date().toISOString().split('T')[0])}
                                >
                                    Today
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-6 border-orange-500/50 text-orange-400"
                                    onClick={() => {
                                        const year = new Date().getFullYear();
                                        const month = useCustomDeadlines ? customSoftBlockMonth : config.softBlock.month;
                                        const day = useCustomDeadlines ? customSoftBlockDay : config.softBlock.day;
                                        setSimulatedDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                                    }}
                                >
                                    Soft Block Day
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-6 border-red-500/50 text-red-400"
                                    onClick={() => {
                                        const year = new Date().getFullYear() + 2;
                                        const month = useCustomDeadlines ? customHardDeleteMonth : config.hardDelete.month;
                                        const day = useCustomDeadlines ? customHardDeleteDay : config.hardDelete.day;
                                        setSimulatedDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                                    }}
                                >
                                    Hard Delete Day (+2 Years)
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Results */}
                {
                    result && (
                        <div className="space-y-4">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <Card className="bg-slate-800/50 border-slate-700">
                                    <CardContent className="p-3 text-center">
                                        <p className="text-xl font-bold text-white">{result?.totalStudents || 0}</p>
                                        <p className="text-xs text-gray-400">Total</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-orange-900/20 border-orange-700/50">
                                    <CardContent className="p-3 text-center">
                                        <p className="text-xl font-bold text-orange-400">
                                            {manualMode ? selectedSoftBlock.size : (result?.eligibleForSoftBlock?.length || 0)}
                                        </p>
                                        <p className="text-xs text-orange-300">Soft Block</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-red-900/20 border-red-700/50">
                                    <CardContent className="p-3 text-center">
                                        <p className="text-xl font-bold text-red-400">
                                            {manualMode ? selectedHardDelete.size : (result?.eligibleForHardDelete?.length || 0)}
                                        </p>
                                        <p className="text-xs text-red-300">Hard Delete</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gray-800/50 border-gray-700">
                                    <CardContent className="p-3 text-center">
                                        <p className="text-xl font-bold text-gray-400">{result?.alreadyBlocked?.length || 0}</p>
                                        <p className="text-xs text-gray-500">Already Blocked</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-green-900/20 border-green-700/50">
                                    <CardContent className="p-3 text-center">
                                        <p className="text-xl font-bold text-green-400">{result?.safeStudents || 0}</p>
                                        <p className="text-xs text-green-300">Safe</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* All Students List (for Manual Mode) */}
                            {manualMode && result.allStudents.length > 0 && (
                                <Card className="bg-slate-800/30 border-slate-700">
                                    <CardHeader
                                        className="cursor-pointer"
                                        onClick={() => setExpandedSection(expandedSection === 'allStudents' ? null : 'allStudents')}
                                    >
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-sm text-white flex items-center gap-2">
                                                <Users className="w-4 h-4" />
                                                All Students ({result.allStudents.length}) - Select for Actions
                                            </CardTitle>
                                            {expandedSection === 'allStudents' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                        </div>
                                    </CardHeader>
                                    {expandedSection === 'allStudents' && (
                                        <CardContent>
                                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                                {result.allStudents.map((student) => (
                                                    <div key={student.uid} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg">
                                                        <div className="flex-1">
                                                            <p className="text-sm text-white font-medium">{student.name}</p>
                                                            <p className="text-xs text-gray-400">
                                                                {student.enrollmentId} • Session End: {student.sessionEndYear || 'N/A'} • Valid: {formatDate(student.validUntil)}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => toggleSoftBlockSelection(student.uid)}
                                                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedSoftBlock.has(student.uid)
                                                                    ? 'bg-orange-500 text-white'
                                                                    : 'bg-slate-700 text-gray-400 hover:bg-orange-500/20'
                                                                    }`}
                                                            >
                                                                <Lock className="w-3 h-3 inline mr-1" />
                                                                Soft
                                                            </button>
                                                            <button
                                                                onClick={() => toggleHardDeleteSelection(student.uid)}
                                                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedHardDelete.has(student.uid)
                                                                    ? 'bg-red-500 text-white'
                                                                    : 'bg-slate-700 text-gray-400 hover:bg-red-500/20'
                                                                    }`}
                                                            >
                                                                <Trash2 className="w-3 h-3 inline mr-1" />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    )}
                                </Card>
                            )}

                            {/* Auto Mode Results */}
                            {!manualMode && (
                                <>
                                    {/* Soft Block Section */}
                                    {result.eligibleForSoftBlock.length > 0 && (
                                        <Card className="bg-orange-900/10 border-orange-700/30">
                                            <CardHeader
                                                className="cursor-pointer"
                                                onClick={() => setExpandedSection(expandedSection === 'softBlock' ? null : 'softBlock')}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <CardTitle className="text-sm text-orange-400 flex items-center gap-2">
                                                        <Lock className="w-4 h-4" />
                                                        Students for Soft Block ({result.eligibleForSoftBlock.length})
                                                    </CardTitle>
                                                    {expandedSection === 'softBlock' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                </div>
                                            </CardHeader>
                                            {expandedSection === 'softBlock' && (
                                                <CardContent>
                                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                                        {result.eligibleForSoftBlock.map((student) => (
                                                            <div key={student.uid} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                                                                <div>
                                                                    <p className="text-sm text-white font-medium">{student.name}</p>
                                                                    <p className="text-xs text-gray-400">{student.enrollmentId} • {student.email}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <Badge className="bg-orange-500/20 text-orange-400 text-[10px]">
                                                                        {student.daysPastSoftBlock} days past
                                                                    </Badge>
                                                                    <p className="text-[10px] text-gray-500 mt-1">Session End: {student.sessionEndYear}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </CardContent>
                                            )}
                                        </Card>
                                    )}

                                    {/* Hard Delete Section */}
                                    {result.eligibleForHardDelete.length > 0 && (
                                        <Card className="bg-red-900/10 border-red-700/30">
                                            <CardHeader
                                                className="cursor-pointer"
                                                onClick={() => setExpandedSection(expandedSection === 'hardDelete' ? null : 'hardDelete')}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <CardTitle className="text-sm text-red-400 flex items-center gap-2">
                                                        <Trash2 className="w-4 h-4" />
                                                        Students for Hard Delete ({result.eligibleForHardDelete.length})
                                                    </CardTitle>
                                                    {expandedSection === 'hardDelete' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                </div>
                                            </CardHeader>
                                            {expandedSection === 'hardDelete' && (
                                                <CardContent>
                                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                                        {result.eligibleForHardDelete.map((student) => (
                                                            <div key={student.uid} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                                                                <div>
                                                                    <p className="text-sm text-white font-medium">{student.name}</p>
                                                                    <p className="text-xs text-gray-400">{student.enrollmentId} • {student.email}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <Badge className="bg-red-500/20 text-red-400 text-[10px]">
                                                                        {student.daysPastHardDelete} days past
                                                                    </Badge>
                                                                    <p className="text-[10px] text-gray-500 mt-1">Session End: {student.sessionEndYear}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </CardContent>
                                            )}
                                        </Card>
                                    )}
                                </>
                            )}

                            {/* Execute Section */}
                            {((manualMode && (selectedSoftBlock.size > 0 || selectedHardDelete.size > 0)) ||
                                (!manualMode && (result.eligibleForSoftBlock.length > 0 || result.eligibleForHardDelete.length > 0))) && (
                                    <Card className="bg-red-900/20 border-red-700/50">
                                        <CardContent className="p-4">
                                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                                <div className="flex items-start gap-3">
                                                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                                    <div>
                                                        <p className="text-red-300 font-medium text-sm">Execute Actions</p>
                                                        <p className="text-red-300/70 text-xs mt-1">
                                                            This will perform the selected soft blocks and/or hard deletions.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-3">
                                                    {/* Confirm Hard Delete Checkbox */}
                                                    {((manualMode && selectedHardDelete.size > 0) ||
                                                        (!manualMode && result.eligibleForHardDelete.length > 0)) && (
                                                            <label className="flex items-center gap-2 p-2 bg-red-900/30 border border-red-700/50 rounded-lg cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={confirmHardDelete}
                                                                    onChange={(e) => setConfirmHardDelete(e.target.checked)}
                                                                    className="w-4 h-4 rounded border-red-500 text-red-600 focus:ring-red-500"
                                                                />
                                                                <div>
                                                                    <span className="text-red-300 text-xs font-medium">CONFIRM HARD DELETE</span>
                                                                    <p className="text-red-400/70 text-[10px]">Required to delete accounts</p>
                                                                </div>
                                                            </label>
                                                        )}

                                                    <Button
                                                        onClick={executeActions}
                                                        disabled={executing}
                                                        className="bg-red-600 hover:bg-red-500 text-white"
                                                    >
                                                        {executing ? (
                                                            <>
                                                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                                                Executing...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Play className="w-4 h-4 mr-2" />
                                                                Execute Actions
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                            {/* Execution Result */}
                            {executionResult && (
                                <Card className={executionResult.success ? 'bg-green-900/20 border-green-700/50' : 'bg-red-900/20 border-red-700/50'}>
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            {executionResult.success ? (
                                                <CheckCircle2 className="w-5 h-5 text-green-400" />
                                            ) : (
                                                <XCircle className="w-5 h-5 text-red-400" />
                                            )}
                                            <span className={`font-medium ${executionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                                                {executionResult.success ? 'Execution Complete' : 'Execution Failed'}
                                            </span>
                                        </div>
                                        {executionResult.executionResults && (
                                            <div className="text-sm text-gray-300 mb-2">
                                                <p>Soft Blocked: {executionResult.executionResults.softBlocked}</p>
                                                <p>Hard Deleted: {executionResult.executionResults.hardDeleted}</p>
                                            </div>
                                        )}
                                        {executionResult.executionResults?.errors?.length > 0 && (
                                            <div className="text-xs text-red-400 mt-2">
                                                {executionResult.executionResults.errors.map((err: string, i: number) => (
                                                    <p key={i}>{err}</p>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* Errors */}
                            {result?.errors && result.errors.length > 0 && (
                                <Card className="bg-red-900/20 border-red-700/50">
                                    <CardContent className="p-4">
                                        <p className="text-red-400 font-medium text-sm mb-2">Errors</p>
                                        {result.errors.map((err, i) => (
                                            <p key={i} className="text-red-300 text-xs">{err}</p>
                                        ))}
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )
                }

                {/* No Results State */}
                {
                    !result && !scanning && (
                        <Card className="bg-slate-800/30 border-slate-700">
                            <CardContent className="p-8 text-center">
                                <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-400 text-sm">Set a date and click "Scan Students" to see which students would be affected</p>
                                <p className="text-gray-500 text-xs mt-2">
                                    Soft Block: When simYear == sessionEndYear && date ≥ soft block date<br />
                                    Hard Delete: When simYear ≥ sessionEndYear + 1 && date ≥ hard delete date
                                </p>
                            </CardContent>
                        </Card>
                    )
                }


                {/* Footer */}
                <div className="flex justify-center gap-4 text-xs">
                    <Link href="/admin/cron-jobs" className="text-gray-400 hover:text-white transition-colors">
                        ← Back to Cron Jobs
                    </Link>
                    <span className="text-gray-600">|</span>
                    <Link href="/admin" className="text-gray-400 hover:text-white transition-colors">
                        Admin Dashboard
                    </Link>
                </div>
            </div >
        </div >
    );
}
