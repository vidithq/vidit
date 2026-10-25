import { expect, test } from "@playwright/test";

import { ONE_PIXEL_PNG } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout, expectNoHorizontalOverflow } from "./support/narrowLayout";
import { swipeLeft } from "./support/touch";

/**
 * Golden path 3: the submit page, its chooser and the paths it opens.
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
    await page.goto("/submit?mode=single");

    const publish = page.getByRole("button", { name: "Publish geolocation" });
    await expectNarrowViewportLayout(page, publish);
  });

  test("stacks the form on a phone as sources, proof, location, details, actions", async ({ page }) => {
    await page.goto("/submit?mode=single");

    const blocks = [
      page.getByRole("heading", { name: /^Sources/ }),
      page.getByRole("heading", { name: /^Proof/ }),
      page.getByRole("heading", { name: /^Location/ }),
      page.getByRole("heading", { name: /^Details/ }),
      page.getByRole("complementary", { name: "Actions" }),
    ];
    const boxes = [];
    for (const block of blocks) boxes.push((await block.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y, `block ${i + 1} starts under block ${i}`).toBeGreaterThan(boxes[i - 1].y);
    }
  });

  test("puts the actions, the location, then the details in the side column on a wide screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/submit?mode=single");

    const actions = (await page.getByRole("complementary", { name: "Actions" }).boundingBox())!;
    const location = (await page.getByRole("heading", { name: /^Location/ }).boundingBox())!;
    const details = (await page.getByRole("heading", { name: /^Details/ }).boundingBox())!;
    expect(location.x).toBeGreaterThanOrEqual(actions.x);
    expect(location.y).toBeGreaterThanOrEqual(actions.y + actions.height);
    expect(details.x).toBe(location.x);
    expect(details.y).toBeGreaterThan(location.y);
  });

  test("holds two source editors on a narrow column", async ({ page }) => {
    await page.goto("/submit?mode=single");

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
    await expect(first.getByLabel("Kind", { exact: true })).toBeEnabled();

    await first.getByLabel("Source 1 link 1", { exact: true }).fill("https://t.me/channel/12345");
    await second.getByLabel("Source 2 link 1", { exact: true }).fill("https://x.com/user/status/1");
    await expectNarrowViewportLayout(page, second.getByRole("button", { name: "Remove source 2", exact: true }));
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Publish geolocation" }));
  });

  test("opens on a chooser of three cards that fits a narrow column", async ({ page }) => {
    await page.goto("/submit");

    const modes = page.getByRole("group", { name: "Submission mode" });
    const cards = modes.getByRole("link");
    await expect(cards).toHaveCount(3);
    await expectNarrowViewportLayout(page, cards.last());
    await expect(page.getByRole("button", { name: "Publish geolocation" })).toBeHidden();

    // The path lives in the URL: a reload keeps it, and Back returns to the chooser.
    await modes.getByRole("link", { name: /^Single event/ }).click();
    await expect(page).toHaveURL(/\/submit\?mode=single$/);
    const publish = page.getByRole("button", { name: "Publish geolocation" });
    await expect(publish).toBeVisible();
    await page.reload();
    await expect(publish).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/submit$/);
    await expect(cards).toHaveCount(3);

    // The link under the title returns to the chooser from any path.
    await page.goto("/submit?mode=bulk");
    await page.getByRole("link", { name: "Other ways to submit" }).click();
    await expect(page).toHaveURL(/\/submit$/);
    await expect(cards).toHaveCount(3);
  });

  test("keeps the form's draft through a trip to the chooser", async ({ page }) => {
    await page.goto("/submit?mode=single");

    await page.getByLabel("Title", { exact: true }).fill("Strike on a depot");
    await page.getByRole("link", { name: "Other ways to submit" }).click();
    await page.getByRole("group", { name: "Submission mode" }).getByRole("link", { name: /^Single event/ }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Strike on a depot");
  });

  test("opens the archive import from the onboarding link", async ({ page }) => {
    await page.goto("/submit?import=1");

    await expect(page.getByRole("group", { name: "Submission mode" })).toHaveCount(0);
    await expectNarrowViewportLayout(page, page.getByRole("link", { name: "Other ways to submit" }));
    await expect(page.getByText("Upload it here")).toBeVisible();
  });

  test("reads an X post on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    await page
      .getByRole("group", { name: "Submission mode" })
      .getByRole("link", { name: /^From an X post/ })
      .click();
    await expect(page).toHaveURL(/\/submit\?mode=xpost$/);

    const createDetection = page.getByRole("button", {
      name: "Create the detection",
    });
    await expectNarrowViewportLayout(page, createDetection);
  });

  test("fits the source editors into 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/submit?mode=single");

    await page.getByRole("button", { name: "Add a source" }).click();
    await page.getByRole("button", { name: "Show source 1" }).click();
    const first = page.getByRole("region", { name: "Source 1" });
    await first.getByLabel("Kind", { exact: true }).selectOption({ label: "Smartphone" });
    await first.getByLabel("Source 1 link 1", { exact: true }).fill("https://t.me/channel/12345");
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Add a source" }));

    // Every control of the editor stays inside its tile.
    const tile = (await first.boundingBox())!;
    const controls = first.locator("input:visible, select:visible, button:visible");
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(tile.x);
      expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width + 0.5);
    }
    // The URL field takes the tile's whole width, its remove control under it.
    const url = (await first.getByLabel("Source 1 link 1", { exact: true }).boundingBox())!;
    const removeLink = (await first.getByRole("button", { name: "Remove source 1 link 1" }).boundingBox())!;
    expect(url.width).toBeGreaterThan(tile.width * 0.85);
    expect(removeLink.y).toBeGreaterThanOrEqual(url.y + url.height);
    await expect(first.getByLabel("Latitude", { exact: true })).toBeVisible();

    // The level options keep their whole labels and the phone tap height.
    for (const option of await first.getByRole("group", { name: "Source 1 level" }).getByRole("button").all()) {
      const fits = await option.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `${await option.textContent()} is cut`).toBe(true);
    }
    for (const name of ["Remove source 1", "Remove source 1 link 1", "Add source 1 link"]) {
      const box = (await first.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(36);
    }
  });

  // A source's capture time is the longest value a form here asks for, and it
  // wears a mark. At 320px the field is about 228px wide inside its editor, so
  // the room the mark leaves is what decides whether the reader can see the
  // instant they just typed or only the front half of it.
  test("a filled instant field clears its own mark", async ({ page }) => {
    await page.goto("/submit?mode=single");

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

  test("the legacy routes redirect here", async ({ page }) => {
    await page.goto("/geolocations/new");
    await expect(page).toHaveURL(/\/submit$/);
    await page.goto("/requests/new");
    await expect(page).toHaveURL(/\/submit\?mode=single$/);
  });
});

test.describe("source carousel on a touch screen", () => {
  test.use({ hasTouch: true });

  test("shows one source at a time and moves by a swipe, the arrows or a dot", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/submit?mode=single");

    const track = page.getByRole("region", { name: "Sources", exact: true });
    const first = page.getByRole("region", { name: "Source 1", exact: true });
    const second = page.getByRole("region", { name: "Source 2", exact: true });
    await expect(page.getByRole("button", { name: "Next source" })).toHaveCount(0);

    // Add a source shows the new one, at the track's full width.
    await page.getByRole("button", { name: "Add a source" }).click();
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
    const trackBox = (await track.boundingBox())!;
    await expect
      .poll(async () => Math.abs((await second.boundingBox())!.x - trackBox.x))
      .toBeLessThanOrEqual(1);
    expect((await second.boundingBox())!.width).toBeGreaterThan(trackBox.width - 1);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Previous source" }).tap();
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
    await expect
      .poll(async () => Math.abs((await first.boundingBox())!.x - trackBox.x))
      .toBeLessThanOrEqual(1);

    const firstBox = (await first.boundingBox())!;
    await swipeLeft(
      page,
      Math.round(trackBox.x + trackBox.width * 0.8),
      Math.round(firstBox.y + 20),
      Math.round(firstBox.width * 0.6),
    );
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
    await expect
      .poll(async () => Math.abs((await second.boundingBox())!.x - trackBox.x))
      .toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Show source 1" }).tap();
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();

    // One source left: no arrows, position or dots.
    await first.getByRole("button", { name: "Remove source 1", exact: true }).tap();
    await expect(page.getByRole("region", { name: /^Source \d$/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Next source" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Show source/ })).toHaveCount(0);
  });
});
