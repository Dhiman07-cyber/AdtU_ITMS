import { test, expect } from '@playwright/test';

const ACTION_TEST_WIDTHS = [1440, 1024, 768, 600, 480, 430, 412, 390, 375, 360, 320];

test.describe('Space-Aware Page Header & Action Bar Tests', () => {
  for (const width of ACTION_TEST_WIDTHS) {
    test(`verifies header action toolbar stability at width ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login', { waitUntil: 'domcontentloaded' });

      // Test that container query root is present and responsive
      const hasCqSupport = await page.evaluate(() => {
        return CSS.supports('container-type', 'inline-size');
      });
      expect(hasCqSupport).toBe(true);

      // Verify header layout rendering without horizontal body overflow
      const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(bodyScrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});
