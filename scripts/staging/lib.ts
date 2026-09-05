/**
 * Shared plumbing for the staging simulation harness.
 * Real Firebase Auth, real Supabase (service role), real HTTP, real WS.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

export const APP_URL = (process.env.STAGING_APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
// ponytail: 127.0.0.1 not localhost — on Windows, localhost resolves to ::1 first
// and the WS server binds IPv4 only; ws handshake then dies with AggregateError.
export const WS_BASE = (process.env.STAGING_WS_URL || `ws://127.0.0.1:${process.env.WS_PORT || 3001}`).replace(/\/$/, '');

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function firebaseAdmin() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: requireEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
        clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
        privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getAuth();
}

let _sb: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _sb;
}

export async function mintCustomToken(uid: string): Promise<string> {
  return firebaseAdmin().createCustomToken(uid);
}

/** Mint a real Firebase ID token for a uid via custom-token exchange. */
export async function mintIdToken(uid: string): Promise<string> {
  const custom = await mintCustomToken(uid);
  const apiKey = requireEnv('NEXT_PUBLIC_FIREBASE_API_KEY');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) }
  );
  const data: any = await res.json();
  if (!res.ok || !data.idToken) throw new Error(`Token exchange failed for ${uid}: ${JSON.stringify(data?.error || data)}`);
  return data.idToken as string;
}

/** Authenticated fetch against the real Next.js API. */
export async function apiCall(method: string, apiPath: string, idToken: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  if (process.env.LOAD_TEST_SECRET || process.env.NODE_ENV !== 'production') {
    // Matches the default LOAD_TEST_SECRET in docker-compose.yml nextjs service.
    // Sends the proxy-level x-load-test-bypass so the global per-IP DDoS guard
    // does not throttle the high-volume simulated users. Per-user route-level
    // rate limits remain fully active.
    headers['x-load-test-bypass'] = process.env.LOAD_TEST_SECRET || 'itms-staging-sim-secret';
  }

  const res = await fetch(`${APP_URL}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

export interface LatencyStats { count: number; min: number; p50: number; p95: number; p99: number; max: number; mean: number; }

export function latencyStats(samplesMs: number[]): LatencyStats {
  if (!samplesMs.length) return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const s = [...samplesMs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    count: s.length,
    min: s[0],
    p50: q(50),
    p95: q(95),
    p99: q(99),
    max: s[s.length - 1],
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

export function writeReport(stage: string, report: unknown): { jsonPath: string; mdPath: string } {
  const dir = path.join(ROOT, 'reports', 'staging', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${stage}.report.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const mdPath = path.join(dir, `${stage}.report.md`);
  fs.writeFileSync(mdPath, renderMarkdown(stage, report as any));
  return { jsonPath, mdPath };
}

function renderMarkdown(stage: string, r: any): string {
  const lines: string[] = [
    `# ITMS Staging Report — ${stage}`,
    ``,
    `- timestamp: ${r.timestamp}`,
    `- git: ${r.gitCommit || 'unknown'}`,
    `- target: ${APP_URL} / ${WS_BASE}`,
    `- duration: ${r.durationSec}s`,
    `- profile: ${r.profile ? `${r.profile.drivers} drivers / ${r.profile.students} students / ${r.profile.buses} buses` : 'n/a'}`,
    ``,
  ];
  if (r.gps) {
    lines.push(`## GPS trace`);
    lines.push(`- sent: ${r.gps.sent}, received-by-students: ${r.gps.received}, delivery: ${r.gps.deliveryPct}%`);
    lines.push(`- duplicates: ${r.gps.duplicates}, out-of-order: ${r.gps.outOfOrder}, wrong-bus: ${r.gps.wrongBus}`);
    lines.push(`- e2e latency (driver→student): p50=${r.gps.latency?.p50 ?? 'N/A'}ms p95=${r.gps.latency?.p95 ?? 'N/A'}ms p99=${r.gps.latency?.p99 ?? 'N/A'}ms max=${r.gps.latency?.max ?? 'N/A'}ms`);
    lines.push(``);
  }
  if (r.dbChecks) {
    lines.push(`## DB verification`);
    for (const c of r.dbChecks) lines.push(`- [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    lines.push(``);
  }
  if (r.wsServerMetrics) {
    lines.push(`## WS server /metrics (delta during run)`);
    for (const [k, v] of Object.entries(r.wsServerMetrics)) lines.push(`- ${k}: ${v}`);
    lines.push(``);
  }
  if (r.failures?.length) {
    lines.push(`## Failures (${r.failures.length})`);
    for (const f of r.failures) lines.push(`- [${f.stage}] ${f.persona || ''} ${f.correlationId || ''} — ${f.error}`);
  } else {
    lines.push(`## Failures: none`);
  }
  lines.push(``, `Verdict: **${r.pass ? 'PASS' : 'FAIL'}**`);
  return lines.join('\n');
}

export function gitCommit(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return 'unknown'; }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, backoffMs = 1000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; if (i + 1 < attempts) await sleep(backoffMs); }
  }
  throw last;
}

// ── Persona persistence ─────────────────────────────────────────────────
export interface Persona { label: string; role: 'driver' | 'student' | 'admin' | 'moderator'; uid: string; email: string; busId?: string; routeId?: string; }
export interface PersonaSet { createdAt: string; drivers: Persona[]; students: Persona[]; buses: { id: string; routeId: string }[]; routes: { id: string }[]; }

const PERSONA_PATH = path.join(ROOT, 'scripts', 'staging', '.personas.json');

export function loadPersonas(): PersonaSet | null {
  if (!fs.existsSync(PERSONA_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf8')); } catch { return null; }
}
export function savePersonas(p: PersonaSet): void { fs.writeFileSync(PERSONA_PATH, JSON.stringify(p, null, 2)); }

/** WS node list for multi-node runs: STAGING_WS_URLS="ws://h:3001,ws://h:3003" */
export const WS_URLS: string[] = (process.env.STAGING_WS_URLS || WS_BASE).split(',').map((s) => s.trim()).filter(Boolean);
export const WS_HEALTH_BASES: string[] = (process.env.STAGING_WS_HEALTH_URLS || `http://localhost:${process.env.HEALTH_PORT || 9090}`).split(',').map((s) => s.trim()).filter(Boolean);
