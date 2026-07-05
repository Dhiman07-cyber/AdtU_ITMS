"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/contexts/toast-context';
import { authApiFetch } from '@/lib/secure-api-client';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Target,
  Shield,
  FileText,
  Eye,
  X,
  Loader2,
  RefreshCw,
  ArrowUpDown,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  auditId: string;
  createdAt: string;
  expiresAt: string;
  category: string;
  action: string;
  summary: string;
  description: string;
  severity: string;
  performedBy: string;
  performedByName: string;
  performedByRole: string;
  performedAt: string;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  page: number;
  hasMore: boolean;
  pageSize: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'applications', label: 'Applications' },
  { value: 'renewals', label: 'Renewals' },
  { value: 'reassignments', label: 'Reassignments' },
  { value: 'additions', label: 'Additions' },
  { value: 'refinements', label: 'Refinements' },
  { value: 'system', label: 'System' },
];

const SEVERITY_CONFIG: Record<string, { label: string; className: string }> = {
  low: {
    label: 'Low',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  medium: {
    label: 'Medium',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  high: {
    label: 'High',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  admin: {
    label: 'Admin',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  moderator: {
    label: 'Moderator',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  system: {
    label: 'System',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  },
  student: {
    label: 'Student',
    className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  },
  driver: {
    label: 'Driver',
    className: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

// ─── Components ──────────────────────────────────────────────────────────────

function AuditCard({
  log,
  onViewDetails,
}: {
  log: AuditLog;
  onViewDetails: (log: AuditLog) => void;
}) {
  const severity = SEVERITY_CONFIG[log.severity] || SEVERITY_CONFIG.low;
  const role = ROLE_CONFIG[log.performedByRole] || ROLE_CONFIG.admin;

  return (
    <Card
      className="border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer group"
      onClick={() => onViewDetails(log)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge
                variant="outline"
                className={cn('text-[10px] font-medium border', severity.className)}
              >
                {severity.label}
              </Badge>
              <Badge
                variant="outline"
                className={cn('text-[10px] font-medium border', role.className)}
              >
                {role.label}
              </Badge>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">
                {log.category}
              </span>
            </div>

            <h4 className="text-sm font-medium text-zinc-100 truncate">
              {log.summary || formatAction(log.action)}
            </h4>

            {log.description && (
              <p className="text-xs text-zinc-400 mt-1 line-clamp-1">
                {log.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {log.performedByName || log.performedBy || '—'}
              </span>
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" />
                {log.targetName || log.targetType || '—'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(log.createdAt)}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[10px] text-zinc-500 font-mono">
              {formatTime(log.createdAt)}
            </span>
            <Eye className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailsDialog({
  log,
  open,
  onClose,
}: {
  log: AuditLog | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!log) return null;

  const severity = SEVERITY_CONFIG[log.severity] || SEVERITY_CONFIG.low;
  const role = ROLE_CONFIG[log.performedByRole] || ROLE_CONFIG.admin;

  const metadataEntries = Object.entries(log.metadata || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{log.summary || formatAction(log.action)}</DialogTitle>
          <DialogDescription className="text-xs">
            Audit ID: {log.auditId || log.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] font-medium border', severity.className)}>
              {severity.label} Severity
            </Badge>
            <Badge variant="outline" className={cn('text-[10px] font-medium border', role.className)}>
              {role.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-medium border bg-zinc-500/10 text-zinc-400 border-zinc-500/20">
              {log.category}
            </Badge>
          </div>

          {/* Description */}
          {log.description && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Description
              </label>
              <p className="text-sm text-zinc-300">{log.description}</p>
            </div>
          )}

          {/* Actor Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Performed By
              </label>
              <p className="text-sm text-zinc-300">{log.performedByName || '—'}</p>
              <p className="text-xs text-zinc-500 font-mono">{log.performedBy}</p>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Role
              </label>
              <p className="text-sm text-zinc-300 capitalize">{log.performedByRole}</p>
            </div>
          </div>

          {/* Target Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Target Type
              </label>
              <p className="text-sm text-zinc-300 capitalize">{log.targetType}</p>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Target Name
              </label>
              <p className="text-sm text-zinc-300">{log.targetName || '—'}</p>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
              Target ID
            </label>
            <p className="text-xs text-zinc-400 font-mono break-all">{log.targetId}</p>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Performed At
              </label>
              <p className="text-sm text-zinc-300">
                {formatDate(log.performedAt || log.createdAt)}
              </p>
              <p className="text-xs text-zinc-500 font-mono">
                {formatTime(log.performedAt || log.createdAt)}
              </p>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
                Expires At
              </label>
              <p className="text-sm text-zinc-300">{formatDate(log.expiresAt)}</p>
            </div>
          </div>

          {/* Document ID */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1">
              Document ID
            </label>
            <p className="text-xs text-zinc-400 font-mono break-all">{log.id}</p>
          </div>

          {/* Metadata */}
          {metadataEntries.length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-2">
                Metadata
              </label>
              <div className="rounded-md border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.06]">
                {metadataEntries.map(([key, value]) => (
                  <div key={key} className="px-3 py-2 flex items-start gap-3">
                    <span className="text-[11px] text-zinc-500 font-mono shrink-0 min-w-[100px]">
                      {key}
                    </span>
                    <span className="text-[11px] text-zinc-300 font-mono break-all whitespace-pre-wrap">
                      {formatMetadataValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-18 rounded-full" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminAuditLogsPage() {
  const { currentUser, userData, loading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Auth guard
  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
    } else if (userData && userData.role !== 'admin') {
      router.push(`/${userData.role}`);
    }
  }, [loading, currentUser, userData, router]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch logs
  const fetchLogs = useCallback(
    async (pageNum: number, refresh = false) => {
      if (!currentUser) return;
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const params = new URLSearchParams();
        params.set('page', String(pageNum));
        if (activeCategory !== 'all') params.set('category', activeCategory);
        if (severityFilter) params.set('severity', severityFilter);
        if (roleFilter) params.set('performedByRole', roleFilter);
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const response = await authApiFetch(currentUser, `/api/admin/audit-logs?${params.toString()}`);

        if (response.ok) {
          const data: AuditLogsResponse = await response.json();
          setLogs(data.logs);
          setHasMore(data.hasMore);
        } else {
          showToast('Failed to load audit logs', 'error');
        }
      } catch {
        showToast('Failed to load audit logs', 'error');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [currentUser, activeCategory, severityFilter, roleFilter, debouncedSearch, startDate, endDate, showToast]
  );

  useEffect(() => {
    if (currentUser && userData?.role === 'admin') {
      fetchLogs(page);
    }
  }, [currentUser, userData, page, fetchLogs]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [activeCategory, severityFilter, roleFilter, debouncedSearch, startDate, endDate]);

  const handleViewDetails = useCallback((log: AuditLog) => {
    setSelectedLog(log);
    setDetailsOpen(true);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchLogs(page, true);
  }, [fetchLogs, page]);

  if (loading || !currentUser || userData?.role !== 'admin') {
    return <PremiumPageLoader />;
  }

  return (
    <div className="space-y-4 pt-10 md:pt-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Audit Logs</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Business activity audit trail — admin only
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] text-zinc-400"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="border border-white/[0.06] bg-white/[0.02]">
        <CardContent className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <Input
                placeholder="Search actions, summaries, targets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-white/[0.03] border-white/[0.06] text-zinc-300 placeholder:text-zinc-600 focus-visible:border-blue-500/40"
              />
            </div>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs bg-white/[0.03] border-white/[0.06] text-zinc-300">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs bg-white/[0.03] border-white/[0.06] text-zinc-300">
                <SelectValue placeholder="Actor Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="moderator">Moderator</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-zinc-500" />
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[130px] h-8 text-xs bg-white/[0.03] border-white/[0.06] text-zinc-300 focus-visible:border-blue-500/40"
              />
              <span className="text-zinc-600 text-xs">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[130px] h-8 text-xs bg-white/[0.03] border-white/[0.06] text-zinc-300 focus-visible:border-blue-500/40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="all" value={activeCategory} onValueChange={setActiveCategory} className="w-full">
        <TabsList className="w-full flex flex-wrap gap-2 bg-transparent dark:bg-transparent h-auto p-0 mb-6 border-none">
          {CATEGORIES.map((cat) => (
            <TabsTrigger
              key={cat.value}
              value={cat.value}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 min-w-fit cursor-pointer data-[state=active]:bg-indigo-600 dark:data-[state=active]:bg-indigo-600 data-[state=active]:text-white dark:data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-500/25 bg-white/5 dark:bg-white/5 text-gray-400 dark:text-gray-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white dark:hover:text-white border-none"
            >
              {cat.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((cat) => (
          <TabsContent key={cat.value} value={cat.value}>
            {/* Audit List */}
            {isLoading ? (
              <LoadingSkeleton />
            ) : logs.length === 0 ? (
              <Card className="border border-white/[0.06] bg-white/[0.02]">
                <CardContent className="p-8 text-center">
                  <FileText className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm text-zinc-400">No audit logs found</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    {debouncedSearch || severityFilter || roleFilter || startDate || endDate
                      ? 'Try adjusting your filters'
                      : 'Business events will appear here'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <AuditCard
                    key={log.id}
                    log={log}
                    onViewDetails={handleViewDetails}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {!isLoading && logs.length > 0 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
                <p className="text-xs text-zinc-500">
                  Page {page} {hasMore ? `· ${logs.length} loaded` : `· ${logs.length} total`}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="h-7 px-2 text-xs border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] text-zinc-400 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasMore}
                    className="h-7 px-2 text-xs border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] text-zinc-400 disabled:opacity-30"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Details Dialog */}
      <DetailsDialog
        log={selectedLog}
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setSelectedLog(null);
        }}
      />
    </div>
  );
}
