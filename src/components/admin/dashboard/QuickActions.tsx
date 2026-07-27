"use client";

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
	Activity,
	ArrowRightLeft,
	Bell,
	FileText,
	Settings,
	UserPlus,
	Users,
	Zap
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ActionItem {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: any;
  color: string;
}

export default function QuickActions({ role = 'admin' }: { role?: 'admin' | 'moderator' }) {
  const router = useRouter();

  const actions: ActionItem[] = [
    {
      id: 'add-student',
      label: 'Add Student',
      description: 'Manually register unit passenger',
      path: `/${role}/students`,
      icon: UserPlus,
      color: 'bg-blue-600 shadow-blue-500/20'
    },
    {
      id: 'add-driver',
      label: 'Add Driver',
      description: 'Onboard new fleet personnel',
      path: `/${role}/drivers`,
      icon: Users,
      color: 'bg-indigo-600 shadow-indigo-500/20'
    },
    {
      id: 'reassignment',
      label: 'Reassignment',
      description: 'Optimize unit load distribution',
      path: `/${role}/smart-allocation`,
      icon: ArrowRightLeft,
      color: 'bg-emerald-600 shadow-emerald-500/20'
    },
    {
      id: 'applications',
      label: 'Open Apps',
      description: 'Verify pending enrollment reqs',
      path: `/${role}/applications`,
      icon: FileText,
      color: 'bg-amber-600 shadow-amber-500/20'
    },
    {
      id: 'notifications',
      label: 'Broadcast',
      description: 'Send fleet telemetry alerts',
      path: `/${role}/notifications`,
      icon: Bell,
      color: 'bg-red-600 shadow-red-500/20'
    },
    {
      id: 'bus-health',
      label: 'Fleet Health',
      description: 'Real-time diagnostic overview',
      path: `/${role}/buses`,
      icon: Activity,
      color: 'bg-cyan-600 shadow-cyan-500/20'
    },
    {
      id: 'sys-config',
      label: role === 'admin' ? 'System Config' : 'My Profile',
      description: role === 'admin' ? 'Core engine and rule adjustment' : 'Manage your moderator profile',
      path: role === 'admin' ? '/admin/settings' : '/moderator/profile',
      icon: role === 'admin' ? Settings : Users,
      color: 'bg-purple-600 shadow-purple-500/20'
    }
  ];

  const handleAction = (path: string) => {
    router.push(path);
  };

  return (
    <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl mb-20 p-6 md:p-10 transition-colors duration-300 hover:bg-[#0f101f]">


      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 relative z-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Zap className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-none">Operational Shortcuts</h3>
            <p className="text-slate-400 text-sm font-medium tracking-tight">Rapid execution matrix for mission-critical tasks</p>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
           <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
           <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Ready</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-5 relative z-10">
        {actions.map((action, idx) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: idx * 0.04 }}
            whileHover={{ y: -5 }}
            className="flex"
          >
            <button
              className="group relative flex flex-col items-center justify-center gap-4 w-full aspect-square bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-white/20 rounded-[32px] transition-all duration-500 overflow-hidden hover:cursor-pointer"
              onClick={() => handleAction(action.path)}
            >
              {/* Tile Glow Effect */}
              <div className={cn(
                "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500",
                action.color
              )} />

              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:-translate-y-1 z-10",
                action.color
              )}>
                <action.icon className="w-6 h-6" />
              </div>
              
              <div className="flex flex-col items-center text-center px-3 z-10">
                <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-indigo-300 transition-colors">{action.label}</span>
                <p className="sr-only sm:not-sr-only text-[9px] font-medium text-slate-500 mt-1 line-clamp-1 group-hover:text-slate-300 transition-colors uppercase tracking-widest px-2">{action.id.split('-').join(' ')}</p>
              </div>


            </button>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
