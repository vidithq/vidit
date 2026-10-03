import { expect, test } from "@playwright/test";

import { mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * Golden path 2: browse the map and open its filters.
 *
 * Public in `proxy.ts`, so this runs signed out. The basemap and the points
 * endpoint are both mocked, so what is measured is the app's own chrome over
 * the canvas rather than a tile server's response time.
 */
test.describe("map", () => {
  test("browses on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    const filters = page.getByRole("button", { name: "Filters" });
    await expectNarrowViewportLayout(page, filters);
  });

  test("opens the filter panel on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    const filters = page.getByRole("button", { name: "Filters" });
    await expect(filters).toBeVisible();
    await filters.click();

    // The panel's own sections are where a phone column runs out of room, so
    // the three checks run again with the panel open.
    await expectNarrowViewportLayout(page, filters);
  });

  // `TAP_STEP` sits on each `<FilterSection>` header toggle, not on the row
  // holding the two of them: on the row it sizes the row and leaves each
  // button at its own 16px line box, a 36px strip a thumb misses two thirds of
  // the time. Measured on the border box each toggle actually presents.
  test("a filter section header is a 36px tap target", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    await page.getByRole("button", { name: "Filters" }).click();

    // Both halves of each header: the summary and chevron, which names itself
    // `Toggle <section>`, and the title beside it, which carries
    // `aria-expanded` and no name of its own (the Next dev-tools launcher is
    // the other `aria-expanded` button on the page, and it has one).
    const toggles = page.locator(
      'button[aria-label^="Toggle "], button[aria-expanded]:not([aria-label])',
    );
    await expect(toggles.first()).toBeVisible();
    expect(
      await toggles.count(),
      "the filter panel rendered no section headers",
    ).toBeGreaterThan(1);

    for (const toggle of await toggles.all()) {
      const box = await toggle.boundingBox();
      expect(box, "a section toggle has no bounding box").not.toBeNull();
      expect(
        (box as { height: number }).height,
        "a filter section toggle stands under the phone tap step",
      ).toBeGreaterThanOrEqual(36);
    }
  });

  // maplibre-gl builds its worker URL at runtime, out of the bundler's sight,
  // so a version bump can leave the worker a 404 that the browser reads as a
  // module script with a text/html type: no tile and no pin renders, and the
  // layout checks above still pass over the blank canvas.
  test("loads the map worker", async ({ page }) => {
    const moduleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /module script/i.test(message.text())) {
        moduleErrors.push(message.text());
      }
    });
    const workerResponse = page.waitForResponse((response) =>
      response.url().includes("maplibre-gl-worker"),
    );
    const workerStarted = page.waitForEvent("worker", {
      predicate: (worker) => worker.url().includes("maplibre-gl-worker"),
    });

    await mockApi(page);
    await page.goto("/map");

    const response = await workerResponse;
    expect(response.status(), "the map worker did not load").toBe(200);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    await workerStarted;
    expect(moduleErrors, "the map worker failed as a module script").toEqual(
      [],
    );
  });
});
