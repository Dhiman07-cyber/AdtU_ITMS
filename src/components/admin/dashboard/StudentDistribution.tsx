"use client";

import { Badge } from '@/components/ui/badge';
import { Card,CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from "motion/react";
import {
	Moon,
	Sun,
	Users
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
              <h3 className="text-sm font-bold text-white">Student Shift Matrix</h3>
              <p className="text-[10px] text-slate-500 font-bold leading-none mt-1">Campus Enrollment</p>
            </div>
          </div>
          <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px] font-bold px-2.5 py-0.5">
            {totalStudents} Total
          </Badge>
        </div>

        {/* Content Section: Horizontal Layout */}
        <div className="flex-1 flex flex-col md:flex-row items-center justify-center gap-10 py-2">
          {/* Pure SVG Donut Chart Container */}
          <div className="relative w-48 h-48 flex-shrink-0 flex items-center justify-center group">
            {/* Elegant Inner Decorative Center Disc */}
            <div className="absolute w-[108px] h-[108px] rounded-full border border-white/5 bg-[#0a0b14] shadow-inner flex flex-col items-center justify-center z-20 transition-all duration-700 pointer-events-none">
              <span className={cn(
                "text-3xl font-bold drop-shadow-lg transition-all duration-500",
                activeData?.name === 'Morning' ? "text-amber-400" : activeData?.name === 'Evening' ? "text-indigo-400" : "text-white"
              )}>
                {activeData ? activeData.value : totalStudents}
              </span>
              <span className="text-[10px] font-bold text-slate-400 mt-0.5">
                {activeData ? activeData.name : "Students"}
              </span>
            </div>
            
            {/* Outer Subtle Accent Ring */}
            <div className="absolute w-[164px] h-[164px] rounded-full border border-indigo-500/10 pointer-events-none group-hover:scale-105 transition-transform duration-700 z-10" />

            {/* Precision Pure SVG Circular Arcs */}
            {(() => {
              const radius = 68;
              const circumference = 2 * Math.PI * radius;
              const total = totalStudents || 1;
              
              const morningRatio = totalStudents > 0 ? morningData.value / total : 0;
              const eveningRatio = totalStudents > 0 ? eveningData.value / total : 0;

              const morningLength = circumference * morningRatio;
              const eveningLength = circumference * eveningRatio;

              return (
                <svg className="w-full h-full overflow-visible" viewBox="0 0 200 200">
                  <defs>
                    {/* Soft ambient orange & indigo glows */}
                    <filter id="glow-orange" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="6" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <filter id="glow-indigo" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="6" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>
                  
                  {/* Outer coordinated SVG rotated container group to prevent clipping */}
                  <g transform="rotate(-90 100 100)">
                    {/* Morning Arc Segment */}
                    {morningLength > 0 && (
                      <motion.circle
                        cx="100"
                        cy="100"
                        r={radius}
                        fill="transparent"
                        stroke="#f59e0b"
                        strokeWidth="16"
                        strokeDasharray={`${morningLength} ${circumference - morningLength}`}
                        strokeDashoffset="0"
                        className="transition-all duration-500 hover:cursor-pointer"
                        style={{
                          filter: activeIndex === 0 ? "url(#glow-orange)" : "none",
                          opacity: activeIndex === -1 ? 0.75 : activeIndex === 0 ? 1.0 : 0.35
                        }}
                        onMouseEnter={() => onPieEnter(0, 0)}
                        onMouseLeave={onPieLeave}
                      />
                    )}

                    {/* Evening Arc Segment */}
                    {eveningLength > 0 && (
                      <motion.circle
                        cx="100"
                        cy="100"
                        r={radius}
                        fill="transparent"
                        stroke="#6366f1"
                        strokeWidth="16"
                        strokeDasharray={`${eveningLength} ${circumference - eveningLength}`}
                        strokeDashoffset={-morningLength}
                        className="transition-all duration-500 hover:cursor-pointer"
                        style={{
                          filter: activeIndex === 1 ? "url(#glow-indigo)" : "none",
                          opacity: activeIndex === -1 ? 0.75 : activeIndex === 1 ? 1.0 : 0.35
                        }}
                        onMouseEnter={() => onPieEnter(0, 1)}
                        onMouseLeave={onPieLeave}
                      />
                    )}
                  </g>
                </svg>
              );
            })()}
          </div>

          {/* Structured Details Cards */}
          <div className="flex-1 flex flex-col gap-4 w-full md:max-w-[280px]">
            <motion.div 
               animate={{ 
                 scale: activeData?.name === 'Morning' ? 1.05 : 1,
                 x: activeData?.name === 'Morning' ? 10 : 0,
                 backgroundColor: activeData?.name === 'Morning' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.03)'
               }}
               className="flex items-center p-3.5 rounded-3xl border border-white/5 hover:border-amber-500/20 transition-all group overflow-hidden relative hover:cursor-pointer"
               onMouseEnter={() => onPieEnter(0, 0)}
               onMouseLeave={onPieLeave}
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
                <span className="text-[10px] font-bold text-slate-500 mb-0.5">Morning Batch</span>
                <div className="flex items-baseline gap-2">
                   <span className="text-xl font-bold text-white">{morningData.value}</span>
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
               onMouseEnter={() => onPieEnter(0, 1)}
               onMouseLeave={onPieLeave}
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
                <span className="text-[10px] font-bold text-slate-500 mb-0.5">Evening Batch</span>
                <div className="flex items-baseline gap-2">
                   <span className="text-xl font-bold text-white">{eveningData.value}</span>
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
