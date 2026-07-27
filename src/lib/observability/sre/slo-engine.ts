/**
 * PROGRAM-004 / PHASE-05: SRE Engineering & Reliability Management
 * Service Level Objectives (SLO), Service Level Indicators (SLI) & Error Budget Engine
 */

export interface SLIDefinition {
  id: string;
  name: string;
  subsystem: string;
  metricName: string;
  numeratorQuery: string;
  denominatorQuery: string;
  unit: string;
}

export interface SLODefinition {
  id: string;
  name: string;
  subsystem: string;
  targetPercent: number; // e.g. 99.9
  windowDays: number;    // e.g. 30
  sli: SLIDefinition;
  owner: string;
  businessImpact: string;
  dependencies: string[];
}

export interface ErrorBudgetStatus {
  sloId: string;
  sloName: string;
  targetPercent: number;
  currentSLIPercent: number;
  totalBudgetPercent: number;     // 100 - targetPercent (e.g., 0.1% for 99.9%)
  budgetConsumedPercent: number;  // % of error budget consumed so far
  budgetRemainingPercent: number; // % of error budget remaining
  burnRate1h: number;             // 1-hour burn rate multiplier
  burnRate6h: number;             // 6-hour burn rate multiplier
  status: 'HEALTHY' | 'WARNING' | 'EXHAUSTED' | 'CRITICAL_BURN';
}

export const SLO_CATALOGUE: SLODefinition[] = [
  {
    id: 'slo-platform-availability',
    name: 'Platform Availability SLO',
    subsystem: 'Platform Core',
    targetPercent: 99.9,
    windowDays: 30,
    owner: 'Platform Team',
    businessImpact: 'Complete platform outage prevents students, drivers, and admins from accessing ITMS services.',
    dependencies: ['Next.js', 'Supabase', 'Firebase', 'NGINX'],
    sli: {
      id: 'sli-platform-availability',
      name: 'Successful HTTP API Responses Ratio',
      subsystem: 'Platform Core',
      metricName: 'itms_api_requests_total',
      numeratorQuery: 'sum(rate(itms_api_requests_total{status=~"2..|4.."}[5m]))',
      denominatorQuery: 'sum(rate(itms_api_requests_total[5m]))',
      unit: 'ratio'
    }
  },
  {
    id: 'slo-websocket-availability',
    name: 'WebSocket Realtime Availability SLO',
    subsystem: 'Realtime Infrastructure',
    targetPercent: 99.9,
    windowDays: 30,
    owner: 'Realtime & Infrastructure Team',
    businessImpact: 'WebSocket downtime stops live bus location updates and waiting flag broadcasts to drivers.',
    dependencies: ['WebSocket Server', 'Node.js Runtime', 'Firebase Auth'],
    sli: {
      id: 'sli-websocket-availability',
      name: 'Successful WebSocket Connections Ratio',
      subsystem: 'Realtime Infrastructure',
      metricName: 'websocket_connections_opened_total',
      numeratorQuery: 'sum(rate(websocket_auth_success_total[5m]))',
      denominatorQuery: 'sum(rate(websocket_connections_opened_total[5m]))',
      unit: 'ratio'
    }
  },
  {
    id: 'slo-trip-availability',
    name: 'Trip Operation Success SLO',
    subsystem: 'Trip Domain',
    targetPercent: 99.95,
    windowDays: 30,
    owner: 'Transit Operations Team',
    businessImpact: 'Failed trip initiations block drivers from starting bus journeys and tracking student manifests.',
    dependencies: ['Trip Service', 'Supabase PostgreSQL', 'Redis'],
    sli: {
      id: 'sli-trip-availability',
      name: 'Completed Trip Ratio',
      subsystem: 'Trip Domain',
      metricName: 'itms_trip_completed_total',
      numeratorQuery: 'sum(rate(itms_trip_completed_total[1h]))',
      denominatorQuery: 'sum(rate(itms_trip_started_total[1h]))',
      unit: 'ratio'
    }
  },
  {
    id: 'slo-payment-availability',
    name: 'Payment Processing Reliability SLO',
    subsystem: 'Payment Domain',
    targetPercent: 99.5,
    windowDays: 30,
    owner: 'Finance & Payments Team',
    businessImpact: 'Payment failures prevent students from renewing bus passes and cause revenue loss.',
    dependencies: ['Razorpay Gateway', 'Payment Service', 'Supabase'],
    sli: {
      id: 'sli-payment-availability',
      name: 'Successful Payments Ratio',
      subsystem: 'Payment Domain',
      metricName: 'itms_payments_completed_total',
      numeratorQuery: 'sum(rate(itms_payments_completed_total[1h]))',
      denominatorQuery: 'sum(rate(itms_payments_initiated_total[1h]))',
      unit: 'ratio'
    }
  },
  {
    id: 'slo-gps-freshness',
    name: 'GPS Quality & Freshness SLO',
    subsystem: 'GPS Pipeline',
    targetPercent: 98.0,
    windowDays: 30,
    owner: 'GIS & Location Team',
    businessImpact: 'Rejected or delayed GPS updates cause inaccurate bus location markers on student maps.',
    dependencies: ['GPS Pipeline', 'WebSocket Broadcast', 'Supabase'],
    sli: {
      id: 'sli-gps-freshness',
      name: 'GPS Acceptance Ratio',
      subsystem: 'GPS Pipeline',
      metricName: 'itms_gps_updates_accepted_total',
      numeratorQuery: 'sum(rate(itms_gps_updates_accepted_total[5m]))',
      denominatorQuery: 'sum(rate(itms_gps_updates_received_total[5m]))',
      unit: 'ratio'
    }
  },
  {
    id: 'slo-database-availability',
    name: 'Database Query Health SLO',
    subsystem: 'Persistence Layer',
    targetPercent: 99.95,
    windowDays: 30,
    owner: 'Database Architecture Team',
    businessImpact: 'Database errors or connection pool exhaustion degrade all platform API routes.',
    dependencies: ['Supabase PostgreSQL', 'PostgREST'],
    sli: {
      id: 'sli-database-availability',
      name: 'Successful Database Query Ratio',
      subsystem: 'Persistence Layer',
      metricName: 'database_queries_total',
      numeratorQuery: 'sum(rate(database_queries_total[5m])) - sum(rate(database_query_errors_total[5m]))',
      denominatorQuery: 'sum(rate(database_queries_total[5m]))',
      unit: 'ratio'
    }
  }
];

