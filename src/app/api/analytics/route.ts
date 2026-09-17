import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Cleanly format GA private key for the client
 */
const formatPrivateKey = (key?: string) => {
  if (!key) return undefined;
  // Handle both literal newlines and escaped \n sequences
  return key.replace(/\\n/g, '\n').replace(/"/g, '');
};

const _get = async () => {
  try {
    const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
    const clientEmail = process.env.GA_CLIENT_EMAIL;
    const privateKey = formatPrivateKey(process.env.GA_PRIVATE_KEY);
    const projectId = process.env.GA_PROJECT_ID;

    if (!PROPERTY_ID || !clientEmail || !privateKey || !projectId) {
      return NextResponse.json({ 
        configured: false,
        status: 'config_missing',
        message: 'Google Analytics 4 credentials are not configured in environment variables.',
        chartData: [],
        totalActiveUsers: 0,
        totalSessions: 0,
        realtimeUsers: 0,
        engagementRate: '0%',
        lastUpdated: new Date().toISOString()
      }, { status: 200 });
    }

    const analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: { client_email: clientEmail, private_key: privateKey },
      projectId,
    });

    // 1. Fetch Realtime Telemetry (Immediate / Active Users in last 30 min)
    let realtimeUsers = 0;
    let realtimeViews = 0;
    let realtimeEvents = 0;
    try {
      const [realtime] = await analyticsDataClient.runRealtimeReport({
        property: `properties/${PROPERTY_ID}`,
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'eventCount' }
        ]
      });

      if (realtime.rows && realtime.rows.length > 0) {
        realtimeUsers = parseInt(realtime.rows[0].metricValues?.[0]?.value || '0', 10);
        realtimeViews = parseInt(realtime.rows[0].metricValues?.[1]?.value || '0', 10);
        realtimeEvents = parseInt(realtime.rows[0].metricValues?.[2]?.value || '0', 10);
      }
    } catch (rtErr) {
      console.warn('GA4 Realtime report warning:', rtErr);
    }

    // 2. Fetch Historical 7-Day Aggregation
    let histRows: any[] = [];
    try {
      const [response] = await analyticsDataClient.runReport({
        property: `properties/${PROPERTY_ID}`,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }]
      });
      histRows = response.rows || [];
    } catch (hErr) {
      console.warn('GA4 Historical report warning:', hErr);
    }

    // 4. Build Chart Timeline
    let chartData: Array<{ date: string; users: number; views: number; sessions: number }> = [];

    const hasHistData = histRows.some((r: any) => parseInt(r.metricValues?.[0]?.value || '0', 10) > 0);

    if (hasHistData) {
      chartData = histRows.map((row: any) => {
        const dateStr = row.dimensionValues[0].value;
        const date = new Date(
          parseInt(dateStr.substring(0, 4)), 
          parseInt(dateStr.substring(4, 6)) - 1, 
          parseInt(dateStr.substring(6, 8))
        );
        const users = parseInt(row.metricValues[0].value, 10);
        const sessions = parseInt(row.metricValues[1].value, 10);
        const views = parseInt(row.metricValues[2].value, 10);
        
        return {
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          users,
          views,
          sessions,
        };
      });
    } else {
      // For immediate/realtime view (past 30 mins):
      // Fetch 30-minute breakdown from GA4 realtime
      const minuteMap = new Map<number, number>();
      try {
        const [rtMinutes] = await analyticsDataClient.runRealtimeReport({
          property: `properties/${PROPERTY_ID}`,
          dimensions: [{ name: 'minutesAgo' }],
          metrics: [{ name: 'activeUsers' }]
        });
        if (rtMinutes.rows) {
          for (const row of rtMinutes.rows) {
            const min = parseInt(row.dimensionValues?.[0]?.value || '0', 10);
            const count = parseInt(row.metricValues?.[0]?.value || '0', 10);
            minuteMap.set(min, count);
          }
        }
      } catch (minErr) {
        console.warn('GA4 Minutes breakdown warning:', minErr);
      }

      // Generate 6 5-minute interval points: 25m, 20m, 15m, 10m, 5m, Now
      const intervals = [25, 20, 15, 10, 5, 0];
      for (const min of intervals) {
        let count = 0;
        for (let offset = 0; offset < 5; offset++) {
          count = Math.max(count, minuteMap.get(min + offset) || 0);
        }
        if (min === 0) count = Math.max(count, realtimeUsers);

        chartData.push({
          date: min === 0 ? 'Now' : `${min}m ago`,
          users: count,
          views: count > 0 ? Math.max(count, Math.round(realtimeViews * (count / Math.max(1, realtimeUsers)))) : 0,
          sessions: count,
        });
      }
    }

    const totalActiveUsers = Math.max(
      realtimeUsers,
      chartData.reduce((sum, day) => sum + day.users, 0)
    );
    const totalSessions = Math.max(
      realtimeUsers,
      chartData.reduce((sum, day) => sum + day.sessions, 0)
    );
    const totalViews = Math.max(
      realtimeViews,
      chartData.reduce((sum, day) => sum + (day.views || 0), 0)
    );

    const formatDuration = (totalSec: number) => {
      if (!totalSec || totalSec <= 0) return '0s';
      const mins = Math.floor(totalSec / 60);
      const secs = Math.round(totalSec % 60);
      if (mins === 0) return `${secs}s`;
      return `${mins}m ${secs}s`;
    };

    let avgDuration = '0s';
    if (histRows.length > 0 && histRows.some((r: any) => parseFloat(r.metricValues[3]?.value || '0') > 0)) {
      const totalSec = histRows.reduce((sum, r) => sum + parseFloat(r.metricValues[3]?.value || '0'), 0);
      avgDuration = formatDuration(totalSec / histRows.length);
    } else if (totalActiveUsers > 0) {
      const estSec = Math.max(30, Math.round((realtimeViews / Math.max(1, totalActiveUsers)) * 45));
      avgDuration = formatDuration(estSec);
    }

    return NextResponse.json({
      configured: true,
      chartData,
      totalActiveUsers,
      totalSessions,
      totalViews,
      realtimeUsers,
      realtimeViews,
      realtimeEvents,
      avgDuration,
      lastUpdated: new Date().toISOString(),
      status: 'success'
    });

  } catch (error: any) {
    console.error('GA4 Analytics error:', error);
    const isPermissionError = error.message?.includes('permission') || error.code === 7;
    return NextResponse.json({ 
      error: isPermissionError ? 'Unauthorized access to GA4 property.' : 'Analytics sync failed.',
      status: 'error'
    }, { status: 500 });
  }
};

export const GET = withSecurity(_get, {
  requiredRoles: ['admin', 'moderator'],
  rateLimit: RateLimits.ADMIN,
});
