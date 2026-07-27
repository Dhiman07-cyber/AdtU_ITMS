import { describe,expect,it } from 'vitest';
import {
	haversineMeters,
	isImpossibleJump,
	isNewerTimestamp,
	isValidLatLng,
	shouldEmitDisplayUpdate,
} from '../location-display-guards';
import { engineFromMapProvider } from '../map-provider-types';

describe('location-display-guards', () => {
    it('isValidLatLng rejects out of range', () => {
        expect(isValidLatLng(91, 0)).toBe(false);
        expect(isValidLatLng(26, 190)).toBe(false);
        expect(isValidLatLng(26.14, 91.73)).toBe(true);
    });

    it('haversineMeters is small for nearby points', () => {
        const a = { lat: 26.144, lng: 91.736 };
        const b = { lat: 26.1441, lng: 91.7361 };
        const m = haversineMeters(a, b);
        expect(m).toBeGreaterThan(0);
        expect(m).toBeLessThan(50);
    });

    it('isNewerTimestamp allows slight skew', () => {
        const t0 = '2026-04-02T10:00:00.000Z';
        const t1 = '2026-04-02T10:00:00.200Z';
        expect(isNewerTimestamp(t1, t0)).toBe(true);
        expect(isNewerTimestamp(t0, t1)).toBe(true);

        const tooOld = '2026-04-02T09:59:59.000Z';
        expect(isNewerTimestamp(tooOld, t1)).toBe(false);
    });

    it('isImpossibleJump flags teleports', () => {
        const prev = { lat: 26.14, lng: 91.73, atMs: Date.now() };
        const next = {
            lat: 28.0,
            lng: 95.0,
            atMs: prev.atMs + 2000,
        };
        expect(isImpossibleJump(prev, next, 80)).toBe(true);
    });

    it('shouldEmitDisplayUpdate throttles until move or interval', () => {
        const opts = {
            minIntervalMs: 2000,
            minMoveMeters: 20,
            hiddenIntervalMs: 5000,
        };
        const p = { lat: 26.144, lng: 91.736 };
        const t0 = shouldEmitDisplayUpdate(p, 1000, null, opts, false);
        expect(t0.emit).toBe(true);
        const t1 = shouldEmitDisplayUpdate(p, 1500, t0.nextState, opts, false);
        expect(t1.emit).toBe(false);
    });
});

describe('map-provider-types', () => {
    it('engineFromMapProvider', () => {
        expect(engineFromMapProvider('guwahati')).toBe('guwahati');
        expect(engineFromMapProvider(undefined)).toBe('guwahati');
    });
});
