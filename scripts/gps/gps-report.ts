/**
 * scripts/gps/gps-report.ts
 *
 * Persists machine-readable telemetry artifacts and generates formatted markdown summaries.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');

export function createAuditArtifactDirectory(runId?: string): string {
  const id = runId || `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const dir = path.join(ROOT, 'artifacts', 'gps-audit', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveJsonArtifact(dir: string, filename: string, data: any): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

export function saveCsvArtifact(dir: string, filename: string, rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = r[h];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '');
    }).join(',')),
  ];
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, csvLines.join('\n'), 'utf8');
  return filePath;
}
