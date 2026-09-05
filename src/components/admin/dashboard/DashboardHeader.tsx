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
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4 mt-2 animate-in fade-in duration-300">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative">
            {(() => {
              const cleanFirstName = (firstName || (role === 'moderator' ? 'Moderator' : 'Admin')).trim().split(/\s+/)[0];
              return (
                <h1 className={cn(
                  "text-2xl md:text-3xl font-extrabold tracking-tight leading-tight",
                  theme === 'dark' ? "bg-gradient-to-r from-white via-blue-100 to-indigo-100 bg-clip-text text-transparent" : "bg-gradient-to-r from-[#1E3A8A] via-[#1E40AF] to-[#1E3A8A] bg-clip-text text-transparent"
                )}>
                  <span className="hidden md:inline">Welcome back, {cleanFirstName}!</span>
                  <span className="inline md:hidden">Welcome {cleanFirstName}!</span>
                </h1>
              );
            })()}
            <div className="absolute -bottom-1 left-0 w-24 h-1 bg-gradient-to-r from-blue-600 to-transparent rounded-full shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
          </div>

          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-xl shadow-lg ring-1",
            theme === 'dark' ? "bg-[#0a0b14] border-white/5 ring-white/5" : "bg-white border-[#E5E7EB] ring-[#E5E7EB]/50"
          )}>
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
            </div>
            <span className="text-[10px] font-bold text-emerald-400">Live Engine</span>
          </div>
        </div>

        <p className={cn(
          "text-xs md:text-sm max-w-xl leading-relaxed font-medium",
          theme === 'dark' ? "text-slate-400" : "text-[#6B7280]"
        )}>
          {role === 'moderator'
            ? "Assist in managing the AdtU transit ecosystem. Support fleet operations, track student logistics, and ensure seamless transit coordination for the university."
            : "You have complete oversight of the AdtU transit ecosystem. Monitor fleet movements, track real-time revenue, and manage student logistics effortlessly."}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex flex-col items-start lg:items-end">
          <span className={cn("text-xs font-semibold flex items-center gap-2", theme === 'dark' ? "text-slate-400" : "text-[#6B7280]")}>
            <Clock className="w-3.5 h-3.5" />
            Last Updated
          </span>
          <span className={cn("text-sm font-mono", theme === 'dark' ? "text-slate-300" : "text-[#111827]")}>
            {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        <Button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 shadow-sm hover:shadow-lg hover:shadow-blue-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 disabled:opacity-50 flex items-center justify-center"
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
