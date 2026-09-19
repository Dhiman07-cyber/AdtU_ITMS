"use client";

import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Clock,RefreshCw } from 'lucide-react';
import { DashboardStats } from './types';

interface DashboardHeaderProps {
  firstName: string;
  lastUpdated: Date;
  isRefreshing: boolean;
  onRefresh: () => void;
  stats: DashboardStats;
  role?: 'admin' | 'moderator';
}

export default function DashboardHeader({
  firstName,
  lastUpdated,
  isRefreshing,
  onRefresh,
  stats,
  role = 'admin'
}: DashboardHeaderProps) {
  const { theme } = useTheme();
  const activeTripsCount = stats.activeBuses;
  const idleBusesCount = stats.totalBuses - stats.activeBuses;
  const driversReadyCount = stats.totalDrivers; // Simplification, assume all drivers ready if not on trip
  const systemLoad = stats.totalBuses > 0 ? Math.round((stats.activeBuses / stats.totalBuses) * 100) : 0;

  return (
    <div className="itms-page-header-container mb-4 mt-2 animate-in fade-in duration-300">
      {/* Top Row: Welcome Title on Left, Last Updated & Refresh on Right in SAME LINE */}
      <div className="flex items-center justify-between gap-2 w-full">
        {/* Left: Title + Live Engine (desktop) */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            {(() => {
              const cleanFirstName = (firstName || (role === 'moderator' ? 'Moderator' : 'Admin')).trim().split(/\s+/)[0];
              return (
                <h1 className={cn(
                  "text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight leading-tight truncate",
                  theme === 'dark' ? "bg-gradient-to-r from-white via-blue-100 to-indigo-100 bg-clip-text text-transparent" : "bg-gradient-to-r from-[#1E3A8A] via-[#1E40AF] to-[#1E3A8A] bg-clip-text text-transparent"
                )}>
                  <span className="hidden md:inline">Welcome back, {cleanFirstName}!</span>
                  <span className="inline md:hidden">Welcome {cleanFirstName}!</span>
                </h1>
              );
            })()}
            <div className="absolute -bottom-1 left-0 w-16 sm:w-24 h-1 bg-gradient-to-r from-blue-600 to-transparent rounded-full shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
          </div>

          {/* Live Engine tag: Hidden on small/mobile screens per user instruction */}
          <div className={cn(
            "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl shadow-lg ring-1 flex-shrink-0",
            theme === 'dark' ? "bg-[#0a0b14] border-white/5 ring-white/5" : "bg-white border-[#E5E7EB] ring-[#E5E7EB]/50"
          )}>
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
            </div>
            <span className="text-[10px] font-bold text-emerald-400">Live Engine</span>
          </div>
        </div>

        {/* Right: Last Updated & Refresh in SAME LINE at rightmost end */}
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div className="hidden sm:flex flex-col items-end">
            <span className={cn("text-[10px] sm:text-xs font-semibold flex items-center gap-1.5", theme === 'dark' ? "text-slate-400" : "text-[#6B7280]")}>
              <Clock className="w-3 h-3" />
              Last Updated
            </span>
            <span className={cn("text-xs sm:text-sm font-mono", theme === 'dark' ? "text-slate-300" : "text-[#111827]")}>
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          <Button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="group h-8 px-3.5 bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-200 dark:border-zinc-700/60 shadow-xs text-xs font-semibold rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50 flex items-center justify-center cursor-pointer gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Subtitle row on the left - strictly 1 line only */}
      <p className={cn(
        "text-[11px] sm:text-xs md:text-sm max-w-xl font-medium mt-1 truncate",
        theme === 'dark' ? "text-slate-400" : "text-[#6B7280]"
      )}>
        {role === 'moderator'
          ? "Support fleet operations, track student logistics & transit coordination."
          : "Monitor fleet movements, track real-time revenue, and manage transit logistics."}
      </p>
    </div>
  );
}
