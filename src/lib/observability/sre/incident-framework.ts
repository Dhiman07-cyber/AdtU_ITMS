/**
 * PROGRAM-004 / PHASE-05: SRE Incident Response & Classification Framework
 */

import { logger } from '../logger';

export type SeverityLevel = 'P0' | 'P1' | 'P2' | 'P3';

export type IncidentCategory =
  | 'INFRASTRUCTURE'
  | 'DATABASE'
  | 'REALTIME'
  | 'PAYMENT'
  | 'APPLICATION'
  | 'SECURITY'
  | 'PERFORMANCE'
  | 'CAPACITY'
  | 'DEPLOYMENT'
  | 'EXTERNAL_DEPENDENCY';

export interface IncidentRecord {
  id: string;
  title: string;
  severity: SeverityLevel;
  category: IncidentCategory;
  symptoms: string[];
  affectedComponents: string[];
  detectedAt: string;
  resolvedAt?: string;
  status: 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED';
  incidentCommander?: string;
  rootCause?: string;
  timeline: Array<{ timestamp: string; note: string }>;
  runbookUrl?: string;
}

export interface EscalationPolicy {
  severity: SeverityLevel;
  targetResponseTimeMinutes: number;
  primaryOwnerRole: string;
  secondaryOwnerRole: string;
  escalationChannel: string;
  notifyLeadership: boolean;
}

export const ESCALATION_MATRIX: Record<SeverityLevel, EscalationPolicy> = {
  P0: {
    severity: 'P0',
    targetResponseTimeMinutes: 5,
    primaryOwnerRole: 'On-Call Incident Commander / SRE Lead',
    secondaryOwnerRole: 'Principal Systems Architect',
    escalationChannel: '#incidents-p0-critical',
    notifyLeadership: true
  },
  P1: {
    severity: 'P1',
    targetResponseTimeMinutes: 15,
    primaryOwnerRole: 'Domain On-Call Engineer',
    secondaryOwnerRole: 'Platform Engineering Lead',
    escalationChannel: '#incidents-p1-urgent',
    notifyLeadership: true
  },
  P2: {
    severity: 'P2',
    targetResponseTimeMinutes: 60,
    primaryOwnerRole: 'Domain Technical Lead',
    secondaryOwnerRole: 'Senior Software Engineer',
    escalationChannel: '#alerts-ops',
    notifyLeadership: false
  },
  P3: {
    severity: 'P3',
    targetResponseTimeMinutes: 480,
    primaryOwnerRole: 'Maintenance Engineer',
    secondaryOwnerRole: 'Service Owner',
    escalationChannel: '#alerts-info',
    notifyLeadership: false
  }
};

export class IncidentManager {
  private activeIncidents: Map<string, IncidentRecord> = new Map();
  private incidentHistory: IncidentRecord[] = [];

  /**
   * Triggers a new classified incident and initiates escalation
   */
  public triggerIncident(
    title: string,
    severity: SeverityLevel,
    category: IncidentCategory,
    symptoms: string[],
    affectedComponents: string[],
    runbookUrl?: string
  ): IncidentRecord {
    const id = `INC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();

    const incident: IncidentRecord = {
      id,
      title,
      severity,
      category,
      symptoms,
      affectedComponents,
      detectedAt: now,
      status: 'OPEN',
      timeline: [{ timestamp: now, note: `Incident detected and classified as ${severity} (${category})` }],
      runbookUrl
    };

    this.activeIncidents.set(id, incident);

    const escalation = ESCALATION_MATRIX[severity];
    logger.fatal('sre_incident_framework', 'incident_declared', {
      incidentId: id,
      title,
      severity,
      category,
      affectedComponents,
      escalationTarget: escalation.primaryOwnerRole,
      channel: escalation.escalationChannel
    });

    return incident;
  }

  /**
   * Adds a timeline update to an active incident
   */
  public addTimelineNote(id: string, note: string): boolean {
    const incident = this.activeIncidents.get(id);
    if (!incident) return false;

    incident.timeline.push({ timestamp: new Date().toISOString(), note });
    logger.info('sre_incident_framework', 'incident_timeline_updated', { incidentId: id, note });
    return true;
  }

  /**
   * Updates status of an incident (e.g. MITIGATED, RESOLVED)
   */
  public updateStatus(id: string, status: IncidentRecord['status'], rootCause?: string): boolean {
    const incident = this.activeIncidents.get(id);
    if (!incident) return false;

    incident.status = status;
    const now = new Date().toISOString();

    if (rootCause) {
      incident.rootCause = rootCause;
    }

    if (status === 'RESOLVED') {
      incident.resolvedAt = now;
      this.activeIncidents.delete(id);
      this.incidentHistory.push(incident);
      logger.info('sre_incident_framework', 'incident_resolved', { incidentId: id, title: incident.title, rootCause });
    } else {
      incident.timeline.push({ timestamp: now, note: `Status updated to ${status}` });
    }

    return true;
  }

  public getActiveIncidents(): IncidentRecord[] {
    return Array.from(this.activeIncidents.values());
  }

  public getIncidentHistory(): IncidentRecord[] {
    return [...this.incidentHistory];
  }
}

export const incidentManager = new IncidentManager();
