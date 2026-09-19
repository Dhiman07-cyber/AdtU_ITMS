"use client";

import NotificationCardV2 from "@/components/NotificationCardV2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger
} from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";
import { useNotifications } from '@/contexts/NotificationContext';
import { useToast } from "@/contexts/toast-context";
import { cn } from "@/lib/utils";
import {
	Bell,
	Inbox,
	Plus,
	RefreshCw,
	Send,
	Truck,
	User
} from "lucide-react";
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect,useMemo,useRef,useState } from "react";

// Deferred: the create/edit form is a heavy (~700-line) component that's only
// needed when an admin opens it. Loading it lazily keeps the list view's
// initial JS payload small for fast first paint on low-end devices.
const NotificationFormV2 = dynamic(() => import("@/components/NotificationFormV2"), {
  ssr: false,
});

type TabType = 'all' | 'moderator' | 'driver' | 'sent';

export default function AdminNotificationsPage() {
  const router = useRouter();
  const { currentUser, userData } = useAuth();
  const { addToast } = useToast();

  // Use the user-specific notification hook
  const {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    deleteGlobally,
    editNotification,
    refresh,
    markAllAsRead
  } = useNotifications();


  const markedRef = useRef<string[]>([]);


  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
      addToast('Notifications refreshed', 'success');
    } catch (e) {
      addToast('Failed to refresh notifications', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Warm the lazily-loaded create/edit form chunk during idle time so the first
  // "Create Notification" click opens instantly instead of waiting on a download.
  useEffect(() => {
    const preload = () => { import("@/components/NotificationFormV2"); };
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(preload, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(preload, 1500);
    return () => clearTimeout(t);
  }, []);

  // Automatically mark all received notifications as read when visiting the page or switching tabs
  useEffect(() => {
    if (loading || !currentUser) return;

    const markAllVisibleAsRead = async () => {
      const unreadIds = notifications
        .filter(n => !n.isRead && !n.isDeletedGlobally && n.sender.userId !== currentUser.uid)
        .map(n => n.id)
        .filter(id => !markedRef.current.includes(id));

      if (unreadIds.length > 0) {
        try {
          markedRef.current = [...markedRef.current, ...unreadIds];
          await markAllAsRead(unreadIds);
        } catch (err) {
          console.error('Error auto-marking notifications as read:', err);
        }
      }
    };

    if (activeTab === 'all' || activeTab === 'moderator' || activeTab === 'driver') {
      markAllVisibleAsRead();
    }
  }, [activeTab, loading, notifications, currentUser, markAllAsRead]);

  // Bucket notifications in a SINGLE pass instead of 5 separate array scans
  // on every render. Recomputes only when notifications or the user change.
  const { receivedNotifications, modNotifications, driverNotificationsCount, sentNotifications } = useMemo(() => {
    const uid = currentUser?.uid;
    const received: typeof notifications = [];
    const mod: typeof notifications = [];
    const driver: typeof notifications = [];
    const sent: typeof notifications = [];

    for (const n of notifications) {
      if (n.sender.userId === uid) {
        sent.push(n);
        continue;
      }
      received.push(n);
      if (n.sender.userRole === 'moderator') mod.push(n);
      else if (n.sender.userRole === 'driver') driver.push(n);
    }

    return {
      receivedNotifications: received,
      modNotifications: mod,
      driverNotificationsCount: driver,
      sentNotifications: sent,
    };
  }, [notifications, currentUser?.uid]);

  // Filtered list for the active tab — picks the precomputed bucket.
  const filteredNotifications = useMemo(() => {
    switch (activeTab) {
      case 'moderator': return modNotifications;
      case 'driver': return driverNotificationsCount;
      case 'sent': return sentNotifications;
      case 'all':
      default: return receivedNotifications;
    }
  }, [activeTab, receivedNotifications, modNotifications, driverNotificationsCount, sentNotifications]);

  // Handlers — stable identities so memoized NotificationCardV2 instances
  // don't re-render on every parent update.
  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markAsRead(notificationId);
      addToast('Marked as read', 'success');
    } catch (error) {
      addToast('Failed to mark as read', 'error');
    }
  };

  const handleEdit = async (notificationId: string, updates: { content: string }) => {
    try {
      await editNotification(notificationId, updates);
      addToast('Notification updated successfully', 'success');
    } catch (error) {
      addToast('Failed to update notification', 'error');
    }
  };

  const handleDeleteGlobally = async (notificationId: string) => {
    try {
      await deleteGlobally(notificationId);
      addToast('Notification deleted for everyone', 'success');
    } catch (error) {
      addToast('Failed to delete notification', 'error');
    }
  };

  if (error) {
    return (
      <div className="mt-12 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">Error loading notifications</p>
          <Button onClick={refresh} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="itms-admin-container space-y-6">
      {/* Header */}
      <div className="itms-page-header-container mb-6">
        <div className="flex items-center justify-between w-full gap-2">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground truncate leading-tight pb-1">
            Notifications
          </h1>

            {/* Desktop action toolbar */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <Button
                onClick={() => setCreateDialogOpen(true)}
                onMouseEnter={() => { import("@/components/NotificationFormV2"); }}
                onFocus={() => { import("@/components/NotificationFormV2"); }}
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create Notification
              </Button>
            </div>

            {/* Mobile Actions - Same line as Notifications at rightmost end */}
            <div className="flex md:hidden items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shrink-0"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin text-blue-600" : "group-hover:rotate-180")} />
                <span>Refresh</span>
              </Button>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                onMouseEnter={() => { import("@/components/NotificationFormV2"); }}
                onFocus={() => { import("@/components/NotificationFormV2"); }}
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 h-8 px-2.5 text-xs font-semibold rounded-lg shrink-0 cursor-pointer active:scale-95 transition-all"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create</span>
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm truncate">
            Manage and send notifications to all users
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-auto min-h-10 sm:h-10 p-1 bg-muted/60 dark:bg-zinc-900/60 border border-white/5 rounded-xl gap-0.5 sm:gap-1">
            <TabsTrigger
              value="all"
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-medium rounded-lg transition-all"
            >
              <Inbox className="h-3.5 w-3.5 shrink-0" />
              <span>All</span>
              {receivedNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 sm:ml-1 text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0 h-4 min-w-4 flex items-center justify-center shrink-0 rounded-full font-bold">
                  {receivedNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="moderator"
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-medium rounded-lg transition-all"
            >
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Mods</span>
              <span className="hidden sm:inline">From Moderators</span>
              {modNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 sm:ml-1 text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0 h-4 min-w-4 flex items-center justify-center shrink-0 rounded-full font-bold">
                  {modNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="driver"
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-medium rounded-lg transition-all"
            >
              <Truck className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Drivers</span>
              <span className="hidden sm:inline">From Drivers</span>
              {driverNotificationsCount.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 sm:ml-1 text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0 h-4 min-w-4 flex items-center justify-center shrink-0 rounded-full font-bold">
                  {driverNotificationsCount.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="sent"
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-2.5 py-1.5 sm:py-1 text-[11px] sm:text-xs font-medium rounded-lg transition-all"
            >
              <Send className="h-3.5 w-3.5 shrink-0" />
              <span>Sent</span>
              {sentNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 sm:ml-1 text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0 h-4 min-w-4 flex items-center justify-center shrink-0 rounded-full font-bold">
                  {sentNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab Content */}
          <TabsContent value={activeTab} className="mt-3">
            {loading && notifications.length === 0 ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-card border animate-pulse" />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                      {activeTab === 'moderator' ? (
                        <User className="h-5 w-5 text-gray-400" />
                      ) : activeTab === 'driver' ? (
                        <Truck className="h-5 w-5 text-gray-400" />
                      ) : activeTab === 'sent' ? (
                        <Send className="h-5 w-5 text-gray-400" />
                      ) : (
                        <Inbox className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      {activeTab === 'moderator'
                        ? 'No notifications from moderators'
                        : activeTab === 'driver'
                          ? 'No notifications from drivers'
                          : activeTab === 'sent'
                            ? 'No sent notifications'
                            : 'No notifications yet'}
                    </p>
                    {activeTab === 'all' && (
                      <Button onClick={() => setCreateDialogOpen(true)} className="h-8 text-xs">
                        Create your first notification
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredNotifications.map((notification) => (
                  <NotificationCardV2
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={handleMarkAsRead}
                    onEdit={handleEdit}
                    onDeleteGlobally={handleDeleteGlobally}
                    onRefresh={refresh}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Notification Dialog — mounted only when opened to defer its chunk */}
        {createDialogOpen && (
          <NotificationFormV2
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
            onSuccess={() => {
              refresh();
              setCreateDialogOpen(false);
            }}
          />
        )}
      </div>
  );
}
