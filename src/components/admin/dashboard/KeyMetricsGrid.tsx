"use client";

import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
	ArrowUpRight,
	Bus,
	FileCheck,
	IndianRupee,
	UserCheck,
	Users
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DashboardStats } from './types';

// Mini sparkline data simulation
const generateSparklineData = (base: number) => {
  return Array.from({ length: 10 }, (_, i) => ({
    value: base + Math.random() * (base * 0.2) - (base * 0.1)
  }));
};

interface MetricCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon: any;
  trend?: string;
  trendColor?: 'emerald' | 'blue' | 'amber';
  color: string;
  className?: string;
  sparklineBase?: number;
}

const MetricCard = ({
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  trendColor = 'emerald',
  color,
  className,
  sparklineBase
}: MetricCardProps) => {
  const { theme } = useTheme();
  const data = sparklineBase ? generateSparklineData(sparklineBase) : [];

  return (
    <Card className={cn(
      "relative overflow-hidden group transition-all duration-500 hover:cursor-pointer",
      theme === 'dark' ? "border-white/5 bg-[#0a0b14] hover:bg-[#0f101f]" : "border-[#E5E7EB] bg-white hover:bg-gray-50",
      className
    )}>
      <CardContent className="p-2 md:p-2.5 flex flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center mb-2">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-105 duration-500",
            color
          )}>
            <Icon className="w-4 h-4" />
          </div>
        </div>

        <div className="space-y-0.5 w-full">
          <h3 className={cn("text-[10px] font-bold", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>{title}</h3>
          <div className="flex flex-col items-center">
            <span className={cn("text-2xl font-bold", theme === 'dark' ? "text-white" : "text-[#111827]")}>{value}</span>
            {subValue && <span className={cn("text-[10px] font-semibold", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>{subValue}</span>}
          </div>
        </div>

      </CardContent>
    </Card>
  );
};

export default function KeyMetricsGrid({ stats, role = 'admin' }: { stats: DashboardStats, role?: 'admin' | 'moderator' }) {
  const router = useRouter();
  const { theme } = useTheme();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-9 gap-3 mb-8">
      {/* Primary Revenue/Payment Card - Spans 5/9 columns (~55%) and 2 rows on large screens */}
      <Card className={cn(
        "md:col-span-2 lg:col-span-5 lg:row-span-2 relative overflow-hidden group shadow-2xl transition-all duration-500 min-h-[220px] md:min-h-0",
        theme === 'dark' ? "border-white/5 bg-[#0a0b14] hover:bg-[#0f101f]" : "border-[#E5E7EB] bg-white hover:bg-gray-50"
      )}>
        {/* Background Watermark - Scaled down and opacity lowered on mobile to prevent overlap */}
        <div className="absolute top-12 sm:top-16 right-0 p-3 sm:p-8 opacity-5 sm:opacity-10 pointer-events-none select-none overflow-hidden group-hover:opacity-15 transition-opacity">
          {role === 'admin' ? (
            <IndianRupee className="w-20 h-20 sm:w-32 sm:h-32 text-indigo-500" />
          ) : (
            <FileCheck className="w-20 h-20 sm:w-32 sm:h-32 text-emerald-500" />
          )}
        </div>

        <CardContent className="p-4 sm:p-4 md:p-3 px-4 sm:px-5 md:px-6 pb-3 sm:pb-3 flex flex-col justify-between h-full relative z-10 min-h-[210px] md:min-h-0">
          <div className="space-y-3 sm:space-y-2">
            <div className="flex items-center justify-between">
              <div className={cn(
                "px-3 sm:px-4 py-1 sm:py-1.5 rounded-full border flex items-center gap-1.5 sm:gap-2",
                theme === 'dark' ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
              )}>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-emerald-400">
                  {role === 'admin' ? 'Real-time Revenue' : 'Payment Processing'}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={cn("group/btn h-7 sm:h-8 px-2 sm:px-3", theme === 'dark' ? "text-slate-400 hover:text-white" : "text-[#6B7280] hover:text-[#111827]")}
                onClick={() => router.push(role === 'admin' ? '/admin/renewal-service' : '/moderator/renewal-service')}
              >
                <span className="text-[10px] font-bold mr-1 sm:mr-2">Revenue</span>
                <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
              </Button>
            </div>

            <div className="space-y-1">
              <h3 className={cn("text-xs sm:text-sm font-bold", theme === 'dark' ? "text-slate-400" : "text-[#6B7280]")}>
                {role === 'admin' ? 'Total Cumulative Revenue' : 'Online vs Offline Preference'}
              </h3>
              <div className="flex items-baseline gap-4">
                {role === 'admin' ? (
                  <span className={cn("text-3xl sm:text-3xl md:text-4xl font-bold tracking-tight", theme === 'dark' ? "text-white" : "text-[#111827]")}>
                    {stats.totalRevenue ? stats.totalRevenue.toLocaleString('en-IN', {
                      style: 'currency',
                      currency: 'INR',
                      maximumFractionDigits: 0
                    }) : '₹0'}
                  </span>
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <span className="text-2xl sm:text-3xl font-bold text-indigo-400">{stats.onlinePayments || 0}</span>
                      <span className={cn("text-[10px] font-bold", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Online</span>
                    </div>
                    <div className={cn("h-8 sm:h-10 w-px mx-2", theme === 'dark' ? "bg-white/10" : "bg-[#E5E7EB]")} />
                    <div className="flex flex-col">
                      <span className="text-2xl sm:text-3xl font-bold text-emerald-400">{stats.offlinePayments || 0}</span>
                      <span className={cn("text-[10px] font-bold", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Offline</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Metrics Grid: 3 balanced columns on mobile so all 3 items stay in 1 row */}
          <div className={cn("grid grid-cols-3 gap-2 sm:gap-3 mt-4 sm:mt-4 pt-3 sm:pt-3 border-t", theme === 'dark' ? "border-white/5" : "border-[#E5E7EB]")}>
            <div className="space-y-0.5 sm:space-y-1 hover:cursor-pointer min-w-0">
              <span className={cn("text-[9px] sm:text-[10px] font-bold truncate block", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>System Bus Fee</span>
              <div className={cn("text-sm sm:text-xl font-bold truncate", theme === 'dark' ? "text-white" : "text-[#111827]")}>₹{typeof stats.systemBusFee === 'number' ? stats.systemBusFee.toLocaleString('en-IN') : '...'}</div>
            </div>
            {role === 'admin' ? (
              <>
                <div className="space-y-0.5 sm:space-y-1 hover:cursor-pointer min-w-0">
                  <span className={cn("text-[9px] sm:text-[10px] font-bold truncate block", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Online Payments</span>
                  <div className="text-sm sm:text-xl font-bold text-indigo-400 truncate">{stats.onlinePayments || 0}</div>
                </div>
                <div className="space-y-0.5 sm:space-y-1 hover:cursor-pointer min-w-0">
                  <span className={cn("text-[9px] sm:text-[10px] font-bold truncate block", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Offline Payments</span>
                  <div className="text-sm sm:text-xl font-bold text-emerald-400 truncate">{stats.offlinePayments || 0}</div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                  <span className={cn("text-[9px] sm:text-[10px] font-bold truncate block", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Currency</span>
                  <div className="text-sm sm:text-xl font-bold text-cyan-400 truncate">INR</div>
                </div>
                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                  <span className={cn("text-[9px] sm:text-[10px] font-bold truncate block", theme === 'dark' ? "text-slate-500" : "text-[#6B7280]")}>Payment Gateway</span>
                  <div className="text-sm sm:text-xl font-bold text-orange-400 truncate">Razorpay</div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Medium Count Cards */}
      <MetricCard
        title="Active Students"
        value={stats.activeStudents}
        subValue={`out of ${stats.totalStudents}`}
        icon={Users}
        color="bg-gradient-to-br from-blue-600 to-indigo-600 shadow-blue-600/20"
        className="lg:col-span-2"
      />

      <MetricCard
        title="Active Buses"
        value={stats.activeBuses}
        subValue={`out of ${stats.totalBuses}`}
        icon={Bus}
        color="bg-gradient-to-br from-cyan-600 to-blue-600 shadow-cyan-600/20"
        className="lg:col-span-2"
      />

      <MetricCard
        title="Active Student Applications"
        value={stats.pendingApplications}
        subValue="Remaining"
        icon={FileCheck}
        color="bg-gradient-to-br from-amber-600 to-orange-600 shadow-amber-600/20"
        className="lg:col-span-2"
      />

      <MetricCard
        title="Active Driver"
        value={stats.totalDrivers}
        subValue="Operational"
        icon={UserCheck}
        color="bg-gradient-to-br from-indigo-600 to-purple-600 shadow-indigo-600/20"
        className="lg:col-span-2"
      />
    </div>
  );
}
