"use client";

import { Clock,MapPin,Navigation,Play,Target,Users } from "lucide-react";
import { useState } from "react";

interface RouteStop {
  stop_name: string;
  name: string;
  sequence: number;
  lat?: number;
  lng?: number;
  time?: string;
}

interface RouteJourneyProps {
  stops: RouteStop[];
  routeName?: string;
  totalDistance?: string;
}

export default function RouteJourney({
  stops,
  routeName,
  totalDistance,
}: RouteJourneyProps) {
  const [activeStop, setActiveStop] = useState<number | null>(null);

  if (!stops || stops.length === 0) {
    return (
      <div className="py-12 text-center border-2 border-dashed border-gray-800 rounded-3xl bg-gray-900/20">
        <MapPin className="h-12 w-12 text-gray-700 mx-auto mb-4 opacity-40" />
        <h3 className="text-xl font-bold text-gray-500">No Journey Data</h3>
        <p className="text-gray-600 text-sm max-w-xs mx-auto">This route hasn't been mapped yet. Assignment of stops is required.</p>
      </div>
    );
  }

  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);
  const mainStopsCount = Math.max(0, sortedStops.length - 1);

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-700">
      {/* Premium Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 p-1">
        <div className="flex items-center space-x-5">
          <div className="relative group">
            <div className="absolute -inset-2 bg-blue-500/20 rounded-2xl blur-xl group-hover:bg-blue-500/30 transition-all duration-500" />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-500 flex items-center justify-center shadow-2xl border border-white/10">
              <Navigation className="h-7 w-7 text-white" />
            </div>
          </div>
          <div>
            <h3 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              Route Journey
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">Live Map</span>
            </h3>
            <p className="text-gray-400 text-sm font-medium">Visual sequence of transit points and stations</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {totalDistance && (
            <div className="hidden sm:flex px-4 py-2 rounded-2xl bg-gray-800/50 border border-gray-700/50 backdrop-blur-md items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Est. Distance</p>
              <span className="text-base font-black text-blue-400">{totalDistance}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Journey Visualization */}
      <div className="relative p-8 md:p-12 rounded-[2rem] bg-slate-900/40 border border-white/5 overflow-hidden shadow-inner group/container md:pt-2 md:pb-2">
        {/* Decorative Grid Mesh */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none" />

        <div className="overflow-x-auto pt-7 pb-4 scrollbar-hide -mx-4 px-4">
          <div className="relative min-w-max flex items-center">

            {/* The Connecting Path Background - Static Pink to Cyan Gradient */}
            <div className="absolute top-[24px] left-10 right-10 h-[2px] bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 opacity-60 rounded-full z-0" />

            {sortedStops.map((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === sortedStops.length - 1;
              const isActive = activeStop === stop.sequence;

              return (
                <div
                  key={(stop as any).id || stop.stop_name || stop.name || `stop-${stop.sequence || index}`}
                  className="flex items-start"
                >
                  {/* Stop Point Station */}
                  <div
                    className="relative flex flex-col items-center group/stop cursor-pointer px-4"
                    onMouseEnter={() => !isActive && setActiveStop(stop.sequence)}
                    onMouseLeave={() => setActiveStop(null)}
                  >

                    {/* Floating time badge */}
                    {stop.time && (
                      <div className={`absolute -top-16 transition-all duration-300 ${isActive ? 'opacity-100 -translate-y-1' : 'opacity-0 translate-y-2'
                        }`}>
                        <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center gap-1.5 shadow-xl">
                          <Clock className="h-3 w-3 text-blue-400 transition-colors" />
                          <span className="text-[10px] font-bold text-white uppercase">{stop.time}</span>
                        </div>
                      </div>
                    )}

                    {/* Track Segment (Marker) - Fixed height ensures alignment with line center */}
                    <div className="h-12 flex items-center justify-center">
                      <div className={`relative z-10 w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-500 ${isFirst
                        ? 'bg-emerald-500 border-emerald-400/50 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                        : isLast
                          ? 'bg-purple-600 border-purple-400/50 shadow-[0_0_20px_rgba(147,51,234,0.3)]'
                          : isActive
                            ? 'bg-blue-600 border-white/50 scale-125 shadow-[0_0_25px_rgba(59,130,246,0.5)]'
                            : 'bg-[#0B1428] border-indigo-400/30 text-indigo-400/90 group-hover/stop:border-white/40'
                        }`}>

                        {isFirst ? (
                          <Play className="h-5 w-5 text-white fill-white" />
                        ) : isLast ? (
                          <Target className="h-5 w-5 text-white" />
                        ) : (
                          <span className={`text-xs font-black tracking-tighter transition-colors ${isActive ? 'text-white' : 'text-indigo-400/90'}`}>
                            {stop.sequence < 10 ? `0${stop.sequence}` : stop.sequence}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Label - Below the node */}
                    <div className={`absolute top-14 left-1/2 -translate-x-1/2 transition-all duration-500 ${isActive ? 'scale-110' : 'group-hover/stop:scale-105 opacity-80'
                      }`}>
                      <p className={`text-[10px] sm:text-[11px] font-black whitespace-nowrap tracking-wider transition-colors uppercase text-center ${isActive ? 'text-blue-400' : 'text-gray-500 group-hover/stop:text-gray-300'
                        }`}>
                        {stop.name}
                      </p>
                    </div>

                    {/* Detail Strip below labels */}
                    <div className={`mt-10 w-1 h-3 rounded-full transition-colors duration-500 ${isActive ? 'bg-blue-500' : 'bg-transparent group-hover/stop:bg-gray-800'
                      }`} />
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Summary Cluster */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="group relative overflow-hidden p-6 rounded-[1.5rem] bg-gray-950/40 border border-white/5 hover:border-emerald-500/20 transition-all duration-500 shadow-xl">
          <div className="relative z-10 flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white group-hover:scale-110 transition-all duration-500 shadow-lg">
              <Play className="h-6 w-6 fill-current" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Start Point</p>
              <p className="text-lg font-black text-white truncate leading-none">{sortedStops[0].name}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden p-6 rounded-[1.5rem] bg-gray-950/40 border border-white/5 hover:border-blue-500/20 transition-all duration-500 shadow-xl">
          <div className="relative z-10 flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 group-hover:bg-blue-500 group-hover:text-white group-hover:scale-110 transition-all duration-500 shadow-lg">
              <Users className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Transit Route</p>
              <p className="text-lg font-black text-white leading-none">{mainStopsCount} Total Stops</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden p-6 rounded-[1.5rem] bg-gray-950/40 border border-white/5 hover:border-purple-500/20 transition-all duration-500 shadow-xl">
          <div className="relative z-10 flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20 group-hover:bg-purple-500 group-hover:text-white group-hover:scale-110 transition-all duration-500 shadow-lg">
              <Target className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest mb-1">Destination</p>
              <p className="text-lg font-black text-white truncate leading-none">{sortedStops[sortedStops.length - 1].name}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
