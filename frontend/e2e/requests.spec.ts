import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID, LONG_TAG_NAME } from "./support/fixtures";
import { answerWith, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The request board, the narrowest content column in the product: a compact
 * `<EntityCard>` puts about 150px between a thumbnail and a status badge at
 * 320px, and a tag rides that column.
 *
 * Public in `proxy.ts`, so this runs signed out.
 */
test.describe("requests", () => {
  test("reads on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/requests");

    const post = page.getByRole("link", { name: "Post request" });
    await expectNarrowViewportLayout(page, post);
  });

  // The page's action sits top right, beside the title, and the sort alone under it.
  test("puts Post request top right, above the sort", async ({ page }) => {
    await mockApi(page);
    await page.goto("/requests");

    const post = (await page.getByRole("link", { name: "Post request" }).boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const sort = (await page.getByRole("group", { name: "Sort requests" }).boundingBox())!;
    expect(post.x, "Post request sits right of the title's start").toBeGreaterThan(title.x);
    expect(post.y + post.height, "Post request sits above the sort").toBeLessThanOrEqual(sort.y);
  });

  // Geolocate shares the actions row with Share and Report, on one line at a phone's width.
  test("puts Geolocate on the request's actions row", async ({ page }) => {
    await mockApi(page);
    await answerWith(page, `/events/${EVENT_ID}`, {
      ...EVENT,
      status: "requested",
      geolocators: [],
    });
    await page.goto(`/requests/${EVENT_ID}`);

    const row = page.getByRole("group", { name: "Event actions" });
    const geolocate = row.getByRole("link", { name: "Geolocate" });
    await expect(geolocate).toBeVisible();
    const [share, located] = [
      (await row.getByRole("button", { name: "Share" }).boundingBox())!,
      (await geolocate.boundingBox())!,
    ];
    expect(
      Math.abs(share.y + share.height / 2 - (located.y + located.height / 2)),
      "Geolocate sits on Share's line",
    ).toBeLessThanOrEqual(2);
    await expectNarrowViewportLayout(page, geolocate);
  });

  // The board's one request carries a tag that is a single 33-character token.
  // `<Pill>` caps itself at its container and breaks the word inside the cap,
  // so the card holds it; without the cap the chip takes the whole word's width
  // and the page scrolls sideways, which is what the reader met here.
  test("a long single-word tag stays inside its card", async ({ page }) => {
    await mockApi(page);
    await page.goto("/requests");

    const pill = page.getByText(LONG_TAG_NAME, { exact: true });
    await expect(pill).toBeVisible();

    const measured = await pill.evaluate((el) => {
      // The compact `<EntityCard>` shell, the box the tag has to stay inside.
      const card = el.closest("div.rounded-md.border");
      if (!card) throw new Error("the tag is not inside a card");
      return {
        // The pill's own box holds its text: an unbroken token overflows it.
        pillOverflowPx: el.scrollWidth - el.clientWidth,
        // And the box stays within the card that bounds it.
        pastCardPx:
          el.getBoundingClientRect().right - card.getBoundingClientRect().right,
      };
    });

    expect(
      measured.pillOverflowPx,
      "the tag does not wrap inside the pill",
    ).toBeLessThanOrEqual(0);
    expect(measured.pastCardPx, "the pill runs past its card").toBeLessThanOrEqual(0);
  });
});
