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
        error: 'Incomplete analytics configuration.',
        status: 'config_missing' 
      }, { status: 500 });
    }

    const analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: { client_email: clientEmail, private_key: privateKey },
      projectId,
    });

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'engagementRate' }
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }]
    });

    if (!response.rows || response.rows.length === 0) {
      return NextResponse.json({
        chartData: [],
        totalActiveUsers: 0,
        totalSessions: 0,
        engagementRate: '0%',
        lastUpdated: new Date().toISOString(),
        status: 'no_data'
      });
    }

    const chartData = response.rows.map((row: any) => {
      const dateStr = row.dimensionValues[0].value;
      const date = new Date(
        parseInt(dateStr.substring(0, 4)), 
        parseInt(dateStr.substring(4, 6)) - 1, 
        parseInt(dateStr.substring(6, 8))
      );
      
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        users: parseInt(row.metricValues[0].value, 10),
        sessions: parseInt(row.metricValues[1].value, 10),
      };
    });

    const totalActiveUsers = chartData.reduce((sum, day) => sum + day.users, 0);
    const totalSessions = chartData.reduce((sum, day) => sum + day.sessions, 0);
    const totalEngage = response.rows.reduce((s: number, r: any) => s + parseFloat(r.metricValues[2].value), 0);
    const engagementRate = ((totalEngage / response.rows.length) * 100).toFixed(1) + '%';

    return NextResponse.json({
      chartData,
      totalActiveUsers,
      totalSessions,
      engagementRate,
      lastUpdated: new Date().toISOString(),
      status: 'success'
    });

  } catch (error: any) {
    console.error('GA4 Analytics error:', error);
    const isPermissionError = error.message?.includes('permission') || error.code === 7;
    return NextResponse.json({ 
      error: isPermissionError ? 'Unauthorized access to GA4 property.' : 'Analytics sync failed.',
    }, { status: 500 });
  }
};

export const GET = withSecurity(_get, {
  requiredRoles: ['admin', 'moderator'],
  rateLimit: RateLimits.ADMIN,
});
