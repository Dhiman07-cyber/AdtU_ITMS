'use client';

import { cn } from '@/lib/utils';

interface HeatStripProps {
  stops: Array<{ id: string; name: string; sequence: number }>;
  counts?: Map<string, number>;
  height?: number;
  showLabels?: boolean;
  className?: string;
}

export default function HeatStrip({ 
  stops, 
  counts,
  height = 8,
  showLabels = false,
  className 
}: HeatStripProps) {
  
  const stopData = (() => {
    if (!counts || counts.size === 0) {
      return stops.map(stop => ({
        ...stop,
        count: 0,
        intensity: 0
      }));
    }

    const maxCount = Math.max(...Array.from(counts.values()));
    
    return stops.map(stop => {
      const count = counts.get(stop.id) || 0;
      const intensity = maxCount > 0 ? count / maxCount : 0;
      
      return {
        ...stop,
        count,
        intensity
      };
    });
  })();

  const getHeatColor = (intensity: number) => {
    if (intensity === 0) return 'bg-zinc-700';
    if (intensity < 0.2) return 'bg-blue-500';
    if (intensity < 0.4) return 'bg-green-500';
    if (intensity < 0.6) return 'bg-yellow-500';
    if (intensity < 0.8) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-0.5 rounded overflow-hidden">
        {stopData.map((stop, index) => (
          <div 
            key={stop.id}
            className="relative flex-1 group"
            style={{ minHeight: `${height}px` }}
          >
            <div 
              className={cn(
                "h-full transition-all duration-300",
                getHeatColor(stop.intensity),
                "hover:scale-y-150 hover:z-10"
              )}
            />
            
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50">
              <div className="bg-zinc-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap border border-zinc-700">
                <div className="font-semibold">{stop.name}</div>
                <div className="text-gray-400">{stop.count} students</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {showLabels && (
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>First Stop</span>
          <span>Last Stop</span>
        </div>
      )}
    </div>
  );
}