export class SLOEngine {
  /**
   * Calculates the current Error Budget status for a given SLO definition.
   */
  public calculateErrorBudget(slo: SLODefinition, currentSLIValue: number): ErrorBudgetStatus {
    const target = Number(slo.targetPercent.toFixed(4));
    const currentSLI = Number(Math.min(100, Math.max(0, currentSLIValue)).toFixed(4));
    
    // Total budget percentage allowable for failures
    const totalBudget = Math.max(0.0001, Number((100 - target).toFixed(4)));
    
    // Actual failure percentage observed
    const failureObserved = Math.max(0, Number((100 - currentSLI).toFixed(4)));
    
    // % of budget consumed
    const budgetConsumed = Math.min(100, (failureObserved / totalBudget) * 100);
    const budgetRemaining = Math.max(0, 100 - budgetConsumed);

    // Calculate burn rates
    const burnRate1h = (failureObserved / totalBudget) * (30 * 24);
    const burnRate6h = (failureObserved / totalBudget) * (30 * 4);

    let status: ErrorBudgetStatus['status'] = 'HEALTHY';
    if (budgetRemaining <= 0) {
      status = 'EXHAUSTED';
    } else if (burnRate1h >= 14.4 || burnRate6h >= 6.0) {
      status = 'CRITICAL_BURN';
    } else if (budgetRemaining < 20 || burnRate1h >= 2.0) {
      status = 'WARNING';
    }

    return {
      sloId: slo.id,
      sloName: slo.name,
      targetPercent: target,
      currentSLIPercent: currentSLI,
      totalBudgetPercent: Number(totalBudget.toFixed(4)),
      budgetConsumedPercent: Number(budgetConsumed.toFixed(2)),
      budgetRemainingPercent: Number(budgetRemaining.toFixed(2)),
      burnRate1h: Number(burnRate1h.toFixed(2)),
      burnRate6h: Number(burnRate6h.toFixed(2)),
      status
    };
  }

  public getAllSLODefinitions(): SLODefinition[] {
    return SLO_CATALOGUE;
  }
}

export const sloEngine = new SLOEngine();
