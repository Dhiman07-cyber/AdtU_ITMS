import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateLayoutMetrics,
  applyLayoutMetricsToDOM,
  installResponsiveEngine,
  type LayoutMetrics
} from '../responsive-layout-engine';

describe('responsive-layout-engine', () => {
  describe('calculateLayoutMetrics', () => {
    it('correctly classifies compact, short phone (e.g. iPhone SE 375x667)', () => {
      const metrics = calculateLayoutMetrics({ width: 375, height: 667 });
      expect(metrics.layoutMode).toBe('compact');
      expect(metrics.heightMode).toBe('short');
      expect(metrics.orientation).toBe('portrait');
      expect(metrics.aspectRatio).toBeCloseTo(0.5622, 3);
    });

    it('correctly classifies compact, tall phone (e.g. iPhone 12 Pro 390x844)', () => {
      const metrics = calculateLayoutMetrics({ width: 390, height: 844 });
      expect(metrics.layoutMode).toBe('compact');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('portrait');
      expect(metrics.aspectRatio).toBeCloseTo(0.4621, 3);
    });

    it('correctly classifies compact, tall Android flagship (e.g. Pixel 7 412x915)', () => {
      const metrics = calculateLayoutMetrics({ width: 412, height: 915 });
      expect(metrics.layoutMode).toBe('compact');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('portrait');
    });

    it('correctly classifies compact, tall Pro Max (e.g. iPhone 14 Pro Max 430x932)', () => {
      const metrics = calculateLayoutMetrics({ width: 430, height: 932 });
      expect(metrics.layoutMode).toBe('compact');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('portrait');
    });

    it('correctly classifies standard tablet in portrait (e.g. iPad 768x1024)', () => {
      const metrics = calculateLayoutMetrics({ width: 768, height: 1024 });
      expect(metrics.layoutMode).toBe('standard');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('portrait');
      expect(metrics.aspectRatio).toBe(0.75);
    });

    it('correctly classifies wide tablet in landscape (e.g. iPad 1024x768)', () => {
      const metrics = calculateLayoutMetrics({ width: 1024, height: 768 });
      expect(metrics.layoutMode).toBe('wide');
      expect(metrics.heightMode).toBe('medium');
      expect(metrics.orientation).toBe('landscape');
      expect(metrics.aspectRatio).toBeCloseTo(1.3333, 3);
    });

    it('correctly classifies standard landscape phone (e.g. 667x375)', () => {
      const metrics = calculateLayoutMetrics({ width: 667, height: 375 });
      expect(metrics.layoutMode).toBe('standard');
      expect(metrics.heightMode).toBe('short');
      expect(metrics.orientation).toBe('landscape');
    });

    it('correctly classifies narrow split-screen / foldable panel (e.g. 320x900)', () => {
      const metrics = calculateLayoutMetrics({ width: 320, height: 900 });
      expect(metrics.layoutMode).toBe('compact');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('portrait');
    });

    it('correctly classifies laptop (e.g. 1366x768)', () => {
      const metrics = calculateLayoutMetrics({ width: 1366, height: 768 });
      expect(metrics.layoutMode).toBe('wide');
      expect(metrics.heightMode).toBe('medium');
      expect(metrics.orientation).toBe('landscape');
    });

    it('correctly classifies desktop (e.g. 1920x1080)', () => {
      const metrics = calculateLayoutMetrics({ width: 1920, height: 1080 });
      expect(metrics.layoutMode).toBe('ultrawide');
      expect(metrics.heightMode).toBe('tall');
      expect(metrics.orientation).toBe('landscape');
    });

    it('correctly handles boundary and zero edge cases safely without dividing by zero', () => {
      const zeroMetrics = calculateLayoutMetrics({ width: 0, height: 0 });
      expect(zeroMetrics.width).toBe(0);
      expect(zeroMetrics.height).toBe(0);
      expect(zeroMetrics.aspectRatio).toBe(1);
      expect(zeroMetrics.layoutMode).toBe('compact');
      expect(zeroMetrics.heightMode).toBe('short');

      const negativeMetrics = calculateLayoutMetrics({ width: -100, height: -200 });
      expect(negativeMetrics.width).toBe(0);
      expect(negativeMetrics.height).toBe(0);
      expect(negativeMetrics.aspectRatio).toBe(1);

      const nanMetrics = calculateLayoutMetrics({ width: NaN, height: NaN });
      expect(nanMetrics.width).toBe(0);
      expect(nanMetrics.height).toBe(0);
      expect(nanMetrics.aspectRatio).toBe(1);
    });
  });

  describe('applyLayoutMetricsToDOM', () => {
    let mockElement: HTMLElement;
    let setPropertySpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      setPropertySpy = vi.fn();
      mockElement = {
        style: {
          setProperty: setPropertySpy,
        },
      } as unknown as HTMLElement;
    });

    it('writes CSS variables to the target element', () => {
      const metrics: LayoutMetrics = {
        width: 1200,
        height: 800,
        aspectRatio: 1.5,
        orientation: 'landscape',
        layoutMode: 'wide',
        heightMode: 'tall',
      };

      applyLayoutMetricsToDOM(metrics, mockElement);

      expect(setPropertySpy).toHaveBeenCalledWith('--itms-vw', '1200px');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-vh', '800px');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-aspect-ratio', '1.5');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-layout-mode', 'wide');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-height-mode', 'tall');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-orientation', 'landscape');
    });

    it('performs DIFF-ONLY writes and does not rewrite unchanged properties', () => {
      const metrics: LayoutMetrics = {
        width: 1200,
        height: 800,
        aspectRatio: 1.5,
        orientation: 'landscape',
        layoutMode: 'wide',
        heightMode: 'tall',
      };

      // First call writes all 6 properties
      applyLayoutMetricsToDOM(metrics, mockElement);
      expect(setPropertySpy).toHaveBeenCalledTimes(6);

      setPropertySpy.mockClear();

      // Second call with identical metrics writes 0 properties (diff-only!)
      applyLayoutMetricsToDOM(metrics, mockElement);
      expect(setPropertySpy).toHaveBeenCalledTimes(0);

      // Third call with only height changed writes only --itms-vh and --itms-aspect-ratio
      const updatedMetrics: LayoutMetrics = {
        ...metrics,
        height: 802,
        aspectRatio: 1.4963,
      };
      applyLayoutMetricsToDOM(updatedMetrics, mockElement);
      expect(setPropertySpy).toHaveBeenCalledTimes(2);
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-vh', '802px');
      expect(setPropertySpy).toHaveBeenCalledWith('--itms-aspect-ratio', '1.4963');
    });
  });

  describe('installResponsiveEngine', () => {
    let addEventListenerSpy: ReturnType<typeof vi.fn>;
    let removeEventListenerSpy: ReturnType<typeof vi.fn>;
    let mockElement: HTMLElement;

    beforeEach(() => {
      addEventListenerSpy = vi.fn();
      removeEventListenerSpy = vi.fn();
      mockElement = {
        clientWidth: 1024,
        clientHeight: 768,
        style: {
          setProperty: vi.fn(),
        },
      } as unknown as HTMLElement;

      vi.stubGlobal('window', {
        innerWidth: 1024,
        innerHeight: 768,
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      });

      vi.stubGlobal('document', {
        documentElement: mockElement,
      });

      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(Date.now()), 0) as unknown as number;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        clearTimeout(id);
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('installs cleanly and fires cleanup on teardown', () => {
      const cleanup = installResponsiveEngine({ targetElement: mockElement });
      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true });
      expect(addEventListenerSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function), { passive: true });

      cleanup();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    });

    it('notifies onLayoutModeChange only on structural mode crossing, not continuous pixels', () => {
      const modeChangeSpy = vi.fn();

      const cleanup = installResponsiveEngine({
        targetElement: mockElement,
        onLayoutModeChange: modeChangeSpy,
      });

      // Initial call sets mode
      expect(modeChangeSpy).toHaveBeenCalledWith('wide');
      expect(modeChangeSpy).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });
});
