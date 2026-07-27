"use client";

import { motion } from 'framer-motion';
import {
   Calendar,
   Mail,
   Clock,
   ExternalLink,
   ShieldAlert,
   UserPlus,
   Hourglass
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DashboardStats } from './types';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface SystemLifecycleIntelligenceProps {
   stats: DashboardStats;
}

function formatUTCDate(date: Date): string {
    const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const day = date.getUTCDate();
    const month = monthNames[date.getUTCMonth()];
    
    let suffix = 'th';
    if (day > 3 && day < 21) {
        suffix = 'th';
    } else {
        switch (day % 10) {
            case 1: suffix = 'st'; break;
            case 2: suffix = 'nd'; break;
            case 3: suffix = 'rd'; break;
            default: suffix = 'th';
        }
    }
    
    return `${month} ${day}${suffix}`;
}

export default function SystemLifecycleIntelligence({ stats }: SystemLifecycleIntelligenceProps) {
   const router = useRouter();
   const [deadlineConfig, setDeadlineConfig] = useState<any>(null);

   useEffect(() => {
      let isMounted = true;
      fetch('/api/settings/deadline-config')
         .then(res => res.json())
         .then(data => {
            if (isMounted && data.config) {
               setDeadlineConfig(data.config);
            }
         })
         .catch(err => console.error('Error fetching deadline config:', err));
      return () => { isMounted = false; };
   }, []);

   const lifecycleDates = useMemo(() => {
      const startMonth = deadlineConfig?.academicSessionStart?.month ?? 6; // default July (0-indexed 6)
      const startDay = deadlineConfig?.academicSessionStart?.day ?? 1;
      const currentYear = new Date().getFullYear();
      const lifecycle = deriveAcademicLifecycle(startMonth, startDay, currentYear);

      return [
         {
            label: 'Reminder 1',
            date: formatUTCDate(lifecycle.reminder1),
            icon: Mail,
            color: 'text-blue-400',
            bg: 'bg-blue-400/10',
            description: 'We begin reminding students to renew their transport service before it expires.'
         },
         {
            label: 'Reminder 2',
            date: formatUTCDate(lifecycle.reminder2),
            icon: Mail,
            color: 'text-sky-400',
            bg: 'bg-sky-400/10',
            description: 'A second reminder is sent to students who have not renewed yet.'
         },
         {
            label: 'Final Reminder',
            date: formatUTCDate(lifecycle.finalReminder),
            icon: Mail,
            color: 'text-cyan-400',
            bg: 'bg-cyan-400/10',
            description: 'This is the final reminder before transport service expires.'
         },
         {
            label: 'Academic Year End',
            date: formatUTCDate(lifecycle.expiry),
            icon: Calendar,
            color: 'text-indigo-400',
            bg: 'bg-indigo-400/10',
            description: 'The current transport service officially ends on this day.'
         },
         {
            label: 'Renewal Deadline',
            date: formatUTCDate(lifecycle.deadline),
            icon: Clock,
            color: 'text-amber-400',
            bg: 'bg-amber-400/10',
            description: 'This is the last day students can renew before the new academic session begins.'
         },
         {
            label: 'Soft Block',
            date: formatUTCDate(lifecycle.softBlock),
            icon: ShieldAlert,
            color: 'text-orange-400',
            bg: 'bg-orange-400/10',
            description: 'Students who have not renewed lose access to transport services. Their reserved bus seat becomes available for new students.'
         },
         {
            label: 'Future Session Activation',
            date: formatUTCDate(lifecycle.activation),
            icon: UserPlus,
            color: 'text-emerald-400',
            bg: 'bg-emerald-400/10',
            description: 'Verified students for the upcoming academic session are automatically assigned seats if available. If no suitable seat is available, their application is moved for manual review.'
         }
      ];
   }, [deadlineConfig]);

   // Derived Analytics
   const reservedCount = stats.activeStudents;
   const expiredCount = stats.expiredStudents;

   return (
      <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl h-full transition-colors duration-300 hover:bg-[#0f101f] font-sans">
         <CardContent className="p-4 pt-2 md:p-6 md:pt-2 h-full flex flex-col">
            {/* Header Row */}
            <div className="flex items-center justify-between mb-5">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                     <Hourglass className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="flex flex-col">
                     <h3 className="text-sm font-bold text-white tracking-tight uppercase leading-tight">System Lifecycle Intelligence</h3>
                     <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">Academic Compliance Matrix</p>
                  </div>
               </div>
               <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest px-0 h-auto"
                  onClick={() => router.push('/admin/setup-admin')}
               >
                  Edit Config <ExternalLink className="w-3 h-3 ml-1.5" />
               </Button>
            </div>

            {/* Main Intelligence Grid */}
            <div className="flex-1 space-y-8">
               {/* Section 1: Lifecycle Timeline */}
               <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                     <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Active Cycle Milestones</span>
                  </div>

                  {/* Desktop Horizontal Timeline */}
                  <TooltipProvider>
                     <div className="relative hidden md:grid grid-cols-7 gap-x-2 items-start pt-2">
                        {/* Connecting Line */}
                        <div className="absolute top-6 left-[7.14%] right-[7.14%] h-[2px] bg-slate-800/50 z-0" />

                        {lifecycleDates.map((milestone, idx) => (
                           <Tooltip key={milestone.label}>
                              <TooltipTrigger asChild>
                                 <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="relative z-10 flex flex-col items-center gap-2 group hover:cursor-pointer w-full"
                                 >
                                    <div className={`w-8 h-8 rounded-full ${milestone.bg} border-2 border-slate-900 group-hover:border-indigo-500/40 flex items-center justify-center transition-all`}>
                                       <milestone.icon className={`w-3.5 h-3.5 ${milestone.color}`} />
                                    </div>
                                    <div className="flex flex-col items-center text-center w-full mt-1">
                                       <div className="h-8 flex items-center justify-center px-1 w-full">
                                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-tight text-center max-w-[85px] group-hover:text-indigo-400 transition-colors">
                                             {milestone.label}
                                          </span>
                                       </div>
                                       <span className="text-[10px] font-bold text-white whitespace-nowrap mt-1">
                                          {milestone.date}
                                       </span>
                                    </div>
                                 </motion.div>
                              </TooltipTrigger>
                              <TooltipContent className="bg-slate-950 border border-white/10 text-white max-w-[240px] p-2.5 rounded-lg shadow-xl text-[11px] leading-relaxed">
                                 <p>{milestone.description}</p>
                              </TooltipContent>
                           </Tooltip>
                        ))}
                     </div>
                  </TooltipProvider>

                  {/* Mobile Vertical Timeline */}
                  <div className="relative flex md:hidden flex-col gap-6 pl-8 pt-2">
                     {/* Connecting Line */}
                     <div className="absolute left-4 top-2 bottom-6 w-[2px] bg-slate-800/50 z-0" />

                     {lifecycleDates.map((milestone, idx) => (
                        <motion.div
                           key={milestone.label}
                           initial={{ opacity: 0, x: -10 }}
                           animate={{ opacity: 1, x: 0 }}
                           transition={{ delay: idx * 0.05 }}
                           className="relative flex flex-col gap-0.5"
                        >
                           {/* Icon Node positioned absolutely on the left vertical line */}
                           <div className={`absolute -left-8 top-0.5 w-8 h-8 rounded-full ${milestone.bg} border-2 border-slate-950 flex items-center justify-center z-10`}>
                              <milestone.icon className={`w-3.5 h-3.5 ${milestone.color}`} />
                           </div>
                           <div className="flex flex-col">
                              <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">{milestone.label}</span>
                              <span className="text-xs font-bold text-white mt-0.5">{milestone.date}</span>
                              <p className="text-[10px] text-slate-400 mt-1 leading-normal max-w-sm">{milestone.description}</p>
                           </div>
                        </motion.div>
                     ))}
                  </div>
               </div>

               {/* Section 2: Reservation Analytics */}
               <div className="grid grid-cols-2 gap-4">
                  <div className="p-5 rounded-3xl bg-emerald-500/[0.03] border border-emerald-500/10 flex flex-col gap-3 group hover:border-emerald-500/30 transition-all hover:cursor-pointer">
                     <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                           <UserPlus className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[8px] font-black uppercase">RESERVED</div>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-3xl font-black text-white">{reservedCount}</span>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1">Confirmed Seats</span>
                     </div>
                  </div>

                  <div className="p-5 rounded-3xl bg-red-500/[0.03] border border-red-500/10 flex flex-col gap-3 group hover:border-red-500/30 transition-all hover:cursor-pointer">
                     <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center">
                           <ShieldAlert className="w-4 h-4 text-red-500" />
                        </div>
                        <div className="px-2 py-0.5 bg-red-500/20 text-red-500 rounded-full text-[8px] font-black uppercase">RENEWAL RISK</div>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-3xl font-black text-white">{expiredCount}</span>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1">Status: Expired</span>
                     </div>
                  </div>
               </div>
            </div>
         </CardContent>
      </Card>
   );
}
