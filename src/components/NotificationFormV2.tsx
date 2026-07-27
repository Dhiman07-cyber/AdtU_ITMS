"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import {
	NotificationType,
	TargetType,
	UserRole
} from '@/lib/notifications/types';
import {
	Bell,
	Clock,
	FileText,
	Loader2,
	Search,
	Send
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback,useEffect,useMemo,useState } from 'react';

import {
	NOTIFICATION_TEMPLATES,
	getTemplateByKey,
	insertDropoffSummary,
	type DropoffAssignment
} from '@/data/notification_templates';
import { getAllRoutes } from '@/lib/dataService';
import { Route } from '@/lib/types';
import {
	calculateExpiry
} from '@/lib/utils/enhancedDatePicker';
// The dropoff matrix is only rendered for the 'dropoff' notification type. Loading it
// lazily keeps it out of the form's initial parse/mount path so the Create dialog paints
// immediately on click instead of waiting on this subtree.
const DropoffMatrix = dynamic(() => import('./DropoffMatrix'), { ssr: false });

interface NotificationFormV2Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  mode?: 'create' | 'edit';
  initialData?: any;
  onEdit?: (id: string, updates: { title?: string, content: string, metadata?: any }) => Promise<void>;
}

// NOTIFICATION_TEMPLATES is a static constant — group it once at module load
// instead of running Object.entries().filter() three times on every render.
const NOTICE_TEMPLATE_ENTRIES = Object.entries(NOTIFICATION_TEMPLATES).filter(([, t]) => t.type === 'notice');
const PICKUP_TEMPLATE_ENTRIES = Object.entries(NOTIFICATION_TEMPLATES).filter(([, t]) => t.type === 'pickup');
const DROPOFF_TEMPLATE_ENTRIES = Object.entries(NOTIFICATION_TEMPLATES).filter(([, t]) => t.type === 'dropoff');

interface RouteOption {
  id: string;
  name: string;
  studentCount?: number;
}

interface UserOption {
  id: string;
  name: string;
  role: UserRole;
  email?: string;
  enrollmentId?: string;
}

