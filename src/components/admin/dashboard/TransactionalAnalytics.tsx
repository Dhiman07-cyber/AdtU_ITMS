"use client";

import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { exportToExcel } from '@/lib/export-helpers';
import { cn } from '@/lib/utils';
import { AnimatePresence,motion } from "motion/react";
import {
	BarChart3,
	Calendar,
	CreditCard,
	Download,
	TrendingUp,
	Wallet
} from 'lucide-react';
import { useEffect,useState } from 'react';
import {
	Area,
	AreaChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis
} from 'recharts';
import { MethodTrend,PaymentTrend } from './types';

interface TransactionalAnalyticsProps {
  paymentTrends: {
    days: PaymentTrend[],
    months: PaymentTrend[],
    methodTrend?: MethodTrend[]
  };
  role?: 'admin' | 'moderator';
  onlineCount?: number;
  offlineCount?: number;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6'];

export default function TransactionalAnalytics({
  paymentTrends,
  role = 'admin',
  onlineCount,
  offlineCount
}: TransactionalAnalyticsProps) {
  const [viewMode, setViewMode] = useState<'days' | 'months'>('days');
  const [metricType, setMetricType] = useState<'revenue' | 'volume'>('revenue');
  const [isExporting, setIsExporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const { currentUser } = useAuth();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const currentData = viewMode === 'days' ? paymentTrends.days || [] : paymentTrends.months || [];
  const methodTrend = paymentTrends.methodTrend || [];

  const handleExport = async () => {
    if (!currentUser) return;
    setIsExporting(true);
    try {
      const token = await currentUser.getIdToken();
      // Use the transactions endpoint with a high limit for export
      const res = await fetch('/api/payment/transactions?limit=1000', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.transactions) {
        // Format for export
        const exportData = data.transactions.map((p: any) => ({
          'Payment ID': p.payment_id || p.id || p.transactionId || 'N/A',
          'Date': p.timestamp ? new Date(p.timestamp).toLocaleString() : 'N/A',
          'Amount': p.amount || 0,
          'Student Name': p.studentName || 'N/A',
          'Enrollment ID': p.studentId || p.enrollmentId || 'N/A',
          'Method': p.method || p.paymentMethod || 'Razorpay',
          'Status': p.status || 'Success',
          'Purpose': p.purpose || 'Bus Fee'
        }));
        await exportToExcel(exportData, `Revenue_Report_${new Date().toISOString().split('T')[0]}`, 'Payments');
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const isRevenue = role === 'admin' && metricType === 'revenue';
      return (
        <div className="bg-[#0f101f] border border-white/10 p-4 rounded-xl shadow-2xl">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-2 border-b border-white/5 pb-2">
            {label}
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-8">
              <span className="text-xs font-medium text-slate-400">{isRevenue ? 'Revenue:' : 'Transactions:'}</span>
              <span className={cn("text-sm font-bold", isRevenue ? "text-indigo-400" : "text-emerald-400")}>
                {isRevenue ? formatCurrency(payload[0].value) : payload[0].value}
              </span>
            </div>
            {isRevenue && (
              <div className="flex items-center justify-between gap-8">
                <span className="text-xs font-medium text-slate-400">Volume:</span>
                <span className="text-sm font-bold text-emerald-400">{payload[0].payload.count} units</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="relative overflow-hidden bg-[#0a0b14] border-white/5 shadow-2xl mb-8 transition-colors duration-300 hover:bg-[#0f101f]">
      <CardHeader className="flex flex-col md:flex-row md:items-center justify-between p-4 pb-1 gap-3 pt-0 pb-0">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
              <TrendingUp className="w-5 h-5" />
            </div>
            <CardTitle className="text-xl font-bold text-white">
              {role === 'moderator' ? 'Collection & Volumetric Trends' : 'Transactional Insights'}
            </CardTitle>
          </div>
          <p className="text-slate-400 text-xs pl-1.5 border-l-2 border-indigo-500/30 ml-1.5">
            {role === 'moderator' ? 'Daily collection activity and period-over-period growth' : 'Collection frequency and settlement models'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-[#161726] p-1.5 rounded-2xl border border-white/5">
          <div className="flex bg-slate-800 rounded-xl p-1">
            <Button
              size="sm"
              variant={viewMode === 'days' ? 'default' : 'ghost'}
              className={cn("text-[10px] font-bold px-4 h-9 rounded-lg transition-all", viewMode === 'days' ? "bg-indigo-600 shadow-indigo-600/20" : "text-slate-500 hover:text-slate-300")}
              onClick={() => setViewMode('days')}
            >
              Last 7 Days
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'months' ? 'default' : 'ghost'}
              className={cn("text-[10px] font-bold px-4 h-9 rounded-lg transition-all", viewMode === 'months' ? "bg-indigo-600 shadow-indigo-600/20" : "text-slate-500 hover:text-slate-300")}
              onClick={() => setViewMode('months')}
            >
              Monthly
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-6 -mt-3">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
          {/* Metric Switchers */}
          <div className="lg:col-span-1 space-y-4">
            {role === 'admin' ? (
              <Button
                className={cn(
                  "w-full h-[116px] p-4 flex flex-col items-start justify-start gap-1 rounded-2xl border transition-all duration-300 hover:cursor-pointer",
                  metricType === 'revenue'
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-600/5 ring-1 ring-white/5"
                    : "bg-transparent border-white/5 text-slate-500 hover:border-white/10 hover:bg-white/5"
                )}
                onClick={() => setMetricType('revenue')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold text-slate-500">Revenue</span>
                </div>
                <div className="text-lg font-bold text-white leading-tight break-words text-left w-full text-wrap">
                  {viewMode === 'days' ? 'Past 7 days Analytics Chart' : 'Monthwise Comparison Chart'}
                </div>
              </Button>
            ) : (
              <div className="w-full h-[116px] p-4 flex flex-col items-start justify-start gap-1 rounded-2xl border bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-600/5 ring-1 ring-white/5 hover:cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold text-slate-500">Transaction Volume</span>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full mt-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500">Online</span>
                    <span className="text-xl font-bold text-white">{onlineCount || 0}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500">Offline</span>
                    <span className="text-xl font-bold text-white">{offlineCount || 0}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 h-[116px] rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-between hover:cursor-pointer">
              {role === 'admin' ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] font-bold text-slate-500">Earnings</span>
                  </div>
                  <div className="space-y-2">
                    <div className="text-lg font-bold text-emerald-400">
                      {(() => {
                        if (viewMode === 'days') {
                          const sum = (paymentTrends.days || []).reduce((acc, curr) => acc + (curr.amount || 0), 0);
                          return formatCurrency(sum);
                        } else {
                          const months = paymentTrends.months || [];
                          const currentMonthVal = months.length > 0 ? (months[months.length - 1]?.amount || 0) : 0;
                          return formatCurrency(currentMonthVal);
                        }
                      })()}
                    </div>
                    <div className="text-[10px] text-slate-500 opacity-60">
                      {viewMode === 'days' ? 'Past 7 Days' : 'This Month'}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <PieChart className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] font-bold text-slate-500 text-wrap leading-tight">Preference Trend</span>
                  </div>
                  <div className="flex-1 w-full mt-1 flex items-center justify-center">
                    {methodTrend.length > 0 ? (
                      isMounted ? (
                        <ResponsiveContainer width="100%" height={80} minWidth={0} minHeight={0}>
                          <PieChart>
                            <Pie
                              data={methodTrend}
                              cx="50%"
                              cy="50%"
                              innerRadius={20}
                              outerRadius={35}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {methodTrend.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      ) : null
                    ) : (
                      <div className="text-[10px] text-slate-500 italic">Calculating...</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* The Chart */}
          <div className="lg:col-span-3 h-[240px] relative">
            {currentData.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center border border-white/5 rounded-3xl bg-white/[0.01]">
                <BarChart3 className="w-12 h-12 text-slate-700 mb-4 opacity-20" />
                <p className="text-slate-500 font-bold text-xs">Not enough data to show</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${viewMode}-${metricType}-${role}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.4 }}
                  className="w-full h-full"
                >
                  {isMounted && (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                      <AreaChart data={currentData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={role === 'admin' && metricType === 'revenue' ? '#6366f1' : '#10b981'} stopOpacity={0.4} />
                            <stop offset="95%" stopColor={role === 'admin' && metricType === 'revenue' ? '#6366f1' : '#10b981'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                        <XAxis
                          dataKey="date"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                          dy={15}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                          tickFormatter={(val) => role === 'admin' && metricType === 'revenue' ? `₹${(val / 1000)}k` : val}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(99, 102, 241, 0.4)', strokeWidth: 1 }} />
                        <Area
                          type="monotone"
                          dataKey={role === 'admin' && metricType === 'revenue' ? 'amount' : 'count'}
                          stroke={role === 'admin' && metricType === 'revenue' ? '#6366f1' : '#10b981'}
                          strokeWidth={4}
                          fillOpacity={1}
                          fill="url(#colorMetric)"
                          animationDuration={1500}
                          dot={{ fill: role === 'admin' && metricType === 'revenue' ? '#4f46e5' : '#10b981', r: 4, strokeWidth: 2, stroke: '#0f172a' }}
                          activeDot={{ r: 7, strokeWidth: 0, fill: role === 'admin' && metricType === 'revenue' ? '#818cf8' : '#34d399' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Footer info blocks */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-6 border-t border-white/5">
          <div className="flex items-center gap-3 hover:cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500">Collection Point</span>
              <span className="text-sm font-bold text-white">
                {role === 'moderator' ? 'Daily Average: ' : ''}
                {role === 'moderator'
                  ? Math.round(currentData.reduce((acc, curr) => acc + curr.count, 0) / (currentData.length || 1))
                  : (paymentTrends.months[paymentTrends.months.length - 1]?.count || 0)
                }
                {role === 'moderator' ? ' units' : ' completed'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 hover:cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500">Currency</span>
              <span className="text-sm font-bold text-white">INR</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3 hover:cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500">Gateway</span>
              <span className="text-sm font-bold text-white">Razorpay (Active)</span>
            </div>
          </div>

          <div className="flex justify-end items-center col-span-1 lg:col-span-1">
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 shadow-sm hover:shadow-lg hover:shadow-blue-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 disabled:opacity-50 flex items-center justify-center"
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              {isExporting ? 'Exporting...' : 'Export'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
