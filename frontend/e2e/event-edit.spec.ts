import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID, MEDIA_URL } from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout, expectNoHorizontalOverflow } from "./support/narrowLayout";

/**
 * The one edit form: the owner's correction of a published geolocation, and the publish of a
 * request. The writes are the page's sticky actions, top right of the header: they stay pinned at
 * the top of the viewport while the fields scroll under them, and Publish counts the requirements
 * it still misses.
 */
test.describe("event edit", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("keeps the save pinned over the fields on a narrow column", async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}/edit`);

    const actions = page.getByRole("complementary", { name: "Actions" });
    const save = actions.getByRole("button", { name: "Save version 2" });
    await expectNarrowViewportLayout(page, save);
    // A version needs the publish floor too, but only a publish counts it.
    await expect(actions.getByRole("button", { name: /missing/ })).toHaveCount(0);

    // At rest the actions sit above the title field, the close a red icon beside the save.
    const title = page.getByLabel("Title", { exact: true });
    expect((await actions.boundingBox())!.y + (await actions.boundingBox())!.height).toBeLessThanOrEqual(
      (await title.boundingBox())!.y,
    );
    await expect(actions.getByRole("button", { name: "Close this geolocation" })).toBeVisible();

    // No version note in the page: the byline under the title field ends with the add button,
    // whose picker floats in a popover.
    await expect(page.getByRole("textbox", { name: "Version note" })).toHaveCount(0);
    const add = page.getByRole("button", { name: "Invite a geolocator" });
    expect((await add.boundingBox())!.y).toBeGreaterThan((await title.boundingBox())!.y);
    await add.click();
    await expect(page.getByRole("dialog", { name: "Invite a geolocator" }).getByRole("combobox")).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");

    // Scrolled to the details, the save is still on screen, pinned at the top.
    await page.getByRole("heading", { name: /^Details/ }).scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport({ ratio: 1 });
  });

  test("links a site near the event from the Linked sites block, inside a narrow column", async ({ page }) => {
    await answerWith(page, "/sites/suggestions", [
      { id: "s1", name: "Northern fuel depot with a long name", kind: "depot", distance_m: 640 },
      { id: "s2", name: "Saky airbase", kind: "airbase", distance_m: 1200 },
    ]);
    await page.goto(`/events/${EVENT_ID}/edit`);

    await page.getByRole("button", { name: /Northern fuel depot/ }).click();
    const effect = page.getByRole("group", { name: "Effect at Northern fuel depot with a long name" });
    await expect(effect).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await effect.getByRole("button", { name: "Destruction" }).click();
    await expect(
      page.getByRole("complementary", { name: "Actions" }).getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
  });

  test("asks for the version note in a panel on the save, inside a narrow column", async ({ page }) => {
    // A proof image completes the floor, so the save goes on to ask for the note.
    await answerWith(page, `/events/${EVENT_ID}`, {
      ...EVENT,
      proof: `<p>Matched the skyline.</p><img src="${MEDIA_URL}">`,
    });
    await page.goto(`/events/${EVENT_ID}/edit`);
    await page.getByLabel("Title", { exact: true }).fill("Corrected title");
    const save = page
      .getByRole("complementary", { name: "Actions" })
      .getByRole("button", { name: "Save version 2" });
    await save.click();

    const panel = page.getByRole("dialog", { name: "Version note" });
    await expect(panel.getByRole("textbox", { name: "Version note" })).toBeFocused();
    await expect(panel).toBeInViewport({ ratio: 1 });
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await save.boundingBox())!.y + (await save.boundingBox())!.height,
    );
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // Escape writes nothing: the save is there to click again. Focus returning to it is the unit
    // test's to check.
    await expect(save).toHaveAccessibleName("Save version 2");
  });

  test("puts the actions top right, over the location and the details, on a wide screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${EVENT_ID}/edit`);

    const rail = page.getByRole("complementary", { name: "Actions" });
    await expect(rail.getByRole("button", { name: "Save version 2" })).toBeVisible();
    const box = async (name: string) =>
      (await page.getByRole("heading", { name: new RegExp(`^${name}`) }).boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    const title = (await page.getByLabel("Title", { exact: true }).boundingBox())!;
    const [sources, proof, location, details] = [
      await box("Sources"),
      await box("Proof"),
      await box("Location"),
      await box("Details"),
    ];
    // Header: the Title field left, in the title's place, the actions top right, level with it.
    expect(railBox.x).toBeGreaterThan(title.x + title.width);
    expect(Math.abs(railBox.y - title.y)).toBeLessThan(12);
    // Main column: title, sources, proof. Side column: location, details, under the actions.
    expect(sources.y).toBeGreaterThan(title.y);
    expect(proof.y).toBeGreaterThan(sources.y);
    expect(location.x).toBeLessThanOrEqual(railBox.x + 1);
    expect(location.y).toBeGreaterThanOrEqual(railBox.y + railBox.height);
    expect(details.y).toBeGreaterThan(location.y);

    // Scrolled down, the title is gone and the actions stay top right.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByLabel("Title", { exact: true })).not.toBeInViewport();
    const pinned = (await rail.boundingBox())!;
    expect(pinned.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pinned.x - railBox.x)).toBeLessThanOrEqual(1);
    await expect(rail.getByRole("button", { name: "Save version 2" })).toBeInViewport({ ratio: 1 });
  });

  test("publishes a request from the same form, counting its missing requirements", async ({ page }) => {
    await answerWith(page, `/events/${EVENT_ID}`, {
      ...EVENT,
      status: "requested",
      version_no: 0,
      version_zero: "request",
      geolocated_at: null,
      geolocators: [],
      conflicts: [],
    });
    await page.goto(`/events/${EVENT_ID}/edit`);

    const publish = page.getByRole("button", { name: "Publish", exact: true });
    await expectNarrowViewportLayout(page, publish);
    const rail = page.getByRole("complementary", { name: "Actions" });
    await expect(rail.getByRole("button", { name: "Save request" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save version/ })).toHaveCount(0);

    // The request names no conflict: Publish counts it, and its count names it.
    await expect(publish).toHaveAccessibleDescription(/^\d+ missing: .*Conflict/);
    const count = rail.getByRole("button", { name: /^\d+ missing: / });
    await count.hover();
    await expect(page.getByText(/^\d+ missing: .*Conflict$/).and(page.locator(":visible"))).toBeVisible();
    await expectNarrowViewportLayout(page, publish);

    // A pick from the conflict field takes Conflict off the count.
    await page.getByRole("combobox", { name: "Conflict" }).fill("russian");
    await page.getByRole("listbox", { name: "Conflict" }).getByRole("option", { name: /^Russian invasion/ }).click();
    await expect(page.getByRole("button", { name: /^Remove Russian invasion/ })).toBeVisible();
    await expect(publish).not.toHaveAccessibleDescription(/Conflict/);
  });
});
