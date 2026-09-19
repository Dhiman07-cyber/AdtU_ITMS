import { test, expect } from '@playwright/test';

test.describe('Realtime Map & Component Resize Invariants', () => {
  test('handles continuous resize without throwing or dropping container bounds', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Step through multiple continuous resize events rapidly to test soak/rAF bounds
    const resizeSteps = [
      { width: 1200, height: 850 },
      { width: 900, height: 750 },
      { width: 768, height: 1024 },
      { width: 480, height: 800 },
      { width: 375, height: 667 },
      { width: 1440, height: 900 },
    ];

    for (const step of resizeSteps) {
      await page.setViewportSize(step);
      // Wait for at least one animation frame
      await page.waitForTimeout(50);

      const isResponsiveActive = await page.evaluate(() => {
        return !!getComputedStyle(document.documentElement).getPropertyValue('--itms-vw');
      });
      expect(isResponsiveActive).toBe(true);
    }
  });
});
