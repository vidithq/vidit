import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * Golden path 1: someone opens a shared event link and reads the record.
 *
 * Signed out, which is how a shared link arrives: `/events` is public in
 * `proxy.ts`, so no session cookie is granted here.
 */
test.describe("shared event link", () => {
  test("reads on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    await expect(page.getByRole("heading", { name: EVENT.title })).toBeVisible();

    // The utilities cluster is what a reader who followed a link acts on: it
    // passes the record on again.
    await expectNarrowViewportLayout(
      page,
      page.getByRole("button", { name: "Share on X" }),
    );
  });
});
