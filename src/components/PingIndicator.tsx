"use client";

import { useEffect,useRef,useState } from 'react';

/**
 * Premium Ping Indicator - Refined Design
 * 
 * Features:
 * - Clean, minimal design without WiFi icon
 * - Accurate latency measurement
 * - Color-coded quality indicators
 * - Solid tooltip with latency and quality info only
 * - 4-bar signal strength display
 */

interface PingQuality {
  label: string;
  color: string;
  barColor: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  activeBars: number;
}

export function CompactPingIndicator() {
  const [ping, setPing] = useState<number>(0);
  const [isOnline, setIsOnline] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);
  const isMeasuringRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const measurePing = async () => {
    if (isMeasuringRef.current) return;

    isMeasuringRef.current = true;

    try {
      // More accurate ping measurement using multiple samples
      const samples: number[] = [];

      // Take 3 quick samples for accuracy
      for (let i = 0; i < 3; i++) {
        const startTime = performance.now();

        try {
          await fetch(`https://www.google.com/favicon.ico?t=${Date.now()}`, {
            method: 'HEAD',  // Use HEAD for faster response
            cache: 'no-store',
            mode: 'no-cors'
          });

          const endTime = performance.now();
          const latency = endTime - startTime;
          samples.push(latency);
        } catch {
          // If one sample fails, continue with others
          continue;
        }

        // Small delay between samples
        if (i < 2) await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (samples.length > 0) {
        // Use median for more stable reading (removes outliers)
        samples.sort((a, b) => a - b);
        const medianPing = samples[Math.floor(samples.length / 2)];
        setPing(Math.min(Math.round(medianPing), 999));
        setIsOnline(true);
      } else {
        throw new Error('All samples failed');
      }
    } catch (error) {
      // Fallback: Try image loading method
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const imgStart = performance.now();
          const img = new Image();
          img.src = `https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png?t=${Date.now()}`;

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            setTimeout(reject, 2000); // Shorter timeout
          });

          const imgEnd = performance.now();
          setPing(Math.min(Math.round(imgEnd - imgStart), 999));
          setIsOnline(true);
        } catch {
          setPing(0);
          setIsOnline(false);
        }
      } else {
        setPing(0);
        setIsOnline(false);
      }
    } finally {
      isMeasuringRef.current = false;
    }
  };

  useEffect(() => {
    measurePing();
    intervalRef.current = setInterval(measurePing, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      measurePing();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setPing(0);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  // Get quality metrics based on ping
  const getQuality = (): PingQuality => {
    if (!isOnline || ping === 0) {
      return {
        label: 'Offline',
        color: 'text-gray-400',
        barColor: 'bg-gray-500',
        textColor: 'text-gray-400',
        bgColor: 'bg-gray-500/10',
        borderColor: 'border-gray-500/30',
        activeBars: 0
      };
    }

    if (ping < 50) {
      return {
        label: 'Excellent',
        color: 'text-emerald-400',
        barColor: 'bg-emerald-400',
        textColor: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/30',
        activeBars: 4
      };
    }

    if (ping < 150) {
      return {
        label: 'Good',
        color: 'text-green-400',
        barColor: 'bg-green-400',
        textColor: 'text-green-400',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/30',
        activeBars: 3
      };
    }

    if (ping < 300) {
      return {
        label: 'Fair',
        color: 'text-amber-400',
        barColor: 'bg-amber-400',
        textColor: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
        activeBars: 2
      };
    }

    return {
      label: 'Poor',
      color: 'text-red-400',
      barColor: 'bg-red-400',
      textColor: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      activeBars: 1
    };
  };

  const quality = getQuality();

  return (
    <div className="relative">
      {/* Main Indicator Container - No WiFi Icon */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/70 hover:border-slate-600/50 transition-all duration-200 cursor-default group"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Ping Value */}
        <div className="flex items-baseline gap-0.5">
          <span className={`text-xs font-semibold tabular-nums ${quality.textColor} transition-colors duration-300`}>
            {isOnline && ping > 0 ? ping : '--'}
          </span>
          <span className="text-[10px] font-medium text-slate-400">ms</span>
        </div>

        {/* Signal Bars - 4 bars with filled-level pattern */}
        <div className="flex items-end gap-0.5 h-3.5">
          {[1, 2, 3, 4].map((bar) => (
            <div
              key={bar}
              className={`w-0.5 rounded-sm transition-all duration-300 ${bar <= quality.activeBars
                  ? `${quality.barColor} shadow-sm`
                  : 'bg-slate-700/50'
                }`}
              style={{
                height: `${bar * 25}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Solid Tooltip - Shows on hover (No glassmorphism, No SIGNAL field) */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-2 z-50 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="min-w-[160px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
            {/* Tooltip Header */}
            <div className="px-3 py-2 border-b border-slate-700/50 bg-slate-800/80">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 ${quality.barColor} rounded-full animate-pulse shadow-lg`} />
                <span className="text-xs font-semibold text-white">Network Status</span>
              </div>
            </div>

            {/* Tooltip Body - Only Latency and Quality */}
            <div className="px-3 py-2.5 space-y-2">
              {/* Latency */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Latency</span>
                <span className={`text-sm font-bold ${quality.textColor}`}>
                  {isOnline && ping > 0 ? `${ping} ms` : 'N/A'}
                </span>
              </div>

              {/* Quality */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Quality</span>
                <span className={`text-sm font-bold ${quality.textColor}`}>
                  {quality.label}
                </span>
              </div>

              {/* Status Indicator */}
              <div className={`mt-2 px-2 py-1.5 rounded ${quality.bgColor} border ${quality.borderColor}`}>
                <div className="flex items-center justify-center gap-1.5">
                  <div className={`w-1.5 h-1.5 ${quality.barColor} rounded-full animate-pulse`} />
                  <span className={`text-[10px] font-semibold ${quality.textColor} uppercase tracking-wide`}>
                    {isOnline ? 'Active' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
