"use client";

import { FullScreenLoader } from '@/components/LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { cn } from "@/lib/utils";
import { formatDateTimeShort } from '@/lib/utils/date-utils';
import {
	AlertCircle,
	Bell,
	Calendar,
	Check,
	CheckCircle2,
	ChevronsUpDown,
	CircleUser,
	Eye,
	Forward,
	GraduationCap,
	Loader2,
	Mail,
	MessageSquare,
	RefreshCw,
	Search,
	Truck,
	User,
	Users,
	X
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useMemo,useState } from 'react';

interface FeedbackEntry {
    id: string;
    user_id: string; // Contains Enrollment ID or Driver/Employee ID
    name: string;
    email: string;
    role: 'student' | 'driver';
    message: string;
    created_at: string;
    read: boolean;
    read_at?: string;
    read_by?: string;
    profile_url: string | null;
    enrollmentId?: string;
    semester?: string;
    faculty?: string;
    department?: string;
    forwarded?: boolean;
    bus_id?: string;
    bus_plate?: string;
}

interface DriverOption {
    id: string;
    name: string;
    employeeId: string;
    role: 'driver';
}

export default function ModeratorFeedbackPage() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();

    const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'driver'>('all');

    // View Modal State
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [selectedFeedback, setSelectedFeedback] = useState<FeedbackEntry | null>(null);
    const [markingAsRead, setMarkingAsRead] = useState(false);

    // Forward Modal State
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingFeedback, setForwardingFeedback] = useState<FeedbackEntry | null>(null);
    const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
    const [moderatorMessage, setModeratorMessage] = useState('Kindly look after this issue.');
    const [openCombobox, setOpenCombobox] = useState(false);
    const [drivers, setDrivers] = useState<DriverOption[]>([]);
    const [loadingRecipients, setLoadingRecipients] = useState(false);
    const [sendingForward, setSendingForward] = useState(false);

    // Verify Moderator Access
    useEffect(() => {
        if (!authLoading) {
            if (!currentUser) {
                router.push('/login');
            } else if (userData?.role !== 'moderator') {
                router.push('/dashboard');
            }
        }
    }, [currentUser, userData, authLoading, router]);

    const fetchFeedback = useCallback(async () => {
        if (!currentUser) return;

        try {
            setRefreshing(true);
            setError(null);
            const token = await currentUser.getIdToken();

            const response = await fetch('/api/feedback', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch feedback');
            }

            const data = await response.json();
            if (data.success) {
                setFeedback(data.items);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (err: any) {
            console.error('Error loading feedback:', err);
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [currentUser]);

    // Fetch feedback on mount and when user is ready
    useEffect(() => {
        if (currentUser && userData?.role === 'moderator') {
            fetchFeedback();
        }
    }, [currentUser, userData, fetchFeedback]);

    // Load drivers for forward modal (Moderators can only forward to Drivers)
    const loadDrivers = useCallback(async () => {
        if (!currentUser) return;
        setLoadingRecipients(true);

        try {
            const token = await currentUser.getIdToken();

            // Fetch drivers
            const driverResponse = await fetch('/api/drivers/get-all', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (driverResponse.ok) {
                const driverData = await driverResponse.json();
                if (driverData.success) {
                    const mappedDrivers = driverData.drivers.map((d: any) => ({
                        id: d.id,
                        name: d.name || d.fullName || 'Unknown',
                        employeeId: d.employeeId || d.driverId || 'N/A',
                        role: 'driver' as const
                    }));

                    // Natural sort by employee ID (DB-01, DB-02...)
                    mappedDrivers.sort((a: any, b: any) =>
                        a.employeeId.localeCompare(b.employeeId, undefined, { numeric: true, sensitivity: 'base' })
                    );

                    setDrivers(mappedDrivers);
                }
            }
        } catch (err) {
            console.error('Error loading drivers:', err);
        } finally {
            setLoadingRecipients(false);
        }
    }, [currentUser]);

    // Filtering Logic — memoized so searching/filtering doesn't rescan on every
    // unrelated re-render (modal opens, refresh spinner, etc.).
    const filteredFeedback = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return feedback.filter(item => {
            const matchesSearch =
                !q ||
                item.name.toLowerCase().includes(q) ||
                item.email.toLowerCase().includes(q) ||
                item.message.toLowerCase().includes(q) ||
                item.user_id.toLowerCase().includes(q);

            const matchesRole = roleFilter === 'all' || item.role === roleFilter;

            return matchesSearch && matchesRole;
        });
    }, [feedback, searchQuery, roleFilter]);

    const formatDate = formatDateTimeShort;

    const formatFullDate = (dateString: string) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    // Truncate message for preview
    const truncateMessage = (message: string, maxLength: number = 150) => {
        if (message.length <= maxLength) return message;
        return message.substring(0, maxLength).trim() + '...';
    };

    // Handle opening view modal
    const handleViewFeedback = async (item: FeedbackEntry) => {
        setSelectedFeedback(item);
        setViewModalOpen(true);

        // Mark as read if not already read
        if (!item.read) {
            await markAsRead(item.id);
        }
    };

    // Mark feedback as read
    const markAsRead = async (feedbackId: string) => {
        if (!currentUser) return;

        setMarkingAsRead(true);
        try {
            const token = await currentUser.getIdToken();
            const response = await fetch(`/api/feedback/${feedbackId}/mark-read`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                // Update local state
                setFeedback(prev => prev.map(f =>
                    f.id === feedbackId ? { ...f, read: true, read_at: new Date().toISOString() } : f
                ));
                // Update selected feedback if viewing
                if (selectedFeedback?.id === feedbackId) {
                    setSelectedFeedback(prev => prev ? { ...prev, read: true, read_at: new Date().toISOString() } : prev);
                }
            }
        } catch (err) {
            console.error('Error marking as read:', err);
        } finally {
            setMarkingAsRead(false);
        }
    };

    // Handle opening forward modal
    const handleOpenForwardModal = (item: FeedbackEntry) => {
        setForwardingFeedback(item);
        setSelectedRecipients([]);
        setModeratorMessage('Kindly look after this issue.');
        setForwardModalOpen(true);
        loadDrivers();
    };

    // Send forward notification via API (writes to PostgreSQL)
    const handleSendForward = async () => {
        if (!currentUser || !forwardingFeedback || selectedRecipients.length === 0 || !userData) {
            addToast('Please select at least one driver', 'error');
            return;
        }

        setSendingForward(true);
        try {
            // Build notification content
            const notificationContent = `📧 Original Feedback from ${forwardingFeedback.name} (${forwardingFeedback.role === 'student' ? 'Student' : 'Driver'}):\n\n"${forwardingFeedback.message}"\n\n---\n\n📝 Moderator's Note:\n${moderatorMessage}`;

            // Create sender object
            const sender = {
                userId: currentUser.uid,
                userName: userData.name || userData.fullName || 'Moderator',
                userRole: 'moderator' as const,
                employeeId: userData.employeeId || userData.empId
            };

            // Create target object for specific users
            const target = {
                type: 'specific_users' as const,
                specificUserIds: selectedRecipients
            };

            // Use API route to create notification (writes to PostgreSQL)
            const token = await currentUser.getIdToken();
            await fetch('/api/notifications/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: `Feedback Forwarded: ${forwardingFeedback.role === 'student' ? 'Student' : 'Driver'} Issue`,
                    content: notificationContent,
                    type: 'notice',
                    targetType: 'specific_users',
                    targetUserIds: selectedRecipients,
                    metadata: {
                        feedbackId: forwardingFeedback.id,
                        feedbackSenderName: forwardingFeedback.name,
                        feedbackSenderRole: forwardingFeedback.role,
                        feedbackBusId: forwardingFeedback.bus_id,
                        feedbackBusPlate: forwardingFeedback.bus_plate,
                        forwardedBy: currentUser.uid
                    }
                }),
            });

            // Mark as forwarded in our feedback system
            const response = await fetch(`/api/feedback/${forwardingFeedback.id}/mark-forwarded`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                // Update local state
                setFeedback(prev => prev.map(f =>
                    f.id === forwardingFeedback.id ? { ...f, forwarded: true } : f
                ));
            }

            addToast(`Notification sent successfully to ${selectedRecipients.length} ${selectedRecipients.length === 1 ? 'driver' : 'drivers'}!`, 'success');
            setForwardModalOpen(false);
        } catch (err: any) {
            console.error('Error sending notification:', err);
            addToast(err.message || 'Failed to send notification', 'error');
        } finally {
            setSendingForward(false);
        }
    };

    if (authLoading) {
        return <FullScreenLoader />;
    }

    return (
        <div className="mt-12 space-y-6">
            {/* Page Header */}
            <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-white truncate">Feedback Management</h1>

                    <Button
                        onClick={fetchFeedback}
                        disabled={refreshing}
                        className={cn(
                            "group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95",
                            refreshing && "opacity-70 cursor-not-allowed"
                        )}
                    >
                        <RefreshCw className={cn(
                            "mr-2 h-3.5 w-3.5 transition-transform duration-500",
                            refreshing ? "animate-spin text-purple-600" : "group-hover:rotate-180"
                        )} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </Button>
                </div>
                <p className="text-gray-600 dark:text-gray-400 mt-1 text-xs sm:text-sm">Manage and action user feedback submissions</p>
            </div>

            {/* Main Card - Darker background */}
            <Card className="bg-[#0d1117] border-gray-800/50">
                <CardContent className="pt-6 pb-6 px-4 sm:px-6">

                    {/* Search and Filters Row */}
                    <div className="flex flex-col md:flex-row gap-3 mb-6">
                        {/* Search Bar */}
                        <div className="relative w-full md:flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search by name, email, or message..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-10 text-sm w-full bg-[#161b22] border-gray-700 text-gray-200 placeholder:text-gray-500"
                            />
                        </div>

                        {/* Role Filters - Right Aligned */}
                        <div className="flex w-full md:w-auto gap-1 bg-[#161b22] p-1 rounded-lg border border-gray-700 md:ml-auto">
                            <button
                                onClick={() => setRoleFilter('all')}
                                className={`flex-1 md:flex-initial px-3 sm:px-4 py-2 rounded-md text-[10px] sm:text-xs font-medium transition-all ${roleFilter === 'all'
                                    ? 'bg-purple-600 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setRoleFilter('student')}
                                className={`flex-1 md:flex-initial px-3 sm:px-4 py-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${roleFilter === 'student'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                            >
                                <User className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                                Students
                            </button>
                            <button
                                onClick={() => setRoleFilter('driver')}
                                className={`flex-1 md:flex-initial px-3 sm:px-4 py-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${roleFilter === 'driver'
                                    ? 'bg-amber-600 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                            >
                                <Truck className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                                Drivers
                            </button>
                        </div>
                    </div>

                    {/* Error State */}
                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-2 text-sm mb-4">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    {/* Loading State */}
                    {(loading || refreshing) && feedback.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16">
                            <Loader2 className="h-10 w-10 animate-spin text-purple-500 mb-4" />
                            <p className="text-gray-400 text-sm">Loading feedback...</p>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && !error && filteredFeedback.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="h-14 w-14 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                <MessageSquare className="h-7 w-7 text-gray-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-300">No Feedback Found</h3>
                            <p className="text-gray-500 mt-1 text-sm max-w-xs text-center">
                                {searchQuery
                                    ? "No feedback matches your search criteria."
                                    : "There are no feedback submissions yet."}
                            </p>
                        </div>
                    )}

                    {/* Feedback Cards - Different/Darker background than main card */}
                    {!loading && filteredFeedback.length > 0 && (
                        <div className="space-y-4">
                            {filteredFeedback.map((item) => (
                                <div
                                    key={item.id}
                                    className="bg-[#1c2128] border border-gray-700/60 rounded-2xl p-5 transition-all duration-200 hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/5"
                                >
                                    {/* Header: Avatar, Name, Read Badge, Date, Role Badge */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            {/* Avatar */}
                                            <div className="relative">
                                                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center overflow-hidden border-2 border-gray-600">
                                                    {item.profile_url ? (
                                                        <Image
                                                            src={item.profile_url}
                                                            alt={item.name}
                                                            width={48}
                                                            height={48}
                                                            className="object-cover h-full w-full"
                                                        />
                                                    ) : (
                                                        <span className="text-lg font-bold text-white">
                                                            {item.name.charAt(0).toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Name and Read Status */}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-base font-bold text-white">{item.name}</h3>
                                                    {item.read ? null : (
                                                        <Badge className="bg-purple-500/20 text-purple-400 border-0 text-[10px] font-semibold px-2 py-0.5">
                                                            NEW
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                                    <Calendar className="h-3 w-3" />
                                                    {formatDate(item.created_at)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Role Badge */}
                                        <Badge
                                            className={`text-[9px] font-bold px-2 py-1 border-0 flex items-center justify-center text-center ${item.role === 'student'
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-amber-500 text-white'
                                                }`}
                                        >
                                            <div className="flex flex-col items-center leading-none gap-0.5">
                                                <span>{item.role === 'student' ? '+ STUDENT' : '+ DRIVER'}</span>
                                                <span>SUBMISSION</span>
                                            </div>
                                        </Badge>
                                    </div>

                                    {/* Info Row: ID and Email */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                        {/* Enrollment ID for students, Employee ID for drivers */}
                                        <div className="flex items-center gap-2.5 bg-[#0d1117] border border-gray-700/50 rounded-xl px-4 py-3">
                                            {item.role === 'student' && (
                                                <GraduationCap className="h-4 w-4 text-purple-400" />
                                            )}
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                                                    {item.role === 'student' ? 'ENROLLMENT ID' : 'EMPLOYEE ID'}
                                                </p>
                                                <p className="text-sm text-white font-mono font-medium">{item.user_id}</p>
                                            </div>
                                        </div>

                                        {/* Email */}
                                        <div className="flex items-center gap-2.5 bg-[#0d1117] border border-gray-700/50 rounded-xl px-4 py-3">
                                            <Mail className="h-4 w-4 text-purple-400" />
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">REGISTERED EMAIL</p>
                                                <p className="text-sm text-white font-medium truncate">{item.email}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Message Preview */}
                                    <div className="mb-4">
                                        <p className="text-sm text-gray-400 leading-relaxed italic break-all line-clamp-2">
                                            "{truncateMessage(item.message)}"
                                        </p>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => handleViewFeedback(item)}
                                            className="flex-1 h-10 text-xs font-medium bg-white hover:bg-gray-100 text-gray-900 border-0 rounded-xl"
                                        >
                                            <Eye className="h-3.5 w-3.5 mr-2" />
                                            View Complete Feedback
                                        </Button>
                                        <Button
                                            onClick={() => handleOpenForwardModal(item)}
                                            disabled={item.forwarded}
                                            className={`flex-1 h-10 text-xs font-bold transition-all rounded-xl ${item.forwarded
                                                ? 'bg-amber-500 text-black hover:bg-amber-500 opacity-100 cursor-default'
                                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                                        >
                                            <Forward className={`h-3.5 w-3.5 mr-2 ${item.forwarded ? 'hidden' : ''}`} />
                                            {item.forwarded ? 'Already Forwarded' : 'Forward Issue'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* View Feedback Modal */}
            <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
                <DialogContent
                    onWheel={(e) => e.stopPropagation()}
                    className="max-w-[95vw] sm:max-w-lg h-[90vh] sm:h-auto p-0 gap-0 rounded-2xl overflow-hidden bg-[#0A0C10] border-gray-800 shadow-2xl flex flex-col mt-4 md:mt-4"
                >
                    {selectedFeedback && (
                        <>
                            {/* Top Accent Line */}
                            <div className={`h-1 w-full ${selectedFeedback.role === 'student' ? 'bg-emerald-500' : 'bg-amber-500'}`} />

                            {/* Header Section */}
                            <div className="px-6 pt-6 pb-2 relative">
                                {/* Header content */}

                                <div className="flex items-start gap-5">
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div className={`h-16 w-16 rounded-full p-0.5 ${selectedFeedback.role === 'student' ? 'bg-emerald-500/20' : 'bg-amber-500/20'}`}>
                                            <div className="h-full w-full rounded-full overflow-hidden border-2 border-[#1c2128]">
                                                {selectedFeedback.profile_url ? (
                                                    <Image
                                                        src={selectedFeedback.profile_url}
                                                        alt={selectedFeedback.name}
                                                        width={64}
                                                        height={64}
                                                        className="object-cover h-full w-full"
                                                    />
                                                ) : (
                                                    <div className={`h-full w-full flex items-center justify-center bg-[#1c2128] ${selectedFeedback.role === 'student' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                        <span className="text-2xl font-bold">{selectedFeedback.name.charAt(0).toUpperCase()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* User Info */}
                                    <div className="flex-1 min-w-0 pt-1">
                                        <DialogTitle className="text-xl font-bold text-white mb-2 leading-none">
                                            {selectedFeedback.name}
                                        </DialogTitle>
                                        <DialogDescription className="sr-only">
                                            Feedback details and message content
                                        </DialogDescription>

                                        <div className="flex flex-wrap items-center gap-3">
                                            <Badge className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border-0 uppercase tracking-wide ${selectedFeedback.role === 'student'
                                                ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                                                : 'bg-amber-500 text-black hover:bg-amber-400'
                                                }`}>
                                                {selectedFeedback.role === 'student' ? 'Student' : 'Driver'}
                                            </Badge>

                                            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium my-0.5">
                                                <Mail className="h-3.5 w-3.5" />
                                                <span className="truncate max-w-[180px]">{selectedFeedback.email}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ID Metadata Box */}
                                <div className="mt-5 bg-[#161b22] rounded-lg border border-gray-800 p-3 flex items-center gap-3">
                                    {selectedFeedback.role === 'student' ? (
                                        <GraduationCap className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                                    ) : (
                                        <Truck className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                    )}
                                    <span className="text-xs text-slate-400 font-medium">
                                        {selectedFeedback.role === 'student' ? 'Enrollment ID:' : 'Employee ID:'}
                                    </span>
                                    <span className="text-sm font-mono text-slate-200 tracking-wide">
                                        {selectedFeedback.user_id}
                                    </span>
                                </div>

                                {/* Date/Time */}
                                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 pl-1">
                                    <Calendar className="h-3.5 w-3.5" />
                                    {formatFullDate(selectedFeedback.created_at)}
                                </div>
                            </div>

                            {/* Message Content */}
                            <div className="px-6 py-4 flex-1 min-h-0 sm:flex-none mb-4">
                                <div className="bg-[#161b22] border border-gray-800 rounded-2xl overflow-hidden h-full sm:h-auto sm:max-h-[35vh] flex flex-col">
                                    <div
                                        className="flex-1 overflow-y-auto custom-scrollbar overscroll-contain touch-pan-y p-4"
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <div className="text-[15px] leading-relaxed text-slate-300 font-normal whitespace-pre-wrap break-words">
                                            {selectedFeedback.message}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-5 bg-[#0d1117] border-t border-gray-800 flex justify-end gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => setViewModalOpen(false)}
                                    className="h-10 px-5 text-sm bg-transparent border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white rounded-lg transition-colors"
                                >
                                    <X className="h-4 w-4 mr-2" />
                                    Close
                                </Button>
                                <Button
                                    onClick={() => {
                                        setViewModalOpen(false);
                                        handleOpenForwardModal(selectedFeedback);
                                    }}
                                    disabled={selectedFeedback.forwarded}
                                    className={`h-10 px-5 text-sm border-0 rounded-lg shadow-lg transition-all font-bold ${selectedFeedback.forwarded
                                        ? 'bg-amber-500 text-black hover:bg-amber-500 opacity-100'
                                        : 'bg-[#4f46e5] hover:bg-[#4338ca] text-white shadow-indigo-500/20'}`}
                                >
                                    <Forward className={`h-4 w-4 mr-2 ${selectedFeedback.forwarded ? 'hidden' : ''}`} />
                                    {selectedFeedback.forwarded ? 'Already Forwarded' : 'Forward Issue'}
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog >

            <Dialog open={forwardModalOpen} onOpenChange={setForwardModalOpen}>
                <DialogContent
                    className="max-w-[95vw] sm:max-w-md h-[75vh] sm:h-auto p-0 rounded-2xl overflow-hidden bg-[#0d1117] border-gray-800 shadow-2xl flex flex-col mt-2 md:mt-2"
                >
                    <DialogHeader className="px-5 sm:px-6 pt-6 pb-4 border-b border-gray-800 bg-gradient-to-br from-blue-500/10 to-transparent">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                                <Bell className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-bold text-white">Send Notification</DialogTitle>
                                <DialogDescription className="text-xs text-gray-400 mt-0.5">
                                    Notify a Driver about this feedback
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div
                        className="px-5 sm:px-6 py-6 sm:py-4 space-y-6 sm:space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar overscroll-contain touch-pan-y"
                    >
                        {/* Recipient Selection (Premium ComboBox) */}
                        <div className="space-y-3">
                            <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                Select Driver
                            </Label>

                            <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={openCombobox}
                                        disabled={loadingRecipients}
                                        className="w-full justify-between h-12 bg-[#080b10] border-slate-800 hover:bg-[#0c0f16] text-slate-200 hover:text-white rounded-xl text-sm transition-all shadow-inner border-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-amber-400" />
                                            {selectedRecipients.length > 0 ? (
                                                <span className="font-semibold text-amber-100">
                                                    {selectedRecipients.length} Selected
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 font-medium">
                                                    {loadingRecipients ? "Loading drivers..." : "Select drivers..."}
                                                </span>
                                            )}
                                        </div>
                                        <ChevronsUpDown className="h-4 w-4 opacity-50 text-slate-400" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-[var(--radix-popover-trigger-width)] p-1.5 bg-[#05070a]/95 backdrop-blur-2xl border-slate-800 shadow-2xl rounded-2xl z-[9999] ring-1 ring-white/10"
                                    side="bottom"
                                    align="start"
                                    sideOffset={8}
                                >
                                    <Command className="bg-transparent">
                                        <div className="flex items-center border-b border-slate-800/50 px-3 py-1 mb-2">
                                            <Search className="h-4 w-4 text-slate-500 mr-2" />
                                            <CommandInput
                                                placeholder="Search by name or ID..."
                                                className="border-none focus:ring-0 bg-transparent text-slate-200 h-10 w-full placeholder:text-slate-600 text-sm"
                                            />
                                        </div>
                                        <CommandList
                                            className="max-h-[240px] overflow-y-auto custom-scrollbar touch-pan-y"
                                            onWheel={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <CommandEmpty className="py-6 text-center">
                                                <div className="flex flex-col items-center gap-2">
                                                    <Users className="h-8 w-8 text-slate-800" />
                                                    <p className="text-sm text-slate-600">No driver found</p>
                                                </div>
                                            </CommandEmpty>

                                            <CommandGroup heading={<span className="text-[10px] font-bold text-amber-500/80 uppercase tracking-widest px-2 mb-2 block">Drivers</span>}>
                                                {drivers.map((driver) => (
                                                    <CommandItem
                                                        key={driver.id}
                                                        value={driver.name + driver.employeeId}
                                                        onSelect={() => {
                                                            setSelectedRecipients(prev =>
                                                                prev.includes(driver.id)
                                                                    ? prev.filter(id => id !== driver.id)
                                                                    : [...prev, driver.id]
                                                            );
                                                        }}
                                                        className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 aria-selected:bg-amber-600/10 group hover:bg-[#0c0f16]"
                                                    >
                                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-all duration-200 ${selectedRecipients.includes(driver.id) ? 'bg-amber-600 border-amber-500 shadow-lg shadow-amber-600/30' : 'bg-slate-900 border-slate-800 group-hover:border-slate-700'}`}>
                                                            <CircleUser className={`h-5 w-5 ${selectedRecipients.includes(driver.id) ? 'text-white' : 'text-amber-500'}`} />
                                                        </div>
                                                        <div className="flex flex-col flex-1 min-w-0">
                                                            <span className={`font-semibold truncate text-sm ${selectedRecipients.includes(driver.id) ? 'text-white' : 'text-slate-200'}`}>{driver.name}</span>
                                                            <span className="text-[11px] text-slate-500/80 font-medium">{driver.employeeId}</span>
                                                        </div>
                                                        {selectedRecipients.includes(driver.id) && (
                                                            <div className="h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center border-2 border-slate-950">
                                                                <Check className="h-3 w-3 text-white" />
                                                            </div>
                                                        )}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Moderator Message */}
                        <div className="space-y-3">
                            <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                Your Message (Optional)
                            </Label>
                            <Textarea
                                value={moderatorMessage}
                                onChange={(e) => setModeratorMessage(e.target.value)}
                                placeholder="Add a note for the driver..."
                                className="min-h-[160px] sm:min-h-[100px] text-sm resize-none bg-[#1c2128] border-gray-700/50 text-gray-200 placeholder:text-gray-500 rounded-xl"
                            />
                            <p className="text-[10px] text-gray-500">
                                This message will be attached along with the original feedback.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="px-5 sm:px-6 py-4 border-t border-gray-800 bg-[#080b10]">
                        <div className="flex w-full gap-3">
                            <Button
                                variant="outline"
                                onClick={() => setForwardModalOpen(false)}
                                disabled={sendingForward}
                                className="flex-1 h-11 text-sm border-gray-700 text-gray-300 hover:bg-gray-800 rounded-xl"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSendForward}
                                disabled={sendingForward || selectedRecipients.length === 0}
                                className={`flex-1 h-11 text-sm rounded-xl shadow-lg transition-all font-bold ${forwardingFeedback?.forwarded
                                    ? 'bg-amber-500 text-black hover:bg-amber-500 opacity-100 cursor-default'
                                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20'}`}
                            >
                                {sendingForward ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Sending...
                                    </>
                                ) : forwardingFeedback?.forwarded ? (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Notified
                                    </>
                                ) : (
                                    <>
                                        <Bell className="h-4 w-4 mr-2" />
                                        Notify
                                    </>
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
