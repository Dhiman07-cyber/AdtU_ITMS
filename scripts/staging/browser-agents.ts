/**
 * Playwright browser agents — real browser users for the staging simulation.
 *
 * Each browser agent represents one real user with an isolated browser context.
 * Uses playwright (not @playwright/test) since this runs outside the test runner.
 *
 * Driver browser: sign in → driver dashboard → live tracking page
 * Student browser: sign in → track bus → receive live updates → verify marker
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mintCustomToken, APP_URL } from './lib';

export interface LocationHistoryItem {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  timestamp: string;
  busId?: string;
  tripId?: string;
  appliedAtMs?: number;
}

export interface BrowserAgentResult {
  uid: string;
  role: 'driver' | 'student';
  label: string;
  signedIn: boolean;
  pageOpened: boolean;
  locationReceived: boolean;
  markerMoved: boolean;
  locationHistory: LocationHistoryItem[];
  markerPositions: { lat: number; lng: number; atMs: number }[];
  error: string | null;
}

export class BrowserAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private _result: BrowserAgentResult;

  constructor(
    private uid: string,
    private role: 'driver' | 'student',
    private label: string,
  ) {
    this._result = {
      uid, role, label,
      signedIn: false, pageOpened: false,
      locationReceived: false, markerMoved: false,
      locationHistory: [],
      markerPositions: [],
      error: null,
    };
  }

  get result(): BrowserAgentResult { return this._result; }

  async start(): Promise<void> {
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();

      // Sign in via e2e-signin page
      const customToken = await mintCustomToken(this.uid);
      await this.page.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(customToken)}`);
      await this.page.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
      await this.page.waitForFunction(
        () => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'),
        { timeout: 30000 }
      );
      this._result.signedIn = true;

      // Navigate to appropriate page
      if (this.role === 'student') {
        await this.page.goto(`${APP_URL}/student/track-bus`, { waitUntil: 'domcontentloaded' });
      } else {
        await this.page.goto(`${APP_URL}/driver`, { waitUntil: 'domcontentloaded' });
      }
      this._result.pageOpened = true;
    } catch (e: any) {
      this._result.error = String(e.message || e);
    }
  }

  /** Check if the student browser has received location data and marker moved. */
  async checkStudentState(): Promise<{
    locationReceived: boolean;
    markerMoved: boolean;
    history: LocationHistoryItem[];
    markerPositions: { lat: number; lng: number; atMs: number }[];
  }> {
    if (!this.page || this.role !== 'student') {
      return { locationReceived: false, markerMoved: false, history: [], markerPositions: [] };
    }
    try {
      const applied = await this.page.evaluate(() => (window as any).__itmsLastBusLocation ?? null);
      const marker = await this.page.evaluate(() => (window as any).__itmsMarkerPosition ?? null);
      const rawHistory: LocationHistoryItem[] = await this.page.evaluate(() => (window as any).__itmsBusLocationHistory ?? []);
      
      const locationReceived = applied && typeof applied.lat === 'number';
      const markerMoved = marker && typeof marker.lat === 'number';
      
      this._result.locationReceived = locationReceived;
      this._result.markerMoved = markerMoved;

      // Merge history monotonically:
      if (Array.isArray(rawHistory) && rawHistory.length > 0) {
        rawHistory.forEach(item => {
          if (!this._result.locationHistory.some(existing => existing.timestamp === item.timestamp && existing.lat === item.lat)) {
            this._result.locationHistory.push(item);
          }
        });
      } else if (applied && typeof applied.lat === 'number') {
        if (!this._result.locationHistory.some(existing => existing.timestamp === applied.timestamp)) {
          this._result.locationHistory.push(applied);
        }
      }

      if (marker && typeof marker.lat === 'number') {
        const lastMarker = this._result.markerPositions[this._result.markerPositions.length - 1];
        if (!lastMarker || lastMarker.lat !== marker.lat || lastMarker.lng !== marker.lng) {
          this._result.markerPositions.push({ lat: marker.lat, lng: marker.lng, atMs: marker.atMs || Date.now() });
        }
      }

      return {
        locationReceived,
        markerMoved,
        history: this._result.locationHistory,
        markerPositions: this._result.markerPositions,
      };
    } catch {
      return { locationReceived: false, markerMoved: false, history: this._result.locationHistory, markerPositions: this._result.markerPositions };
    }
  }

  async close(): Promise<void> {
    try { await this.page?.close(); } catch { /* ignore */ }
    try { await this.context?.close(); } catch { /* ignore */ }
    try { await this.browser?.close(); } catch { /* ignore */ }
  }
}

/**
 * Launch a small set of browser agents (1 driver + 1-2 students).
 * Returns the agents for lifecycle management.
 */
export async function launchBrowserAgents(
  driverPersona: { uid: string; label: string },
  studentPersonas: { uid: string; label: string }[],
): Promise<BrowserAgent[]> {
  const agents: BrowserAgent[] = [];
  const driverAgent = new BrowserAgent(driverPersona.uid, 'driver', driverPersona.label);
  agents.push(driverAgent);

  for (const sp of studentPersonas) {
    agents.push(new BrowserAgent(sp.uid, 'student', sp.label));
  }

  // Start all browsers concurrently
  await Promise.allSettled(agents.map(a => a.start()));

  return agents;
}
