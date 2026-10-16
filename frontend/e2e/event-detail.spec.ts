import { expect, test } from "@playwright/test";

import { EVENT, EVENT_APPROVALS, EVENT_ID } from "./support/fixtures";
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

  test("stamps its approvals in the header and lists them in the panel", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    // Five stamps, oldest first, then a bubble for the rest; no card at the foot of the page.
    const stamps = page.getByRole("list", { name: "Approved by" });
    await expect(stamps.getByRole("button", { name: /^Approved by/ })).toHaveCount(5);
    const first = stamps.getByRole("button", {
      name: `Approved by ${EVENT_APPROVALS[0].reviewer!.username}`,
    });
    await expect(first).toBeVisible();
    expect((await first.boundingBox())?.width).toBe(28);
    await expect(page.getByRole("heading", { name: "Approvals" })).toHaveCount(0);
    await expectNarrowViewportLayout(page, stamps.getByRole("button", { name: "Show 2 more approvals" }));

    // A tap opens the stamp's card, which holds the way to the profile.
    await first.click();
    await expectNarrowViewportLayout(page, page.getByRole("link", { name: "View profile" }));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await stamps.getByRole("button", { name: "Show 2 more approvals" }).click();
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Approvals", exact: true }));
  });
});
