"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
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
import {
	Bell,
	Inbox,
	Plus,
	Send,
	Truck,
	User
} from "lucide-react";
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useMemo,useRef,useState } from "react";

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
  const handleMarkAsRead = useCallback(async (notificationId: string) => {
    try {
      await markAsRead(notificationId);
      addToast('Marked as read', 'success');
    } catch (error) {
      addToast('Failed to mark as read', 'error');
    }
  }, [markAsRead, addToast]);

  const handleEdit = useCallback(async (notificationId: string, updates: { content: string }) => {
    try {
      await editNotification(notificationId, updates);
      addToast('Notification updated successfully', 'success');
    } catch (error) {
      addToast('Failed to update notification', 'error');
    }
  }, [editNotification, addToast]);

  const handleDeleteGlobally = useCallback(async (notificationId: string) => {
    try {
      await deleteGlobally(notificationId);
      addToast('Notification deleted for everyone', 'success');
    } catch (error) {
      addToast('Failed to delete notification', 'error');
    }
  }, [deleteGlobally, addToast]);


  if (loading) {
    return <PremiumPageLoader message="Loading Notifications..." subMessage="Fetching recent updates..." />;
  }

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
    <div className="mt-12 py-4 px-3 sm:px-4 lg:px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Notifications
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage and send notifications to all users
            </p>
          </div>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            onMouseEnter={() => { import("@/components/NotificationFormV2"); }}
            onFocus={() => { import("@/components/NotificationFormV2"); }}
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 h-9 text-sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Notification
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-9">
            <TabsTrigger value="all" className="flex items-center gap-1.5 text-xs">
              <Inbox className="h-3.5 w-3.5" />
              All
              {receivedNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                  {receivedNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="moderator" className="flex items-center gap-1.5 text-xs">
              <User className="h-3.5 w-3.5" />
              From Moderators
              {modNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                  {modNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="driver" className="flex items-center gap-1.5 text-xs">
              <Truck className="h-3.5 w-3.5" />
              From Drivers
              {driverNotificationsCount.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                  {driverNotificationsCount.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" className="flex items-center gap-1.5 text-xs">
              <Send className="h-3.5 w-3.5" />
              Sent
              {sentNotifications.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                  {sentNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab Content */}
          <TabsContent value={activeTab} className="mt-3">
            {filteredNotifications.length === 0 ? (
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
    </div>
  );
}
