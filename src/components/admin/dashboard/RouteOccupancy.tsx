"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AnimatePresence,motion } from "motion/react";
import {
	AlertTriangle,
	ArrowRight,
	BarChart as BarChartIcon,
	ChevronDown,
	ChevronUp,
	Navigation,
	TrendingUp
} from 'lucide-react';
import { useEffect,useState } from 'react';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis
} from 'recharts';
import { RouteOccupancyData } from './types';

interface RouteOccupancyProps {
   routeOccupancy: RouteOccupancyData[];
   busUtilization?: any[];
}

export default function RouteOccupancy({ routeOccupancy, busUtilization = [] }: RouteOccupancyProps) {
   const [viewMode, setViewMode] = useState<'leaderboard' | 'cluster'>('leaderboard');
   const [startIndex, setStartIndex] = useState(0);
   const [isExpanded, setIsExpanded] = useState(false);
   const [isMounted, setIsMounted] = useState(false);

   useEffect(() => {
      setIsMounted(true);
   }, []);

   const sortedRoutes = [...routeOccupancy].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
   );

   const currentRoutes = (() => {
      const count = isExpanded ? 7 : 5;
      return sortedRoutes.slice(startIndex, startIndex + count);
   })();

   const topCongestedBuses = (() => {
      const count = isExpanded ? 5 : 3;
      return [...busUtilization]
         .sort((a, b) => b.utilization - a.utilization)
         .slice(0, count);
   })();

   const chartData = [...routeOccupancy]
      .sort((a, b) => b.occupancy - a.occupancy)
      .slice(0, 10).map(r => ({
         name: r.name.split(' ')[0],
         fullName: r.name,
         occupancy: r.occupancy
      }));

   const handleNextSection = () => {
      const currentCount = isExpanded ? 7 : 5;
      const nextStart = startIndex + currentCount;
      if (nextStart < sortedRoutes.length) {
         setStartIndex(nextStart);
         setIsExpanded(false);
      }
   };

   const handlePrevSection = () => {
      // Since sections are 5 or 7 depending on expansion, 
      // simple logic: we go back by 5 always to ensure we don't skip
      setStartIndex(prev => Math.max(0, prev - 5));
      setIsExpanded(false);
   };

   const hasNextSection = startIndex + (isExpanded ? 7 : 5) < sortedRoutes.length;

   return (
      <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl mb-8 transition-colors duration-300 hover:bg-[#0f101f]">
         <CardHeader className="p-6 pb-0 pt-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
               <div className="space-y-1">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                        <Navigation className="w-5 h-5 rotate-45" />
                     </div>
                     <CardTitle className="text-2xl font-bold text-white leading-none">Route Performance Matrix</CardTitle>
                  </div>
                  <CardDescription className="text-slate-400 text-[11px] pl-1.5 border-l-2 border-orange-500/30 ml-1.5 h-auto">Pressure analysis and occupancy ranking by transit paths</CardDescription>
               </div>

               <div className="relative flex bg-[#0c0d1b] p-1 rounded-xl border border-white/5 shadow-inner shrink-0 overflow-hidden h-10 w-64">
                  {/* Sliding Background Indicator */}
                  <motion.div
                     initial={false}
                     animate={{ x: viewMode === 'leaderboard' ? 0 : '100%' }}
                     transition={{ type: "spring", stiffness: 400, damping: 30 }}
                     className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-white/10 rounded-lg border border-white/10 shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                  />
                  
                  <button
                     onClick={() => setViewMode('leaderboard')}
                     className={cn(
                        "relative flex-1 z-10 text-[10px] font-bold transition-colors duration-300",
                        viewMode === 'leaderboard' ? "text-white" : "text-slate-500 hover:text-slate-400"
                     )}
                  >
                     Leaderboard
                  </button>
                  <button
                     onClick={() => setViewMode('cluster')}
                     className={cn(
                        "relative flex-1 z-10 text-[10px] font-bold transition-colors duration-300",
                        viewMode === 'cluster' ? "text-white" : "text-slate-500 hover:text-slate-400"
                     )}
                  >
                     Cluster View
                  </button>
               </div>
            </div>
         </CardHeader>

         <CardContent className="p-6 pt-2 pb-2">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
               {/* Detailed Performance Table / Ranking */}
               <div className="lg:col-span-3">
                  {viewMode === 'leaderboard' ? (
                     <div className="space-y-2">
                        <AnimatePresence mode="wait">
                           <motion.div
                              key={startIndex}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="space-y-2"
                           >
                              {currentRoutes.map((route, idx) => (
                                 <motion.div
                                    key={route.name}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.4, delay: idx * 0.05 }}
                                    className="relative group flex items-center gap-4 bg-white/[0.01] hover:bg-white/[0.04] p-3 rounded-2xl border border-white/5 hover:border-orange-500/30 transition-all duration-300 hover:cursor-pointer"
                                 >
                                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 border border-white/5 group-hover:text-orange-400 transition-all shadow-lg">
                                       {String(startIndex + idx + 1).padStart(2, '0')}
                                    </div>

                                    <div className="flex-1 space-y-1">
                                       <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-3">
                                             <h4 className="text-sm font-bold text-white">{route.name}</h4>
                                             {route.occupancy > 90 && (
                                                <Badge className="bg-red-500/20 text-red-500 border-none text-[8px] font-extrabold px-1.5 h-4 flex items-center">At Risk</Badge>
                                             )}
                                          </div>
                                          <span className={cn(
                                             "text-[10px] font-bold",
                                             route.occupancy > 90 ? "text-red-400" : route.occupancy > 70 ? "text-amber-400" : "text-emerald-400"
                                          )}>{route.occupancy}% Load</span>
                                       </div>

                                       <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-white/5 flex items-center shadow-inner">
                                          <motion.div
                                             initial={{ width: 0 }}
                                             animate={{ width: `${route.occupancy}%` }}
                                             transition={{ duration: 1.2, delay: idx * 0.1 }}
                                             className={cn(
                                                "h-full rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]",
                                                route.occupancy > 90 ? "bg-red-600" : route.occupancy > 70 ? "bg-amber-600" : "bg-emerald-600"
                                             )}
                                          />
                                       </div>
                                    </div>

                                    <div className="flex-shrink-0 flex items-center gap-6 pl-4 border-l border-white/5 min-w-[70px] justify-end">
                                       <div className="flex flex-col items-center">
                                          <span className="text-[11px] font-bold text-white whitespace-nowrap">{route.students}</span>
                                          <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">Pax</span>
                                       </div>
                                       <div className="flex flex-col items-center border-l border-white/10 pl-4">
                                          <span className="text-[11px] font-bold text-white whitespace-nowrap">{Math.ceil(route.capacity / 40)}</span>
                                          <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">Buses</span>
                                       </div>
                                    </div>
                                 </motion.div>
                              ))}
                           </motion.div>
                        </AnimatePresence>
                     </div>
                  ) : (
                     <div className="h-[340px] w-full bg-slate-950/40 rounded-3xl border border-white/5 p-6 flex flex-col group overflow-hidden relative">
                        <div className="flex items-center justify-between mb-6">
                           <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400">
                                 <BarChartIcon className="w-4 h-4" />
                              </div>
                              <span className="text-[10px] font-bold text-white">Occupancy Spread (Top 10)</span>
                           </div>
                           <div className="text-[9px] font-bold text-slate-500">Load Balance Index</div>
                        </div>

                        <div className="flex-1">
                           {isMounted && (
                              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                 <BarChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                                    <XAxis
                                       dataKey="name"
                                       axisLine={false}
                                       tickLine={false}
                                       tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                                    />
                                    <YAxis
                                       hide={true}
                                       domain={[0, 100]}
                                    />
                                    <RechartsTooltip
                                       cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                                       contentStyle={{
                                          backgroundColor: '#0f172a',
                                          border: '1px solid rgba(255,255,255,0.1)',
                                          borderRadius: '12px',
                                          fontSize: '10px',
                                          fontWeight: '700',
                                          padding: '12px'
                                       }}
                                       formatter={(value) => [`${value}% Load`]}
                                    />
                                    <Bar dataKey="occupancy" radius={[4, 4, 0, 0]} barSize={24}>
                                       {chartData.map((entry, index) => (
                                          <Cell
                                             key={`cell-${index}`}
                                             fill={entry.occupancy > 90 ? '#ef4444' : entry.occupancy > 70 ? '#f59e0b' : '#10b981'}
                                             fillOpacity={0.6}
                                          />
                                       ))}
                                    </Bar>
                                 </BarChart>
                              </ResponsiveContainer>
                           )}
                        </div>

                        <div className="mt-4 flex items-center justify-between pt-4 border-t border-white/5">
                           <div className="flex items-baseline gap-1.5">
                              <span className="text-xl font-bold text-white">{(routeOccupancy.reduce((acc, r) => acc + r.occupancy, 0) / (routeOccupancy.length || 1)).toFixed(1)}%</span>
                              <span className="text-[8px] font-bold text-slate-500">Avg Fleet Load</span>
                           </div>
                           <TrendingUp className="w-4 h-4 text-emerald-500 opacity-50" />
                        </div>
                     </div>
                  )}
               </div>

               {/* Metrics and Insights Column */}
               <div className="lg:col-span-2">
                  <div className="p-4 rounded-2xl bg-[#0a0b14] border border-white/10 group hover:border-red-500/20 transition-all duration-500 h-full flex flex-col">
                      <div className="flex items-center gap-4 mb-4 pb-2 border-b border-white/5">
                         <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 group-hover:bg-red-500 group-hover:text-white transition-all duration-500 shadow-xl shadow-red-500/10">
                            <AlertTriangle className="w-5 h-5 animate-pulse" />
                         </div>
                         <div>
                            <div className="text-xs font-bold text-white leading-none mb-1">Heavy Load Alert</div>
                            <div className="text-[9px] font-bold text-slate-500">Critical Unit Snapshot</div>
                         </div>
                      </div>

                     <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 px-1 mb-1.5">
                           <span>Unit / Shift Context</span>
                           <span>Intensity</span>
                        </div>
                        {topCongestedBuses.map((bus, idx) => (
                           <motion.div
                              key={bus.name}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.1 }}
                              className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 group/row hover:bg-red-500/5 hover:border-red-500/10 transition-all hover:cursor-pointer"
                           >
                              <div className="flex flex-col">
                                 <span className="text-[11px] font-bold text-white group-hover/row:text-red-400 transition-colors">{bus.name}</span>
                                 <span className="text-[8px] font-bold text-slate-600">Main Arterial Path</span>
                              </div>
                              <div className="flex items-center gap-4">
                                 <div className="flex flex-col items-center">
                                    <div className="flex items-center gap-1.5">
                                       <div className={cn(
                                          "w-1.5 h-1.5 rounded-full",
                                          bus.utilization > 90 ? "bg-red-500 animate-ping" : "bg-amber-500"
                                       )} />
                                       <span className={cn(
                                          "text-[11px] font-bold",
                                          bus.utilization > 90 ? "text-red-400" : "text-amber-400"
                                       )}>{bus.utilization}%</span>
                                    </div>
                                    <span className="text-[8px] font-bold text-slate-700">Load</span>
                                 </div>
                                 <div className="flex flex-col items-center border-l border-white/10 pl-3">
                                    <span className="text-[11px] font-bold text-white">{bus.students}</span>
                                    <span className="text-[8px] font-bold text-slate-700">Pax</span>
                                 </div>
                              </div>
                           </motion.div>
                        ))}
                     </div>
                  </div>
               </div>
            </div>
         </CardContent>

         <div className="px-6 py-1 bg-white/[0.01] border-t border-white/5 flex items-center justify-center gap-4">
            {startIndex === 0 ? (
               // FIRST SECTION LOGIC: View More or Next
               !isExpanded ? (
                  <div className="flex items-center gap-4">
                     <Button
                        variant="ghost"
                        onClick={() => setIsExpanded(true)}
                        className="h-10 px-8 text-slate-400 hover:text-orange-400 text-[10px] font-bold group"
                     >
                        <ChevronDown className="w-4 h-4 mr-2 group-hover:translate-y-0.5 transition-transform" />
                        View More
                     </Button>
                     {hasNextSection && (
                        <Button
                           variant="outline"
                           onClick={handleNextSection}
                           className="h-8 px-6 border-slate-700 hover:bg-slate-800 text-slate-300 text-[9px] font-bold rounded-xl transition-all"
                        >
                           Next Section
                        </Button>
                     )}
                  </div>
               ) : (
                  <div className="flex items-center gap-4">
                     <Button
                        variant="ghost"
                        onClick={() => setIsExpanded(false)}
                        className="h-10 px-8 text-slate-400 hover:text-white text-[10px] font-bold flex items-center"
                     >
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Collapse
                     </Button>
                     {hasNextSection && (
                        <Button
                           variant="outline"
                           onClick={handleNextSection}
                           className="h-10 px-8 border-slate-700 hover:bg-slate-800 text-slate-300 text-[10px] font-bold rounded-2xl group flex items-center gap-3"
                        >
                           Next Section
                           <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </Button>
                     )}
                  </div>
               )
            ) : (
               // SUBSEQUENT SECTIONS: Only Prev and Next
               <div className="flex items-center gap-4">
                  <Button
                     variant="ghost"
                     onClick={handlePrevSection}
                     className="h-10 px-6 text-slate-400 hover:text-white text-[10px] font-bold flex items-center"
                  >
                     Previous Section
                  </Button>
                  {hasNextSection && (
                     <Button
                        variant="outline"
                        onClick={handleNextSection}
                        className="h-10 px-8 border-slate-700 hover:bg-slate-800 text-slate-300 text-[10px] font-bold rounded-2xl group flex items-center gap-3"
                     >
                        Next Section
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                     </Button>
                  )}
               </div>
            )}
         </div>
      </Card>
   );
}
