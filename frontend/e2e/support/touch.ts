import type { Page } from "@playwright/test";

/**
 * Swipes one finger left by `distance` pixels from (`startX`, `y`).
 *
 * The finger is driven as raw touch points, the input `hasTouch` emulates on every platform: a
 * synthesized touch scroll gesture needs a touch screen the headless Linux browser does not
 * report. The finger rests before it lifts, so the release carries no fling past the next item.
 */
export async function swipeLeft(page: Page, startX: number, y: number, distance: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y }],
  });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX - Math.round((distance * step) / 10), y }],
    });
  }
  await page.waitForTimeout(200);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: startX - distance, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
