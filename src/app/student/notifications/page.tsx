"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Bell, Bus, Info, MapPin, Clock, RefreshCw } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/contexts/toast-context";
import NotificationCardV2 from "@/components/NotificationCardV2";
import { Timestamp } from "firebase/firestore";
import { PremiumPageLoader } from "@/components/LoadingSpinner";

type TabType = 'all' | 'trip' | 'notice' | 'pickup' | 'dropoff' | 'announcement';

export default function StudentNotificationsPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    notifications: allNotifications,
    unreadCount,
    loading,
    markAsRead,
    refresh
  } = useNotifications();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    addToast('Notifications refreshed', 'success');
    setIsRefreshing(false);
  };

  // Automatically mark all received notifications as read when visiting the page
  useEffect(() => {
    if (loading || !currentUser) return;

    const markAllVisibleAsRead = async () => {
      const unreadReceived = allNotifications.filter(n =>
        !n.isRead &&
        !n.isDeletedGlobally &&
        n.sender.userId !== currentUser.uid
      );

      if (unreadReceived.length > 0) {
        try {
          // Mark each as read
          const promises = unreadReceived.map(n => markAsRead(n.id));
          await Promise.all(promises);
        } catch (err) {
          console.error('Error auto-marking notifications as read:', err);
        }
      }
    };

    markAllVisibleAsRead();
  }, [loading, allNotifications, currentUser, markAsRead]);

  // Filter notifications by type
  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') {
      return allNotifications;
    }

    // Filter by type field
    return allNotifications.filter(n => n.type === activeTab);
  }, [allNotifications, activeTab]);

  // Count notifications by type
  const getCountByType = (type: TabType) => {
    if (type === 'all') return allNotifications.length;
    return allNotifications.filter(n => n.type === type).length;
  };



  const getTabIcon = (type: TabType) => {
    switch (type) {
      case 'all': return <Bell className="h-4 w-4" />;
      case 'trip': return <Bus className="h-4 w-4" />;
      case 'notice': return <Info className="h-4 w-4" />;
      case 'pickup': return <MapPin className="h-4 w-4" />;
      case 'dropoff': return <MapPin className="h-4 w-4" />;
      default: return <Bell className="h-4 w-4" />;
    }
  };


  if (!currentUser || loading) {
    return <PremiumPageLoader message="Loading Notifications" subMessage="Preparing your notification center..." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/20 to-purple-50/20 dark:from-gray-950 dark:via-gray-950 dark:to-gray-950 h-screen">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 pt-20 pb-4 md:pt-24 md:pb-6 min-h-screen">
        {/* Compact Header with Gradient */}
        <div className="relative overflow-hidden rounded-xl md:rounded-2xl mb-4 md:mb-6 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 opacity-90"></div>
          <div className="relative p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 md:p-2.5 rounded-xl bg-white/20 backdrop-blur-sm">
                  <Bell className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-white">
                    Notifications
                  </h1>
                  <p className="text-[11px] md:text-sm text-blue-100 mt-0.5 font-medium">
                    Stay updated with announcements and alerts
                  </p>
                </div>
              </div>
              <div className="flex items-start md:items-center gap-4">
                <Button
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="group h-8 px-3 md:px-4 bg-white hover:bg-gray-50 text-black hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[9px] md:text-[10px] uppercase tracking-wider md:tracking-widest rounded-lg transition-all duration-300 active:scale-95 whitespace-nowrap"
                >
                  <RefreshCw className={`mr-1.5 md:mr-2 h-3 w-3 md:h-3.5 md:w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="all" value={activeTab} onValueChange={(value) => setActiveTab(value as TabType)} className="space-y-3 md:space-y-4">
          {/* Compact Tab List */}
          <TabsList className="grid w-full grid-cols-5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-800/50 rounded-xl p-2 sm:p-1 shadow-md min-h-[4rem] sm:min-h-[2.5rem]">
            <TabsTrigger
              value="all"
              className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 px-2 sm:px-1 rounded-lg transition-all"
              style={activeTab === 'all' ? {
                background: 'linear-gradient(to bottom right, #2563eb, #9333ea)',
                color: 'white',
                boxShadow: 'none'
              } : {}}
            >
              <Bell className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-[9px] sm:text-xs font-medium">All</span>
              {getCountByType('all') > 0 && (
                <span className="hidden sm:inline text-[10px]">({getCountByType('all')})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="trip"
              className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 px-2 sm:px-1 rounded-lg transition-all"
              style={activeTab === 'trip' ? {
                background: 'linear-gradient(to bottom right, #2563eb, #9333ea)',
                color: 'white',
                boxShadow: 'none'
              } : {}}
            >
              <Bus className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-[9px] sm:text-xs font-medium">Trip</span>
              {getCountByType('trip') > 0 && (
                <span className="hidden sm:inline text-[10px]">({getCountByType('trip')})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="notice"
              className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 px-2 sm:px-1 rounded-lg transition-all"
              style={activeTab === 'notice' ? {
                background: 'linear-gradient(to bottom right, #2563eb, #9333ea)',
                color: 'white',
                boxShadow: 'none'
              } : {}}
            >
              <Info className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-[9px] sm:text-xs font-medium">Notice</span>
              {getCountByType('notice') > 0 && (
                <span className="hidden sm:inline text-[10px]">({getCountByType('notice')})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="pickup"
              className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 px-2 sm:px-1 rounded-lg transition-all"
              style={activeTab === 'pickup' ? {
                background: 'linear-gradient(to bottom right, #2563eb, #9333ea)',
                color: 'white',
                boxShadow: 'none'
              } : {}}
            >
              <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-[9px] sm:text-xs font-medium">Pickup</span>
              {getCountByType('pickup') > 0 && (
                <span className="hidden sm:inline text-[10px]">({getCountByType('pickup')})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="dropoff"
              className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 px-2 sm:px-1 rounded-lg transition-all"
              style={activeTab === 'dropoff' ? {
                background: 'linear-gradient(to bottom right, #2563eb, #9333ea)',
                color: 'white',
                boxShadow: 'none'
              } : {}}
            >
              <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-[10px] sm:text-xs font-bold sm:font-medium">Drop</span>
              {getCountByType('dropoff') > 0 && (
                <span className="hidden sm:inline text-[10px]">({getCountByType('dropoff')})</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="space-y-2 md:space-y-3">
            {filteredNotifications.length === 0 ? (
              <Card className="border-gray-100 dark:border-gray-800 shadow-sm bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl">
                <CardContent className="py-12 md:py-16 text-center">
                  <div className="inline-flex p-3 md:p-4 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-2xl mb-3 md:mb-4">
                    <div className="text-gray-600 dark:text-gray-400">
                      {getTabIcon(activeTab)}
                    </div>
                  </div>
                  <p className="text-xs md:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {activeTab === 'all' ? 'No notifications' : `No ${activeTab} notifications`}
                  </p>
                  <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-500">
                    {activeTab === 'all' ? 'You\'ll see all notifications here when available' : `You'll see ${activeTab} updates here when available`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4 md:space-y-6">
                {filteredNotifications.map((notification) => (
                  <NotificationCardV2
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={markAsRead}
                    onRefresh={refresh}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

    </div>
  );
}
