"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
	Calendar,
	CheckCircle2,
	Clock,
	History,
	Loader2,
	RotateCcw,
	Route,
	Shield,
	User,
	Users,
	XCircle
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";
import { toast } from "react-hot-toast";

// ============================================
// TYPES
// ============================================

type ReassignmentType = "driver_reassignment" | "student_reassignment" | "route_reassignment" | "rollback" | "all";
type ReassignmentStatus = "pending" | "committed" | "rolled_back" | "failed" | "no-op";

interface ChangeRecord {
    docPath: string;
    collection: string;
    docId: string;
    before: Record<string, any> | null;
    after: Record<string, any> | null;
}

interface ReassignmentLog {
    id: string;
    operation_id: string;
    type: ReassignmentType;
    actor_id: string;
    actor_label: string;
    logged_at: string;
    status: ReassignmentStatus;
    summary: string | null;
    changes: ChangeRecord[];
    meta: Record<string, any>;
    rollback_of: string | null;
    created_at: string;
}

interface ReassignmentHistoryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultType?: ReassignmentType;
    onRefresh?: () => void;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const getTypeIcon = (type: ReassignmentType) => {
    switch (type) {
        case "driver_reassignment":
            return <User className="w-5 h-5" />;
        case "student_reassignment":
            return <Users className="w-5 h-5" />;
        case "route_reassignment":
            return <Route className="w-5 h-5" />;
        case "rollback":
            return <RotateCcw className="w-5 h-5" />;
        default:
            return <History className="w-5 h-5" />;
    }
};

const getTypeLabel = (type: ReassignmentType) => {
    switch (type) {
        case "driver_reassignment":
            return "Driver";
        case "student_reassignment":
            return "Student";
        case "route_reassignment":
            return "Route";
        case "rollback":
            return "Rollback";
        default:
            return "All";
    }
};

const getTypeGradient = (type: ReassignmentType) => {
    switch (type) {
        case "driver_reassignment":
            return "from-blue-500/20 to-indigo-500/20";
        case "student_reassignment":
            return "from-emerald-500/20 to-teal-500/20";
        case "route_reassignment":
            return "from-orange-500/20 to-amber-500/20";
        case "rollback":
            return "from-rose-500/20 to-red-500/20";
        default:
            return "from-zinc-500/20 to-zinc-600/20";
    }
};

const getStatusBadge = (status: ReassignmentStatus) => {
    switch (status) {
        case "committed":
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Committed
                </div>
            );
        case "rolled_back":
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Rolled Back
                </div>
            );
        case "failed":
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-medium">
                    <XCircle className="w-3.5 h-3.5" />
                    Failed
                </div>
            );
        case "pending":
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Pending
                </div>
            );
        default:
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-500/10 border border-zinc-500/20 text-zinc-400 text-[11px] font-medium">
                    {status}
                </div>
            );
    }
};

const formatActorLabel = (label: string) => {
    // If format is already correct, return it
    if (
        label.includes(" (Admin)") ||
        label.includes(" (DB-") ||
        label.includes(" (MB-") ||
        label.includes(" (Moderator)") ||
        /\(.*\)/.test(label) // Any parenthesized role/ID
    ) {
        return label;
    }

    // Try to parse legacy "Name (UID...)" format
    const match = label.match(/^(.+?)\s*\(/);
    if (match) {
        return `${match[1]} (Admin)`;
    }

    // If no context, return as is (don't guess blindly)
    return label;
};

const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
};

const formatRelative = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 60000) return "Just now";
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return formatTime(dateStr);
};


// ============================================
// MAIN COMPONENT
// ============================================

