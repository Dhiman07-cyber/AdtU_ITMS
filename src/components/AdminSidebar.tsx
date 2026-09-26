"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Bell,
  Bus,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Command,
  GraduationCap,
  IdCard,
  Map,
  MessageSquareQuote,
  QrCode,
  RotateCcw,
  Route as RouteIcon,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSidebar } from "./AppShell";

import { useTheme } from "@/components/theme-provider";

interface SidebarItem {
  href: string;
  label: string;
  icon: typeof GraduationCap;
  color?: string;
}

interface NavGroup {
  name: string;
  items: SidebarItem[];
}

const adminNavGroups: NavGroup[] = [
  {
    name: "MANAGEMENT",
    items: [
      {
        href: "/admin/students",
        label: "Students",
        icon: GraduationCap,
        color: "text-blue-400",
      },
      {
        href: "/admin/drivers",
        label: "Drivers",
        icon: IdCard,
        color: "text-indigo-400",
      },
      {
        href: "/admin/moderators",
        label: "Moderators",
        icon: ShieldCheck,
        color: "text-pink-400",
      },
    ],
  },
  {
    name: "LIFECYCLE",
    items: [
      { href: "/admin/applications", label: "Applications", icon: ClipboardList, color: "text-orange-400" },
      { href: "/admin/renewal-service", label: "Pass Renewal", icon: RotateCcw, color: "text-amber-400" },
      { href: "/admin/verification", label: "Verification", icon: QrCode, color: "text-cyan-400" },
      { href: "/admin/smart-allocation", label: "Reassignment Hub", icon: ArrowLeftRight, color: "text-teal-400" },
    ],
  },
  {
    name: "FLEET & OPS",
    items: [
      { href: "/admin/buses", label: "Buses", icon: Bus, color: "text-amber-400" },
      { href: "/admin/routes", label: "Routes", icon: RouteIcon, color: "text-emerald-400" },
      { href: "/admin/fleet-map", label: "Fleet Map", icon: Map, color: "text-sky-400" },
    ],
  },
  {
    name: "SYSTEM",
    items: [
      { href: "/admin/notifications", label: "Notifications", icon: Bell, color: "text-red-400" },
      { href: "/admin/feedback", label: "Feedbacks", icon: MessageSquareQuote, color: "text-cyan-400" },
      { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText, color: "text-violet-400" },
    ],
  },
];

// Precompute once at module scope — avoids rebuilding this array for every nav item on render
const adminAllHrefs = adminNavGroups.flatMap((group) => group.items.map((i) => i.href));

