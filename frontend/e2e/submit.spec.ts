import { expect, test } from "@playwright/test";

import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * Golden path 3: the submit page, in each of the two modes it opens in.
 *
 * `/submit` sits behind the auth wall, so the context carries the session
 * cookie `proxy.ts` checks and `/auth/me` answers with the fixture user.
 * `/geolocations/new` redirects here, preserving its query.
 */
test.describe("submit", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("fills the single-event form on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    const publish = page.getByRole("button", { name: "Publish geolocation" });
    await expectNarrowViewportLayout(page, publish);
  });

  test("reads an X post on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    const modes = page.getByRole("group", { name: "Submission mode" });
    await expect(modes).toBeVisible();
    await modes.getByRole("button", { name: "From an X post" }).click();

    const createDetection = page.getByRole("button", {
      name: "Create the detection",
    });
    await expectNarrowViewportLayout(page, createDetection);
  });

  // The required instant field is the longest value a form here asks for, and
  // it wears a mark. At 320px the field is about 248px wide, so the room the
  // mark leaves is what decides whether the reader can see the instant they
  // just typed or only the front half of it.
  test("a filled instant field clears its own mark", async ({ page }) => {
    await page.goto("/submit");

    const field = page.locator("#source_posted_at");
    await expect(field).toBeVisible();
    await field.fill("2025-01-03T14:20");

    const measured = await field.evaluate((el) => {
      const input = el as HTMLInputElement;
      const style = window.getComputedStyle(input);
      // The room the value gets: the content box less the field's own text
      // padding on one side and the padding the trailing mark reserves on the
      // other. `clientWidth` already excludes the border.
      const textRoomPx =
        input.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      // What the value needs, asked of the engine rather than guessed at. A
      // `datetime-local` paints its value in shadow chrome, in the locale's own
      // format and with its own field padding, and it reports neither: the
      // input's `scrollWidth` never exceeds its `clientWidth` however narrow
      // the box gets, because the shadow edit clips instead of scrolling, so
      // the clipped value cannot be measured on the field itself. An unsized
      // clone carrying the same classes and the same value sizes to the
      // intrinsic width the engine wants for exactly that chrome.
      const probe = input.cloneNode(true) as HTMLInputElement;
      probe.value = input.value;
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.width = "auto";
      probe.style.padding = "0";
      probe.style.border = "0";
      document.body.append(probe);
      const valuePx = probe.getBoundingClientRect().width;
      probe.remove();
      return { textRoomPx, valuePx };
    });

    expect(
      measured.textRoomPx,
      `the field leaves ${Math.round(measured.textRoomPx)}px for a value the engine paints in ${Math.round(measured.valuePx)}px: the instant runs under the calendar mark`,
    ).toBeGreaterThanOrEqual(measured.valuePx);
  });

  test("the legacy route redirects here", async ({ page }) => {
    await page.goto("/geolocations/new");
    await expect(page).toHaveURL(/\/submit$/);
  });
});
