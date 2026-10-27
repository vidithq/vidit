import { expect, test } from "@playwright/test";

import {
  COLLECTED_EVENT,
  COLLECTION,
  COLLECTION_ID,
} from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

/**
 * A collection page, read by its owner.
 *
 * The owner rather than a visitor, because the owner is the narrow case: the
 * header carries a long title plus the whole cluster, the report flag every
 * reader gets and the two controls only the owner does. `/collections` is
 * public in `proxy.ts`, so the session cookie is granted for the owner
 * controls rather than for access.
 */
test.describe("collection page", () => {
  test("the header stays inside the column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    const heading = page.getByRole("heading", { name: COLLECTION.title });
    await expect(heading).toBeVisible();

    // The header holds the long title beside the owner's three-control
    // cluster, the row that wraps last on this page, so what is measured is
    // whether anything in it is laid out wider than the column it sits in.
    const overflow = await heading.evaluate((el) => {
      const frame = el.closest("header");
      if (!frame) throw new Error("the heading is not in the page header");
      return frame.scrollWidth - frame.clientWidth;
    });

    expect(overflow, "the header runs past the column").toBeLessThanOrEqual(1);
  });

  test("opens the report form inside the column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    await expect(
      page.getByRole("heading", { name: COLLECTION.title }),
    ).toBeVisible();

    // The drop is the rightmost control in the cluster, so it is the one a
    // wrapping row pushes off the column first.
    await expectControlInsideViewport(
      page,
      page.getByRole("button", { name: "Drop this collection" }),
    );

    // Where the owner goes to put more of their work on it: their own
    // catalogue, since an event joins a collection from its own page. It sits
    // in the Events header, the other row on this page that wraps.
    await expectControlInsideViewport(
      page,
      page.getByRole("link", { name: "Your geolocations" }),
    );

    // The flag opens a dialog holding a select and a textarea, the only form
    // this reading page ever shows: both have to render at the size that
    // keeps mobile Safari from zooming the column in on focus.
    await page.getByRole("button", { name: "Report" }).click();
    await expect(
      page.getByRole("heading", { name: "Report this collection" }),
    ).toBeVisible();
    await expectNarrowViewportLayout(
      page,
      page.getByRole("button", { name: "Send report" }),
    );
  });
});

/**
 * The same page read by a visitor, for the Coverage section it steps the
 * collection's work in.
 *
 * A visitor rather than the owner, because Coverage is what every reader of
 * the page gets and the owner's controls are covered above. Its last row holds
 * where the reader stands beside the two moves, so a phone is where that row
 * can push the column open or land a control off it.
 */
test.describe("collection coverage", () => {
  test("steps through the collection on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    await expect(
      page.getByRole("heading", { name: COLLECTION.title }),
    ).toBeVisible();

    // Coverage opens on the first item, and the two moves are what a reader
    // came to this page to press.
    await expect(page.getByText("1 of 2")).toBeVisible();
    await expect(
      page.getByRole("link", { name: COLLECTED_EVENT.title }),
    ).toBeVisible();
    const next = page.getByRole("button", { name: "Next" });
    await expectNarrowViewportLayout(page, next);
    await expectControlInsideViewport(
      page,
      page.getByRole("button", { name: "Previous" }),
    );

    // The step is the share unit, so it rides the page's own URL.
    await next.click();
    await expect(page.getByText("2 of 2")).toBeVisible();
    await expect(page).toHaveURL(/\?step=2$/);
    await expectNoHorizontalOverflow(page);
  });
});

/**
 * The create page, which is the same form before there is a collection.
 *
 * It is the longest form on this surface: two text fields, then the picker's
 * two blocks: the add field, whose list rows carry a title, a date and a status
 * badge, then the held events as a vertical list of compact rows. A row is where a
 * phone column gets pushed open, so what this measures is the whole page
 * against the column, with the add block's own field under the same 16px rule
 * the two above it take.
 */
test.describe("collection create page", () => {
  test("fits the form and its two blocks on a narrow column", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/collections/new");

    await expect(
      page.getByRole("heading", { name: "New collection" }),
    ).toBeVisible();

    // The collection holds nothing yet, and the block that says so points at
    // the one above it. The side column follows, below the fields on a phone.
    await expect(
      page.getByRole("heading", { name: "Events in this collection" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing on this collection yet.")).toBeVisible();

    // The add block: its own search field, whose list opens on focus with a
    // row that has to stay inside the column beside its date and badge.
    const field = page.getByRole("combobox", { name: "Add events" });
    await expect(field).toHaveAttribute(
      "placeholder",
      "Search your geolocations by title…",
    );
    await field.focus();
    await expectControlInsideViewport(page, page.getByRole("option").first());
    await page.keyboard.press("Escape");

    await expectNarrowViewportLayout(
      page,
      page.getByRole("button", { name: "Create collection" }),
    );
  });
});

/**
 * The owner's edit page for that collection.
 *
 * It is the same form over a collection that exists: the title field, the
 * description editor, the picker holding what the collection holds, and the
 * Cancel and Save pinned in the page's actions above all three cards, which is
 * the shape that breaks on a phone when a field is laid out narrower than the
 * column or renders under the 16px mobile Safari zooms on. Dropping the collection is not on this
 * page; it is the header trash on the collection page itself. The owner is
 * the only reader it has.
 */
test.describe("collection edit page", () => {
  test("fits the form on a narrow column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}/edit`);

    // The page names the collection it edits under its own heading.
    await expect(
      page.getByRole("heading", { name: "Edit collection" }),
    ).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(COLLECTION.title);

    // The save is what the reader came here to press, and the fields above it,
    // the two text ones and the add block's search box, are what the shared
    // checks measure.
    await expectNarrowViewportLayout(
      page,
      page.getByRole("button", { name: "Save collection" }),
    );

    // Cancel sits beside it, in the page's sticky actions.
    await expectControlInsideViewport(
      page,
      page.getByRole("button", { name: "Cancel" }),
    );

    // What the collection holds is a vertical list under the add block, each row's remove
    // control at its right edge, inside the column.
    const held = page.getByRole("list", { name: "Events in this collection" });
    await expect(held.getByRole("listitem").first()).toBeVisible();
    await expectControlInsideViewport(
      page,
      held.getByRole("button", { name: /^Remove / }).first(),
    );
  });
});
