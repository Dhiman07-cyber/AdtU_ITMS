import { test, expect } from '@playwright/test';

const TEST_VIEWPORTS = [
  { name: 'Ultra Compact Phone', width: 320, height: 568 },
  { name: 'Compact Android', width: 360, height: 640 },
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12 Pro', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { name: 'Foldable / Mini Tablet', width: 600, height: 1024 },
  { name: 'iPad Portrait', width: 768, height: 1024 },
  { name: 'iPad Air Portrait', width: 820, height: 1180 },
  { name: 'iPad Landscape', width: 1024, height: 768 },
  { name: 'Small Laptop', width: 1280, height: 800 },
  { name: 'Standard Laptop', width: 1440, height: 900 },
  { name: 'Desktop 1080p', width: 1920, height: 1080 },
  { name: 'QHD 1440p', width: 2560, height: 1440 },
  { name: 'Ultrawide', width: 3440, height: 1440 },
  // Extreme / Non-standard aspect ratios
  { name: 'Tall Narrow Foldable', width: 320, height: 900 },
  { name: 'Short Wide Mobile', width: 430, height: 700 },
  { name: 'Square Window', width: 700, height: 700 },
  { name: 'Compact Landscape Phone', width: 900, height: 500 },
];

test.describe('Responsive Layout Engine — Cross-Device Viewport Suite', () => {
  for (const vp of TEST_VIEWPORTS) {
    test(`renders landing page stably at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // 1. Verify that the Dynamic Layout Engine injected the CSS variables onto :root
      const customVars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          vw: style.getPropertyValue('--itms-vw').trim(),
          vh: style.getPropertyValue('--itms-vh').trim(),
          aspectRatio: style.getPropertyValue('--itms-aspect-ratio').trim(),
          layoutMode: style.getPropertyValue('--itms-layout-mode').trim(),
          heightMode: style.getPropertyValue('--itms-height-mode').trim(),
        };
      });

      expect(customVars.vw).toBeTruthy();
      expect(customVars.vh).toBeTruthy();
      expect(customVars.layoutMode).toBeTruthy();

      // 2. Verify no unexpected horizontal page overflow
      const overflow = await page.evaluate(() => {
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });

      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  test('dynamically updates CSS variables on viewport resize without reloading', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Initial desktop mode
    let mode = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--itms-layout-mode').trim()
    );
    expect(mode).toBe('wide');

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(100);

    mode = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--itms-layout-mode').trim()
    );
    expect(mode).toBe('compact');

    // Resize to tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(100);

    mode = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--itms-layout-mode').trim()
    );
    expect(mode).toBe('standard');
  });
});