export default function AdminSidebar() {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();
  const { theme } = useTheme();

  // Auto-collapse on small screens if resized below desktop breakpoint
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (window.innerWidth < 1024 && !collapsed) {
          setCollapsed(true);
        }
      }, 150);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [collapsed, setCollapsed]);

  return (
    <aside
      style={{
        width: collapsed ? 64 : 220,
        willChange: "width",
        contain: "layout style paint",
        transform: "translate3d(0, 0, 0)",
        backfaceVisibility: "hidden",
        overscrollBehavior: "contain",
      }}
      className={cn(
        "fixed top-12 left-0 bottom-0 z-40",
        "border-r",
        theme === "dark" ? "border-white/10 bg-[#0B1224]" : "border-admin-border bg-admin-sidebar",
        "flex flex-col overflow-hidden overscroll-contain",
        "hidden md:flex",
        "transition-[width] duration-100 ease-linear"
      )}
    >
      {/* Header/Toggle Section */}
      <div
        className={cn(
          "flex items-center px-3 py-2 h-13 shrink-0 border-b border-white/5",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed ? (
          <Link
            href="/admin"
            className="flex items-center gap-2.5 group cursor-pointer outline-none"
            title="Open Dashboard"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-1.5 rounded-lg bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/20 group-hover:border-blue-500/40 transition-colors">
                <Command className="h-3.5 w-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <div className="flex flex-col">
              <span
                className={cn(
                  "text-[12px] font-bold leading-none tracking-tight group-hover:text-blue-400 transition-colors",
                  theme === "dark" ? "text-zinc-100" : "text-admin-text"
                )}
              >
                Control Hub
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  theme === "dark" ? "text-zinc-400" : "text-admin-text-secondary"
                )}
              >
                Administrator
              </span>
            </div>
          </Link>
        ) : (
          <Link
            href="/admin"
            className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/20 hover:border-blue-500/40 transition-colors cursor-pointer"
            title="Open Dashboard"
          >
            <Command className="h-3.5 w-3.5 text-blue-400" />
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "h-6 w-6 rounded-md transition-colors",
            theme === "dark"
              ? "hover:bg-white/5 text-zinc-500 hover:text-zinc-200"
              : "hover:bg-admin-hover text-admin-text-secondary hover:text-admin-text"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Navigation Groups - Comfortable Sizing */}
      <nav
        style={{ overscrollBehavior: "contain" }}
        className={cn(
          "flex-1 px-2.5 overflow-y-auto no-scrollbar py-2.5 overscroll-contain",
          collapsed ? "space-y-2" : "space-y-3"
        )}
      >
        {adminNavGroups.map((group) => (
          <div key={group.name} className="space-y-0.5">
            {!collapsed && (
              <h3
                className={cn(
                  "px-2 text-[9px] uppercase tracking-widest font-bold font-mono text-zinc-400 dark:text-zinc-400",
                  "pt-1.5 pb-0.5"
                )}
              >
                {group.name}
              </h3>
            )}
            <div className={cn(collapsed ? "space-y-2" : "space-y-1")}>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" &&
                    pathname?.startsWith(item.href) &&
                    !adminAllHrefs.some(
                      (h) => h !== item.href && h.startsWith(item.href) && pathname?.startsWith(h)
                    ));

                const linkContent = (
                  <div
                    className={cn(
                      "group relative flex items-center gap-2.5 px-3 rounded-lg transition-colors duration-150",
                      collapsed ? "py-2" : "py-1.5",
                      "text-[12.5px] font-medium outline-none cursor-pointer",
                      isActive
                        ? theme === "dark"
                          ? "text-blue-400 bg-blue-400/10 font-semibold"
                          : "text-admin-primary bg-admin-active font-semibold"
                        : theme === "dark"
                        ? "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
                        : "text-admin-text-secondary hover:text-admin-text hover:bg-admin-hover"
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1 bottom-1 w-[2.5px] bg-blue-500 rounded-r-full shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                    )}

                    <Link
                      href={item.href}
                      className="flex items-center gap-2.5 flex-1 min-w-0"
                    >
                      <div
                        className={cn(
                          "relative flex items-center justify-center shrink-0",
                          collapsed ? "mx-auto" : ""
                        )}
                      >
                        <Icon className={cn("h-4 w-4", isActive ? "text-blue-400" : item.color)} />
                        {isActive && <div className="absolute inset-0 bg-blue-400/10 rounded-full" />}
                      </div>

                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                    </Link>
                  </div>
                );

                if (!collapsed) {
                  return <div key={item.href}>{linkContent}</div>;
                }

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent
                      side="right"
                      sideOffset={10}
                      className={cn(
                        "border text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xl",
                        theme === "dark"
                          ? "bg-[#090a10] border-slate-700/50 text-slate-100"
                          : "bg-admin-card border-admin-border text-admin-text"
                      )}
                    >
                      <span>{item.label}</span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* System & Footer Section (Pinned to Bottom) */}
      <div className="mt-auto flex flex-col gap-0.5 px-2 pb-2 pt-1 border-t border-white/5">
        {collapsed ? (
          <Tooltip key="sys-config-collapsed">
            <TooltipTrigger asChild>
              <Link
                href="/admin/sys-renewal-config-x9k2p"
                className={cn(
                  "group relative flex items-center gap-2.5 px-2.5 rounded-lg transition-colors duration-200 py-1.5",
                  "text-[12px] font-medium outline-none",
                  pathname?.includes("sys-renewal-config")
                    ? theme === "dark"
                      ? "text-white bg-white/5"
                      : "text-admin-text bg-admin-active"
                    : theme === "dark"
                    ? "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
                    : "text-admin-text-secondary hover:text-admin-text hover:bg-admin-hover"
                )}
              >
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:rotate-90 mx-auto">
                  <Settings
                    className={cn(
                      "h-3.5 w-3.5 transition-colors",
                      theme === "dark"
                        ? "text-zinc-400 group-hover:text-white"
                        : "text-admin-text-secondary group-hover:text-admin-text"
                    )}
                  />
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              className={cn(
                "border text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xl",
                theme === "dark"
                  ? "bg-[#090a10] border-slate-700/50 text-slate-100"
                  : "bg-white border-[#E5E7EB] text-[#111827]"
              )}
            >
              <span>System Config</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/admin/sys-renewal-config-x9k2p"
            className={cn(
              "group relative flex items-center gap-2.5 px-2 rounded-lg transition-colors duration-200 py-1",
              "text-[12px] font-medium outline-none",
              pathname?.includes("sys-renewal-config")
                ? theme === "dark"
                  ? "text-white bg-white/5"
                  : "text-admin-text bg-admin-active"
                : theme === "dark"
                ? "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
                : "text-admin-text-secondary hover:text-admin-text hover:bg-admin-hover"
            )}
          >
            <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:rotate-90">
              <Settings
                className={cn(
                  "h-3.5 w-3.5 transition-colors",
                  theme === "dark"
                    ? "text-zinc-400 group-hover:text-white"
                    : "text-admin-text-secondary group-hover:text-admin-text"
                )}
              />
            </div>
            <div className="flex flex-col items-start leading-none">
              <span className={cn(theme === "dark" ? "text-zinc-200" : "text-admin-text")}>
                System Config
              </span>
              <span
                className={cn(
                  "text-[8.5px] mt-0.5",
                  theme === "dark" ? "text-zinc-400" : "text-admin-text-secondary"
                )}
              >
                Core Settings
              </span>
            </div>
          </Link>
        )}

        {/* Active Status Footer */}
        {!collapsed ? (
          <div className="px-2 pt-0.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
              <span
                className={cn(
                  "text-[8.5px] uppercase tracking-wider font-semibold",
                  theme === "dark" ? "text-zinc-400" : "text-admin-text-secondary"
                )}
              >
                Active
              </span>
            </div>
            <span
              className={cn(
                "text-[8.5px] font-mono",
                theme === "dark" ? "text-zinc-400" : "text-admin-text-secondary"
              )}
            >
              v2.4.0
            </span>
          </div>
        ) : (
          <div className="flex justify-center pt-0.5 opacity-60">
            <span
              className={cn(
                "text-[8px] font-mono tracking-tighter",
                theme === "dark" ? "text-zinc-400" : "text-admin-text-secondary"
              )}
            >
              v2.4.0
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
