"use client";

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Settings, Bus, TrendingUp, Users, ChevronRight, Zap } from 'lucide-react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useApiCollection } from '@/hooks/useApiCollection';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface OverloadInfo {
  busId: string;
  busNumber: string;
  routeName: string;
  capacity: number;
  morningCount: number;
  eveningCount: number;
  reason: 'morning' | 'evening' | 'both';
  overloadCount: number;
  shift: string;
  loadPercentage: number;
}

interface HighLoadAlertProps {
  role: 'admin' | 'moderator';
  className?: string;
}

export default function HighLoadAlert({ role, className = '' }: HighLoadAlertProps) {
  const router = useRouter();
  const { data: buses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false, cacheTTL: 0,
  });
  const [selectedBus, setSelectedBus] = useState<string | null>(null);

  const overloadedBuses = useMemo(() => {
    if (!buses.length) return [];

    const overloadList: OverloadInfo[] = [];

    buses.forEach((bus: any) => {
      const capacity = Number(bus.capacity || bus.totalCapacity || 50);
      const load = bus.load || {};
      const morningCount = Number(bus.morningLoad ?? bus.morning_load ?? load.morningCount ?? load.morning_count ?? 0);
      const eveningCount = Number(bus.eveningLoad ?? bus.evening_load ?? load.eveningCount ?? load.evening_count ?? 0);
      const busShift = bus.shift || 'Both';

      let isOverloaded = false;
      let reason: 'morning' | 'evening' | 'both' = 'morning';
      let overloadCount = 0;
      let maxCount = morningCount;

      const thresholdCount = Math.max(Math.ceil(capacity * 0.8), capacity - 5);

      // Per-shift overload logic
      if (busShift === 'Morning') {
        maxCount = morningCount;
        if (morningCount >= thresholdCount) {
          isOverloaded = true;
          reason = 'morning';
          overloadCount = Math.max(0, morningCount - capacity);
        }
      } else if (busShift === 'Evening') {
        maxCount = eveningCount;
        if (eveningCount >= thresholdCount) {
          isOverloaded = true;
          reason = 'evening';
          overloadCount = Math.max(0, eveningCount - capacity);
        }
      } else if (busShift === 'Both') {
        maxCount = Math.max(morningCount, eveningCount);
        const morningOverload = morningCount >= thresholdCount;
        const eveningOverload = eveningCount >= thresholdCount;

        if (morningOverload && eveningOverload) {
          isOverloaded = true;
          reason = 'both';
          overloadCount = Math.max(
            Math.max(0, morningCount - capacity),
            Math.max(0, eveningCount - capacity)
          );
        } else if (morningOverload) {
          isOverloaded = true;
          reason = 'morning';
          overloadCount = Math.max(0, morningCount - capacity);
        } else if (eveningOverload) {
          isOverloaded = true;
          reason = 'evening';
          overloadCount = Math.max(0, eveningCount - capacity);
        }
      }

      if (isOverloaded) {
        const routeName = bus.route?.routeName || bus.routeName || 'Route';
        const loadPercentage = (maxCount / capacity) * 100;

        overloadList.push({
          busId: bus.id || bus.busId,
          busNumber: bus.busNumber || 'Bus',
          routeName,
          capacity,
          morningCount,
          eveningCount,
          reason,
          overloadCount,
          shift: busShift,
          loadPercentage
        });
      }
    });

    return overloadList.sort((a, b) => (b.loadPercentage - a.loadPercentage) || (b.overloadCount - a.overloadCount));
  }, [buses]);

  const totalStudents = overloadedBuses.reduce(
    (acc, b) => acc + b.overloadCount,
    0
  );

  const criticalCount = overloadedBuses.filter(b => b.reason === 'both').length;
  const highCount = overloadedBuses.filter(b => b.reason !== 'both').length;

  if (overloadedBuses.length === 0) {
    return null;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border-zinc-700/50 shadow-xl cursor-pointer">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-red-500/5 to-orange-500/5" />
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl" />

        <CardContent className="relative px-6 py-2.5 md:px-8 md:py-3">
          {/* Header Row */}
          <div className="flex items-center justify-between mb-2.5 md:mb-3">
            <div className="flex items-center gap-1.5 md:gap-2.5">
              {/* Icon with pulse effect */}
              <div className="relative">
                <div className="absolute inset-0 bg-amber-500/30 rounded-xl blur-md animate-pulse" />
                <div className="relative w-7 h-7 md:w-8.5 md:h-8.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                  <AlertTriangle className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1 md:gap-1.5">
                  <h3 className="text-xs md:text-sm font-bold text-white">High-Load Buses</h3>
                  <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 text-[7px] md:text-[8px] px-0.5 md:px-1 py-0 font-bold whitespace-nowrap">
                    <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-red-500 rounded-full animate-pulse mr-1 inline-block" />
                    LIVE
                  </Badge>
                </div>
                <p className="text-[8px] md:text-[9.5px] text-zinc-400">
                  {totalStudents} students over capacity • {overloadedBuses.length} buses attention
                </p>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => router.push(`/${role}/smart-allocation`)}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/20 h-6 md:h-7 text-[9px] md:text-[10px] px-4 md:px-5 font-semibold whitespace-nowrap"
            >
              <Settings className="h-2.5 w-2.5 md:h-3 md:w-3 mr-1 md:mr-1.5" />
              <span className="hidden xs:inline">Manage Overload</span>
              <span className="xs:hidden">Manage</span>
            </Button>
          </div>

          {/* Stats Cards Row */}
          <div className="grid grid-cols-3 gap-1.5 md:gap-2 mb-2.5 md:mb-3">
            {/* Critical */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-red-500/10 to-red-900/20 border border-red-500/30 rounded-xl px-5 py-1.5 md:px-6 md:py-2 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-0.5 md:mb-1">
                <span className="text-[7.5px] md:text-[9px] font-semibold text-red-400 uppercase tracking-wide">Critical</span>
                <div className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-red-500/20 flex items-center justify-center">
                  <Zap className="w-2 h-2 md:w-2.5 md:h-2.5 text-red-400" />
                </div>
              </div>
              <div className="text-lg md:text-xl font-bold text-red-400">{criticalCount}</div>
              <div className="text-[7.5px] md:text-[8.5px] text-red-400/60 leading-tight">Both shifts overloaded</div>
            </motion.div>

            {/* High */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-amber-500/10 to-amber-900/20 border border-amber-500/30 rounded-xl px-5 py-1.5 md:px-6 md:py-2 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-0.5 md:mb-1">
                <span className="text-[7.5px] md:text-[9px] font-semibold text-amber-400 uppercase tracking-wide">High</span>
                <div className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <TrendingUp className="w-2 h-2 md:w-2.5 md:h-2.5 text-amber-400" />
                </div>
              </div>
              <div className="text-lg md:text-xl font-bold text-amber-400">{highCount}</div>
              <div className="text-[7.5px] md:text-[8.5px] text-amber-400/60 leading-tight">Single shift overloaded</div>
            </motion.div>

            {/* Total Affected */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-cyan-500/10 to-cyan-900/20 border border-cyan-500/30 rounded-xl px-5 py-1.5 md:px-6 md:py-2 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-0.5 md:mb-1">
                <span className="text-[7.5px] md:text-[9px] font-semibold text-cyan-400 uppercase tracking-wide">Total</span>
                <div className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <Bus className="w-2 h-2 md:w-2.5 md:h-2.5 text-cyan-400" />
                </div>
              </div>
              <div className="text-lg md:text-xl font-bold text-cyan-400">{overloadedBuses.length}</div>
              <div className="text-[7.5px] md:text-[8.5px] text-cyan-400/60 leading-tight">Buses overloaded</div>
            </motion.div>
          </div>

          {/* Bus Cards - Horizontal Scroll */}
          <div className="relative">
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-zinc-800/50">
              <AnimatePresence>
                {overloadedBuses.map((bus, index) => (
                  <motion.div
                    key={bus.busId}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedBus(selectedBus === bus.busId ? null : bus.busId)}
                    className={cn(
                      "flex-shrink-0 w-[190px] md:w-56 rounded-xl border px-4.5 py-2 md:px-5.5 md:py-2.5 cursor-pointer transition-all duration-200",
                      bus.reason === 'both'
                        ? 'bg-gradient-to-br from-red-950/60 to-red-900/40 border-red-500/40 hover:border-red-400/60'
                        : 'bg-gradient-to-br from-amber-950/40 to-amber-900/30 border-amber-500/30 hover:border-amber-400/50',
                      selectedBus === bus.busId && 'ring-2 ring-purple-500/50'
                    )}
                  >
                    {/* Bus Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-1 md:gap-1.5">
                        <div className={cn(
                          "w-6 h-6 md:w-7 md:h-7 rounded-lg flex items-center justify-center",
                          bus.reason === 'both'
                            ? 'bg-red-500/20'
                            : 'bg-amber-500/20'
                        )}>
                          <Bus className={cn(
                            "w-3 h-3 md:w-3.5 md:h-3.5",
                            bus.reason === 'both' ? 'text-red-400' : 'text-amber-400'
                          )} />
                        </div>
                        <div>
                          <div className={cn(
                            "text-[11px] md:text-xs font-bold",
                            bus.reason === 'both' ? 'text-red-200' : 'text-amber-200'
                          )}>
                            {bus.busNumber}
                          </div>
                          <div className="text-[8px] md:text-[9px] text-zinc-400 truncate max-w-[80px] md:max-w-none">{bus.routeName}</div>
                        </div>
                      </div>
                      <Badge className={cn(
                        "text-[6.5px] md:text-[7.5px] px-1 py-0.5 font-bold",
                        bus.reason === 'both'
                          ? 'bg-red-500 text-white'
                          : 'bg-amber-500 text-white'
                      )}>
                        {bus.reason === 'both' ? 'CRITICAL' : 'HIGH'}
                      </Badge>
                    </div>

                    {/* Load Bars */}
                    <div className="space-y-1.5">
                      {/* Morning */}
                      {(bus.shift === 'Morning' || bus.shift === 'Both') && (
                        <div>
                          <div className="flex justify-between text-[9px] mb-0.5">
                            <span className={cn(
                              "font-medium",
                              bus.morningCount > bus.capacity ? 'text-orange-400' : 'text-zinc-400'
                            )}>
                              🌅 Morning
                            </span>
                            <span className={cn(
                              "font-bold",
                              bus.morningCount > bus.capacity ? 'text-orange-400' : 'text-zinc-400'
                            )}>
                              {bus.morningCount}/{bus.capacity}
                            </span>
                          </div>
                          <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min((bus.morningCount / bus.capacity) * 100, 100)}%` }}
                              transition={{ duration: 0.5, delay: index * 0.05 }}
                              className={cn(
                                "h-full rounded-full",
                                bus.morningCount > bus.capacity
                                  ? 'bg-gradient-to-r from-red-500 to-orange-500'
                                  : 'bg-gradient-to-r from-zinc-600 to-zinc-500'
                              )}
                            />
                          </div>
                        </div>
                      )}

                      {/* Evening */}
                      {(bus.shift === 'Evening' || bus.shift === 'Both') && (
                        <div>
                          <div className="flex justify-between text-[9px] mb-0.5">
                            <span className={cn(
                              "font-medium",
                              bus.eveningCount > bus.capacity ? 'text-blue-400' : 'text-zinc-400'
                            )}>
                              🌙 Evening
                            </span>
                            <span className={cn(
                              "font-bold",
                              bus.eveningCount > bus.capacity ? 'text-blue-400' : 'text-zinc-400'
                            )}>
                              {bus.eveningCount}/{bus.capacity}
                            </span>
                          </div>
                          <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min((bus.eveningCount / bus.capacity) * 100, 100)}%` }}
                              transition={{ duration: 0.5, delay: index * 0.05 + 0.1 }}
                              className={cn(
                                "h-full rounded-full",
                                bus.eveningCount > bus.capacity
                                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                                  : 'bg-gradient-to-r from-zinc-600 to-zinc-500'
                              )}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Overload Info */}
                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-zinc-700/50">
                      <div className={cn(
                        "text-[9px] font-bold flex items-center gap-1",
                        bus.reason === 'both' ? 'text-red-400' : 'text-amber-400'
                      )}>
                        <Users className="w-2.5 h-2.5" />
                        {bus.overloadCount} over capacity
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[7px] md:text-[9px] text-zinc-400 mt-2 md:mt-2.5 pt-1.5 md:pt-2 border-t border-zinc-700/50">
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-500 rounded-full" />
                <div className="absolute inset-0 w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-500 rounded-full animate-ping opacity-75" />
              </div>
              <span>Real-time monitoring active</span>
            </div>
            <span className="font-bold text-amber-400">
              {totalStudents} students need reassignment
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Custom Scrollbar Styles */}
      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar {
          height: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(39, 39, 42, 0.5);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(113, 113, 122, 0.6);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(161, 161, 170, 0.7);
        }
      `}</style>
    </motion.div>
  );
}
