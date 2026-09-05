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
	ShieldCheck,
	Truck
} from "lucide-react";
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from "react";

// Deferred: the heavy (~700-line) create/edit form loads only when opened.
const NotificationFormV2 = dynamic(() => import("@/components/NotificationFormV2"), {
  ssr: false,
});

type TabType = 'all' | 'admin' | 'driver' | 'sent';

export default function ModeratorNotificationsPage() {
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

  // Warm the lazy create/edit form chunk during idle time so first open is instant.
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

    if (activeTab === 'all' || activeTab === 'admin' || activeTab === 'driver') {
      markAllVisibleAsRead();
    }
  }, [activeTab, loading, notifications, currentUser, markAllAsRead]);

  // Direct bucket computation in render
  const uid = currentUser?.uid;
  const receivedNotifications: typeof notifications = [];
  const adminNotificationsCount: typeof notifications = [];
  const driverNotificationsCount: typeof notifications = [];
  const sentNotifications: typeof notifications = [];

  for (const n of notifications) {
    if (n.sender.userId === uid) {
      sentNotifications.push(n);
      continue;
    }
    receivedNotifications.push(n);
    if (n.sender.userRole === 'admin') adminNotificationsCount.push(n);
    else if (n.sender.userRole === 'driver') driverNotificationsCount.push(n);
  }

  // Filtered list for the active tab
  const filteredNotifications = (() => {
    switch (activeTab) {
      case 'admin': return adminNotificationsCount;
      case 'driver': return driverNotificationsCount;
      case 'sent': return sentNotifications;
      case 'all':
      default: return receivedNotifications;
    }
  })();

  // Handlers
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


  if (loading) {
    return <PremiumPageLoader message="Loading Notifications..." subMessage="Fetching recent updates..." />;
  }

  if (error) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center">
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
    <div className="flex-1 py-20 px-3 sm:px-4 lg:px-6 pt-15">
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
        <Tabs defaultValue="all" value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full mb-10">
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
            <TabsTrigger value="admin" className="flex items-center gap-1.5 text-xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              From Admins
              {adminNotificationsCount.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                  {adminNotificationsCount.length}
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
          <TabsContent value={activeTab} className="mt-3 pt-4">
            {filteredNotifications.length === 0 ? (
              <Card>
                <CardContent className="py-30">
                  <div className="text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                      {activeTab === 'admin' ? (
                        <ShieldCheck className="h-5 w-5 text-gray-400" />
                      ) : activeTab === 'driver' ? (
                        <Truck className="h-5 w-5 text-gray-400" />
                      ) : activeTab === 'sent' ? (
                        <Send className="h-5 w-5 text-gray-400" />
                      ) : (
                        <Inbox className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      {activeTab === 'admin'
                        ? 'No notifications from admins'
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
