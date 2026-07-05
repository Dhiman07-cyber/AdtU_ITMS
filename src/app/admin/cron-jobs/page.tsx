'use client';

/**
 * Admin Cron Jobs Testing Dashboard
 * 
 * A comprehensive page to test all cron jobs in the system.
 * ADMIN ONLY - requires admin authentication.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import {
    Play,
    RefreshCw,
    Shield,
    Calendar,
    Trash2,
    Users,
    Bell,
    CheckCircle2,
    XCircle,
    Clock,
    AlertTriangle,
    ChevronRight,
    Zap,
    Database,
    Mail,
    FileText,
    Settings,
    ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Define all cron jobs in the system with detailed info
const CRON_JOBS = [
    {
        id: 'cleanup-notifications',
        name: 'Notification Cleanup',
        endpoint: '/api/cron/cleanup-notifications',
        method: 'GET',
        schedule: 'Daily at 00:00 UTC',
        category: 'Maintenance',
        description: 'Deletes expired notifications and their read receipts from Firestore. Notifications with a cleanup period (1-7 days) are automatically removed after their expiry date.',
        details: [
            'Queries notifications where expiresAt < current midnight',
            'Deletes notification documents and associated read receipts',
            'Processes in batches to handle large volumes',
        ],
        icon: Bell,
        color: 'blue',
        safe: true,
    },
    {
        id: 'cleanup-swaps',
        name: 'Driver Swap Cleanup',
        endpoint: '/api/cron/cleanup-swaps',
        method: 'GET',
        schedule: 'Daily at 00:00 UTC',
        category: 'Maintenance',
        description: 'Manages driver swap request lifecycle - expires pending requests, ends accepted swaps, and cleans up old documents.',
        details: [
            'Expires pending requests past acceptance window',
            'Reverts accepted swaps that have passed their time period',
            'Deletes swap documents older than 7 days',
        ],
        icon: RefreshCw,
        color: 'purple',
        safe: true,
    },
    {
        id: 'expiry-check-main',
        name: 'Expiry Check (Main)',
        endpoint: '/api/cron/expiry-check?type=main',
        method: 'GET',
        schedule: 'October 23 at 00:00 UTC',
        category: 'Student Management',
        description: 'Main expiry check that notifies students whose bus service is about to expire. Sends renewal reminders via email and in-app notifications.',
        details: [
            'Queries students where validUntil is approaching',
            'Sends personalized renewal reminder emails',
            'Creates in-app notifications for affected students',
            'Updates student computed deadline fields',
        ],
        icon: Calendar,
        color: 'orange',
        safe: true,
    },
    {
        id: 'expiry-check-mid',
        name: 'Expiry Check (Mid-Month)',
        endpoint: '/api/cron/expiry-check?type=mid-june',
        method: 'GET',
        schedule: 'October 15 at 00:00 UTC',
        category: 'Student Management',
        description: 'Mid-month follow-up reminder for students who haven\'t renewed yet. A gentler reminder before the main deadline.',
        details: [
            'Checks students who received main reminder but haven\'t renewed',
            'Sends follow-up email with deadline urgency',
            'Lower priority than main check',
        ],
        icon: Mail,
        color: 'yellow',
        safe: true,
    },
    {
        id: 'cleanup-expired-students',
        name: 'Delete Expired Students',
        endpoint: '/api/cron/cleanup-expired-students',
        method: 'POST',
        schedule: 'August 31 at 00:00 UTC',
        category: 'Destructive',
        description: 'PERMANENTLY deletes student accounts that have not renewed by the hard deadline (60 days after soft block).',
        details: [
            '⚠️ Deletes Firebase Authentication account',
            '⚠️ Deletes Firestore student document',
            '⚠️ Deletes payment records from Supabase',
            '⚠️ Deletes profile images from Cloudinary',
            '❗ This action is IRREVERSIBLE',
        ],
        icon: Users,
        color: 'red',
        safe: false,
        warning: 'This action PERMANENTLY DELETES student accounts, all their data, and cannot be undone.',
    },
];

interface CronResult {
    id: string;
    success: boolean;
    data: any;
    error?: string;
    duration: number;
    timestamp: Date;
}

export default function AdminCronTestingPage() {
    const router = useRouter();
    const { userData, currentUser, loading } = useAuth();
    const [results, setResults] = useState<Record<string, CronResult>>({});
    const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());

    const [expandedJob, setExpandedJob] = useState<string | null>(null);

    // Redirect if not authenticated or not admin (after loading completes)

    const runCronJob = async (job: typeof CRON_JOBS[0]) => {
        if (!currentUser) return;

        const startTime = Date.now();
        setRunningJobs(prev => new Set([...prev, job.id]));

        try {
            const endpoint = job.endpoint;

            // Get admin token for authentication
            const token = await currentUser.getIdToken();

            // Use POST for manual triggering with admin auth
            // Most cron endpoints support POST for admin-triggered runs
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });

            const data = await response.json();
            const duration = Date.now() - startTime;

            setResults(prev => ({
                ...prev,
                [job.id]: {
                    id: job.id,
                    success: response.ok && data.success !== false,
                    data,
                    error: data.error,
                    duration,
                    timestamp: new Date(),
                },
            }));
        } catch (error: any) {
            const duration = Date.now() - startTime;
            setResults(prev => ({
                ...prev,
                [job.id]: {
                    id: job.id,
                    success: false,
                    data: null,
                    error: error.message || 'Request failed',
                    duration,
                    timestamp: new Date(),
                },
            }));
        } finally {
            setRunningJobs(prev => {
                const next = new Set(prev);
                next.delete(job.id);
                return next;
            });
        }
    };

    const getColorClasses = (color: string) => {
        const colors: Record<string, { bg: string; border: string; text: string; icon: string; glow: string }> = {
            blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', icon: 'bg-blue-500', glow: 'hover:shadow-blue-500/20' },
            purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', icon: 'bg-purple-500', glow: 'hover:shadow-purple-500/20' },
            orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', icon: 'bg-orange-500', glow: 'hover:shadow-orange-500/20' },
            yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', icon: 'bg-yellow-500', glow: 'hover:shadow-yellow-500/20' },
            red: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', icon: 'bg-red-500', glow: 'hover:shadow-red-500/20' },
            green: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', icon: 'bg-green-500', glow: 'hover:shadow-green-500/20' },
        };
        return colors[color] || colors.blue;
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'Maintenance': return <Database className="w-3 h-3" />;
            case 'Student Management': return <Users className="w-3 h-3" />;
            case 'Destructive': return <Trash2 className="w-3 h-3" />;
            case 'Finance': return <FileText className="w-3 h-3" />;
            default: return <Settings className="w-3 h-3" />;
        }
    };

    // Group jobs by category
    const groupedJobs = CRON_JOBS.reduce((acc, job) => {
        if (!acc[job.category]) acc[job.category] = [];
        acc[job.category].push(job);
        return acc;
    }, {} as Record<string, typeof CRON_JOBS>);

    // Show loading state
    if (loading || !userData) {
        return <PremiumPageLoader message="Loading Cron Dashboard..." subMessage="Preparing system automation..." />;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Link href="/admin">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white">
                                    <ArrowLeft className="w-4 h-4" />
                                </Button>
                            </Link>
                            <div className="p-2 bg-purple-500/20 rounded-xl border border-purple-500/30">
                                <Zap className="w-5 h-5 text-purple-400" />
                            </div>
                            <div>
                                <h1 className="text-xl md:text-2xl font-bold text-white">Cron Jobs Dashboard</h1>
                                <p className="text-xs text-gray-400">Maintain and monitor scheduled system tasks</p>
                            </div>
                        </div>
                    </div>

                    <Link href="/admin/deadline-testing">
                        <Button className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white">
                            <Calendar className="w-4 h-4 mr-2" />
                            Deadline Simulation
                        </Button>
                    </Link>
                </div>

                {/* Warning Banner */}
                <Card className="bg-amber-900/20 border-amber-700/50">
                    <CardContent className="p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-amber-300 font-medium text-sm">Production Environment Warning</p>
                            <p className="text-amber-300/70 text-xs mt-1">
                                Running these cron jobs will execute their actual functionality. Some jobs send emails, delete data, or modify records.
                                Review each job's description and details before running.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Jobs by Category */}
                {Object.entries(groupedJobs).map(([category, jobs]) => (
                    <div key={category} className="space-y-3">
                        {/* Category Header */}
                        <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${category === 'Destructive' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700/50 text-gray-400'}`}>
                                {getCategoryIcon(category)}
                            </div>
                            <h2 className={`text-sm font-semibold ${category === 'Destructive' ? 'text-red-400' : 'text-gray-300'}`}>
                                {category}
                            </h2>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-600 text-gray-500">
                                {jobs.length} job{jobs.length > 1 ? 's' : ''}
                            </Badge>
                        </div>

                        {/* Job Cards */}
                        <div className="grid gap-3">
                            {jobs.map((job) => {
                                const colors = getColorClasses(job.color);
                                const isRunning = runningJobs.has(job.id);
                                const result = results[job.id];
                                const Icon = job.icon;
                                const isExpanded = expandedJob === job.id;

                                return (
                                    <Card
                                        key={job.id}
                                        className={`${colors.bg} border ${colors.border} ${colors.glow} hover:shadow-lg transition-all duration-300`}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                                {/* Left: Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start gap-3">
                                                        <div className={`p-2.5 ${colors.icon} rounded-xl flex-shrink-0`}>
                                                            <Icon className="w-5 h-5 text-white" />
                                                        </div>

                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <h3 className="text-base font-semibold text-white">{job.name}</h3>
                                                                {!job.safe && (
                                                                    <Badge className="bg-red-500/30 text-red-400 border-red-500/50 text-[10px] px-1.5">
                                                                        DESTRUCTIVE
                                                                    </Badge>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                                                                <Clock className="w-3 h-3" />
                                                                <span>{job.schedule}</span>
                                                            </div>

                                                            <p className="text-gray-300 text-sm mt-2 leading-relaxed">
                                                                {job.description}
                                                            </p>

                                                            {/* Expandable Details */}
                                                            <button
                                                                onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                                                                className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                                            >
                                                                <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                                {isExpanded ? 'Hide details' : 'Show details'}
                                                            </button>

                                                            {isExpanded && (
                                                                <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-700">
                                                                    {job.details.map((detail, i) => (
                                                                        <p key={i} className={`text-xs ${detail.startsWith('⚠️') || detail.startsWith('❗') ? 'text-red-400' : 'text-gray-400'}`}>
                                                                            {detail}
                                                                        </p>
                                                                    ))}
                                                                    <div className="pt-2">
                                                                        <code className="text-[10px] bg-slate-800 px-2 py-1 rounded text-gray-500">
                                                                            {job.method} {job.endpoint}
                                                                        </code>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {job.warning && (
                                                                <div className="mt-3 p-2 bg-red-900/30 border border-red-700/50 rounded-lg">
                                                                    <p className="text-red-300 text-xs font-medium">⚠️ {job.warning}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Right: Actions */}
                                                <div className="flex flex-col gap-2 lg:min-w-[200px]">

                                                    {/* Run Button */}
                                                    <Button
                                                        onClick={() => runCronJob(job)}
                                                        disabled={isRunning}
                                                        className={`w-full ${isRunning
                                                            ? 'bg-slate-700 text-slate-400'
                                                            : job.safe
                                                                ? `${colors.icon} hover:opacity-90 text-white`
                                                                : 'bg-red-600 hover:bg-red-500 text-white'
                                                            }`}
                                                    >
                                                        {isRunning ? (
                                                            <>
                                                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                                                Running...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Play className="w-4 h-4 mr-2" />
                                                                Run Now
                                                            </>
                                                        )}
                                                    </Button>

                                                    {/* Result Display */}
                                                    {result && (
                                                        <div className={`p-3 rounded-xl ${result.success ? 'bg-green-900/30 border border-green-700/50' : 'bg-red-900/30 border border-red-700/50'}`}>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                {result.success ? (
                                                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                                                ) : (
                                                                    <XCircle className="w-4 h-4 text-red-400" />
                                                                )}
                                                                <span className={`text-xs font-medium ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                                                                    {result.success ? 'Success' : 'Failed'}
                                                                </span>
                                                                <span className="text-gray-500 text-[10px] ml-auto">{result.duration}ms</span>
                                                            </div>

                                                            {result.error && (
                                                                <p className="text-red-300 text-xs mt-1 line-clamp-2">{result.error}</p>
                                                            )}

                                                            {result.success && result.data && (
                                                                <p className="text-green-300/70 text-xs mt-1 line-clamp-2">
                                                                    {result.data.message || JSON.stringify(result.data).slice(0, 80)}
                                                                </p>
                                                            )}

                                                            <p className="text-gray-500 text-[10px] mt-2">
                                                                {result.timestamp.toLocaleTimeString()}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {/* Footer */}
                <Card className="bg-slate-800/30 border-slate-700">
                    <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="flex items-center gap-2 text-gray-400 text-xs">
                                <Shield className="w-4 h-4" />
                                <span>All cron jobs require admin authentication. Jobs are logged for audit purposes.</span>
                            </div>
                            <div className="flex gap-2">
                                <Link href="/admin">
                                    <Button variant="outline" size="sm" className="text-xs">
                                        Back to Dashboard
                                    </Button>
                                </Link>
                                <Link href="/admin/settings">
                                    <Button variant="outline" size="sm" className="text-xs">
                                        <Settings className="w-3 h-3 mr-1" />
                                        Settings
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
