"use client";

import { Badge } from '@/components/ui/badge';
import { Card,CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
	Moon,
	Sun,
	Users
} from 'lucide-react';
import { useEffect,useState } from 'react';
import {
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer
} from 'recharts';
import { ShiftDistributionData } from './types';

interface StudentDistributionProps {
  distribution: ShiftDistributionData[];
  totalStudents: number;
}

export default function StudentDistribution({ distribution, totalStudents }: StudentDistributionProps) {
  const morningData = distribution.find(d => d.name === 'Morning') || { name: 'Morning', value: 0 };
  const eveningData = distribution.find(d => d.name === 'Evening') || { name: 'Evening', value: 0 };

  const morningPercent = totalStudents > 0 ? Math.round((morningData.value / totalStudents) * 100) : 0;
  const eveningPercent = totalStudents > 0 ? Math.round((eveningData.value / totalStudents) * 100) : 0;

  const [activeIndex, setActiveIndex] = useState(-1);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const activeData = activeIndex !== -1 ? distribution[activeIndex] : null;

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(-1);
  };

  return (
    <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl h-full transition-colors duration-300 hover:bg-[#0f101f] flex flex-col">
      <CardContent className="p-4 md:p-6 pt-2 md:pt-2 flex-1 flex flex-col">
        {/* Compact Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Users className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-sm font-black text-white tracking-tight uppercase">Student Shift Matrix</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">Campus Enrollment</p>
            </div>
          </div>
          <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px] font-black px-2.5 py-0.5">
            {totalStudents} TOTAL
          </Badge>
        </div>

        {/* Content Section: Horizontal Layout */}
        <div className="flex-1 flex flex-col md:flex-row items-center justify-center gap-10 py-2">
          {/* Smaller Chart */}
          <div className="relative w-44 h-44 flex-shrink-0 group">
            {/* Elegant Inner Decorative Rings */}
            <div className="absolute inset-[15%] rounded-full border border-white/5 bg-[#0a0b14] shadow-inner flex flex-col items-center justify-center z-20 transition-all duration-700">
              <span className={cn(
                "text-4xl font-extrabold tracking-tighter drop-shadow-lg transition-all duration-500",
                activeData?.name === 'Morning' ? "text-amber-400" : activeData?.name === 'Evening' ? "text-indigo-400" : "text-white"
              )}>
                {activeData ? activeData.value : totalStudents}
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {activeData ? activeData.name : "Students"}
              </span>
            </div>
            
            <div className="absolute inset-0 rounded-full border border-indigo-500/10 pointer-events-none scale-105 group-hover:scale-110 transition-transform duration-1000 z-10" />

            {isMounted && (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={distribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={88}
                    paddingAngle={8}
                    cornerRadius={10}
                    stroke="none"
                    dataKey="value"
                    onMouseEnter={onPieEnter}
                    onMouseLeave={onPieLeave}
                    activeShape={false}
                    isAnimationActive={true}
                    animationBegin={0}
                    animationDuration={1500}
                  >
                    {distribution.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.name === 'Morning' ? 'url(#morningGradient)' : 'url(#eveningGradient)'}
                        stroke="none"
                        style={{
                          outline: 'none',
                          cursor: 'pointer',
                          filter: activeIndex === index ? 'saturate(1.2) brightness(1.1)' : 'none',
                          opacity: activeIndex === -1 || activeIndex === index ? 1 : 0.4
                        }}
                        className="transition-all duration-300"
                      />
                    ))}
                  </Pie>
                  <defs>
                     <linearGradient id="morningGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                     </linearGradient>
                     <linearGradient id="eveningGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#4f46e5" />
                     </linearGradient>
                  </defs>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Shift Details: Premium Horizontal Stack */}
          <div className="flex flex-col flex-1 w-full gap-3 max-w-[280px]">
            <motion.div 
               animate={{ 
                 scale: activeData?.name === 'Morning' ? 1.05 : 1,
                 x: activeData?.name === 'Morning' ? 10 : 0,
                 backgroundColor: activeData?.name === 'Morning' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.03)'
               }}
               className="flex items-center p-3.5 rounded-3xl border border-white/5 hover:border-amber-500/20 transition-all group overflow-hidden relative hover:cursor-pointer"
            >
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Sun className="w-12 h-12 text-amber-500" />
              </div>
              <div className={cn(
                "w-11 h-11 rounded-2xl border flex items-center justify-center mr-4 transition-all",
                activeData?.name === 'Morning' ? "bg-amber-500/20 border-amber-500/40" : "bg-amber-500/10 border-amber-500/20"
              )}>
                <Sun className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Morning Batch</span>
                <div className="flex items-baseline gap-2">
                   <span className="text-xl font-black text-white">{morningData.value}</span>
                   <span className="text-[10px] font-bold text-amber-500/60">{morningPercent}%</span>
                </div>
              </div>
            </motion.div>

            <motion.div 
               animate={{ 
                 scale: activeData?.name === 'Evening' ? 1.05 : 1,
                 x: activeData?.name === 'Evening' ? 10 : 0,
                 backgroundColor: activeData?.name === 'Evening' ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.03)'
               }}
               className="flex items-center p-3.5 rounded-3xl border border-white/5 hover:border-indigo-500/20 transition-all group overflow-hidden relative hover:cursor-pointer"
            >
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Moon className="w-12 h-12 text-indigo-500" />
              </div>
              <div className={cn(
                "w-11 h-11 rounded-2xl border flex items-center justify-center mr-4 transition-all",
                activeData?.name === 'Evening' ? "bg-indigo-500/20 border-indigo-500/40" : "bg-indigo-500/10 border-indigo-500/20"
              )}>
                <Moon className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Evening Batch</span>
                <div className="flex items-baseline gap-2">
                   <span className="text-xl font-black text-white">{eveningData.value}</span>
                   <span className="text-[10px] font-bold text-indigo-500/60">{eveningPercent}%</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
