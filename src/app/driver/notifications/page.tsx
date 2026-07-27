"use client";

import NotificationCardV2 from "@/components/NotificationCardV2";
import NotificationFormV2 from "@/components/NotificationFormV2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/contexts/toast-context";
import { Bell,MapPin,MapPinOff,Megaphone,Plus,RefreshCw,Zap } from "lucide-react";
import { useRouter } from 'next/navigation';
import { useEffect,useMemo,useState } from "react";

import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function DriverNotificationsPage() {
  const router = useRouter();
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const {
    notifications: allNotifications,
    unreadCount,
    loading,
    markAsRead,
    refresh
  } = useNotifications();


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

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'notifications' | 'notice' | 'pickup' | 'dropoff'>('notifications');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    addToast('Notifications refreshed', 'success');
    setIsRefreshing(false);
  };

  // Filter notifications by type for tabs
  const filteredNotifications = useMemo(() => {
    if (activeSection === 'notifications') return allNotifications;
    // Map internal Tab name to NotificationType
    const sectionToType: Record<string, string> = {
      'notice': 'notice',
      'pickup': 'pickup',
      'dropoff': 'dropoff'
    };
    return allNotifications.filter((n: any) => n.type === sectionToType[activeSection]);
  }, [allNotifications, activeSection]);

  // Check authorization
  useEffect(() => {
    if (!authLoading && userData && userData.role !== 'driver') {
      router.push(`/${userData.role}`);
    }
  }, [userData, router, authLoading]);

  if (loading || authLoading) {
    return (
      <PremiumPageLoader
        message="Syncing Notifications"
        subMessage="Preparing your broadcast center..."
        fullScreen
      />
    );
  }

  return (
    <div className="flex-1 bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 pb-24 md:pb-12 text-gray-900 dark:text-gray-100 min-h-screen relative overflow-hidden">
      {/* Animated background elements matching Driver Dashboard */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-6 relative z-10">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 p-1">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 opacity-50 blur-3xl" />
          <div className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-3xl p-4 sm:p-8 md:p-10">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 sm:gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                      Notifications
                    </h1>
                    <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 mt-1 uppercase tracking-widest font-black">
                      Official Broadcast Center
                    </p>
                  </div>

                  {/* Mobile Create Button - Same row as title */}
                  <div className="sm:hidden">
                    <Button
                      onClick={() => setCreateDialogOpen(true)}
                      className="h-10 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-black uppercase tracking-wider shadow-lg active:scale-95 transition-all text-[10px] rounded-xl"
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Create
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3 sm:mt-4">
                  <Badge className="px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-black bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 uppercase tracking-tight">
                    <Bell className="h-3 w-3 mr-1" />
                    Driver Access
                  </Badge>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider animate-pulse">
                      <Zap className="h-3 w-3 mr-1" />
                      {unreadCount} New
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
                {/* Desktop Create Button */}
                <div className="hidden sm:block">
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    className="h-12 px-8 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-black uppercase tracking-[0.15em] shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all text-xs rounded-xl"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    New Broadcast
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="h-10 sm:h-12 px-5 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-black text-[10px] sm:text-[11px] uppercase tracking-widest rounded-xl transition-all duration-300 active:scale-95 w-full sm:w-auto"
                >
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'rotate-0'}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-800/50 rounded-2xl p-1.5 shadow-sm">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {[
              { id: 'notifications', label: 'All', icon: Bell },
              { id: 'notice', label: 'Notices', icon: Megaphone },
              { id: 'pickup', label: 'Pickup', icon: MapPin },
              { id: 'dropoff', label: 'Dropoff', icon: MapPinOff },
            ].map((tab) => {
              const Icon = tab.icon;
              const count = tab.id === 'notifications'
                ? allNotifications.length
                : allNotifications.filter(n => n.type === tab.id).length;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id as any)}
                  className={`px-3 sm:px-4 py-2.5 rounded-xl font-black transition-all duration-300 flex items-center justify-center gap-2 ${activeSection === tab.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md scale-[1.02]'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                  <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline text-xs uppercase tracking-widest">{tab.label}</span>
                  {count > 0 && (
                    <span className={`text-[10px] ${activeSection === tab.id ? 'opacity-70' : 'text-slate-400'}`}>({count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notifications List */}
        <div className="space-y-4 md:space-y-6">
          {filteredNotifications.length === 0 ? (
            <Card className="bg-white/50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800 rounded-3xl py-24 text-center border-dashed">
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 bg-gray-50 dark:bg-gray-800/50 rounded-full flex items-center justify-center border border-gray-100 dark:border-gray-700">
                  <Bell className="h-8 w-8 text-gray-300 dark:text-gray-600" />
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight text-slate-400">All caught up!</h3>
                  <p className="text-[11px] md:text-sm text-blue-100 mt-1 md:mt-0.5 font-medium max-w-[180px] md:max-w-none leading-tight">
                    Stay updated with announcements and alerts
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            filteredNotifications.map((notification) => (
              <NotificationCardV2
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onRefresh={refresh}
              />
            ))
          )}
        </div>

        {/* Create Notification Form (Self-managed Modal) */}
        <NotificationFormV2
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSuccess={() => {
            setCreateDialogOpen(false);
            refresh();
          }}
        />
      </div>
    </div>
  );
}
