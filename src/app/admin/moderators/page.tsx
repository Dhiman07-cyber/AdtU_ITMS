"use client";

import { ExportButton } from '@/components/ExportButton';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { deleteModerator } from '@/lib/dataService';
import { exportToExcel } from '@/lib/export-helpers';
import { supabase } from '@/lib/supabase-client';
import { cn } from '@/lib/utils';
import { Edit,Eye,Filter,MoreHorizontal,Plus,RefreshCw,Search,Shield,Trash2 } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo,useCallback,useEffect,useMemo,useState } from 'react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import Avatar from '@/components/Avatar';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { formatDateDDMMYYYY } from '@/lib/utils/date-utils';

// Memoized table row — skips re-rendering for moderators whose data/handlers
// are unchanged, keeping search/filter typing smooth with a full page of rows.
const ModeratorRow = memo(function ModeratorRow({
  moderator,
  onDelete,
}: {
  moderator: any;
  onDelete: (id: string, name: string) => void;
}) {
  const joining = moderator.joiningDate || moderator.joinDate;
  const yearsLabel = (() => {
    if (!joining) return 'N/A';
    const joinDate = new Date(joining);
    const years = Math.floor((Date.now() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return years > 0 ? `${years} year${years > 1 ? 's' : ''}` : '< 1 year';
  })();
  const sinceLabel = (() => {
    if (!joining) return 'N/A';
    const d = new Date(joining);
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').join('-');
  })();
  const status = moderator.status || 'active';
  const isActive = status.toLowerCase() === 'active';

  return (
    <TableRow className="h-auto">
      <TableCell className="py-1.5">
        <div className="flex flex-row items-center gap-2">
          <Avatar
            src={safeImageSrc(moderator.profilePhotoUrl)}
            name={moderator.name || moderator.fullName}
            size="xs"
            className="flex-shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{moderator.name || moderator.fullName || 'N/A'}</div>
            <div className="text-xs text-muted-foreground">{moderator.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="space-y-0.5">
          <div className="text-xs font-medium text-foreground">
            Ph: {moderator.phone || moderator.phoneNumber || 'N/A'}
          </div>
          {(moderator.alternatePhone || moderator.altPhone || moderator.alternativePhone) && (
            <div className="text-xs text-muted-foreground">
              Alt: {moderator.alternatePhone || moderator.altPhone || moderator.alternativePhone}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="font-mono text-[10px] text-foreground whitespace-nowrap">
          {moderator.employeeId || 'N/A'}
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="space-y-0.5">
          <div className="text-[10px] font-medium text-foreground">{yearsLabel}</div>
          <div className="text-[9px] text-muted-foreground">Since {sinceLabel}</div>
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="text-[10px] text-foreground truncate max-w-[150px]">
          {moderator.approvedBy || 'N/A'}
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${isActive ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
        </span>
      </TableCell>
      <TableCell className="py-1.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-7 w-7 p-0 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-gray-800 dark:bg-gray-900 border-gray-700 dark:border-gray-600 shadow-xl rounded-lg w-40">
            <DropdownMenuLabel className="text-white text-[11px] font-semibold px-2 py-1.5">Actions</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-600" />
            <DropdownMenuItem asChild>
              <Link href={`/admin/moderators/view/${moderator.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                <Eye className="mr-1.5 h-3 w-3 text-blue-400" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/moderators/edit/${moderator.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                <Edit className="mr-1.5 h-3 w-3 text-yellow-400" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/moderators/config/${moderator.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                <Shield className="mr-1.5 h-3 w-3 text-emerald-400" />
                Configuration
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-600" />
            <DropdownMenuItem
              className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 !text-white text-[11px] cursor-pointer transition-colors"
              onClick={() => onDelete(moderator.id, moderator.name)}
            >
              <Trash2 className="mr-1.5 h-3 w-3" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

export default function AdminModerators() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: moderators, loading: loadingModerators, refresh: refreshModerators } = useApiCollection('moderators', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc', autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when mutations occur in other pages
  useEventDrivenRefresh({
    collectionName: 'moderators',
    onRefresh: async () => {
      await refreshModerators();
    }
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string, name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('moderators');
      await refreshModerators();
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing moderators:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const isLoading = authLoading || loadingModerators;

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin') {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  // Real-time listeners handle data fetching automatically

  // Stable delete handler so memoized rows don't re-render on unrelated updates.
  const handleDeleteClick = useCallback((id: string, name: string) => {
    setDeleteItem({ id, name });
    setIsDialogOpen(true);
  }, []);

  // Memoized so it only recomputes when the data, search term, or filters change.
  const filteredModerators = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return moderators.filter(moderator => {
      const matchesSearch = !searchTerm ||
        (moderator.name && moderator.name.toLowerCase().includes(term)) ||
        (moderator.email && moderator.email.toLowerCase().includes(term)) ||
        (moderator.fullName && moderator.fullName.toLowerCase().includes(term)) ||
        (moderator.phone && moderator.phone.includes(searchTerm)) ||
        (moderator.phoneNumber && moderator.phoneNumber.includes(searchTerm)) ||
        (moderator.employeeId && moderator.employeeId.toLowerCase().includes(term)) ||
        (moderator.staffId && moderator.staffId.toLowerCase().includes(term));

      // Default to 'active' if status is missing
      const currentStatus = (moderator.status || 'active').toLowerCase();
      const matchesStatus = statusFilter === "all" || currentStatus === statusFilter.toLowerCase();

      let matchesExperience = true;
      if (experienceFilter !== "all") {
        const joinDateStr = moderator.joiningDate || moderator.joinDate;
        if (joinDateStr) {
          const joinDate = new Date(joinDateStr);
          const years = Math.floor((Date.now() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

          if (experienceFilter === "0-2") matchesExperience = years >= 0 && years <= 2;
          else if (experienceFilter === "3-5") matchesExperience = years >= 3 && years <= 5;
          else if (experienceFilter === "6-10") matchesExperience = years >= 6 && years <= 10;
          else if (experienceFilter === "10+") matchesExperience = years > 10;
        } else {
          matchesExperience = false;
        }
      }

      return matchesSearch && matchesStatus && matchesExperience;
    });
  }, [moderators, searchTerm, statusFilter, experienceFilter]);

  // Export moderators data from Supabase
  const handleExportModerators = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Fetch moderators from Supabase moderator_profiles or users table where role='moderator'
      let rawModerators: any[] = [];
      const { data: modProfiles, error: modError } = await supabase
        .from('moderator_profiles')
        .select('*');

      if (!modError && modProfiles && modProfiles.length > 0) {
        rawModerators = modProfiles;
      } else {
        const { data: userMods } = await supabase
          .from('users')
          .select('*')
          .eq('role', 'moderator');
        rawModerators = userMods || [];
      }

      const moderatorsData = rawModerators.map((moderator: any, index: number) => {
        return [
          (index + 1).toString(),
          moderator.full_name || moderator.name || 'N/A',
          moderator.email || 'N/A',
          moderator.phone || moderator.phoneNumber || 'N/A',
          moderator.employee_id || moderator.emp_id || 'N/A',
          moderator.faculty || moderator.assigned_faculty || 'N/A',
          moderator.approved_by || 'Admin',
          (moderator.status || 'active').charAt(0).toUpperCase() + (moderator.status || 'active').slice(1),
          moderator.joining_date || moderator.created_at ? formatDateDDMMYYYY(moderator.joining_date || moderator.created_at) : 'N/A'
        ];
      });

      // Add headers
      moderatorsData.unshift([
        'Sl No', 'Name', 'Email', 'Phone', 'Employee ID', 'Faculty', 'Approved By', 'Status', 'Joining Date'
      ]);

      // Add section header
      moderatorsData.unshift(['ALL MODERATORS REPORT (SUPABASE)'], ['']);

      await exportToExcel(moderatorsData, `ADTU_Moderators_Report_${dateStr}`, 'Moderators');

      addToast(
        `Exported ${rawModerators.length} moderators to ADTU_Moderators_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting moderators from Supabase:', error);
      addToast(
        'Failed to export moderators data. Please try again.',
        'error'
      );
    }
  };

  // Helper function to format date
  const formatDate = formatDateDDMMYYYY;

  if (isLoading && moderators.length === 0) {
    return <PremiumPageLoader message="Curating Moderator Directory..." subMessage="Fetching moderator profiles and status..." />;
  }

  if (!currentUser || !userData || userData.role !== 'admin') {
    return null;
  }

  const confirmDelete = async () => {
    if (!deleteItem) return;

    setIsDeleting(true);
    try {
      const success = await deleteModerator(deleteItem.id);
      if (success) {
        // Refresh data immediately after deletion
        invalidateCollectionCache('moderators');
        await refreshModerators();
        addToast(
          `Moderator ${deleteItem.name} deleted successfully`,
          'success'
        );
      } else {
        addToast(
          'Failed to delete moderator',
          'error'
        );
      }
    } catch (error) {
      console.error('Error deleting moderator:', error);
      addToast(
        'Error deleting moderator',
        'error'
      );
    } finally {
      setIsDeleting(false);
      setIsDialogOpen(false);
      setDeleteItem(null);
    }
  };

  const commonBtnClass = "group h-8 px-4 bg-white hover:bg-gray-50 text-gray-700 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  return (
    <div className="mt-12 space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Moderator Management</h1>
          <p className="text-muted-foreground mt-1">Manage all moderator accounts</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/moderators/add">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Moderator
            </Button>
          </Link>
          <ExportButton
            onClick={() => handleExportModerators()}
            label="EXPORT"
            className={commonBtnClass}
          />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={commonBtnClass}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            REFRESH
          </Button>
        </div>
      </div>

      <Card className="bg-gray-50 dark:bg-gray-900 border-border min-h-[480px] flex flex-col">
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search moderators..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs w-full"
                />
              </div>

              {/* Filters - Side by side on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

                <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Experience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Experience</SelectItem>
                    <SelectItem value="0-2" className="text-xs">0-2 years</SelectItem>
                    <SelectItem value="3-5" className="text-xs">3-5 years</SelectItem>
                    <SelectItem value="6-10" className="text-xs">6-10 years</SelectItem>
                    <SelectItem value="10+" className="text-xs">10+ years</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                    <SelectItem value="active" className="text-xs">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs">Inactive</SelectItem>
                  </SelectContent>
                </Select>

                {(experienceFilter !== "all" || statusFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setExperienceFilter("all");
                      setStatusFilter("all");
                    }}
                    className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Moderators list">
              <Table>
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="text-[11px] py-1.5">Moderator</TableHead>
                    <TableHead className="text-[11px] py-1.5">Phone</TableHead>
                    <TableHead className="text-[11px] py-1.5">Employee ID</TableHead>
                    <TableHead className="text-[11px] py-1.5">Years of Service</TableHead>
                    <TableHead className="text-[11px] py-1.5">Approved By</TableHead>
                    <TableHead className="text-[11px] py-1.5">Status</TableHead>
                    <TableHead className="text-[11px] py-1.5 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                {filteredModerators.length > 0 && (
                  <TableBody>
                    {filteredModerators.map((moderator, index) => (
                      <ModeratorRow
                        key={moderator.uid || moderator.id || `moderator-${index}`}
                        moderator={moderator}
                        onDelete={handleDeleteClick}
                      />
                    ))}
                  </TableBody>
                )}
              </Table>
              {filteredModerators.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[11px] text-gray-500 min-h-[220px]">
                  No moderators found
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Moderator</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteItem?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
              onClick={() => setIsDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700 font-medium min-w-[80px]"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <div className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                  <span>Deleting...</span>
                </div>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
