import { expect, test } from "@playwright/test";

import { API_BASE_URL } from "./support/environment";
import { CONFLICTS, EVENT_ID, ONE_PIXEL_PNG } from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
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

  test("pins the publish buttons on one line on a phone, each counting what it misses", async ({ page }) => {
    await page.goto("/submit?mode=single");

    const actions = page.getByRole("complementary", { name: "Actions" });
    const publish = actions.getByRole("button", { name: "Publish geolocation" });
    const request = actions.getByRole("button", { name: "Publish request" });
    await expect(publish).toBeVisible();

    // Every condition is unmet on an empty form: a geolocation misses the request's four and
    // its own three. Each button says so, and its count names them.
    await expect(publish).toHaveAccessibleDescription(
      "7 missing: Title, Coordinates, Source file, Source URL, Source kind, Proof, Conflict",
    );
    await expect(request).toHaveAccessibleDescription(
      "4 missing: Title, Source file, Source URL, Source kind",
    );
    await expect(actions.getByRole("button", { name: /^7 missing: / })).toHaveText("7");
    await expect(actions.getByRole("button", { name: /^4 missing: / })).toHaveText("4");

    // One line of buttons, and nothing else in the cluster.
    const publishBox = (await publish.boundingBox())!;
    const requestBox = (await request.boundingBox())!;
    expect(Math.abs(publishBox.y - requestBox.y)).toBeLessThan(1);
    expect((await actions.boundingBox())!.height).toBeLessThan(publishBox.height + 1);
    await expectNoHorizontalOverflow(page);

    // Scrolled to the last field, both buttons stay on screen, under the menu chip.
    await page.getByRole("heading", { name: /^Details/ }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Title", { exact: true })).not.toBeInViewport();
    await expect(publish).toBeInViewport({ ratio: 1 });
    await expect(request).toBeInViewport({ ratio: 1 });
    expect((await actions.boundingBox())!.y).toBeGreaterThanOrEqual(56);

    // A publish while short flags the gaps: the fields turn red.
    await publish.click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveClass(/border-red-500/);
  });

  test("stacks the form on a phone as actions, sources, proof, location, details", async ({ page }) => {
    await page.goto("/submit?mode=single");

    const blocks = [
      page.getByRole("complementary", { name: "Actions" }),
      page.getByRole("heading", { name: /^Sources/ }),
      page.getByRole("heading", { name: /^Proof/ }),
      page.getByRole("heading", { name: /^Location/ }),
      page.getByRole("heading", { name: /^Details/ }),
    ];
    const boxes = [];
    for (const block of blocks) boxes.push((await block.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y, `block ${i + 1} starts under block ${i}`).toBeGreaterThan(boxes[i - 1].y);
    }
  });

  test("puts the actions top right, over the location then the details, on a wide screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/submit?mode=single");

    const rail = page.getByRole("complementary", { name: "Actions" });
    // A mouse on a count lists what is missing.
    const label = "4 missing: Title, Source file, Source URL, Source kind";
    await rail.getByRole("button", { name: label }).hover();
    await expect(page.getByText(label, { exact: true }).and(page.locator(":visible"))).toBeVisible();
    await page.mouse.move(0, 0);
    const actions = (await rail.boundingBox())!;
    const title = (await page.getByLabel("Title", { exact: true }).boundingBox())!;
    const location = (await page.getByRole("heading", { name: /^Location/ }).boundingBox())!;
    const details = (await page.getByRole("heading", { name: /^Details/ }).boundingBox())!;
    expect(Math.abs(actions.y - title.y)).toBeLessThan(12);
    expect(location.x).toBeLessThanOrEqual(actions.x + 1);
    expect(location.y).toBeGreaterThanOrEqual(actions.y + actions.height);
    expect(details.x).toBe(location.x);
    expect(details.y).toBeGreaterThan(location.y);

    // One Details card: the date, the time, the conflict and the tags.
    const card = page.getByRole("heading", { name: /^Details/ }).locator("xpath=ancestor::section[1]");
    await expect(card.locator("#occurred_date")).toBeVisible();
    await expect(card.getByText("Tags", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Classification/ })).toHaveCount(0);

    // Scrolled down, the actions stay top right while the title goes. The source's extra fields
    // make the form taller than the screen.
    await page.getByRole("region", { name: "Source 1" }).getByRole("button", { name: "More details" }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByLabel("Title", { exact: true })).not.toBeInViewport();
    const pinned = (await rail.boundingBox())!;
    expect(Math.abs(pinned.x - actions.x)).toBeLessThanOrEqual(1);
    await expect(rail.getByRole("button", { name: "Publish geolocation" })).toBeInViewport({ ratio: 1 });
  });

  test("puts the Title field in the event title's place, the byline and its picker under it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${EVENT_ID}`);
    const eventTitle = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    await page.goto("/submit?mode=single");

    // The page name stays the heading of the page, for assistive tech only.
    await expect(page.getByRole("heading", { level: 1, name: "Submit" })).toHaveClass(/sr-only/);
    const field = page.getByLabel("Title", { exact: true });
    const title = (await field.boundingBox())!;
    expect(Math.abs(title.x - eventTitle.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(title.y - eventTitle.y)).toBeLessThan(8);

    // The byline under it is the analyst's, with the add button that picks the co-geolocators. The
    // picker floats in a popover, so nothing under the title moves.
    const add = page.getByRole("button", { name: "Invite a geolocator" });
    expect((await add.boundingBox())!.y).toBeGreaterThan(title.y + title.height);
    const sources = page.getByRole("heading", { name: /^Sources/ });
    const sourcesY = (await sources.boundingBox())!.y;
    await add.click();
    const invite = page.getByRole("dialog", { name: "Invite a geolocator" }).getByRole("combobox");
    await invite.fill("dee");
    await invite.press("Enter");
    await expect(page.getByRole("dialog", { name: "Invite a geolocator" })).toHaveCount(0);
    const picked = page.getByRole("link", { name: "dee, invited when you publish" });
    await expect(picked).toBeVisible();
    expect(Math.abs((await picked.boundingBox())!.y - (await add.boundingBox())!.y)).toBeLessThan(8);
    expect((await sources.boundingBox())!.y).toBe(sourcesY);
  });

  test("picks a co-geolocator on a narrow column", async ({ page }) => {
    await page.goto("/submit?mode=single");

    const add = page.getByRole("button", { name: "Invite a geolocator" });
    await add.click();
    const popover = page.getByRole("dialog", { name: "Invite a geolocator" });
    await expectNarrowViewportLayout(page, popover.getByRole("combobox"));
    await popover.getByRole("combobox").fill("dee");
    await popover.getByRole("combobox").press("Enter");
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Remove dee" }));
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

    // The back arrow returns to the chooser: back through the history from a path the chooser
    // opened, and straight to it from a path opened by its address.
    await modes.getByRole("link", { name: /^Bulk import/ }).click();
    await expect(page).toHaveURL(/\/submit\?mode=bulk$/);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/submit$/);
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    // That Back was a step through the history, so Forward reopens the path.
    await page.goForward();
    await expect(page).toHaveURL(/\/submit\?mode=bulk$/);

    await page.goto("/submit?mode=bulk");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/submit$/);
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Other ways to submit" })).toHaveCount(0);
  });

  test("keeps the form's draft through a trip to the chooser", async ({ page }) => {
    await page.goto("/submit?mode=single");

    await page.getByLabel("Title", { exact: true }).fill("Strike on a depot");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("group", { name: "Submission mode" }).getByRole("link", { name: /^Single event/ }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Strike on a depot");
  });

  test("opens the archive import from the onboarding link", async ({ page }) => {
    await page.goto("/submit?import=1");

    await expect(page.getByRole("group", { name: "Submission mode" })).toHaveCount(0);
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Back" }));
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
    await first.getByRole("button", { name: "More details" }).click();
    await expect(first.getByLabel("Latitude", { exact: true })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Add a source" }));

    // Every control of the editor stays inside its tile.
    const tile = (await first.boundingBox())!;
    const controls = first.locator("input:visible, select:visible, button:visible");
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(tile.x);
      expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width + 0.5);
    }
    // Each link is a card: the URL with its remove control at the card's top right, the post
    // time and the archive box under the URL.
    const url = (await first.getByLabel("Source 1 link 1", { exact: true }).boundingBox())!;
    const removeLink = (await first.getByRole("button", { name: "Remove source 1 link 1" }).boundingBox())!;
    const posted = (await first.getByLabel("Posted (UTC), source 1, t.me").boundingBox())!;
    const archive = (await first.getByRole("button", { name: "Archive source 1, t.me" }).boundingBox())!;
    expect(url.width).toBeGreaterThan(tile.width * 0.6);
    expect(removeLink.x).toBeGreaterThanOrEqual(url.x + url.width);
    expect(Math.abs(removeLink.y + removeLink.height / 2 - (url.y + url.height / 2))).toBeLessThanOrEqual(1);
    expect(posted.y).toBeGreaterThanOrEqual(url.y + url.height);
    expect(archive.y).toBeGreaterThanOrEqual(url.y + url.height);
    await expect(first.getByText("Posted (UTC)", { exact: true })).toBeHidden();
    // The post time needs the card's whole width at 320px to show its value; on a wider
    // phone the archive box sits beside it.
    await page.setViewportSize({ width: 480, height: 800 });
    const wider = [
      (await first.getByLabel("Posted (UTC), source 1, t.me").boundingBox())!,
      (await first.getByRole("button", { name: "Archive source 1, t.me" }).boundingBox())!,
    ];
    expect(wider[1].x).toBeGreaterThanOrEqual(wider[0].x + wider[0].width);
    expect(Math.abs(wider[1].y + wider[1].height / 2 - (wider[0].y + wider[0].height / 2))).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 320, height: 568 });

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

  // Both pairs share `CoordinateInputs`: the Location card's subject point and a source's capture
  // position, the narrowest box the pair renders in. Each width keeps the two fields and the two
  // actions on one line, the side column of a wide screen included. From 375px up a 6-decimal value
  // shows whole; at 320px the 16px field text and the 36px tap squares leave room for about 6
  // characters, and the rest scrolls inside the field.
  for (const width of [null, 1024]) {
    test(`keeps each coordinate pair and its actions on one line${width ? ` at ${width}px` : ""}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ width, height: 900 });
      await page.goto("/submit?mode=single");
      const source = page.getByRole("region", { name: "Source 1" });
      await source.getByLabel("Kind", { exact: true }).selectOption({ label: "Smartphone" });
      // The capture position sits under the source's folded More details.
      await source.getByRole("button", { name: "More details" }).click();
      const location = page.getByRole("heading", { name: /^Location/ }).locator("xpath=ancestor::section[1]");

      for (const box of [location, source]) {
        const lat = box.getByLabel("Latitude", { exact: true });
        const lng = box.getByLabel("Longitude", { exact: true });
        await lat.fill("48.015883");
        await lng.fill("37.802411");
        const items = [
          lat,
          lng,
          box.getByRole("link", { name: "View on Maps" }),
          box.getByRole("button", { name: "Copy coordinates" }),
        ];
        const card = (await box.boundingBox())!;
        const boxes = [];
        for (const item of items) boxes.push((await item.boundingBox())!);
        const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
        for (let i = 1; i < boxes.length; i++) {
          expect(Math.abs(middle(boxes[i]) - middle(boxes[0])), `item ${i + 1} on the fields' line`).toBeLessThan(1);
          expect(boxes[i].x, `item ${i + 1} after item ${i}`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
        }
        expect(boxes[0].x).toBeGreaterThanOrEqual(card.x);
        expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(card.x + card.width + 0.5);
        // No visible label: the fields carry only their accessible names.
        await expect(box.getByText("Latitude", { exact: true })).toHaveCount(0);
        if (page.viewportSize()!.width >= 375) {
          for (const field of [lat, lng]) {
            expect(await field.evaluate((el) => el.scrollWidth <= el.clientWidth), "the value shows whole").toBe(true);
          }
        }
      }
      await expectNoHorizontalOverflow(page);
    });
  }

  // The side column of a wide screen and a 320px phone both hold the pair side by side.
  for (const width of [null, 1024]) {
    test(`keeps the event date and time on one line${width ? ` at ${width}px` : ""}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 900 });
      await page.goto("/submit?mode=single");
      const card = page.getByRole("heading", { name: /^Details/ }).locator("xpath=ancestor::section[1]");
      // One read of all three boxes: the form still settles while it loads, and separate reads
      // would compare positions from different layouts.
      const { date, time, cardBox } = await card.evaluate((el) => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width };
        };
        return {
          date: box(el.querySelector("#occurred_date")!),
          time: box(el.querySelector("#occurred_time")!),
          cardBox: box(el),
        };
      });
      expect(Math.abs(date.y - time.y)).toBeLessThan(1);
      expect(time.x).toBeGreaterThanOrEqual(date.x + date.width);
      expect(time.x + time.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("lays each link out on one row under column headers on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/submit?mode=single");

    const first = page.getByRole("region", { name: "Source 1" });
    await first.getByRole("button", { name: "Add source 1 link" }).click();
    await first.getByLabel("Source 1 link 1", { exact: true }).fill("https://t.me/channel/12345");

    // URL, post time, archive box, remove: one line, in that order, under their headers.
    const row = [
      first.getByLabel("Source 1 link 1", { exact: true }),
      first.getByLabel("Posted (UTC), source 1, link 1, t.me"),
      first.getByRole("button", { name: "Archive source 1, link 1, t.me" }),
      first.getByRole("button", { name: "Remove source 1 link 1" }),
    ];
    const boxes = [];
    for (const cell of row) boxes.push((await cell.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].x, `cell ${i + 1} follows cell ${i}`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
      expect(Math.abs(boxes[i].y + boxes[i].height / 2 - (boxes[0].y + boxes[0].height / 2))).toBeLessThanOrEqual(1);
    }
    const headers = ["Links", "Posted (UTC)", "Archive"];
    for (const [i, text] of headers.entries()) {
      const header = (await first.getByText(text, { exact: true }).first().boundingBox())!;
      expect(Math.abs(header.x - boxes[i].x), `${text} heads its column`).toBeLessThanOrEqual(1);
      expect(header.y + header.height).toBeLessThanOrEqual(boxes[0].y);
    }
    // The second row keeps the first row's columns.
    const secondPosted = first.getByLabel("Posted (UTC), source 1, link 2, this link");
    const second = (await secondPosted.boundingBox())!;
    expect(Math.abs(second.x - boxes[1].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(second.width - boxes[1].width)).toBeLessThanOrEqual(1);

    // The archive box opens the paste line under its row, above the next row.
    await row[2].click();
    const paste = (await first.getByLabel("Archived copy of source 1, link 1, t.me").boundingBox())!;
    expect(paste.y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
    expect(paste.y + paste.height).toBeLessThanOrEqual((await secondPosted.boundingBox())!.y);
    await expectNoHorizontalOverflow(page);
  });

  test("picks, changes and removes a conflict through the search field", async ({ page }) => {
    const unlisted = { wikidata_id: null, start_year: null, end_year: null, tier: null };
    await answerWith(page, "/conflicts", [
      ...CONFLICTS,
      { ...unlisted, id: "44444444-4444-4444-8444-444444444442", name: "Other", is_ongoing: true },
      {
        ...unlisted,
        id: "44444444-4444-4444-8444-444444444443",
        name: "Falklands War",
        start_year: 1982,
        end_year: 1982,
        is_ongoing: false,
      },
    ]);
    await page.goto("/submit?mode=single");
    const publish = page.getByRole("button", { name: "Publish geolocation" });
    await expect(publish).toHaveAccessibleDescription(/Conflict$/);

    // At rest the field lists nothing; focus lists the ongoing conflicts, Other last.
    const field = page.getByRole("combobox", { name: "Conflict" });
    const list = page.getByRole("listbox", { name: "Conflict" });
    await expect(list).toHaveCount(0);
    await field.focus();
    await expect(list.getByRole("option")).toHaveText(["Russian invasion of Ukraine (2022-present)", "Other"]);
    await expectNoHorizontalOverflow(page);
    await list.getByRole("option", { name: "Russian invasion of Ukraine (2022-present)" }).click();
    const chip = page.getByRole("button", { name: "Remove Russian invasion of Ukraine (2022-present)" });
    await expect(chip).toBeVisible();
    await expect(publish).not.toHaveAccessibleDescription(/Conflict/);

    // The switch adds the ended conflicts; the arrows and Enter pick one.
    await page.getByRole("switch", { name: "Include ended conflicts" }).click();
    await field.fill("falk");
    await expect(list.getByRole("option")).toHaveText(["Falklands War (1982)"]);
    await field.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Falklands War (1982)" })).toBeVisible();

    // The chips remove the picks, and the conflict is missing again.
    await chip.click();
    await page.getByRole("button", { name: "Remove Falklands War (1982)" }).click();
    await expect(publish).toHaveAccessibleDescription(/Conflict$/);
    await expectNoHorizontalOverflow(page);
  });

  test("picks, creates and removes tags through the search fields", async ({ page }) => {
    await page.route(`${API_BASE_URL}/tags`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ id: "33333333-3333-4333-8333-333333333339", name: "Rubble" }),
          })
        : route.fallback(),
    );
    await page.goto("/submit?mode=single");

    // The Details card: the arrows and Enter pick a suggestion.
    const details = page.getByRole("combobox", { name: "Tags", exact: true });
    await details.fill("dro");
    await expect(page.getByRole("listbox", { name: "Tags", exact: true }).getByRole("option")).toHaveText([
      "Drone",
      'Create "dro"',
    ]);
    await details.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Drone" })).toBeVisible();
    await expect(details).toHaveValue("");

    // A source: a click creates the typed tag and picks it, a chip click removes it.
    const source = page.getByRole("region", { name: "Source 1" });
    await source.getByRole("button", { name: "More details" }).click();
    const field = source.getByRole("combobox", { name: "Source 1 tags" });
    await field.fill("Rubble");
    const list = page.getByRole("listbox", { name: "Source 1 tags" });
    await expect(list).toBeInViewport({ ratio: 1 });
    await list.getByRole("option", { name: 'Create "Rubble"' }).click();
    const chip = source.getByRole("button", { name: "Remove Rubble" });
    await expect(chip).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await chip.click();
    await expect(chip).toHaveCount(0);
  });

  // A source's capture time and a link's post time are the longest values a form
  // here asks for, and they wear a mark. At 320px the capture field is about 228px
  // wide inside its editor and the post time shares a link card, so the room left
  // is what decides whether the reader can see the instant they just typed or
  // only the front half of it.
  for (const [name, label] of [
    ["capture time", /^Captured \(UTC\)/],
    ["link's post time", /^Posted \(UTC\), source 1/],
  ] as const) {
    test(`a filled ${name} field clears its own mark`, async ({ page }) => {
      await page.goto("/submit?mode=single");

      const source = page.getByRole("region", { name: "Source 1" });
      await source.getByRole("button", { name: "More details" }).click();
      const field = source.getByLabel(label).and(page.locator("input"));
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
  }

  test("the legacy routes redirect here", async ({ page }) => {
    await page.goto("/geolocations/new");
    await expect(page).toHaveURL(/\/submit$/);
    await page.goto("/requests/new");
    await expect(page).toHaveURL(/\/submit\?mode=single$/);
  });
});

test.describe("publish counts on a touch screen", () => {
  test.use({ hasTouch: true });

  test("lists what is missing on a tap on the count, and publishes on a tap on the button", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/submit?mode=single");

    const actions = page.getByRole("complementary", { name: "Actions" });
    const label = "4 missing: Title, Source file, Source URL, Source kind";
    const list = page.getByText(label, { exact: true }).and(page.locator(":visible"));
    const request = actions.getByRole("button", { name: "Publish request" });
    await actions.getByRole("button", { name: label }).tap();
    await expect(list).toBeVisible();
    // The list hangs under the button, never over it.
    expect((await list.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await request.boundingBox())!.y + (await request.boundingBox())!.height,
    );
    await expectNoHorizontalOverflow(page);

    // A tap on the button itself closes the list and flags the gaps red.
    await request.tap();
    await expect(list).toBeHidden();
    await expect(page.getByLabel("Title", { exact: true })).toHaveClass(/border-red-500/);
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
