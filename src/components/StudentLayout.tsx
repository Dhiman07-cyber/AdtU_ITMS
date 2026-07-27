"use client";

import { useTransportEntitlement } from "@/hooks/useTransportEntitlement";
import { cn } from "@/lib/utils";
import { Home,MapPin,QrCode,RefreshCcw,User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import StudentAuthWrapper from "./StudentAuthWrapper";

interface StudentLayoutProps {
  children: ReactNode;
}

export default function StudentLayout({ children }: StudentLayoutProps) {
  const pathname = usePathname();
  // Phase 3 — Track Bus / Bus Pass are transport features; show them in the nav
  // only while the student currently owns transport access. Dashboard, Renewal,
  // and Profile stay available in every lifecycle state.
  const { entitled: transportEntitled } = useTransportEntitlement();

  const navItems = [
    { href: "/student", icon: Home, label: "Dashboard" },
    ...(transportEntitled
      ? [
          { href: "/student/track-bus", icon: MapPin, label: "Track Bus" },
          { href: "/student/bus-pass", icon: QrCode, label: "Bus Pass" },
        ]
      : []),
    { href: "/student/renew-services", icon: RefreshCcw, label: "Renewal" },
    { href: "/student/profile", icon: User, label: "Profile" },
  ];

  return (
    <StudentAuthWrapper>
      <div className="pb-16 md:pb-0"> {/* Add bottom padding for mobile nav */}
        {children}
      </div>

      {/* Premium Bottom Navigation - Mobile Only - Matching Driver UI */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden z-[9999] transition-transform duration-300 data-[hidden=true]:translate-y-full" id="student-bottom-nav">
        {/* Glassmorphism Container */}
        <div className="bg-white/80 dark:bg-[#0E0F12]/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 shadow-2xl">

          <div className="flex justify-around items-center px-2 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const allNavHrefs = navItems.map(i => i.href);
              const isActive = pathname === item.href || (
                item.href !== "/student" &&
                pathname?.startsWith(item.href) &&
                !allNavHrefs.some(h => h !== item.href && h.startsWith(item.href) && pathname?.startsWith(h))
              );

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex flex-col items-center justify-center gap-1 flex-1 group"
                >
                  {/* Active Background Glow - Transparent */}
                  {isActive && (
                    <div className="absolute inset-0 bg-transparent rounded-xl" />
                  )}

                  {/* Icon Container with Enhanced Active State */}
                  <div className={cn(
                    "relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300",
                    isActive
                      ? "bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30 scale-105"
                      : "bg-gray-100 dark:bg-gray-800 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 group-active:scale-95"
                  )}>
                    {/* Icon Glow Effect */}
                    {isActive && (
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl blur-md opacity-50" />
                    )}

                    <Icon className={cn(
                      "relative h-5 w-5 transition-all duration-300",
                      isActive
                        ? "text-white"
                        : "text-gray-600 dark:text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400"
                    )} />
                  </div>

                  {/* Label with Enhanced Typography */}
                  <span className={cn(
                    "text-[10px] font-medium transition-all duration-300 relative",
                    isActive
                      ? "text-blue-600 dark:text-blue-400 font-bold"
                      : "text-gray-600 dark:text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400"
                  )}>
                    {item.label}
                    {/* Active underline */}
                    {isActive && (
                      <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full" />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </StudentAuthWrapper>
  );
}







