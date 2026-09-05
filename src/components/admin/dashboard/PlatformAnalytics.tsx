'use client';

import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { authApiFetch } from '@/lib/secure-api-client';
import { motion } from 'motion/react';
import { BarChart3,MousePointer2,Percent,RefreshCw,TrendingUp,Users } from 'lucide-react';
import { useEffect,useState } from 'react';
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis
} from 'recharts';

interface AnalyticsData {
  chartData: Array<{
    date: string;
    users: number;
    sessions: number;
  }>;
  totalActiveUsers: number;
  totalSessions: number;
  engagementRate: string;
  lastUpdated: string;
}

export default function PlatformAnalytics() {
  const { currentUser } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchAnalytics = async (manual = false) => {
    if (manual) setIsRefreshing(true);
    else setLoading(true);
    
    setError(null);
    try {
      if (!currentUser) return;
      
      const response = await authApiFetch(currentUser, '/api/analytics', { 
        cache: 'no-store' 
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch analytics Intelligence');
      }
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Connecting to analytics server...');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchAnalytics();
    }
  }, [currentUser]);

  if (loading && !data) {
    return (
      <div className="w-full h-[280px] bg-[#0a0b14] border border-white/5 rounded-3xl flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-blue-400 text-xs font-medium animate-pulse">Synchronizing Platform Intelligence...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isNotConfigured = error.includes('credentials are not configured');
    const isNoData = error.includes('No analytics data available yet') || error.includes('No data available for the selected period');

    if (isNotConfigured) {
      return (
        <div className="w-full h-[280px] bg-[#0a0b14] border border-white/5 rounded-3xl flex items-center justify-center text-center px-10">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <BarChart3 className="w-6 h-6 text-amber-500/60" />
            </div>
            <div>
              <h3 className="text-white font-bold tracking-tight text-base">GA Intelligence Pending</h3>
              <p className="text-slate-500 text-[11px] font-medium max-w-sm mx-auto mt-2 leading-relaxed">
                GA4 credentials are not configured in the environment. 
                Configure <code className="text-amber-500/80 bg-amber-500/5 px-1 py-0.5 rounded border border-amber-500/10">GA_CLIENT_EMAIL</code> to unlock insights.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (isNoData) {
      return (
        <div className="w-full h-[280px] bg-[#0a0b14] border border-white/5 rounded-3xl flex items-center justify-center text-center px-10">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <TrendingUp className="w-6 h-6 text-blue-500/60" />
            </div>
            <div>
              <h3 className="text-white font-bold tracking-tight text-base">GA Analytics Ready</h3>
              <p className="text-slate-500 text-[11px] font-medium max-w-sm mx-auto mt-2 leading-relaxed">
                Google Analytics is configured but no data has been collected yet.
              </p>
              <div className="mt-4">
                <button 
                  onClick={() => fetchAnalytics(true)}
                  className="px-5 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-xl transition-all text-xs font-bold active:scale-95"
                >
                  Refresh Data
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full p-6 bg-red-500/5 border border-red-500/20 rounded-3xl text-center">
        <p className="text-red-400 mb-4 text-xs font-medium">{error}</p>
        <button 
          onClick={() => fetchAnalytics(true)}
          className="px-5 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-all text-xs font-bold active:scale-95"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const hasData = !!data;

  if (!hasData) {
    return (
      <div className="w-full h-[280px] bg-[#0a0b14] border border-white/5 rounded-3xl flex items-center justify-center text-center px-10">
        <div className="space-y-3">
          <div className="mx-auto w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-white font-bold tracking-tight text-sm">Waiting for Intelligence</h3>
            <p className="text-slate-500 text-[10px] font-medium">No analytics data available yet</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="bg-[#0a0b14] border border-white/5 rounded-3xl overflow-hidden shadow-2xl relative group transition-colors duration-300 hover:bg-[#0f101f]">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-purple-600/5 opacity-50 pointer-events-none" />
      
      <CardHeader className="relative z-10 flex flex-row items-center justify-between py-3 px-6">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <BarChart3 className="w-4 h-4 text-blue-400" />
          </div>
          <CardTitle className="text-lg font-bold bg-gradient-to-r from-white via-blue-100 to-slate-400 bg-clip-text text-transparent">
            Platform Analytics
          </CardTitle>
        </div>
        
        <button 
          onClick={() => fetchAnalytics(true)}
          disabled={isRefreshing}
          className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>

      <CardContent className="relative z-10 space-y-4 pt-0 pb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Active Users', value: data?.totalActiveUsers, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10', trend: '+12%' },
            { label: 'Sessions', value: data?.totalSessions, icon: MousePointer2, color: 'text-purple-400', bg: 'bg-purple-400/10', trend: '+8%' },
            { label: 'Engagement', value: data?.engagementRate, icon: Percent, color: 'text-emerald-400', bg: 'bg-emerald-400/10', trend: '+5%' },
          ].map((metric, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300 hover:cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-1.5 ${metric.bg} rounded-lg`}>
                  <metric.icon className={`w-3.5 h-3.5 ${metric.color}`} />
                </div>
                <span className="text-[9px] font-bold text-emerald-400">{metric.trend}</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-slate-500 text-[9px] font-bold">{metric.label}</p>
                <p className="text-2xl font-bold text-white">
                  {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="h-[180px] w-full bg-white/[0.01] border border-white/5 rounded-2xl p-4 relative overflow-hidden group/chart">
          <div className="absolute top-2 right-4 flex items-center gap-3 z-20">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[8px] font-bold text-slate-500">Users</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              <span className="text-[8px] font-bold text-slate-500">Sessions</span>
            </div>
          </div>
          
          {isMounted && (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <LineChart data={data?.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff03" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                  dy={8}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0c0e1a', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: '12px', 
                    fontSize: '10px',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)'
                  }}
                  itemStyle={{ padding: '0px' }}
                  cursor={{ stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="users" 
                  name="Active Users"
                  stroke="#3b82f6" 
                  strokeWidth={3} 
                  dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                  animationDuration={1500} 
                />
                <Line 
                  type="monotone" 
                  dataKey="sessions" 
                  name="Sessions"
                  stroke="#a855f7" 
                  strokeWidth={3} 
                  dot={{ fill: '#a855f7', r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: '#a855f7', strokeWidth: 2, fill: '#fff' }}
                  animationDuration={1800} 
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 text-[8px] text-slate-700 font-bold">
          <div className="w-1 h-1 rounded-full bg-blue-500/40" />
          Platform Intelligence Engine
        </div>
      </CardContent>
    </Card>
  );
}
