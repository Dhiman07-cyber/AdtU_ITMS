"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from "motion/react";
import {
	ArrowRight,
	Bus,
	ChevronDown,
	ChevronUp,
	TrendingUp
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BusUtilizationData } from './types';

interface BusUtilizationProps {
  busUtilization: BusUtilizationData[];
}

export default function BusUtilization({ busUtilization }: BusUtilizationProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sortedBuses = [...busUtilization].sort((a, b) => {
    const peakA = Math.max(a.morningCount, a.eveningCount);
    const peakB = Math.max(b.morningCount, b.eveningCount);
    const remA = a.capacity - peakA;
    const remB = b.capacity - peakB;
    return remA - remB; // Least remaining space (most loaded) first
  });

  const getStatusColor = (utilization: number) => {
    if (utilization > 90) return 'text-red-400 bg-red-400/10 border-red-400/20';
    if (utilization > 70) return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  };

  const getProgressColor = (utilization: number) => {
    if (utilization > 90) return 'bg-gradient-to-r from-red-600 to-orange-500';
    if (utilization > 70) return 'bg-gradient-to-r from-amber-600 to-yellow-500';
    return 'bg-gradient-to-r from-emerald-600 to-cyan-500';
  };

  return (
    <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl transition-colors duration-300 hover:bg-[#0f101f]">
      <CardHeader className="flex flex-col md:flex-row md:items-center justify-between p-6 pb-0 pt-2 gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Bus className="w-5 h-5" />
            </div>
            <CardTitle className="text-xl font-bold text-white">Fleet Utilization Matrix</CardTitle>
          </div>
          <p className="text-slate-400 text-[11px] pl-1.5 border-l border-cyan-500/30 ml-1.5">Load distribution across shifts</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 bg-[#0c0d1b] p-3 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-400">Optimal</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[10px] font-bold text-amber-400">High</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[10px] font-bold text-red-400">At Risk</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(isExpanded ? sortedBuses.slice(0, 6) : sortedBuses.slice(0, 3)).map((bus, idx) => (
            <motion.div
              key={bus.name}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="relative group p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-cyan-500/30 hover:bg-white/[0.04] transition-all duration-500 flex flex-col gap-4 hover:cursor-pointer"
            >
              {/* Bus Card Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-white/5 flex items-center justify-center text-slate-400 group-hover:text-cyan-400 transition-colors shadow-xl">
                    <Bus className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-white">{bus.name}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500">Active</span>
                    </div>
                  </div>
                </div>
                <Badge className={cn("text-[9px] font-bold px-2 py-1 rounded-lg border", getStatusColor(bus.utilization))}>
                  {bus.utilization > 90 ? 'Overload' : bus.utilization > 70 ? 'Heavy' : 'Stable'}
                </Badge>
              </div>

              {/* Main Progress Indicator */}
              <div className="space-y-3">
                <div className="flex justify-between items-baseline mb-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-500">Current Utilization</span>
                    <span className="text-xl font-bold text-white">{bus.utilization}%</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold">Optimal</span>
                  </div>
                </div>
                <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-white/5 shadow-inner">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${bus.utilization}%` }}
                    transition={{ duration: 1, delay: idx * 0.1 }}
                    className={cn("h-full rounded-full shadow-lg", getProgressColor(bus.utilization))}
                  />
                </div>
              </div>

              {/* Shift Breakdown */}
              <div className="grid grid-cols-2 gap-4 py-4 border-t border-white/5">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="text-[9px] font-bold">Morning Shift</span>
                  </div>
                  <div className="text-sm font-bold text-white pl-3 border-l border-amber-500/20">{bus.morningCount} Pax</div>
                  <div className="text-[9px] font-medium text-slate-500 pl-3">Cap: {bus.capacity}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-blue-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="text-[9px] font-bold">Evening Shift</span>
                  </div>
                  <div className="text-sm font-bold text-white pl-3 border-l border-blue-500/20">{bus.eveningCount} Pax</div>
                  <div className="text-[9px] font-medium text-slate-500 pl-3">Cap: {bus.capacity}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>

      <div className="px-6 py-3 bg-white/[0.01] border-t border-white/5 flex items-center justify-center gap-4">
        <Button
          variant="ghost"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-10 px-6 text-slate-400 hover:text-cyan-400 text-[10px] font-bold group"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2 group-hover:-translate-y-0.5 transition-transform" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 mr-2 group-hover:translate-y-0.5 transition-transform" />
              View More
            </>
          )}
        </Button>

        {isExpanded && (
          <Link href="/admin/smart-allocation" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="h-10 px-8 border-slate-700 hover:bg-slate-800 text-slate-300 text-[10px] font-bold rounded-2xl group">
              Detailed View
              <ArrowRight className="w-4 h-4 ml-3 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
        )}
      </div>
    </Card>
  );
}
