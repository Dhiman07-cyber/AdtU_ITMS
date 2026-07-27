/**
 * PROGRAM-004 / PHASE-03 Student & Driver Domain Activity Observability
 */

import { metrics } from '../metrics';

class StudentDriverObservability {
  public recordPassScan(driverId: string, studentId: string, busId: string, valid: boolean): void {
    metrics.counter('student_pass_scans_total', 'Total digital bus pass scans', {
      result: valid ? 'valid' : 'invalid',
    });
  }

  public recordServiceRenewal(studentId: string, success: boolean): void {
    metrics.counter('student_renewals_total', 'Total student service renewals', {
      result: success ? 'success' : 'failure',
    });
  }

  public recordActiveUsers(activeStudentsCount: number, activeDriversCount: number): void {
    metrics.gauge('active_students_count', 'Current daily active students count', {}, activeStudentsCount);
    metrics.gauge('active_drivers_count', 'Current daily active drivers count', {}, activeDriversCount);
  }
}

export const studentDriverObservability = new StudentDriverObservability();
