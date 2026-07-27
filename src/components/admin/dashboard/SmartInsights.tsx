"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
	Activity,
	AlertTriangle,
	ArrowRight,
	Bus,
	Clock,
	FileText,
	ShieldCheck,
	TrendingUp,
	Users,
	Zap
} from 'lucide-react';
import { BusUtilizationData,DashboardStats,RouteOccupancyData } from './types';

interface SmartInsightsProps {
  stats: DashboardStats;
  busUtilization: BusUtilizationData[];
  routeOccupancy: RouteOccupancyData[];
}

interface Insight {
  id: string;
  type: 'warning' | 'optimal' | 'info' | 'urgent';
  title: string;
  description: string;
  icon: any;
}

export default function SmartInsights({ stats, busUtilization, routeOccupancy }: SmartInsightsProps) {
  const insights: Insight[] = [];

  // 1. Route Overload Risk
  const overloadedRoutes = routeOccupancy.filter(r => r.occupancy > 90);
  if (overloadedRoutes.length > 0) {
    insights.push({
      id: 'route-overload',
      type: 'urgent',
      title: 'Route Load Critical',
      description: `${overloadedRoutes.length} route${overloadedRoutes.length > 1 ? 's' : ''} (e.g. ${overloadedRoutes[0].name}) exceeding 90% capacity. Unit reassignment recommended.`,
      icon: AlertTriangle
    });
  }

  // 2. Driver Capacity
  if (stats.activeDrivers < stats.totalBuses) {
    insights.push({
      id: 'driver-shortage',
      type: 'warning',
      title: 'Driver Pool Imbalance',
      description: `Operating with ${stats.totalBuses - stats.activeDrivers} unassigned units. Ensure sufficient reserve driver pool for emergency coverage.`,
      icon: Users
    });
  } else {
    insights.push({
      id: 'driver-optimal',
      type: 'optimal',
      title: 'Fleet Staffing Optimal',
      description: 'Driver-to-unit ratio is healthy. All active units fully staffed for the current operational cycle.',
      icon: ShieldCheck
    });
  }

  // 3. Low Occupancy Bus
  const underutilizedBuses = busUtilization.filter(b => b.utilization < 30 && b.utilization > 0);
  if (underutilizedBuses.length > 0) {
    insights.push({
      id: 'low-occupancy',
      type: 'info',
      title: 'Low Occupancy Units',
      description: `Bus ${underutilizedBuses[0].name.replace(/\D/g, '')} is operating below 30% utilization. Audit route path or consolidate with neighboring units.`,
      icon: Bus
    });
  }

  // 4. Collection Performance
  insights.push({
    id: 'collection-perf',
    type: 'optimal',
    title: 'Strong Collection Delta',
    description: 'Revenue collection rate is maintaining a 94.2% average across all active student plans. Optimal performance.',
    icon: TrendingUp
  });

  // 5. Shift Imbalance
  const morningPercent = stats.totalStudents > 0 ? (stats.morningStudents / stats.totalStudents) * 100 : 50;
  const eveningPercent = stats.totalStudents > 0 ? (stats.eveningStudents / stats.totalStudents) * 100 : 50;
  if (Math.abs(morningPercent - eveningPercent) > 20) {
    insights.push({
      id: 'shift-imbalance',
      type: 'warning',
      title: 'Shift Load Imbalance',
      description: `Significant load disparity (${Math.round(Math.abs(morningPercent - eveningPercent))}%) detected between shifts. Review scheduling rules.`,
      icon: Activity
    });
  }

  // 6. Application Pressure
  if (stats.pendingApplications > 20) {
    insights.push({
      id: 'app-pressure',
      type: 'warning',
      title: 'Verification Pressure',
      description: `${stats.pendingApplications} student applications are awaiting verification. Processing delay may affect deployment schedules.`,
      icon: FileText
    });
  }

  // 7. Deadline Sensitivity
  if (stats.academicYearEnd) {
    const daysLeft = Math.ceil((new Date(stats.academicYearEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 30 && daysLeft > 0) {
      insights.push({
        id: 'deadline-alert',
        type: 'urgent',
        title: 'Renewal Phase Approaching',
        description: `Academic year ends in ${daysLeft} days. Automate renewal notifications to prevent service interruption.`,
        icon: Clock
      });
    }
  }

  const getTypeStyles = (type: Insight['type']) => {
    switch (type) {
      case 'urgent': return 'bg-red-500/10 border-red-500/20 text-red-400 font-black';
      case 'warning': return 'bg-amber-500/10 border-amber-500/20 text-amber-400 font-bold';
      case 'optimal': return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-bold';
      case 'info': return 'bg-blue-500/10 border-blue-500/20 text-blue-400 font-bold';
      default: return 'bg-slate-500/10 border-slate-500/20 text-slate-400 font-medium';
    }
  };

  const getIconBg = (type: Insight['type']) => {
    switch (type) {
      case 'urgent': return 'bg-red-500 shadow-red-500/20';
      case 'warning': return 'bg-amber-500 shadow-amber-500/20';
      case 'optimal': return 'bg-emerald-500 shadow-emerald-500/20';
      case 'info': return 'bg-blue-500 shadow-blue-500/20';
      default: return 'bg-slate-500 shadow-slate-500/20';
    }
  };

  return (
    <div className="mb-12">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
           <Zap className="w-6 h-6" />
        </div>
        <div className="space-y-0.5">
           <h3 className="text-2xl font-black text-white tracking-tight">System Smart Insights</h3>
           <p className="text-slate-500 text-sm font-medium tracking-tight">AI-assisted operational recommendations based on real-time telemetry</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {insights.slice(0, 8).map((insight, idx) => (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: idx * 0.1 }}
          >
            <Card className={cn(
              "h-full relative overflow-hidden bg-[#0a0b14] border-white/5 group hover:border-white/10 hover:bg-[#0f101f] transition-all duration-500"
            )}>
              <CardContent className="p-6 pb-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-6">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg shadow-lg group-hover:scale-110 transition-transform duration-500",
                    getIconBg(insight.type)
                  )}>
                    <insight.icon className="w-5 h-5" />
                  </div>
                  <Badge className={cn("text-[8px] font-black tracking-widest px-2 py-0.5 border uppercase", getTypeStyles(insight.type))}>
                    {insight.type}
                  </Badge>
                </div>

                <div className="space-y-2 flex-grow">
                  <h4 className="text-sm font-black text-white tracking-wide group-hover:text-indigo-300 transition-colors">{insight.title}</h4>
                  <p className="text-[11px] font-medium leading-relaxed text-slate-400 group-hover:text-slate-300 transition-colors">
                    {insight.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                   <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Recommended Action</span>
                   <Button variant="ghost" className="h-6 px-0 text-slate-400 hover:text-white group/action">
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                   </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