export default function NotificationFormV2({ open, onClose, onSuccess, mode = 'create', initialData, onEdit }: NotificationFormV2Props) {
  const { currentUser, userData } = useAuth();
  const { addToast } = useToast();

  const [sending, setSending] = useState(false);
  const [targetType, setTargetType] = useState<TargetType>('all_users');
  const [targetRole, setTargetRole] = useState<UserRole | undefined>();
  const [selectedBuses, setSelectedBuses] = useState<string[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [targetShift, setTargetShift] = useState<'morning' | 'evening' | 'both' | undefined>();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [notificationType, setNotificationType] = useState<NotificationType>('notice');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('custom');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [specificUserRoleFilter, setSpecificUserRoleFilter] = useState<UserRole | undefined>();
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [expiryTime, setExpiryTime] = useState<string>('');
  const [expiryDays, setExpiryDays] = useState<string>("1");

  const [buses, setBuses] = useState<RouteOption[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [fullRoutes, setFullRoutes] = useState<Route[]>([]);
  const [fullBuses, setFullBuses] = useState<any[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [dropoffAssignments, setDropoffAssignments] = useState<DropoffAssignment[]>([]);
  // Dropoff-specific targeting
  const [dropoffTargetRole, setDropoffTargetRole] = useState<'all' | 'student' | 'driver'>('all');
  const [dropoffShift, setDropoffShift] = useState<'morning' | 'evening' | 'both'>('morning');

  const userRole = userData?.role as UserRole;

  // Stable element arrays for the template dropdown — built once so typing in
  // the title/message (which re-renders the whole form) doesn't recreate and
  // reconcile ~30 <SelectItem>s every keystroke.
  const templateItems = useMemo(() => ({
    notice: NOTICE_TEMPLATE_ENTRIES.map(([key, t]) => (
      <SelectItem key={key} value={key} className="py-1.5 text-xs pl-6">{t.title}</SelectItem>
    )),
    pickup: PICKUP_TEMPLATE_ENTRIES.map(([key, t]) => (
      <SelectItem key={key} value={key} className="py-1.5 text-xs pl-6">{t.title}</SelectItem>
    )),
    dropoff: DROPOFF_TEMPLATE_ENTRIES.map(([key, t]) => (
      <SelectItem key={key} value={key} className="py-1.5 text-xs pl-6">{t.title}</SelectItem>
    )),
  }), []);

  // Filter the specific-users list only when the list or query changes, not on
  // every form re-render.
  const filteredUsers = useMemo(
    () => users.filter(u =>
      u.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      u.enrollmentId?.toLowerCase().includes(userSearchQuery.toLowerCase())
    ),
    [users, userSearchQuery]
  );

  useEffect(() => {
    const days = parseInt(expiryDays);
    const expiryConfig = calculateExpiry(days);
    setExpiryDate(expiryConfig.date);
    setExpiryTime(expiryConfig.time);
  }, [expiryDays, notificationType]);

  // Pre-fill data for Edit Mode
  useEffect(() => {
    if (open && mode === 'edit' && initialData) {
      setTitle(initialData.title || '');
      setMessage(initialData.content || '');
      setNotificationType(initialData.type || 'notice');

      // Target
      if (initialData.target) {
        setTargetType(initialData.target.type || 'all_users');
        if (initialData.target.roleFilter) setTargetRole(initialData.target.roleFilter);
        if (initialData.target.shift) setTargetShift(initialData.target.shift === 'Morning' ? 'morning' : initialData.target.shift === 'Evening' ? 'evening' : 'both');
        if (initialData.target.busIds) setSelectedBuses(initialData.target.busIds);
        if (initialData.target.routeIds) setSelectedRoutes(initialData.target.routeIds);
        if (initialData.target.specificUserIds) setSelectedUsers(initialData.target.specificUserIds);
      }

      // Metadata / Matrix
      if (initialData.metadata) {
        if (initialData.metadata.matrix) {
          setDropoffAssignments(initialData.metadata.matrix);
        }
        setSelectedTemplate('custom');
      }
    }
  }, [open, mode, initialData]);

  useEffect(() => {
    if (open && currentUser && notificationType === 'dropoff') {
      if (fullRoutes.length === 0) loadFullRoutes();
      if (fullBuses.length === 0) loadFullBuses();
    }
  }, [open, currentUser, notificationType, fullRoutes.length, fullBuses.length]);

  useEffect(() => {
    if (open && currentUser) {
      if (userRole === 'driver') {
        const driverRoute = userData?.routeId || userData?.routeId;
        const driverBus = userData?.busId || userData?.busId;
        if (driverRoute) {
          setTargetType('route_based');
          setSelectedRoutes([driverRoute]);
        } else if (driverBus) {
          setTargetType('bus_based');
          setSelectedBuses([driverBus]);
        }
      }

      if (targetType === 'bus_based' || targetType === 'route_based' || targetType === 'specific_users') {
        loadOptions();
      }
    }
  }, [open, targetType, specificUserRoleFilter, currentUser, userRole, userData]);

  const loadFullBuses = useCallback(async () => {
    try {
      const token = await currentUser?.getIdToken();
      const res = await fetch('/api/buses', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch buses');
      const data = await res.json();
      const busData = (data.buses || []).map((bus: any) => ({
        id: bus.busId || bus.id,
        busId: bus.busId || bus.id,
        ...bus
      }));
      setFullBuses(busData.sort((a: any, b: any) => {
        const numA = parseInt((a.busId || a.id || '').replace(/\D/g, '') || '0');
        const numB = parseInt((b.busId || b.id || '').replace(/\D/g, '') || '0');
        return numA - numB;
      }));
    } catch (error) {
      console.error('Error loading full buses:', error);
    }
  }, [currentUser]);

  const loadFullRoutes = useCallback(async () => {
    try {
      const data = await getAllRoutes();
      setFullRoutes(data);
    } catch (error) {
      console.error('Error loading full routes:', error);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const token = await currentUser?.getIdToken();
      const headers = { 'Authorization': `Bearer ${token}` };

      if (targetType === 'bus_based') {
        const res = await fetch('/api/buses', { headers });
        if (!res.ok) throw new Error('Failed to fetch buses');
        const data = await res.json();
        const busData = (data.buses || []).map((bus: any) => ({
          id: bus.busId || bus.id,
          name: bus.busNumber || bus.plateNumber || bus.busId || bus.id,
          studentCount: bus.currentMembers ?? bus.currentPassengerCount ?? 0
        }));
        setBuses(busData.sort((a: any, b: any) => a.name.localeCompare(b.name)));
      }

      if (targetType === 'route_based') {
        const [routesRes, studentsRes] = await Promise.all([
          fetch('/api/routes', { headers }),
          fetch('/api/students', { headers })
        ]);
        if (!routesRes.ok) throw new Error('Failed to fetch routes');
        const routesRaw = await routesRes.json();
        const studentsRaw = studentsRes.ok ? await studentsRes.json() : [];

        const routeCounts: Record<string, number> = {};
        if (Array.isArray(studentsRaw)) {
          studentsRaw.forEach((s: any) => {
            const rid = s.routeId || s.routeId || '';
            if (rid) routeCounts[rid] = (routeCounts[rid] || 0) + 1;
          });
        }

        const routesData = (Array.isArray(routesRaw) ? routesRaw : []).map((r: any) => ({
          id: r.routeId || r.id,
          name: r.routeName || r.name || r.routeId || r.id,
          studentCount: routeCounts[r.routeId || r.id] || 0
        }));
        setRoutes(routesData.sort((a: any, b: any) => a.name.localeCompare(b.name)));
      }

      if (targetType === 'specific_users') {
        const rolesToLoad = specificUserRoleFilter ? [specificUserRoleFilter] :
          (userRole === 'driver' ? ['student'] : ['moderator', 'driver', 'student']) as UserRole[];

        const results = await Promise.all(rolesToLoad.map(async (role) => {
          const endpoint = role === 'student' ? '/api/students' : role === 'driver' ? '/api/drivers' : '/api/moderators';
          const res = await fetch(endpoint, { headers });
          if (!res.ok) return [];
          const data = await res.json();
          const items = Array.isArray(data) ? data : [];
          return items.map((item: any) => ({
            id: item.id || item.uid,
            name: item.name || item.fullName || 'Unknown',
            role: role,
            email: item.email,
            enrollmentId: item.enrollmentId || item.employeeId || item.driverId || item.staffId
          }));
        }));
        const usersData = results.flat();
        setUsers(usersData.sort((a: any, b: any) => a.name.localeCompare(b.name)));
      }
    } catch (error) {
      addToast('Error loading options', 'error');
    } finally {
      setLoadingOptions(false);
    }
  }, [targetType, specificUserRoleFilter, userRole, addToast, currentUser]);

  // Update message when dropoff assignments change
  useEffect(() => {
    if (notificationType === 'dropoff' && dropoffAssignments.length > 0) {
      if (mode === 'edit' && selectedTemplate === 'custom') {
        // In edit mode, we respect manual edits and don't overwrite with template
      } else {
        const template = NOTIFICATION_TEMPLATES[selectedTemplate] || NOTIFICATION_TEMPLATES.dropoff_arrangement;
        const updatedMessage = insertDropoffSummary(template.message, dropoffAssignments);
        setMessage(updatedMessage);
      }
    }
  }, [dropoffAssignments, notificationType, selectedTemplate, mode]);

  const resetForm = useCallback(() => {
    setTargetType('all_users');
    setTargetRole(undefined);
    setSelectedBuses([]);
    setSelectedRoutes([]);
    setTargetShift(undefined);
    setSelectedUsers([]);
    setNotificationType('notice');
    setTitle('');
    setMessage('');
    setSelectedTemplate('custom');
    setUserSearchQuery('');
    setSpecificUserRoleFilter(undefined);
    setExpiryDays("1");
    setDropoffAssignments([]);
    setDropoffTargetRole('student');
    setDropoffShift('morning');

    if (userRole === 'driver') {
      const driverRoute = userData?.routeId || userData?.routeId;
      const driverBus = userData?.busId || userData?.busId;
      if (driverRoute) {
        setTargetType('route_based');
        setSelectedRoutes([driverRoute]);
      } else if (driverBus) {
        setTargetType('bus_based');
        setSelectedBuses([driverBus]);
      }
    }
  }, [userRole, userData]);

  const handleDiscard = useCallback(() => {
    resetForm();
    onClose();
    addToast('Draft discarded and form reset', 'success');
  }, [resetForm, onClose, addToast]);

  const applyTemplate = useCallback((key: string) => {
    if (key === 'custom') {
      setSelectedTemplate('custom');
      setNotificationType('notice');
      setTitle('');
      setMessage('');
      setDropoffAssignments([]);
      return;
    }

    const employeeId = (userData as any)?.employeeId || (userData as any)?.driverId || 'STAFF';
    const template = getTemplateByKey(key, userData?.name || 'Staff', employeeId);

    if (template) {
      setSelectedTemplate(key);
      setNotificationType(template.type);
      setTitle(template.title);
      setMessage(template.message);

      // Reset matrix if not a dropoff template
      if (template.type !== 'dropoff') {
        setDropoffAssignments([]);
      }
    }
  }, [userData]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !message) {
      addToast('Please fill title and message', 'error');
      return;
    }
    setSending(true);

    try {
      if (mode === 'edit' && initialData && onEdit) {
        await onEdit(initialData.id, {
          title,
          content: message
        });
        addToast('Broadcast updated successfully!', 'success');
        onSuccess?.();
        onClose();
      } else {
        const token = await currentUser?.getIdToken();
        const expiryTimestamp = new Date(`${expiryDate}T${expiryTime}`).getTime();
        const response = await fetch('/api/notifications/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            type: notificationType,
            title, content: message,
            targetType: notificationType === 'dropoff' ? 'all_role' : targetType,
            targetRole: notificationType === 'dropoff' ? (userRole === 'driver' ? 'student' : (dropoffTargetRole === 'all' ? undefined : dropoffTargetRole)) : targetRole,
            targetShift: notificationType === 'dropoff' ? (userRole === 'driver' ? targetShift : dropoffShift) : targetShift,
            targetBusIds: notificationType === 'dropoff' ? undefined : (targetType === 'bus_based' ? selectedBuses : undefined),
            targetRouteIds: notificationType === 'dropoff' ? undefined : (targetType === 'route_based' ? selectedRoutes : undefined),
            targetUserIds: notificationType === 'dropoff' ? undefined : (targetType === 'specific_users' ? selectedUsers : undefined),
            expiryAt: expiryTimestamp,
            sendToAllRoles: notificationType === 'dropoff' && dropoffTargetRole === 'all' && userRole !== 'driver'
          })
        });
        const result = await response.json();
        if (result.success) {
          addToast('Broadcast sent successfully!', 'success');
          resetForm();
          onSuccess?.();
          onClose();
        } else addToast(result.error || 'Failed to send', 'error');
      }
    } catch (error) { addToast('Operation failed', 'error'); }
    finally { setSending(false); }
  }, [title, message, mode, initialData, onEdit, notificationType, targetType, targetRole, selectedBuses, selectedRoutes, selectedUsers, expiryDate, expiryTime, expiryDays, dropoffTargetRole, dropoffShift, currentUser, userRole, userData, addToast, onSuccess, onClose, resetForm]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        onWheel={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="max-w-[95vw] sm:max-w-[550px] lg:max-w-[800px] p-0 mt-5 overflow-hidden rounded-[20px] border border-slate-200/50 dark:border-slate-800/50 shadow-2xl bg-white dark:bg-slate-950 top-[50%] translate-y-[-50%] [&>button[data-slot=dialog-close]]:right-4 [&>button[data-slot=dialog-close]]:top-4 [&>button[data-slot=dialog-close]]:bg-slate-100 dark:[&>button[data-slot=dialog-close]]:bg-slate-800 [&>button[data-slot=dialog-close]]:rounded-full [&>button[data-slot=dialog-close]]:p-1.5 [&>button[data-slot=dialog-close]]:hover:bg-red-500 [&>button[data-slot=dialog-close]]:hover:text-white"
      >
        <DialogHeader className="p-0">
          <div className="relative px-5 py-4 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/30 dark:bg-slate-900/10">
            <div className="flex items-center justify-between relative z-10 pr-8">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm ${mode === 'edit' ? 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-500' : 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-500'}`}>
                  {mode === 'edit' ? <FileText className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </div>
                <div className="text-left space-y-0.5">
                  <DialogTitle className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                    {mode === 'edit' ? 'Edit Broadcast' : 'Create Broadcast'}
                  </DialogTitle>
                  <DialogDescription className="text-slate-500 dark:text-slate-400 text-[10px] font-medium">
                    {mode === 'edit' ? 'Refine your existing message & details' : 'Send campus-wide alerts efficiently'}
                  </DialogDescription>
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="px-5 pb-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar overscroll-none touch-pan-y pt-4"
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Section 1: Template & Target */}
          <div className="bg-slate-50/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/[0.05] rounded-2xl p-4 shadow-sm space-y-4">
            <div className={`grid grid-cols-1 ${userRole === 'driver' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em] ml-1">Message Template</Label>
                <Select value={selectedTemplate} onValueChange={applyTemplate}>
                  <SelectTrigger className="h-9 border-slate-200/60 dark:border-slate-800/50 bg-white dark:bg-slate-900/50 rounded-lg font-medium focus:ring-blue-500/20 transition-colors text-xs shadow-sm">
                    <SelectValue placeholder="Select Template" />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-slate-200 dark:border-slate-800 shadow-xl max-h-[350px] z-[100]">
                    <SelectItem value="custom" className="font-semibold italic py-1.5 text-xs">✏️ Custom Blank</SelectItem>

                    {/* Notice Templates */}
                    <div className="px-3 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30">Notices</div>
                    {templateItems.notice}

                    {/* Transit (Pickup) */}
                    <div className="px-3 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">Transit (Pickup)</div>
                    {templateItems.pickup}

                    {/* Dropoff (Matrix) */}
                    <div className="px-3 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">Dropoff (Matrix)</div>
                    {templateItems.dropoff}
                  </SelectContent>
                </Select>
              </div>

              {userRole !== 'driver' && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em] ml-1">Target Audience</Label>
                  <Select
                    value={targetType}
                    onValueChange={(v) => setTargetType(v as TargetType)}
                    disabled={notificationType === 'dropoff'}
                  >
                    <SelectTrigger className="h-9 border-slate-200/60 dark:border-slate-800/50 bg-white dark:bg-slate-900/50 rounded-lg font-medium focus:ring-blue-500/20 transition-colors text-xs shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 dark:border-slate-800 shadow-xl z-[100]">
                      <SelectItem value="all_users" className="py-1.5 text-xs">All Users</SelectItem>
                      <SelectItem value="all_role" className="py-1.5 text-xs">By Role</SelectItem>
                      <SelectItem value="shift_based" className="py-1.5 text-xs">By Shift</SelectItem>
                      <SelectItem value="bus_based" className="py-1.5 text-xs">By Bus</SelectItem>
                      <SelectItem value="route_based" className="py-1.5 text-xs">By Route</SelectItem>
                      <SelectItem value="specific_users" className="py-1.5 text-xs">Specific Users</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {userRole === 'driver' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em] ml-1">Target Audience</Label>
                    <div className="h-9 px-3 flex items-center border border-slate-200/60 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/30 rounded-lg font-medium text-xs shadow-sm text-slate-500 cursor-not-allowed">
                      {notificationType === 'dropoff' ? 'All Students' : 'Your Assigned Route'}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em] ml-1">Shift</Label>
                    <Select value={targetShift || 'morning'} onValueChange={(v) => setTargetShift(v as any)}>
                      <SelectTrigger className="h-9 border-slate-200/60 dark:border-slate-800/50 bg-white dark:bg-slate-900/50 rounded-lg font-medium text-xs shadow-sm focus:ring-blue-500/20 transition-colors">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg border-slate-200 dark:border-slate-800 shadow-xl z-[100]">
                        <SelectItem value="morning" className="py-1.5 text-xs font-semibold">Morning</SelectItem>
                        <SelectItem value="evening" className="py-1.5 text-xs">Evening</SelectItem>
                        <SelectItem value="both" className="py-1.5 text-xs">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Dynamic Target Selection */}
          {notificationType !== 'dropoff' && userRole !== 'driver' && (targetType === 'all_role' || targetType === 'shift_based' || targetType === 'bus_based' || targetType === 'route_based' || targetType === 'specific_users') && (
            <div className="bg-slate-50/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/[0.05] rounded-2xl p-4 shadow-sm animate-in fade-in duration-200">
              <div className="space-y-3">
                {targetType === 'all_role' && (
                  <div className="space-y-2">
                    <Label className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Select Target Roles</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {['moderator', 'driver', 'student'].map(r => (
                        <Button
                          key={r} type="button"
                          variant={targetRole === r ? 'default' : 'outline'}
                          className={`h-9 text-[11px] font-semibold rounded-lg border-slate-200 dark:border-slate-800 transition-colors ${targetRole === r ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25 border-transparent' : 'bg-white dark:bg-slate-950 hover:bg-slate-50 text-slate-600 dark:text-slate-400'}`}
                          onClick={() => setTargetRole(r as UserRole)}
                        >
                          {r.charAt(0).toUpperCase() + r.slice(1)}s
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {targetType === 'shift_based' && (
                  <div className="space-y-2">
                    <Label className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Select Target Shift</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'morning', label: 'Morning' },
                        { id: 'evening', label: 'Evening' },
                        { id: 'both', label: 'Both' }
                      ].map(s => (
                        <Button
                          key={s.id} type="button"
                          variant={targetShift === s.id ? 'default' : 'outline'}
                          className={`h-9 text-[11px] font-semibold rounded-lg border-slate-200 dark:border-slate-800 transition-colors ${targetShift === s.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25 border-transparent' : 'bg-white dark:bg-slate-950 hover:bg-slate-50 text-slate-600 dark:text-slate-400'}`}
                          onClick={() => setTargetShift(s.id as any)}
                        >
                          {s.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {targetType === 'bus_based' && (
                  <div className="space-y-2">
                    <Label className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Select Bus(es)</Label>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                      {buses.map(b => (
                        <div key={b.id} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm transition-colors hover:border-blue-200 dark:hover:border-blue-900/50">
                          <Checkbox id={b.id} checked={selectedBuses.includes(b.id)} onCheckedChange={c => c ? setSelectedBuses([...selectedBuses, b.id]) : setSelectedBuses(selectedBuses.filter(id => id !== b.id))} className="rounded-md h-3.5 w-3.5" />
                          <Label htmlFor={b.id} className="text-xs font-semibold flex-1 cursor-pointer text-slate-700 dark:text-slate-300">{b.name}</Label>
                          <Badge variant="secondary" className="bg-slate-50 dark:bg-slate-900 text-[9px] font-bold rounded-md px-1 py-0">{b.studentCount}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {targetType === 'route_based' && (
                  <div className="space-y-2">
                    <Label className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Select Route(s)</Label>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                      {routes.map(r => (
                        <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm transition-colors hover:border-blue-200 dark:hover:border-blue-900/50">
                          <Checkbox id={r.id} checked={selectedRoutes.includes(r.id)} onCheckedChange={c => c ? setSelectedRoutes([...selectedRoutes, r.id]) : setSelectedRoutes(selectedRoutes.filter(id => id !== r.id))} className="rounded-md h-3.5 w-3.5" />
                          <Label htmlFor={r.id} className="text-xs font-semibold flex-1 cursor-pointer text-slate-700 dark:text-slate-300">{r.name}</Label>
                          <Badge variant="secondary" className="bg-slate-50 dark:bg-slate-900 text-[9px] font-bold rounded-md px-1 py-0">{r.studentCount}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {targetType === 'specific_users' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input className="pl-8 h-8 text-xs border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950" placeholder="Search..." value={userSearchQuery} onChange={e => setUserSearchQuery(e.target.value)} />
                      </div>
                      <Select value={specificUserRoleFilter || 'all'} onValueChange={v => setSpecificUserRoleFilter(v === 'all' ? undefined : v as UserRole)}>
                        <SelectTrigger className="w-24 h-8 text-[11px] font-semibold border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950"><SelectValue placeholder="Role" /></SelectTrigger>
                        <SelectContent className="rounded-lg z-[100]"><SelectItem value="all">All</SelectItem><SelectItem value="driver">Drivers</SelectItem><SelectItem value="student">Students</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                      {filteredUsers.map(u => (
                        <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm">
                          <Checkbox id={u.id} checked={selectedUsers.includes(u.id)} onCheckedChange={c => c ? setSelectedUsers([...selectedUsers, u.id]) : setSelectedUsers(selectedUsers.filter(sid => sid !== u.id))} className="rounded-md h-3.5 w-3.5" />
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{u.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-slate-400 font-medium tracking-tight uppercase">{u.role} • {u.enrollmentId || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Title & Message */}
          <div className="bg-slate-50/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/[0.05] rounded-2xl p-4 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em] ml-1">Broadcast Title</Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="E.g., Urgent Update: Bus Delay"
                className="h-10 border-slate-200/60 dark:border-slate-800/50 rounded-lg font-semibold text-slate-800 dark:text-white bg-white dark:bg-slate-900/50 shadow-sm focus:ring-blue-500/10 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center ml-1">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-[0.1em]">Message Content</Label>
                <span className="text-[9px] font-bold text-slate-400">{message.length} chars</span>
              </div>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type your broadcast message clearly..."
                className="min-h-[130px] border-slate-200/60 dark:border-slate-800/50 rounded-lg text-xs leading-relaxed p-4 bg-white dark:bg-slate-900/50 shadow-sm focus:ring-blue-500/10 resize-none px-4"
                required
              />
            </div>

            {/* Dropoff Matrix Assignment Section - Only for general dropoff arrangement */}
            {notificationType === 'dropoff' && selectedTemplate !== 'dropoff_change' && selectedTemplate !== 'dropoff_delay' && (
              <div className="pt-2 animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
                {/* Dropoff Target Selection - Flat Grid */}
                {userRole !== 'driver' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[8px] sm:text-[9px] font-black uppercase text-slate-400 tracking-widest ml-0.5">Send To</Label>
                      <Select value={dropoffTargetRole} onValueChange={(v) => setDropoffTargetRole(v as any)}>
                        <SelectTrigger className="h-9 border-slate-200/60 dark:border-slate-800/50 bg-white dark:bg-slate-900/50 rounded-lg font-semibold text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg z-[100]">
                          <SelectItem value="all" className="py-1.5 text-xs font-semibold">All (Students + Drivers)</SelectItem>
                          <SelectItem value="student" className="py-1.5 text-xs">Students Only</SelectItem>
                          <SelectItem value="driver" className="py-1.5 text-xs">Drivers Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[8px] sm:text-[9px] font-black uppercase text-slate-400 tracking-widest ml-0.5">Shift</Label>
                      <Select value={dropoffShift} onValueChange={(v) => setDropoffShift(v as any)}>
                        <SelectTrigger className="h-9 border-slate-200/60 dark:border-slate-800/50 bg-white dark:bg-slate-900/50 rounded-lg font-semibold text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg z-[100]">
                          <SelectItem value="morning" className="py-1.5 text-xs font-semibold">Morning</SelectItem>
                          <SelectItem value="evening" className="py-1.5 text-xs">Evening</SelectItem>
                          <SelectItem value="both" className="py-1.5 text-xs">Both Shifts</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Matrix Header with Clear All */}
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-bold uppercase text-blue-500 tracking-[0.1em] ml-1">Dropoff Matrix Assignment</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDropoffAssignments([])}
                    className="h-6 px-2 text-[9px] font-bold text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Clear All
                  </Button>
                </div>

                {/* Matrix Component */}
                <DropoffMatrix
                  routes={fullRoutes}
                  buses={fullBuses}
                  assignments={dropoffAssignments}
                  onChange={setDropoffAssignments}
                />
              </div>
            )}
          </div>

          {/* Auto-Cleanup & Actions - Flat Layout */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            {/* Cleanup Selector */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200/60 dark:border-slate-800/50">
              <Clock className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-2">Cleanup:</span>
              <Select value={expiryDays} onValueChange={setExpiryDays}>
                <SelectTrigger className="ml-5 h-6 w-auto border-none bg-transparent p-0 text-xs font-bold text-slate-700 dark:text-slate-200 focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg z-[100]">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => <SelectItem key={d} value={d.toString()}>{d} Day{d > 1 ? 's' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 flex-1 sm:justify-end">
              <Button type="button" variant="ghost" onClick={handleDiscard} disabled={sending} className="h-9 px-3 text-[10px] sm:text-[11px] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold hover:bg-red-600 hover:text-white transition-colors rounded-lg border border-red-200/50 dark:border-red-800/50">
                Discard
              </Button>
              <Button type="submit" disabled={sending} className="h-9 flex-1 sm:flex-initial sm:px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm rounded-lg shadow-lg shadow-blue-500/20 transition-all hover:translate-y-[-1px] active:translate-y-[0.5px]">
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Send
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
