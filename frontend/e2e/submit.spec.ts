import { expect, test } from "@playwright/test";

import { ONE_PIXEL_PNG } from "./support/fixtures";
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

  test("holds two source editors on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    await page.getByRole("button", { name: "Add a source" }).click();
    const first = page.getByRole("region", { name: "Source 1" });
    const second = page.getByRole("region", { name: "Source 2" });
    await expect(second).toBeVisible();

    // A picked file uploads at once and the slot previews the staged copy.
    await first.locator('input[type="file"]').setInputFiles({
      name: "street.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await expect(first.getByText(/^Uploading/)).toHaveCount(0);
    await expect(first.getByRole("button", { name: "View image" })).toBeVisible();
    await expect(first.getByLabel("Sensor", { exact: true })).toBeEnabled();

    await first.getByLabel("Source 1 link 1", { exact: true }).fill("https://t.me/channel/12345");
    await second.getByLabel("Source 2 link 1", { exact: true }).fill("https://x.com/user/status/1");
    await expectNarrowViewportLayout(page, second.getByRole("button", { name: "Remove source 2", exact: true }));
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Publish geolocation" }));
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

  // A source's capture time is the longest value a form here asks for, and it
  // wears a mark. At 320px the field is about 220px wide inside its editor, so
  // the room the mark leaves is what decides whether the reader can see the
  // instant they just typed or only the front half of it.
  test("a filled instant field clears its own mark", async ({ page }) => {
    await page.goto("/submit");

    const field = page.getByRole("region", { name: "Source 1" }).getByLabel(/^Captured \(UTC\)/);
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
