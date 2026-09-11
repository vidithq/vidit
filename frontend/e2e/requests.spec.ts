import { expect, test } from "@playwright/test";

import { LONG_TAG_NAME } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
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
