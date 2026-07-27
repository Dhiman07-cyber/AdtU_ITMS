"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import {
	Bus,
	ChevronRight,
	MapPin,
	ShieldCheck,
	Timer,
	Users
} from 'lucide-react';
import { ActiveTrip,DashboardStats } from './types';

interface HeroLiveOperationsProps {
  activeTrips: ActiveTrip[];
  totalBuses: number;
  totalStudents: number;
  stats?: DashboardStats;
  allBuses?: any[];
  allRoutes?: any[];
  allDrivers?: any[];
  role?: 'admin' | 'moderator';
}

export default function HeroLiveOperations({
  activeTrips,
  totalBuses,
  totalStudents,
  stats,
  allBuses = [],
  allRoutes = [],
  allDrivers = [],
  role = 'admin'
}: HeroLiveOperationsProps) {
  // --- ANALYTICS HELPERS ---
  function allStudentsCount(s?: DashboardStats) {
    if (!s) return 0;
    return s.totalStudents;
  }

  function calculateRealMetrics(buses: any[], routes: any[], drivers: any[], s?: DashboardStats) {
    // 1. Efficiency Calculation
    let totalCap = 0;
    let totalOcc = 0;
    buses.forEach(b => {
      totalCap += (b.totalCapacity || b.capacity || 50);
      totalOcc += (b.currentMembers || 0);
    });
    const efficiency = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;

    // 2. Idle Resources
    const idleBuses = buses.filter(b => (b.currentMembers || 0) === 0).length;
    const idleDrivers = s ? Math.max(0, s.totalDrivers - s.activeDrivers) : 0;
    const idleRoutes = routes.filter(r => !r.assignedBuses || r.assignedBuses.length === 0).length;

    const possiblePoints = (buses.length || 1) + ((s ? s.totalDrivers : drivers.length) || 1) + (routes.length || 1);
    const idlePoints = idleBuses + idleDrivers + idleRoutes;
    const idleScore = Math.round((idlePoints / possiblePoints) * 10);

    // 3. Top Pressure Route
    let topPressureRoute: any = { name: "System Nominal", load: 0, morningPct: 0, eveningPct: 0, variance: 0, trend: [20, 25, 22, 28, 24, 30, 26, 35] };
    let maxL = -1;

    routes.forEach(route => {
      const routeBuses = buses.filter(b => b.routeId === route.routeId || b.route?.routeId === route.routeId);
      let rCap = 0;
      let rLoad = 0;
      let rMorning = 0;
      let rEvening = 0;

      routeBuses.forEach(b => {
        const busCap = (b.totalCapacity || b.capacity || 50);
        rCap += busCap;
        rLoad += (b.currentMembers || 0);
        rMorning += (b.load?.morningCount || 0);
        rEvening += (b.load?.eveningCount || 0);
      });

      if (rCap > 0) {
        const loadPct = Math.round((rLoad / rCap) * 100);
        const morningPct = Math.round((rMorning / rCap) * 100);
        const eveningPct = Math.round((rEvening / rCap) * 100);
        const variance = Math.abs(morningPct - eveningPct);

        if (loadPct > maxL) {
          maxL = loadPct;
          // Generate a more meaningful trend based on real load and some minor variance
          const baseTrend = [
            Math.max(10, morningPct - 15),
            Math.max(15, morningPct - 5),
            morningPct,
            Math.round((morningPct + eveningPct) / 2),
            eveningPct,
            Math.max(10, eveningPct - 10),
            Math.max(15, eveningPct - 5),
            loadPct
          ];

          topPressureRoute = {
            name: route.routeName,
            load: loadPct,
            morningPct,
            eveningPct,
            variance,
            trend: baseTrend
          };
        }
      }
    });

    return { efficiency, idleBuses, idleDrivers, idleRoutes, idleScore, topPressureRoute };
  }

  function getBusHeatMap(busesData: any[]) {
    return busesData.map(b => {
      const capacity = (b.totalCapacity || b.capacity || 50);
      const mLoad = b.load?.morningCount || 0;
      const eLoad = b.load?.eveningCount || 0;
      const current = b.currentMembers || 0;

      // User preference: "Bus-6 (AS-01-SC-1392)"
      // Extract number from busId (e.g. "bus_6" -> 6)
      const busIdStr = b.busId || b.id || "";
      const busMatch = busIdStr.match(/\d+/);
      const busNum = busMatch ? busMatch[0] : "0";
      const reg = b.busNumber || "N/A";

      return {
        id: b.id || b.busId,
        busIdDisplay: `Bus-${busNum}`,
        registration: reg,
        fullIdentifier: `Bus-${busNum} (${reg})`,
        morningLoad: capacity > 0 ? Math.round((mLoad / capacity) * 100) : 0,
        eveningLoad: capacity > 0 ? Math.round((eLoad / capacity) * 100) : 0,
        capacity,
        current,
        busNumVal: parseInt(busNum) || 0
      };
    }).sort((a, b) => a.busNumVal - b.busNumVal);
  }

  const hasActiveTrips = activeTrips.length > 0;
  const hasEnoughData = (allBuses.length > 0 || allStudentsCount(stats) > 0);

  if (!hasActiveTrips) {
    if (!hasEnoughData) {
      return (
        <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl mb-5 min-h-[180px] flex items-center justify-center group transition-all duration-500">
          <div className="text-center space-y-2">
            <h3 className="text-white font-bold tracking-tight">Not enough information to display analytics</h3>
            <p className="text-slate-500 text-xs">Start using the platform to generate meaningful insights</p>
          </div>
        </Card>
      );
    }

    // REAL ANALYTICS CALCULATIONS
    const metrics = calculateRealMetrics(allBuses, allRoutes, allDrivers, stats);
    const busHeat = getBusHeatMap(allBuses);

    return (
      <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl mb-5 min-h-[195px] group transition-all duration-500 overflow-visible">


        <CardContent className="p-0 h-full relative z-10 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/[0.03]">
          {/* Dashboard Header & Efficiency Score */}
          <div className="p-5 pt-4 pb-4 md:w-1/3 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em]">Operational Equilibrium</span>
              </div>
              <div className="flex flex-col items-center justify-center py-5 space-y-1">
                <h3 className="text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase">System Efficiency</h3>
                <div className="flex flex-col items-center justify-center -mt-2">
                  <span className="text-4xl pt-1 font-black text-white tracking-tighter leading-none">{metrics.efficiency}%</span>
                  <span className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-2">Utilized</span>
                </div>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Idle Resource Capture</div>
                <div className="text-xs font-black text-orange-400">-{metrics.idleScore}% Impact</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Idle Buses', val: Math.max(0, totalBuses - activeTrips.length), sub: 'At Stand' },
                  { label: 'Drivers', val: metrics.idleDrivers, sub: 'Standby' },
                  { label: 'Routes', val: metrics.idleRoutes, sub: 'Inactive' }
                ].map((idle, i) => (
                  <div key={i} className="bg-white/[0.02] border border-white/5 rounded-lg p-1.5 text-center transition-colors group-hover/card:bg-white/[0.03] hover:cursor-pointer">
                    <div className="text-xs font-black text-white">{idle.val}</div>
                    <div className="text-[7px] font-bold text-slate-600 uppercase tracking-widest">{idle.label}</div>
                    {idle.sub && <div className="text-[5px] font-bold text-slate-700 uppercase tracking-tight">{idle.sub}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bus Load Distribution Heat */}
          <div className="flex-1 p-5 pt-2 pb-2 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-blue-400">
                <MapPin className="w-4 h-4 text-white" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Load Distribution Heat</span>
              </div>
              {metrics.topPressureRoute && metrics.topPressureRoute.load >= 80 && (
                <Badge className="bg-red-500/10 text-red-500 border-none text-[8px] font-black tracking-widest uppercase px-2 py-0.5 animate-pulse">
                  Alert: {metrics.topPressureRoute.name} ({metrics.topPressureRoute.load}%)
                </Badge>
              )}
            </div>

            <div className="flex-1 overflow-x-auto no-scrollbar">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em] border-b border-white/[0.03]">
                    <th className="pb-1.5 w-[45%]">Bus Identifier</th>
                    <th className="pb-1.5 text-center px-4">Morning</th>
                    <th className="pb-1.5 text-center px-4">Evening</th>
                    <th className="pb-1.5 text-right">Capacity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.01]">
                  {busHeat.length > 0 ? busHeat.slice(0, 4).map((bus, i) => (
                    <tr key={bus.id} className="group/row hover:bg-white/[0.01] hover:cursor-pointer">
                      <td className="py-2.5 text-[10px] font-bold text-slate-300 w-[45%]">
                        <div className="flex flex-col">
                          <span className="text-white font-black">{bus.busIdDisplay}</span>
                          <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">{bus.registration}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-center px-4">
                        <div className="flex flex-col items-center">
                          <HeatDot load={bus.morningLoad} />
                          <span className="text-[6px] font-black text-slate-700 uppercase mt-1">Morning</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-center px-4">
                        <div className="flex flex-col items-center">
                          <HeatDot load={bus.eveningLoad} />
                          <span className="text-[6px] font-black text-slate-700 uppercase mt-1">Evening</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-[10px] font-black text-indigo-400">
                        {bus.capacity}
                        <div className="text-[6px] font-bold text-slate-700 uppercase tracking-tighter">Seats</div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-600 text-[10px] font-bold">
                        No bus data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strategic Insight Sidebox */}
          <div className="p-5 md:w-[28%] flex flex-col justify-between bg-white/[0.005]">
            <div className="space-y-4">
              <div className="p-4 pt-2 pb-2 rounded-3xl bg-white/[0.02] border border-white/5 group-hover/card:border-blue-500/20 transition-all duration-500 hover:bg-white/[0.03] hover:cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Strategic Insight</span>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-none text-[8px] font-black tracking-widest uppercase px-2 py-0">STABLE</Badge>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-bold text-white truncate mb-0.5">
                      {metrics.topPressureRoute ? `${metrics.topPressureRoute.name} Focus` : "Balanced System Area"}
                    </div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Route Load Variance Index</div>
                  </div>

                  {/* MINI GRAPH: SHIFT VARIANCE FOR TOP ROUTE */}
                  <div className="flex items-end gap-1.5 h-10 mt-2">
                    {metrics.topPressureRoute ? (
                      <>
                        <div className="flex-1 flex flex-col justify-end gap-1 group/bar">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${metrics.topPressureRoute.morningPct}%` }}
                            className="w-full bg-blue-500/30 border-t-2 border-blue-400 rounded-t-sm"
                          />
                          <span className="text-[7px] font-black text-slate-600 text-center uppercase tracking-tighter">MORNING</span>
                        </div>
                        <div className="flex-1 flex flex-col justify-end gap-1 group/bar">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${metrics.topPressureRoute.eveningPct}%` }}
                            className="w-full bg-indigo-500/30 border-t-2 border-indigo-400 rounded-t-sm"
                          />
                          <span className="text-[7px] font-black text-slate-600 text-center uppercase tracking-tighter">EVENING</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 h-full bg-white/5 rounded border border-dashed border-white/10 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-slate-600">Collecting Data...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Button
                onClick={() => window.location.href = `/${role}/buses`}
                size="sm"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-[9px] uppercase tracking-[0.2em] h-10 rounded-xl shadow-lg shadow-blue-600/10 active:scale-[0.98] transition-all"
              >
                Inspect Fleet Assets
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- INTERNAL COMPONENTS ---
  function HeatDot({ load }: { load: number }) {
    if (load === 0) return <div className="w-2 h-2 rounded-full bg-white/5 inline-block" title="0% load" />;
    if (load < 50) return <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] inline-block" title={`${load}% load`} />;
    if (load < 85) return <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] inline-block" title={`${load}% load`} />;
    return <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] inline-block" title={`${load}% load`} />;
  }

  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-slate-700/50 shadow-2xl mb-4 group min-h-[260px] transition-all duration-500">
      {/* Animated Matrix-like background for "Live" feel */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent" />
        <div className="grid grid-cols-12 h-full w-full pointer-events-none">
          {Array.from({ length: 48 }).map((_, i) => (
            <div key={i} className="border-r border-b border-white/[0.03]" />
          ))}
        </div>
      </div>

      <CardContent className="relative p-2.5 px-4 md:p-3.5 md:px-8 z-10">
        <div className="flex flex-col gap-3 h-full">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="relative h-3 w-3 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-white flex items-center gap-3">
                  Live Operations Center
                  <Badge variant="outline" className="text-[9px] font-bold border-cyan-500/30 text-cyan-400 bg-cyan-500/5 px-1.5 py-0">
                    {activeTrips.length} ACTIVE TRIPS
                  </Badge>
                </h3>
              </div>
              <p className="text-slate-400 text-sm">Real-time transit surveillance and route performance</p>
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" className="bg-slate-900/50 border-slate-700 hover:bg-slate-800 text-slate-300 text-[10px] font-bold uppercase tracking-widest px-4">
                Surveillance Feed
              </Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold uppercase tracking-widest px-4 shadow-lg shadow-indigo-600/20">
                Live Console
              </Button>
            </div>
          </div>

          {/* Featured Trip Monitor */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeTrips.slice(0, 2).map((trip, idx) => (
                  <motion.div
                    key={trip.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="group-item relative overflow-hidden bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-indigo-500/30 rounded-xl p-3 transition-all duration-300 hover:cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                          <Bus className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white tracking-wide">Bus {trip.busId}</div>
                          <div className="text-[8px] font-medium text-slate-500 uppercase">Status</div>
                        </div>
                      </div>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-none text-[8px] font-extrabold px-1.5 py-0">EN-ROUTE</Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                          <span>Progress</span>
                          <span className="text-indigo-400">65%</span>
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: "65%" }}
                            className="h-full bg-gradient-to-r from-indigo-500 to-blue-400 rounded-full"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 py-1.5 border-y border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[8px] font-bold text-slate-500 uppercase">Route</span>
                          <span className="text-[10px] font-bold text-white truncate max-w-[100px]">{trip.routeName}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[8px] font-bold text-slate-500 uppercase">Driver</span>
                          <span className="text-[10px] font-bold text-indigo-300 truncate max-w-[80px]">{trip.driverName}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[9px]">
                        <div className="flex items-center gap-1 text-slate-400">
                          <Users className="w-3 h-3" />
                          <span className="font-bold text-white">{trip.studentCount}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400">
                          <Timer className="w-3 h-3" />
                          <span className="font-bold text-white">12m</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Secondary monitor table */}
              <div className="hidden lg:block bg-white/[0.01] border border-white/5 rounded-2xl p-2 px-4">
                <div className="flex items-center justify-between py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2">
                  <span>Additional Units En-Route</span>
                  <span>Latest Update</span>
                </div>
                {activeTrips.slice(2, 5).map((trip, idx) => (
                  <div key={trip.id} className="flex items-center justify-between py-3 border-t border-white/5 px-2 hover:bg-white/[0.02] transition-colors group/row rounded-lg hover:cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center text-slate-400 group-hover/row:text-cyan-400 transition-colors">
                        <Bus className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-200">Bus {trip.busId} • {trip.routeName}</div>
                        <div className="text-[10px] text-slate-500">Assigned Driver: {trip.driverName}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-slate-300">{trip.studentCount} Pax</span>
                        <span className="text-[8px] text-slate-500 uppercase">Load Balance</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover/row:translate-x-1 transition-transform" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Map Representation Side */}
            <div className="relative">
              <div className="relative h-full min-h-[300px] rounded-3xl border border-white/10 bg-slate-900 overflow-hidden shadow-inner">
                {/* Simulated Map UI */}
                <div className="absolute inset-0 opacity-40">
                  <div className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 bg-[radial-gradient(circle_at_center,_transparent_40%,#1e293b_90%)] z-10" />
                  <div className="grid grid-cols-20 h-full w-full">
                    {Array.from({ length: 400 }).map((_, i) => (
                      <div key={i} className="border-[0.5px] border-white/5" />
                    ))}
                  </div>
                </div>

                {/* Simulated Fleet Dots */}
                <div className="absolute top-1/4 left-1/3 w-4 h-4">
                  <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping opacity-50" />
                  <div className="relative w-full h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(79,70,229,0.8)] flex items-center justify-center">
                    <Bus className="w-2.5 h-2.5 text-white" />
                  </div>
                  <div className="absolute top-1/2 left-full ml-2 w-max px-2 py-1 bg-[#090a10] rounded border border-white/10 text-[8px] font-bold text-white whitespace-nowrap">
                    BUS 038 • EN-ROUTE
                  </div>
                </div>

                <div className="absolute bottom-1/3 right-1/4 w-4 h-4">
                  <div className="absolute inset-0 bg-cyan-500 rounded-full animate-ping opacity-40" />
                  <div className="relative w-full h-full bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.8)] flex items-center justify-center">
                    <Bus className="w-2.5 h-2.5 text-white" />
                  </div>
                  <div className="absolute top-1/2 right-full mr-2 w-max px-2 py-1 bg-[#090a10] rounded border border-white/10 text-[8px] font-bold text-white whitespace-nowrap">
                    BUS 102 • EN-ROUTE
                  </div>
                </div>

                {/* Map Overlay Text */}
                <div className="absolute bottom-4 left-4 right-4 p-4 rounded-2xl bg-[#090a10] border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Active Fleet Area</div>
                      <div className="text-xs font-bold text-white">Central Transit Zone</div>
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 bg-white/5 px-2 py-1 rounded">SCANNING MODE</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
