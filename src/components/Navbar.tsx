"use client";

import { useAuth } from "@/contexts/auth-context";
import { useTransportEntitlement } from "@/hooks/useTransportEntitlement";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import React, { useState, useCallback, useEffect } from "react";
import {
  User, Bus, Bell, Menu, X, LayoutDashboard,
  GraduationCap, UserCog, ShieldCheck, MapPin,
  ClipboardCheck, MessageCircle, Settings2, LogOut,
  ChevronRight, QrCode, RefreshCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/signout-button";
import { CompactPingIndicator } from '@/components/PingIndicator';
import { APP_NAME } from '@/config/runtime';
import { useNotifications } from '@/contexts/NotificationContext';
import { cn } from "@/lib/utils";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavbarProps {
  onMenuToggle?: () => void;
  isSidebarOpen?: boolean;
}

interface MobileRoute {
  label: string;
  href: string;
  icon: any;
  color: string;
}

const Navbar = React.memo(function Navbar({ onMenuToggle, isSidebarOpen = false }: NavbarProps) {
  const { currentUser, userData, needsApplication } = useAuth();
  // Phase 3 — gate transport nav items (Track Bus / My Pass) by canonical entitlement.
  const { entitled: transportEntitled } = useTransportEntitlement();
  const googleProvider = currentUser?.providerData?.find(p => p.providerId === 'google.com');
  const rawGoogleName = googleProvider?.displayName || currentUser?.displayName;
  const googleName = (rawGoogleName && !rawGoogleName.includes('@'))
    ? rawGoogleName
    : (userData?.fullName || userData?.name || "User");
  const router = useRouter();
  const pathname = usePathname();
  const appName = APP_NAME;
  const { unreadCount } = useNotifications();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);

  const isAdminArea = pathname?.startsWith('/admin');
  const isModeratorArea = pathname?.startsWith('/moderator');
  const isMobileCapable = isAdminArea || isModeratorArea;

  // Sync mobile menu state with the parent sidebar toggle if needed
  // However, the user wants to REPLACE the profile dropdown with this menu
  // so we'll use our own state for the profile-triggered menu.

  const getDashboardPath = useCallback(() => {
    if (needsApplication) return "/apply/form";
    if (userData?.role === 'admin') return "/admin";
    if (userData?.role === 'moderator') return "/moderator";
    if (userData?.role === 'driver') return "/driver";
    if (userData?.role === 'student') return "/student";
    return "/";
  }, [userData?.role, needsApplication]);

  // Define routes for mobile menu
  const getMobileRoutes = (): MobileRoute[] => {
    if (userData?.role === 'admin') {
      return [
        { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, color: 'text-blue-500' },
        { label: 'Students', href: '/admin/students', icon: GraduationCap, color: 'text-indigo-500' },
        { label: 'Drivers', href: '/admin/drivers', icon: UserCog, color: 'text-purple-500' },
        { label: 'Moderators', href: '/admin/moderators', icon: ShieldCheck, color: 'text-pink-500' },
        { label: 'Buses', href: '/admin/buses', icon: Bus, color: 'text-amber-500' },
        { label: 'Routes', href: '/admin/routes', icon: MapPin, color: 'text-emerald-500' },
        { label: 'Applications', href: '/admin/applications', icon: ClipboardCheck, color: 'text-orange-500' },
        { label: 'Notifications', href: '/admin/notifications', icon: Bell, color: 'text-red-500' },
        { label: 'Feedback', href: '/admin/feedback', icon: MessageCircle, color: 'text-cyan-500' },
        { label: 'System Config', href: '/admin/sys-renewal-config-x9k2p', icon: Settings2, color: 'text-slate-600' },
      ];
    }
    if (userData?.role === 'moderator') {
      return [
        { label: 'Profile', href: '/moderator/profile', icon: User, color: 'text-slate-400' },
        { label: 'Dashboard', href: '/moderator', icon: LayoutDashboard, color: 'text-blue-500' },
        { label: 'Students', href: '/moderator/students', icon: GraduationCap, color: 'text-indigo-500' },
        { label: 'Drivers', href: '/moderator/drivers', icon: UserCog, color: 'text-purple-500' },
        { label: 'Buses', href: '/moderator/buses', icon: Bus, color: 'text-amber-500' },
        { label: 'Routes', href: '/moderator/routes', icon: MapPin, color: 'text-emerald-500' },
        { label: 'Applications', href: '/moderator/applications', icon: ClipboardCheck, color: 'text-orange-500' },
        { label: 'Notifications', href: '/moderator/notifications', icon: Bell, color: 'text-red-500' },
        { label: 'Feedback', href: '/moderator/feedback', icon: MessageCircle, color: 'text-cyan-500' },
      ];
    }
    if (userData?.role === 'driver') {
      return [
        { label: 'Dashboard', href: '/driver', icon: LayoutDashboard, color: 'text-blue-500' },
        { label: 'Live Tracking', href: '/driver/live-tracking', icon: MapPin, color: 'text-emerald-500' },
        { label: 'Scan Pass', href: '/driver/scan-pass', icon: QrCode, color: 'text-purple-500' },
        { label: 'My Students', href: '/driver/students', icon: GraduationCap, color: 'text-indigo-500' },
        { label: 'Notifications', href: '/driver/notifications', icon: Bell, color: 'text-red-500' },
      ];
    }
    if (userData?.role === 'student') {
      return [
        { label: 'Dashboard', href: '/student', icon: LayoutDashboard, color: 'text-blue-500' },
        ...(transportEntitled
          ? [
              { label: 'Track Bus', href: '/student/track-bus', icon: MapPin, color: 'text-emerald-500' },
              { label: 'My Pass', href: '/student/bus-pass', icon: QrCode, color: 'text-purple-500' },
            ]
          : []),
        { label: 'Renew Service', href: '/student/renew-services', icon: RefreshCcw, color: 'text-orange-500' },
        { label: 'Notifications', href: '/student/notifications', icon: Bell, color: 'text-red-500' },
      ];
    }
    return [];
  };

  const mobileRoutes = getMobileRoutes();

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // Hide bottom nav when mobile menu is open
  useEffect(() => {
    const bottomNavs = document.querySelectorAll('#student-bottom-nav, nav.fixed.bottom-0');
    if (isMobileMenuOpen) {
      bottomNavs.forEach(nav => {
        if (nav instanceof HTMLElement) {
          nav.style.display = 'none';
        }
      });
    } else {
      bottomNavs.forEach(nav => {
        if (nav instanceof HTMLElement) {
          nav.style.display = '';
        }
      });
    }
  }, [isMobileMenuOpen]);

  if (!currentUser) return null;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[9999] bg-white dark:bg-neutral-900 border-b border-[rgba(255,255,255,0.06)] shadow-sm transition-colors duration-200"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4">
        <div className="flex items-center justify-between h-12" style={{ minHeight: '48px' }}>
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            {/* App Logo + Name */}
            <Link
              href={getDashboardPath()}
              className="flex items-center space-x-1.5 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg rounded-lg px-1"
              aria-label={`${appName} - Go to Dashboard`}
            >
              <div className="bg-theme-accent p-1 rounded-lg transition-colors">
                <Bus className="h-4 w-4 text-blue-400" />
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white transition-colors">
                {appName}
              </span>
            </Link>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-2.5">
            <CompactPingIndicator />

            {userData?.role && (
              <Link href={`/${userData.role}/notifications`}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative rounded-full hover:bg-white/10 h-8 w-8 transition-colors focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg",
                    pathname === `/${userData.role}/notifications`
                      ? "bg-theme-accent text-white"
                      : "text-theme-text-secondary hover:text-theme-text"
                  )}
                  title={`Your Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                  aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                >
                  <Bell className="h-3.5 w-3.5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center px-1 py-0.5 text-[9px] font-bold leading-none text-white transform bg-theme-danger rounded-full min-w-[0.875rem] h-3.5">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
              </Link>
            )}

            {/* Profile Dropdown / Mobile Menu Toggle */}
            <div className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-full hover:bg-white/10 text-theme-text-secondary hover:text-theme-text transition-all duration-200 h-8 w-8",
                  isMobileMenuOpen && "bg-white/10 text-theme-text"
                )}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label="Toggle navigation menu"
              >
                {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </div>

            {/* Desktop Profile Dropdown */}
            <div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-white/10 text-theme-text-secondary hover:text-theme-text transition-all duration-200 hover:scale-105 h-8 w-8 focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg"
                    aria-label="User menu"
                  >
                    <User className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60 z-[10000] backdrop-blur-xl bg-theme-surface/95 border border-white/10 shadow-2xl rounded-xl p-1 animate-in fade-in-0 zoom-in-95"
                >
                  <DropdownMenuLabel className="font-normal p-2">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-theme-accent to-theme-accent-3 rounded-xl shadow-lg ring-1 ring-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <User className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-sm font-semibold text-theme-text truncate leading-none">
                          {googleName}
                        </p>
                        <p className="text-[10px] text-theme-text-secondary truncate font-medium">
                          {userData?.email || currentUser?.email}
                        </p>
                        <div className="pt-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/20 capitalize shadow-sm">
                            {needsApplication ? "New User" : (userData?.role || "User")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </DropdownMenuLabel>

                  {userData?.role && userData.role !== 'admin' && (
                    <>
                      <DropdownMenuSeparator className="bg-white/10 mx-1 my-1" />
                      <DropdownMenuItem
                        onClick={() => router.push(`/${userData.role}/profile`)}
                        className="flex items-center gap-3 cursor-pointer mx-1 rounded-lg text-sm text-theme-text focus:bg-theme-accent/10 focus:text-theme-accent transition-all duration-200 px-3 py-2"
                      >
                        <User className="h-4 w-4 opacity-70 text-white" />
                        <span className="font-medium text-white">Profile</span>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator className="bg-white/10 mx-1 my-1" />
                  <div className="p-1">
                    <SignOutButton variant="ghost" size="sm" showText={true} />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Full Width Mobile Menu Overlay */}
      <AnimatePresence mode="wait">
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, clipPath: 'inset(0% 0% 100% 0%)' }}
            animate={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
            exit={{ opacity: 0, clipPath: 'inset(0% 0% 100% 0%)' }}
            transition={{
              duration: 0.6,
              ease: [0.19, 1, 0.22, 1]
            }}
            className="md:hidden fixed inset-0 z-[10000] overflow-hidden bg-[#09090b] flex flex-col shadow-2xl"
          >
            {/* Profile Section - Dark Premium SaaS style */}
            <div className="px-6 py-8 border-b border-white/10 bg-white/[0.03] relative">
              <div className="absolute top-6 right-6 flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-gray-300 transition-all active:scale-95 shadow-sm"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-[2px] shadow-lg border border-white/10">
                    <div className="w-full h-full rounded-full bg-blue-950 flex items-center justify-center overflow-hidden">
                      {userData?.role !== 'admin' && (userData?.profilePhotoUrl || userData?.photoURL) ? (
                        <img
                          src={safeImageSrc(userData.profilePhotoUrl || userData.photoURL)}
                          alt={userData.fullName || userData.name || "Profile"}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="h-7 w-7 text-blue-100" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <h2 className="text-lg font-bold text-white tracking-tight leading-snug truncate">
                    {googleName}
                  </h2>
                  <p className="text-xs text-gray-400 font-medium truncate">
                    {userData?.email || currentUser?.email}
                  </p>
                  <div className="flex pt-0.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[9px] font-bold bg-blue-500/10 border border-blue-500/20 text-blue-300 uppercase tracking-widest shadow-sm">
                      {userData?.role || "Member"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Grid/List - Dark Mode with Separators */}
            <div className="flex-1 px-0 py-2 overflow-y-auto no-scrollbar">
              {mobileRoutes.map((route, idx) => {
                const allMobileHrefs = mobileRoutes.map(r => r.href);
                const isActive = pathname === route.href || (
                  route.href !== `/${userData?.role}` &&
                  pathname?.startsWith(route.href) &&
                  !allMobileHrefs.some(h => h !== route.href && h.startsWith(route.href) && pathname?.startsWith(h))
                );
                const isLast = idx === mobileRoutes.length - 1;

                return (
                  <motion.div
                    key={route.href}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                  >
                    <Link
                      href={route.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        "group flex items-center justify-between py-4 px-6 transition-all duration-200",
                        isActive
                          ? "bg-white/5 border-l-2 border-l-blue-500"
                          : cn("hover:bg-white/[0.02]", !isLast && "border-b border-white/[0.06]")
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300",
                          isActive ? "bg-blue-600/20 text-blue-400" : "bg-transparent text-gray-500 group-hover:text-gray-300"
                        )}>
                          <route.icon className={cn("h-5 w-5", isActive && "text-blue-400")} />
                        </div>
                        <span className={cn(
                          "text-[15px] font-medium tracking-wide transition-colors",
                          isActive ? "text-blue-400 font-semibold" : "text-gray-400 group-hover:text-gray-200"
                        )}>
                          {route.label}
                        </span>
                      </div>
                      <ChevronRight className={cn(
                        "h-4 w-4 transition-all duration-300",
                        isActive ? "text-blue-400 opacity-100" : "text-gray-600 opacity-0 group-hover:opacity-50 -translate-x-2 group-hover:translate-x-0"
                      )} />
                    </Link>
                  </motion.div>
                );
              })}
            </div>

            {/* Sign Out Section - Dark styled */}
            <div className="p-6 mt-auto bg-white/[0.02] border-t border-white/5">
              <Button
                variant="default"
                size="lg"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsSignOutDialogOpen(true);
                }}
                className="w-full justify-center bg-gradient-to-r from-red-600/90 to-rose-700/90 hover:from-red-600 hover:to-rose-700 text-white rounded-[20px] py-7 text-base font-black shadow-lg shadow-red-900/20 border border-white/5 transition-all active:scale-[0.97] flex items-center gap-3"
              >
                <LogOut className="h-5 w-5" />
                <span>Sign Out</span>
              </Button>

              {/* Branding Footer */}
              <div className="mt-8 mb-4 flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Bus className="h-4 w-4 text-blue-500/80" />
                  <span className="text-[11px] font-black uppercase tracking-[0.25em]">{appName}</span>
                </div>
                <div className="h-1 w-1 rounded-full bg-gray-700" />
                <span className="text-[10px] font-extrabold text-gray-600">VERSION 2.4.0 • ENTERPRISE EDITION</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Root-level controlled SignOut dialog to survive mobile menu closing */}
      <SignOutButton
        suppressTrigger
        open={isSignOutDialogOpen}
        onOpenChange={setIsSignOutDialogOpen}
      />
    </nav>
  );
});

export default Navbar;


