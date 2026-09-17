'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { authApiFetch } from '@/lib/secure-api-client';
import { motion } from 'motion/react';
import { BarChart3, Clock, MousePointer2, RefreshCw, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  configured?: boolean;
  status?: string;
  message?: string;
  chartData: Array<{
    date: string;
    users: number;
    views?: number;
    sessions?: number;
  }>;
  totalActiveUsers?: number;
  totalSessions?: number;
  totalViews?: number;
  realtimeUsers?: number;
  realtimeViews?: number;
  realtimeEvents?: number;
  avgDuration?: string;
  lastUpdated?: string;
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

  const fetchAnalytics = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else if (!data) setLoading(true);

    setError(null);
    try {
      if (!currentUser) return;

      const response = await authApiFetch(currentUser, '/api/analytics', {
        cache: 'no-store'
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch analytics');
      }
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Connecting to analytics server...');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const userUid = currentUser?.uid;
  useEffect(() => {
    if (userUid) {
      fetchAnalytics();

      // Auto-poll realtime counts every 30 seconds
      const timer = setInterval(() => {
        fetchAnalytics(false);
      }, 30000);

      return () => clearInterval(timer);
    }
  }, [userUid]);

  if (loading && !data) {
    return (
      <div className="w-full h-[280px] bg-[#0a0b14] border border-white/5 rounded-3xl flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-blue-400 text-xs font-medium animate-pulse">Loading Analytics Data...</p>
        </div>
      </div>
    );
  }

  const isConfigMissing =
    data?.configured === false ||
    data?.status === 'config_missing' ||
    (error && (
      error.includes('credentials are not configured') ||
      error.includes('Incomplete analytics configuration') ||
      error.includes('config_missing')
    ));

  if (isConfigMissing) {
    return (
      <Card className="bg-[#0a0b14] border border-white/5 rounded-3xl overflow-hidden shadow-2xl p-6 text-center">
        <div className="flex flex-col items-center justify-center py-6 max-w-sm mx-auto space-y-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <BarChart3 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-white font-bold tracking-tight text-sm">Analytics Not Ready</h3>
            <p className="text-slate-500 text-[11px] font-medium mt-1 leading-relaxed">
              Waiting for website visitors or analytics to connect.
            </p>
          </div>
          <button
            onClick={() => fetchAnalytics(true)}
            className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl transition-all text-xs font-semibold cursor-pointer hover:cursor-pointer active:scale-95 inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            Refresh
          </button>
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <div className="w-full p-6 bg-red-500/5 border border-red-500/20 rounded-3xl text-center">
        <p className="text-red-400 mb-4 text-xs font-medium">{error}</p>
        <button
          onClick={() => fetchAnalytics(true)}
          className="px-5 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-all text-xs font-bold active:scale-95 cursor-pointer hover:cursor-pointer"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const activeUsersVal = data?.totalActiveUsers ?? data?.realtimeUsers ?? 0;
  const sessionsVal = data?.totalSessions ?? data?.realtimeUsers ?? 0;
  const avgDurationVal = data?.avgDuration || '0s';
  const hasActivity = activeUsersVal > 0 || sessionsVal > 0;

  return (
    <Card className="bg-[#0a0b14] border border-white/5 rounded-3xl overflow-hidden shadow-2xl relative group transition-colors duration-300 hover:bg-[#0f101f]">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-purple-600/5 opacity-50 pointer-events-none" />

      <CardHeader className="relative z-10 flex flex-row items-center justify-between py-3 px-6">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <BarChart3 className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold bg-gradient-to-r from-white via-blue-100 to-slate-400 bg-clip-text text-transparent">
              Website & App Traffic
            </CardTitle>
          </div>
        </div>

        <button
          onClick={() => fetchAnalytics(true)}
          disabled={isRefreshing}
          className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer hover:cursor-pointer"
          title="Refresh live analytics data"
        >
          <RefreshCw className={`w-4 h-4 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>

      <CardContent className="relative z-10 space-y-4 pt-0 pb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              label: 'Active Users',
              sublabel: 'Total unique visitors',
              value: activeUsersVal,
              icon: Users,
              color: 'text-blue-400',
              bg: 'bg-blue-400/10',
              trend: hasActivity ? 'Live' : '0'
            },
            {
              label: 'Total Visits',
              sublabel: 'Total app sessions',
              value: sessionsVal,
              icon: MousePointer2,
              color: 'text-purple-400',
              bg: 'bg-purple-400/10',
              trend: hasActivity ? 'Active' : '0'
            },
            {
              label: 'Avg. Time on App',
              sublabel: 'Average session duration',
              value: avgDurationVal,
              icon: Clock,
              color: 'text-emerald-400',
              bg: 'bg-emerald-400/10',
              trend: hasActivity ? 'Active' : '0s'
            },
          ].map((metric, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-1.5 ${metric.bg} rounded-lg`}>
                  <metric.icon className={`w-3.5 h-3.5 ${metric.color}`} />
                </div>
                <span className="text-[9px] font-bold text-emerald-400">{metric.trend}</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-slate-400 text-[10px] font-bold tracking-tight">{metric.label}</p>
                <p className="text-xl font-bold text-white truncate">
                  {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                </p>
                <p className="text-slate-500 text-[9px] font-medium">{metric.sublabel}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="w-full bg-white/[0.01] border border-white/5 rounded-2xl p-4 relative overflow-hidden group/chart">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold text-slate-300">User Traffic Trend</p>
              <p className="text-[9px] text-slate-500">Active users and visits over time</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-[9px] font-semibold text-slate-400">Users</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-[9px] font-semibold text-slate-400">Visits</span>
              </div>
            </div>
          </div>

          {isMounted && (
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={data?.chartData} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 9, fontWeight: 600 }}
                    dy={4}
                  />
                  <YAxis hide domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0c0e1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      fontSize: '11px',
                      padding: '8px 12px',
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.7)'
                    }}
                    formatter={(value: any, name: any) => [
                      `${value} ${name === 'Users' ? 'users' : 'visits'}`,
                      name
                    ]}
                    itemStyle={{ padding: '2px 0' }}
                    cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="users"
                    name="Users"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                    animationDuration={1000}
                  />
                  <Line
                    type="monotone"
                    dataKey="sessions"
                    name="Visits"
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    dot={{ fill: '#a855f7', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: '#a855f7', strokeWidth: 2, fill: '#fff' }}
                    animationDuration={1200}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 text-[8px] text-slate-700 font-bold">
          <div className="w-1 h-1 rounded-full bg-blue-500/40" />
          Google Analytics 4 • Live Web & App Data
        </div>
      </CardContent>
    </Card>
  );
}
