/**
 * Shared E2E test helpers. Real DB, real auth, real assertions.
 */
import { type Page, expect } from '@playwright/test';
import { loadPersonas, mintCustomToken, mintIdToken, supabase, sleep, APP_URL, WS_BASE, apiCall, type Persona } from '../scripts/staging/lib';
import { DriverAgent, StudentAgent, type Failure } from '../scripts/staging/agents';

export { loadPersonas, mintCustomToken, mintIdToken, supabase, sleep, APP_URL, WS_BASE, apiCall };
export type { Persona };
export { DriverAgent, StudentAgent };
export type { Failure };

// ── DB verification helpers ────────────────────────────────────────────────

export async function dbActiveTrips(busIds: string[]): Promise<{ trip_id: string; bus_id: string; driver_id: string; status: string }[]> {
  const { data, error } = await supabase()
    .from('active_trips')
    .select('trip_id, bus_id, driver_id, status')
    .in('bus_id', busIds)
    .eq('status', 'active');
  if (error) throw new Error(`dbActiveTrips: ${error.message}`);
  return data ?? [];
}

export async function dbBusLocations(busIds: string[]): Promise<{ bus_id: string; lat: number; lng: number; updated_at: string }[]> {
  const { data, error } = await supabase()
    .from('bus_locations')
    .select('bus_id, lat, lng, updated_at')
    .in('bus_id', busIds);
  if (error) throw new Error(`dbBusLocations: ${error.message}`);
  return data ?? [];
}

export async function dbWaitingFlags(busIds: string[], status?: string): Promise<any[]> {
  let q = supabase().from('waiting_flags').select('*').in('bus_id', busIds);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(`dbWaitingFlags: ${error.message}`);
  return data ?? [];
}

export async function dbAssertNoActiveTrips(busIds: string[]): Promise<void> {
  const trips = await dbActiveTrips(busIds);
  expect(trips).toHaveLength(0);
}

export async function dbAssertNoBusLocations(busIds: string[]): Promise<void> {
  const locs = await dbBusLocations(busIds);
  expect(locs).toHaveLength(0);
}

// ── Auth helpers ───────────────────────────────────────────────────────────

export async function signInBrowser(page: Page, uid: string): Promise<void> {
  const customToken = await mintCustomToken(uid);
  await page.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(customToken)}`);
  await page.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'),
    { timeout: 30000 }
  );
}

// ── Read applied marker state from student browser ─────────────────────────

export interface AppliedSample { atMs: number; lat: number; lng: number; timestamp: string; driverUid: string; }

export async function readApplied(page: Page): Promise<AppliedSample | null> {
  try {
    const v = await page.evaluate(() => (window as any).__itmsLastBusLocation ?? null);
    return v && typeof v.lat === 'number' ? v : null;
  } catch { return null; }
}

// ── Read MapLibre marker target position (proves actual rendered state) ─────

export interface MarkerPosition { lat: number; lng: number; heading: number; atMs: number; }

export async function readMarkerPosition(page: Page): Promise<MarkerPosition | null> {
  try {
    const v = await page.evaluate(() => (window as any).__itmsMarkerPosition ?? null);
    return v && typeof v.lat === 'number' ? v : null;
  } catch { return null; }
}

// ── Wait for condition with timeout ────────────────────────────────────────

export async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 15000,
  intervalMs = 400
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}
