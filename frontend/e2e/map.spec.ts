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

    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expectNarrowViewportLayout(page, filters);
  });

  test("opens the filter panel in a sheet on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expect(filters).toBeVisible();
    await filters.click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();

    // The panel's own lines are where a phone column runs out of room, so the three checks run
    // again with the sheet open, and again with a line's editor over it.
    await expectNarrowViewportLayout(page, sheet.getByRole("button", { name: "Done" }));
    await sheet.getByRole("button", { name: "Show", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Show" });
    await expect(editor).toBeInViewport({ ratio: 1 });
    await editor.getByRole("button", { name: "Sites" }).click();
    await editor.press("Escape");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTitle("Remove filter Show: Sites").filter({ visible: true })).toBeVisible();
    await expectNarrowViewportLayout(page, filters);
  });

  // From `lg` up the panel floats under its header, and the map's bottom-left row (zoom, locate,
  // basemap) sits under it: a tall open panel stops above that row and scrolls the rest.
  test("keeps the open filter panel above the map's bottom-left controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await mockApi(page);
    await page.goto("/map");

    const header = page.getByRole("button", { name: /^Filters/ }).first();
    await header.click();
    await expect(page.getByRole("heading", { name: "When" })).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-bottom-left .maplibregl-ctrl-group").first()).toBeVisible();

    const panel = (await header.locator("..").boundingBox())!;
    const controls = await page
      .locator(".maplibregl-ctrl-bottom-left > *")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    for (const control of controls) {
      if (control.width === 0) continue;
      if (control.right <= panel.x || control.left >= panel.x + panel.width) continue;
      expect(
        panel.y + panel.height,
        "the filter panel runs over a bottom-left map control",
      ).toBeLessThanOrEqual(control.top);
    }
  });

  // `TAP_STEP` sits on each line of the panel, so a line that opens an editor and a switch line
  // are each a 36px target on a phone. Measured on the border box each line presents.
  test("a filter line is a 36px tap target", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    const lines = sheet.locator('button[aria-haspopup="dialog"], button[role="switch"]');
    await expect(lines.first()).toBeVisible();
    expect(await lines.count(), "the filter panel rendered no lines").toBeGreaterThan(1);

    for (const line of await lines.all()) {
      const box = await line.boundingBox();
      expect(box, "a filter line has no bounding box").not.toBeNull();
      expect(
        (box as { height: number }).height,
        "a filter line stands under the phone tap step",
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