export function ReassignmentHistoryModal({
    open,
    onOpenChange,
    defaultType = "all",
    onRefresh
}: ReassignmentHistoryModalProps) {
    const { currentUser, userData } = useAuth();
    const [logs, setLogs] = useState<ReassignmentLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [rollingBack, setRollingBack] = useState<string | null>(null);

    const isAdmin = userData?.role === "admin";
    const gradient = getTypeGradient(defaultType);

    // Fetch logs
    const fetchLogs = useCallback(async () => {
        if (!currentUser) return;

        setLoading(true);
        try {
            const token = await currentUser.getIdToken();
            const params = new URLSearchParams({ limit: "50" });
            if (defaultType !== "all") {
                params.set("type", defaultType);
            }

            const response = await fetch(`/api/reassignment-logs?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store'
            });

            if (!response.ok) throw new Error("Failed to fetch logs");

            const data = await response.json();
            setLogs(data.data || data.logs || []);
        } catch (error) {
            console.error("Error fetching logs:", error);
            toast.error("Failed to load history");
        } finally {
            setLoading(false);
        }
    }, [currentUser, defaultType]);

    useEffect(() => {
        if (open) fetchLogs();
    }, [open, fetchLogs]);

    const handleRollback = async (operationId: string) => {
        if (!currentUser || !isAdmin) {
            toast.error("Only admins can perform rollback");
            return;
        }

        setRollingBack(operationId);
        try {
            const token = await currentUser.getIdToken();

            // Execute immediately without validation check (as per request)

            // Execute immediately without confirm dialog as requested

            // Execute
            const rollbackRes = await fetch("/api/reassignment-logs/rollback", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    operationId,
                    actorId: currentUser.uid,
                    actorLabel: `${userData?.name || "Admin"} (Admin)`,
                }),
            });

            const rollbackData = await rollbackRes.json();
            if (rollbackData.success) {
                toast.success("Rollback successful");
                fetchLogs();
                onRefresh?.();
            } else {
                toast.error(rollbackData.message || "Rollback failed");
            }
        } catch (error) {
            console.error("Rollback error:", error);
            toast.error("Rollback failed");
        } finally {
            setRollingBack(null);
        }
    };

    const latestLog = logs.length > 0 ? logs[0] : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>

            <DialogContent className="max-w-lg z-[100] mt-6 max-h-[90vh] flex flex-col bg-zinc-950/95 backdrop-blur-xl border-zinc-800 shadow-2xl p-0 gap-0 overflow-hidden ring-1 ring-white/10" showCloseButton={false}>

                {/* Header Section */}
                <div className={cn(
                    "relative px-5 py-4 shrink-0 border-b border-zinc-800/50",
                    // Subtle matching theme gradient
                    "bg-gradient-to-r from-zinc-900 via-purple-900/10 to-zinc-900"
                )}>
                    {/* Close Button Custom */}
                    <button
                        onClick={() => onOpenChange(false)}
                        className="absolute top-4 right-4 p-2 rounded-full hover:bg-black/20 hover:cursor-pointer text-zinc-400 hover:text-white transition-colors"
                    >
                        <XCircle className="w-5 h-5" />
                    </button>

                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3 text-lg font-bold text-white tracking-tight">
                            <div className="p-2 bg-black/30 rounded-lg ring-1 ring-white/10 backdrop-blur-md shadow-lg">
                                {getTypeIcon(defaultType)}
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                                <span>{getTypeLabel(defaultType)} History</span>
                                <Badge variant="outline" className="bg-black/20 border-white/10 text-zinc-400 font-normal text-[9px] px-1.5 h-4">
                                    LOGS & ROLLBACK
                                </Badge>
                            </div>
                        </DialogTitle>

                    </DialogHeader>
                </div>

                {/* Content Body */}
                {/* Content Body - Scrollable */}
                <div className="p-5 overflow-y-auto bg-gradient-to-b from-zinc-900/50 to-zinc-950">
                    {loading ? (
                        <div className="h-48 flex flex-col items-center justify-center gap-3">
                            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                            <p className="text-sm text-zinc-500 animate-pulse">Retrieving logs...</p>
                        </div>
                    ) : !latestLog ? (
                        <div className="h-48 flex flex-col items-center justify-center text-center gap-3 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/30">
                            <div className="p-3 rounded-full bg-zinc-800/50">
                                <History className="w-6 h-6 text-zinc-600" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-zinc-400">No Operations Found</p>
                                <p className="text-xs text-zinc-600">History will appear here after your first action</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Card: Main Operation Info */}
                            <div className="relative group">
                                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="relative bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 transition-colors rounded-2xl p-5 shadow-lg">

                                    {/* Status Row */}
                                    <div className="flex items-center justify-between mb-4">
                                        {getStatusBadge(latestLog.status)}
                                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 bg-zinc-950/50 px-2 py-1 rounded-md border border-zinc-800/50">
                                            <Calendar className="w-3 h-3" />
                                            {formatRelative(latestLog.created_at)}
                                        </div>
                                    </div>

                                    {/* Summary Text */}
                                    <h3 className="text-base font-semibold text-zinc-100 leading-snug mb-3">
                                        {latestLog.summary || "Manual adjustment operation committed"}
                                    </h3>

                                    {/* Actor & Time */}
                                    <div className="flex items-center gap-4 text-xs text-zinc-400 pt-3 border-t border-zinc-800/50">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1 rounded-full bg-zinc-800">
                                                <Shield className="w-3 h-3 text-indigo-400" />
                                            </div>
                                            <span className="font-medium text-zinc-300">
                                                {formatActorLabel(latestLog.actor_label)}
                                            </span>
                                        </div>
                                        <div className="w-px h-3 bg-zinc-800" />
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-3 h-3" />
                                            <span>{formatTime(latestLog.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Detailed Changes Table */}
                            {latestLog.meta?.stagingSnapshot && Array.isArray(latestLog.meta.stagingSnapshot) && latestLog.meta.stagingSnapshot.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
                                        <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-widest">Changes</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
                                    </div>

                                    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 overflow-hidden">
                                        <table className="w-full text-xs text-left">
                                            <thead>
                                                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                                                    <th className="px-3 py-2 text-zinc-500 font-medium">Driver</th>
                                                    <th className="px-3 py-2 text-zinc-500 font-medium text-center">Action</th>
                                                    <th className="px-3 py-2 text-zinc-500 font-medium">Change</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-800/50">
                                                {latestLog.meta.stagingSnapshot.map((op: any, index: number) => (
                                                    <tr key={index} className="group hover:bg-zinc-800/30 transition-colors">
                                                        <td className="px-3 py-2.5">
                                                            <div className="font-medium text-zinc-300">{op.driverName || "Unknown"}</div>
                                                            <div className="text-[10px] text-zinc-500">{op.driverCode || op.driverId}</div>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <div className={cn(
                                                                "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium",
                                                                op.type === "assign" ? "bg-emerald-500/10 text-emerald-500" :
                                                                    op.type === "swap" ? "bg-amber-500/10 text-amber-500" :
                                                                        "bg-indigo-500/10 text-indigo-500"
                                                            )}>
                                                                {op.type === "assign" && "Assigned"}
                                                                {op.type === "swap" && "Swapped"}
                                                                {op.type === "markReserved" && "Reserved"}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <div className="flex flex-col gap-0.5">
                                                                {op.type === "markReserved" ? (
                                                                    <div className="flex items-center gap-1.5 text-zinc-400">
                                                                        <span className="line-through text-zinc-600">{op.oldBusNumber || "No Bus"}</span>
                                                                        <span>→</span>
                                                                        <span className="text-amber-400">Reserved Pool</span>
                                                                    </div>
                                                                ) : op.type === "swap" ? (
                                                                    <div className="space-y-1">
                                                                        <div className="flex items-center gap-1.5 text-zinc-300">
                                                                            <span className="text-zinc-500">To:</span>
                                                                            <span>{op.busNumber}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
                                                                            <span className="text-zinc-600">Swap with:</span>
                                                                            <span>{op.swapDriverName || "None"}</span>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1.5 text-zinc-300">
                                                                        <span className="text-zinc-500">To:</span>
                                                                        <span>{op.busNumber}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Rollback Section */}
                            {isAdmin && latestLog.type !== "rollback" && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
                                        <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-widest">Actions</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
                                    </div>

                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    onClick={() => handleRollback(latestLog.operation_id)}
                                                    disabled={latestLog.status === "rolled_back" || rollingBack === latestLog.operation_id}
                                                    className={cn(
                                                        "w-full relative overflow-hidden group h-11 transition-all duration-300",
                                                        latestLog.status === "rolled_back"
                                                            ? "bg-amber-500/10 border border-amber-500/30 text-amber-400 cursor-not-allowed opacity-90"
                                                            : "bg-zinc-900 border border-zinc-800 hover:border-red-500/30 hover:bg-red-500/5 text-zinc-300 hover:text-red-400"
                                                    )}
                                                >
                                                    <span className="relative z-10 flex items-center justify-center gap-2 font-medium">
                                                        {latestLog.status === "rolled_back" ? (
                                                            <>
                                                                <RotateCcw className="w-4 h-4 text-amber-400 shrink-0" />
                                                                This operation has been rolled back
                                                            </>
                                                        ) : rollingBack === latestLog.operation_id ? (
                                                            <>
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                Rolling back...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <RotateCcw className="w-4 h-4 group-hover:-rotate-180 transition-transform duration-500" />
                                                                Rollback to Previous State
                                                            </>
                                                        )}
                                                    </span>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>
                                                    {latestLog.status === "rolled_back"
                                                        ? "This operation has already been rolled back"
                                                        : "Undo all changes made in this operation"}
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>

                                    {latestLog.status !== "rolled_back" && (
                                        <p className="text-[11px] text-center text-zinc-500">
                                            This will immediately revert changes to drivers, buses, and routes.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 shrink-0 bg-zinc-950 border-t border-zinc-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
                            System Active
                        </span>
                    </div>

                    <Button
                        variant="default"
                        size="sm"
                        onClick={fetchLogs}
                        disabled={loading}
                        className="h-8 bg-white text-black hover:bg-zinc-200 border-0 font-medium text-xs px-4"
                    >
                        {loading ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                        ) : (
                            <RotateCcw className="w-3 h-3 mr-1.5" />
                        )}
                        Refresh Status
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ReassignmentHistoryModal;
