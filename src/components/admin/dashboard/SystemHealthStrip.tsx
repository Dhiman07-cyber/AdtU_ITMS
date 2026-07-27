"use client";

import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
	Bus,
	MessageSquare as MessageSquareIcon,
	Users,
	Zap
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DashboardStats } from './types';

interface HealthMetricProps {
  icon: any;
  label: string;
  value: string | number;
  subValue?: string;
  color: 'blue' | 'emerald' | 'amber' | 'purple' | 'red' | 'indigo' | 'cyan';
  delay: number;
}

const HealthMetric = ({ icon: Icon, label, value, subValue, color, delay }: HealthMetricProps) => {
  const { theme } = useTheme();
  const colorVariants: Record<string, { dark: string; light: string }> = {
    blue: { dark: 'bg-blue-500/5 border-blue-500/10 text-blue-400', light: 'bg-blue-50 border-blue-200 text-blue-600' },
    emerald: { dark: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400', light: 'bg-emerald-50 border-emerald-200 text-emerald-600' },
    amber: { dark: 'bg-amber-500/5 border-amber-500/10 text-amber-400', light: 'bg-amber-50 border-amber-200 text-amber-600' },
    purple: { dark: 'bg-purple-500/5 border-purple-500/10 text-purple-400', light: 'bg-purple-50 border-purple-200 text-purple-600' },
    red: { dark: 'bg-red-500/5 border-red-500/10 text-red-400', light: 'bg-red-50 border-red-200 text-red-600' },
    indigo: { dark: 'bg-indigo-500/5 border-indigo-500/10 text-indigo-400', light: 'bg-indigo-50 border-indigo-200 text-indigo-600' },
    cyan: { dark: 'bg-cyan-500/5 border-cyan-500/10 text-cyan-400', light: 'bg-cyan-50 border-cyan-200 text-cyan-600' },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay * 0.1 }}
      className={cn(
        "flex-1 flex flex-col items-center justify-center text-center gap-1.5 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.02] hover:cursor-pointer",
        theme === 'dark' ? "hover:bg-white/5" : "hover:bg-gray-50",
        colorVariants[color][theme]
      )}
    >
      <div className={cn(
        "w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-500",
        theme === 'dark' ? `bg-${color}-500/10 shadow-${color}-400/5` : `bg-${color}-100 shadow-${color}-200/20`
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex flex-col items-center">
        <span className={cn("text-[9px] font-bold uppercase tracking-[0.12em] mb-0.5", theme === 'dark' ? "text-slate-400/80" : "text-[#6B7280]")}>
          {label}
        </span>
        <div className="flex flex-col items-center">
          <span className={cn("text-base font-black tracking-tight leading-none", theme === 'dark' ? "text-white" : "text-[#111827]")}>
            {value}
          </span>
          {subValue && (
            <span className={cn("text-[8px] font-bold mt-0.5 tracking-wide uppercase opacity-70", theme === 'dark' ? "text-slate-400" : "text-[#6B7280]")}>
              {subValue}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default function SystemHealthStrip({ stats }: { stats: DashboardStats }) {
  const activeTripsCount = stats.enrouteBuses || stats.activeBuses || 0;
  const idleBusesCount = Math.max(0, (stats.operationalBuses || stats.totalBuses) - activeTripsCount);
  const router = useRouter();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-0 w-full animate-in fade-in duration-300 mb-5">
      <HealthMetric
        icon={Zap}
        label="Active Trips"
        value={activeTripsCount}
        subValue="in motion"
        color="blue"
        delay={0}
      />
      <HealthMetric
        icon={Bus}
        label="Idle Buses"
        value={idleBusesCount}
        subValue="at stand"
        color="indigo"
        delay={1}
      />
      <HealthMetric
        icon={Users}
        label="Drivers Ready"
        value={stats.totalDrivers}
        subValue="available"
        color="purple"
        delay={2}
      />
      <div onClick={() => router.push('/admin/feedback')} className="cursor-pointer hover:cursor-pointer">
        <HealthMetric
          icon={MessageSquareIcon}
          label="Feedbacks Received"
          value={stats.feedbacksCount}
          subValue="Last 7 days"
          color="cyan"
          delay={3}
        />
      </div>
    </div>
  );
}
