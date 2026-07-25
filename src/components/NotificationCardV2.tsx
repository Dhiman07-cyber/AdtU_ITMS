"use client";

import { useState, memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  User,
  Clock,
  EyeOff,
  Bell,
  Calendar,
  CheckCheck,
  MapPin,
  Globe,
  Loader2,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  Bus,
  Truck,
  X
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import NotificationFormV2 from './NotificationFormV2';
import { UserNotificationView } from '@/lib/notifications/types';
import { formatDistanceToNow, format } from 'date-fns';

interface NotificationCardV2Props {
  notification: UserNotificationView;
  onMarkAsRead?: (id: string) => Promise<void>;
  onEdit?: (id: string, updates: { title?: string, content: string, metadata?: any }) => Promise<void>;
  onDeleteGlobally?: (id: string) => Promise<void>;
  onRefresh?: () => void;
}

function NotificationCardV2({
  notification,
  onMarkAsRead,
  onEdit,
  onDeleteGlobally,
  onRefresh,
}: NotificationCardV2Props) {
  const { currentUser, userData } = useAuth();
  const { addToast } = useToast();
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [didMarkAsRead, setDidMarkAsRead] = useState(false);
  // Combine prop state with local state for instant UI updates
  const isEffectiveRead = notification.isRead || didMarkAsRead;

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '';
    try {
      let date: Date;
      if (timestamp.toDate) date = timestamp.toDate();
      else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
      else date = new Date(timestamp);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) { return ''; }
  };

  const formatExpiry = (timestamp: any) => {
    if (!timestamp) return null;
    try {
      let date: Date;
      if (timestamp.toDate) date = timestamp.toDate();
      else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
      else date = new Date(timestamp);
      return format(date, 'MMM d, h:mm a');
    } catch (error) { return null; }
  };

  const formatFullDate = (timestamp: any) => {
    if (!timestamp) return '';
    try {
      let date: Date;
      if (timestamp.toDate) date = timestamp.toDate();
      else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
      else date = new Date(timestamp);
      return format(date, 'MMMM d, yyyy • h:mm a');
    } catch (error) { return ''; }
  };

  // Determine the target role for visual accents
  const getTargetRole = () => {
    const { target } = notification;
    if (target.type === 'all_users') return 'all';
    if (target.roleFilter) return target.roleFilter;
    if (target.type === 'route_based' || target.type === 'bus_based') return 'student';
    return 'all';
  };

  const targetRole = getTargetRole();

  const roleThemes = {
    student: {
      color: "indigo",
      label: "Students",
      bg: "bg-indigo-500",
      lightBg: "bg-indigo-50/50",
      border: "border-indigo-100",
      accent: "from-indigo-500 to-blue-600",
      glow: "shadow-indigo-500/20"
    },
    driver: {
      color: "emerald",
      label: "Drivers",
      bg: "bg-emerald-500",
      lightBg: "bg-emerald-50/50",
      border: "border-emerald-100",
      accent: "from-emerald-500 to-teal-600",
      glow: "shadow-emerald-500/20"
    },
    moderator: {
      color: "purple",
      label: "Moderators",
      bg: "bg-purple-500",
      lightBg: "bg-purple-50/50",
      border: "border-purple-100",
      accent: "from-purple-500 to-pink-600",
      glow: "shadow-purple-500/20"
    },
    admin: {
      color: "rose",
      label: "Admins",
      bg: "bg-rose-500",
      lightBg: "bg-rose-50/50",
      border: "border-rose-100",
      accent: "from-rose-500 to-red-600",
      glow: "shadow-rose-500/20"
    },
    all: {
      color: "blue",
      label: "Everyone", // Fallback
      bg: "bg-blue-600",
      lightBg: "bg-blue-50/50",
      border: "border-blue-100",
      accent: "from-blue-600 to-indigo-700",
      glow: "shadow-blue-500/20"
    }
  };

  const typeThemes = {
    trip: { icon: Globe },
    notice: { icon: Bell },
    pickup: { icon: MapPin },
    dropoff: { icon: MapPin },
    announcement: { icon: AlertCircle },
    default: { icon: Bell }
  };

  const roleTheme = roleThemes[targetRole] || roleThemes.all;
  const typeTheme = typeThemes[notification.type] || typeThemes.default;
  const ThemeIcon = typeTheme.icon;

  const isFeedbackIssue = !!notification.metadata?.feedbackId;
  const isRenewalRequest = notification.title.toLowerCase().includes('renewal request');

  const parseMatrixFromContent = (content: string) => {
    const lines = content.split('\n');
    const matrix: any[] = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      // Format is "Bus-X : Route Name (Stop 1, Stop 2)"
      if (trimmed.startsWith('Bus-') && trimmed.includes(' : ')) {
        const parts = trimmed.split(' : ');
        if (parts.length >= 2) {
          const busNumber = parts[0].trim();
          const rest = parts.slice(1).join(' : ').trim();
          let routeName = rest;
          let stops: any[] = [];
          
          if (rest.endsWith(')')) {
            // Find the matching opening parenthesis from the end
            let depth = 0;
            let matchIndex = -1;
            for (let i = rest.length - 1; i >= 0; i--) {
              if (rest[i] === ')') depth++;
              else if (rest[i] === '(') {
                depth--;
                if (depth === 0) {
                  matchIndex = i;
                  break;
                }
              }
            }

            if (matchIndex !== -1) {
              routeName = rest.substring(0, matchIndex).trim();
              const stopsStr = rest.substring(matchIndex + 1, rest.length - 1);
              stops = stopsStr.split(',').map((s: string) => ({ name: s.trim() }));
            } else {
              // Fallback if mismatched
              stops = [{ name: 'Standard Coverage' }];
            }
          }
          
          matrix.push({ busNumber, routeName, stops });
        }
      }
    });
    return matrix.length > 0 ? matrix : undefined;
  };

  const getMatrixData = () => {
    return (notification as any).metadata?.matrix || 
           (notification.type === 'dropoff' ? parseMatrixFromContent(notification.content) : undefined);
  };

  const getDisplayLabel = () => {
    if (targetRole !== 'all') return roleTheme.label;

    const userRole = userData?.role || (currentUser?.email?.includes('admin') ? 'admin' : 'student');

    if (userRole === 'admin' || userRole === 'moderator') return "Global Broadcast";
    if (userRole === 'student') return "Campus Notice";
    if (userRole === 'driver') return "Fleet Notice";
    return "General Notice";
  };

  const displayLabel = getDisplayLabel();

  const handleMarkAsRead = async (skipRefresh = false) => {
    if (onMarkAsRead && !isEffectiveRead) {
      setLoading(true);
      try {
        await onMarkAsRead(notification.id);
        setDidMarkAsRead(true); // Visually mark as read instantly
        if (!skipRefresh) {
          onRefresh?.();
        }
      } catch (error) { addToast('Failed to mark as read', 'error'); }
      finally { setLoading(false); }
    }
  };

  const handleEdit = async (id: string, updates: { title?: string, content: string, metadata?: any }) => {
    setLoading(true);
    try {
      if (onEdit) {
        await onEdit(id, updates);
        // setIsEditDialogOpen(false); // Can be handled by form or here
        addToast('Updated successfully', 'success');
        onRefresh?.();
      }
    } catch (error) { addToast('Failed to update', 'error'); }
    finally { setLoading(false); }
  };

  const expiryDisplay = formatExpiry(notification.expiryAt);

  return (
    <>
      <Card
        className={`group relative flex flex-col overflow-hidden transition-colors duration-200 border-l-[6px] cursor-pointer ${!isEffectiveRead
          ? `bg-gradient-to-br from-white to-${roleTheme.color}-50/40 dark:from-slate-800/60 dark:to-${roleTheme.color}-900/20 border-r border-t border-b border-${roleTheme.color}-200/50 dark:border-${roleTheme.color}-800/30`
          : `bg-white dark:bg-[#0a0b14] shadow-sm hover:shadow-xl hover:dark:bg-slate-900 transition-colors shadow-black/5`} rounded-[24px] border ${roleTheme.border} dark:border-slate-800 hover:shadow-lg hover:shadow-${roleTheme.color}-500/10 transition-colors duration-200`}
        style={{ borderLeftColor: `var(--role-${targetRole})` }}
        onClick={() => {
          setIsViewDialogOpen(true);
          if (!isEffectiveRead) handleMarkAsRead(true);
        }}
      >
        <CardContent className="p-0">
          <div className="p-5 space-y-4 pt-0">
            {/* Header: Type & Metadata */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${roleTheme.accent} text-white shadow-lg overflow-hidden relative`}>
                  <ThemeIcon className="h-4 w-4 relative z-10" />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-black uppercase tracking-[0.12em] bg-clip-text text-transparent bg-gradient-to-r ${roleTheme.accent}`}>
                      {isFeedbackIssue ? "Issues" : isRenewalRequest ? "Request" : notification.type}
                    </span>
                    <Badge variant="outline" className={`h-4.5 text-[9px] font-bold border-${roleTheme.color}-200 text-${roleTheme.color}-600 dark:border-${roleTheme.color}-800 dark:text-${roleTheme.color}-400 px-1.5`}>
                      {displayLabel}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                    <Clock className="h-3 w-3" />
                    {formatDate(notification.createdAt)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isEffectiveRead && (
                  <span className={`flex h-2 w-2 rounded-full bg-${roleTheme.color}-500`} />
                )}
                {(notification.canEdit || notification.canDeleteGlobally) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-2xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 rounded-[20px] border-slate-200/50 dark:border-slate-800/50 shadow-2xl bg-white dark:bg-slate-950 p-1.5">
                      <DropdownMenuItem className="py-2.5 rounded-xl font-bold text-xs cursor-pointer focus:bg-slate-100 dark:focus:bg-slate-900 transition-colors" onClick={() => {
                        setIsViewDialogOpen(true);
                        if (!isEffectiveRead) handleMarkAsRead(true);
                      }}>
                        <Eye className="h-4 w-4 mr-3 text-slate-500" /> View Detailed Broadcast
                      </DropdownMenuItem>
                      {!isEffectiveRead && (
                        <DropdownMenuItem className="py-2.5 rounded-xl font-bold text-xs cursor-pointer focus:bg-blue-50 dark:focus:bg-blue-900/40 text-blue-600 transition-colors" onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsRead();
                        }}>
                          <CheckCheck className="h-4 w-4 mr-3" /> Acknowledge Message
                        </DropdownMenuItem>
                      )}
                      {notification.canEdit && (
                        <DropdownMenuItem className="py-2.5 rounded-xl font-bold text-xs cursor-pointer focus:bg-amber-50 dark:focus:bg-amber-900/40 text-amber-600 transition-colors" onClick={(e) => {
                          e.stopPropagation();
                          setIsEditDialogOpen(true);
                        }}>
                          <Edit className="h-4 w-4 mr-3" /> Edit Announcement
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator className="my-1.5" />
                      {notification.canDeleteGlobally && (
                        <DropdownMenuItem
                          className="py-2.5 rounded-xl font-bold text-xs cursor-pointer text-red-600 focus:bg-red-600 focus:text-white transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-3" /> Delete Globally
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Title: The Core Focus */}
            <div className="space-y-1.5 sm:space-y-2">
              <h3 className={`text-[18px] sm:text-[17px] font-extrabold leading-[1.3] tracking-tight break-all line-clamp-1 ${!isEffectiveRead ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                {notification.title}
              </h3>
              <p className={`text-[14px] sm:text-[13px] leading-relaxed font-medium line-clamp-2 break-all ${isEffectiveRead ? 'text-slate-500/80' : 'text-slate-600 dark:text-slate-400'}`}>
                {notification.content}
              </p>
            </div>

            {/* Footer Information */}
            <div className="pt-4 flex items-center justify-between border-t border-slate-100/60 dark:border-slate-800/40">
              <div className="flex items-center gap-2.5 group/sender">
                <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${roleTheme.accent} p-[1.5px]`}>
                  <div className="h-full w-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center">
                    <User className={`h-3.5 w-3.5 text-${roleTheme.color}-500`} />
                  </div>
                </div>
                <div className="flex flex-col">
                  {isRenewalRequest ? (
                    <span className="text-[12px] sm:text-[11px] font-black text-slate-800 dark:text-slate-100 leading-none tracking-tight">Student name : {notification.sender.userName}</span>
                  ) : (
                    <>
                      <span className="text-[12px] sm:text-[11px] font-black text-slate-800 dark:text-slate-100 leading-none tracking-tight">{notification.sender.userName}</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="secondary" className="h-4 text-[8px] sm:text-[7px] font-black uppercase tracking-widest px-1.5 sm:px-1 bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {notification.sender.userRole}
                        </Badge>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {expiryDisplay && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-orange-50/60 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border border-orange-100/40 dark:border-orange-900/20 transition-all hover:scale-105">
                  <Clock className="h-3 w-3" />
                  <span className="text-[10px] font-black uppercase tracking-wider">{expiryDisplay}</span>
                </div>
              )}
            </div>
          </div>

          {/* Detailed View Link for Unread */}
          {!isEffectiveRead && (
            <button
              onClick={() => {
                setIsViewDialogOpen(true);
                // Skip refresh to prevent closing
                if (!isEffectiveRead) handleMarkAsRead(true);
              }}
              className={`w-full py-3.5 bg-gradient-to-r ${roleTheme.accent} hover:brightness-110 active:scale-[0.98] text-[11px] font-black text-white uppercase tracking-[0.2em] transition-all shadow-lg overflow-hidden relative group/btn`}
            >
              <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
              Open Full Broadcast
            </button>
          )}
        </CardContent>

        <style jsx>{`
            :root {
                --role-student: #6366f1;
                --role-driver: #10b981;
                --role-moderator: #a855f7;
                --role-admin: #f43f5e;
                --role-all: #2563eb;
            }
        `}</style>
      </Card>

      {/* Enhanced View Dialog */}
      <Dialog
        open={isViewDialogOpen}
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          // If closing and we marked as read locally, trigger real refresh now
          if (!open && didMarkAsRead) {
            onRefresh?.();
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onWheel={(e) => e.stopPropagation()}
          className="max-w-[95vw] sm:max-w-4xl p-0 border-2 border-white sm:border-0 rounded-2xl sm:rounded-[28px] overflow-hidden bg-white dark:bg-slate-950 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] animate-in zoom-in-95 duration-500 sm:top-[54%] !translate-y-[-50%] sm:mt-0"
        >
          <div className="relative flex flex-col max-h-[80vh] sm:max-h-[90vh]">
            {/* Modal Header Wrap - Compact on mobile */}
            <div className={`relative px-5 sm:px-8 pt-6 sm:pt-10 pb-3 sm:pb-6 bg-gradient-to-br from-${roleTheme.color}-500/5 to-transparent`}>


              {/* Close Button - Single Instance, Top Right */}
              <button
                onClick={() => setIsViewDialogOpen(false)}
                className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 rounded-full text-slate-500 dark:text-slate-400 transition-all duration-300 hover:rotate-90 hover:scale-110 active:scale-95 z-[60] group/close shadow-sm border border-black/5 dark:border-white/5"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5 group-hover/close:text-red-500 transition-colors" />
              </button>

              {/* Mobile: Row Layout for everything */}
              <div className="flex flex-row items-center justify-between gap-2 sm:gap-4 mb-3 sm:mb-6 pr-8">
                {/* Left: Icon + Badges */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className={`w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-[16px] bg-gradient-to-br ${roleTheme.accent} shadow-lg ${roleTheme.glow} flex items-center justify-center text-white ring-1 sm:ring-4 ring-${roleTheme.color}-500/5`}>
                    <ThemeIcon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Badge className={`bg-${roleTheme.color}-500 hover:bg-${roleTheme.color}-600 text-white font-black px-1.5 sm:px-1.5 py-0.5 sm:py-0.5 text-[8px] sm:text-[8px] tracking-wider border-0 shadow-sm`}>
                        {isFeedbackIssue ? "ISSUES" : isRenewalRequest ? "REQUEST" : notification.type.toUpperCase()}
                      </Badge>
                      {!isEffectiveRead && (
                        <Badge variant="default" className="bg-blue-600 text-[8px] sm:text-[8px] font-black px-1.5 py-0.5 uppercase animate-pulse shadow-sm">New</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-slate-400 font-bold">
                      <Calendar className="h-3 w-3 sm:h-3 sm:w-3" />
                      <span className="truncate max-w-[150px] sm:max-w-none">{formatFullDate(notification.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Sender Info - Hidden on mobile in the MODAL as requested */}
                <div className={`hidden sm:flex items-center gap-2 bg-white dark:bg-slate-900 px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border border-slate-200/40 dark:border-slate-800/40 shadow-sm`}>
                  <div className={`h-6 w-6 sm:h-8 sm:w-8 rounded-md sm:rounded-lg bg-gradient-to-br ${roleTheme.accent} flex items-center justify-center font-black text-white shadow-md text-[10px] sm:text-xs ring-1 sm:ring-2 ring-white dark:ring-slate-900`}>
                    {notification.sender.userName.charAt(0)}
                  </div>
                  <div className="hidden sm:block">
                    {isRenewalRequest ? (
                      <p className="text-[8px] sm:text-[10px] font-black text-slate-900 dark:text-white leading-tight uppercase tracking-tight">Student name : {notification.sender.userName}</p>
                    ) : (
                      <>
                        <p className="text-[8px] sm:text-[10px] font-black text-slate-900 dark:text-white leading-tight uppercase tracking-tight">{notification.sender.userName}</p>
                        <p className={`text-[6px] sm:text-[7px] text-${roleTheme.color}-600 dark:text-${roleTheme.color}-400 font-black uppercase tracking-widest`}>{notification.sender.userRole}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <DialogTitle className="text-[19px] sm:text-2xl font-[900] text-slate-900 dark:text-white leading-[1.25] tracking-tight pr-10 sm:pr-0 mt-3 mb-1">
                {notification.title}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Detailed view of the notification content
              </DialogDescription>
            </div>

            {/* Scrollable Content Area - Compact on mobile */}
            <div
              className="px-5 sm:px-8 py-5 sm:py-6 overflow-y-auto custom-scrollbar overscroll-none touch-pan-y flex-1 relative max-h-[420px] sm:max-h-[450px]"
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="max-w-none relative z-10">
                <div className="text-[15px] sm:text-[14px] text-slate-700 dark:text-slate-300 leading-[1.6] font-semibold tracking-tight whitespace-pre-wrap mb-4">
                  {isFeedbackIssue ? (
                    <div className="space-y-5">
                      {/* Premium Sender & Bus Cards */}
                      <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="relative group overflow-hidden rounded-[20px] bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/50 p-3.5 transition-shadow hover:shadow-lg hover:shadow-blue-500/5">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              <User className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400/80 mb-0.5">Reporter</p>
                              <p className="text-[11px] sm:text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{notification.metadata?.feedbackSenderName || 'Unknown'}</p>
                            </div>
                          </div>
                        </div>

                        <div className="relative group overflow-hidden rounded-[20px] bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/50 p-3.5 transition-shadow hover:shadow-lg hover:shadow-amber-500/5">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                              <Bus className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400/80 mb-0.5">Vehicle</p>
                              <p className="text-[11px] sm:text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {notification.metadata?.feedbackBusId ? (
                                  `Bus-${notification.metadata.feedbackBusId.split('_')[1] || notification.metadata.feedbackBusId} ${notification.metadata.feedbackBusPlate ? `(${notification.metadata.feedbackBusPlate})` : ''}`
                                ) : 'N/A'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Content Section: Original Feedback */}
                      <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-slate-50 to-white dark:from-slate-950 dark:to-slate-900/50 border border-slate-200/60 dark:border-slate-800/60 p-5 sm:p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              <MessageSquare className="h-4 w-4" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">Original Submission</span>
                          </div>
                          <div className="h-px flex-1 mx-4 bg-emerald-500/10" />
                        </div>
                        <div className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300 font-medium italic break-all">
                          <span className="text-emerald-500/40 text-3xl font-sans mr-1 leading-none">"</span>
                          {notification.metadata?.originalFeedback || (
                            notification.content.includes('Original Feedback from')
                              ? notification.content.split('---')[0].split('):\n\n')[1]?.replace(/^"|"$/g, '')
                              : notification.content
                          )}
                          <span className="text-emerald-500/40 text-3xl font-sans ml-1 leading-none inline-block align-bottom">"</span>
                        </div>
                      </div>

                      {/* Admin Note: Action/Instruction */}
                      <div className="relative overflow-hidden rounded-[24px] bg-indigo-500/[0.03] dark:bg-indigo-500/[0.02] border-2 border-indigo-500/10 dark:border-indigo-500/10 p-5 sm:p-6 shadow-xl shadow-indigo-500/5">
                        <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
                        <div className="flex items-center gap-2.5 mb-4">
                          <div className="p-2 rounded-lg bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
                            <AlertCircle className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">Resolution & Action</span>
                        </div>
                        <div className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-100 font-bold tracking-tight break-all">
                          {notification.metadata?.adminNote || (
                            notification.content.includes("Administrator's Note:")
                              ? notification.content.split("Administrator's Note:")[1]?.trim()
                              : "Review required."
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const matrixData = getMatrixData();
                      if (matrixData && matrixData.length > 0) {
                        const lines = notification.content.split('\n');
                        const introLines = lines.filter(line => !line.trim().startsWith('Bus-') && !line.includes(' : Route-'));
                        return introLines.join('\n').trim();
                      }
                      return notification.content;
                    })()
                  )}
                </div>

                {/* Premium Matrix Table */}
                {(() => {
                  const matrixData = getMatrixData();
                  if (!matrixData || matrixData.length === 0) return null;

                  return (
                    <div className="mt-4 sm:mt-8 mb-4 sm:mb-6 overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-lg sm:shadow-xl bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className={`px-2.5 sm:px-4 py-2 sm:py-3 bg-gradient-to-r ${roleTheme.accent} text-white flex items-center justify-between`}>
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
                          <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-[0.1em] sm:tracking-[0.2em]">Dropoff Matrix</span>
                        </div>
                        <Badge variant="outline" className="text-[6px] sm:text-[8px] font-black border-white/20 text-white bg-white/10 uppercase tracking-wide sm:tracking-widest">{matrixData.length} Buses</Badge>
                      </div>

                      {/* Mobile: Compact Card Layout, Desktop: Table */}
                      <div className="hidden sm:block overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-200/40 dark:border-slate-800/40">
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">Service Vehicle</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">Assigned Route</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">Coverage & Stops</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100/50 dark:divide-slate-800/50">
                            {matrixData.map((row: any, idx: number) => (
                              <tr key={idx} className="group/row hover:bg-slate-50/80 dark:hover:bg-slate-800/20 transition-colors">
                                <td className="px-4 py-4 min-w-[180px]">
                                  <div className={`inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gradient-to-br ${roleTheme.accent} text-[11px] font-black text-white shadow-lg transition-all group-hover/row:scale-[1.02] whitespace-nowrap`}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                                    <span>{row.busNumber}</span>
                                    {row.plateNumber && (
                                      <span className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/10 text-[9px] font-bold text-white/90">({row.plateNumber})</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-col">
                                    <span className="text-[13px] font-extrabold text-slate-900 dark:text-slate-100 whitespace-nowrap">{row.routeName}</span>
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Verified Schedule</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.stops?.map((stop: any, sIdx: number) => (
                                      <span key={sIdx} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-800 text-[9px] font-bold text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60 group-hover/row:border-blue-500/30 group-hover/row:text-blue-600 transition-all shadow-sm">
                                        {stop.name}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile: Compact Card View - No Horizontal Scroll */}
                      <div className="block sm:hidden divide-y divide-slate-100/50 dark:divide-slate-800/50">
                        {matrixData.map((row: any, idx: number) => (
                          <div key={idx} className="p-2.5 space-y-1.5">
                            {/* Bus + Route on same line */}
                            <div className="flex items-center justify-between gap-2">
                              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-br ${roleTheme.accent} text-[8px] font-black text-white shadow-md`}>
                                <div className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />
                                <span>{row.busNumber}</span>
                                {row.plateNumber && (
                                  <span className="text-[7px] text-white/80">({row.plateNumber})</span>
                                )}
                              </div>
                              <span className="text-[10px] font-extrabold text-slate-900 dark:text-slate-100">{row.routeName}</span>
                            </div>
                            {/* Stops as wrap - show all */}
                            <div className="flex flex-wrap gap-1">
                              {row.stops?.map((stop: any, sIdx: number) => (
                                <span key={sIdx} className="inline-flex items-center px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[7px] font-bold text-slate-500 dark:text-slate-400 border border-slate-200/40 dark:border-slate-700/40">
                                  {stop.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="px-6 sm:px-8 py-5 border-t border-slate-100 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                {expiryDisplay && (
                  <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-orange-50/80 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border border-orange-100/50 dark:border-orange-900/30 w-full sm:w-auto shadow-sm">
                    <Clock className="h-3.5 w-3.5" />
                    <div className="flex flex-col">
                      <span className="text-[7px] font-black uppercase tracking-[0.1em] leading-none mb-0.5 opacity-70">Expires On</span>
                      <span className="text-px[10px] font-black">{expiryDisplay}</span>
                    </div>
                  </div>
                )}

                {!isFeedbackIssue && (
                  <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800/50 text-slate-500 border border-slate-200/50 dark:border-slate-700/50 w-full sm:w-auto shadow-sm">
                    <div className={`h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]`} />
                    <span className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-600 dark:text-emerald-400">Official Broadcast</span>
                  </div>
                )}
              </div>

              <Button
                onClick={() => setIsViewDialogOpen(false)}
                className={`w-full sm:w-auto h-11 px-8 bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 font-black text-[10px] uppercase tracking-[0.2em] rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg`}
              >
                Close View
              </Button>
            </div>
          </div >
        </DialogContent >
      </Dialog >

      {/* Edit Form */}
      < NotificationFormV2
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)
        }
        mode="edit"
        initialData={notification}
        onEdit={handleEdit}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="rounded-[24px] border-0 shadow-2xl p-6 sm:p-8 bg-white dark:bg-slate-950 max-w-[90vw] sm:max-w-md">
          <AlertDialogHeader>
            <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center mb-4 mx-auto">
              <Trash2 className="h-7 w-7 text-red-600" />
            </div>
            <AlertDialogTitle className="text-xl font-black text-center text-slate-900 dark:text-white tracking-tight">Destructive Action</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 dark:text-slate-400 text-sm font-medium text-center leading-relaxed mt-2">
              This will permanently revoke access to this notification for <span className="text-red-600 font-bold">everyone</span>. This action is irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 flex flex-col sm:flex-row gap-3 w-full">
            <AlertDialogCancel className="w-full sm:w-1/2 font-black text-[10px] uppercase tracking-widest rounded-xl border-slate-200 h-11 hover:bg-slate-50 transition-all">Abort Action</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDeleteGlobally?.(notification.id)}
              className="w-full sm:w-1/2 bg-red-600 hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-xl h-11 shadow-lg shadow-red-500/20 active:scale-95 transition-all"
            >
              Confirm Deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Memoized: cards only re-render when their own notification or handlers change,
// keeping tab switches and mark-as-read updates smooth even with long lists.
export default memo(NotificationCardV2);
