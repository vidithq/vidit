import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The three checks every narrow-viewport spec runs, in one place so a page
 * cannot be covered by a weaker version of them.
 *
 * Each check answers one way a page breaks on a phone:
 * sideways scroll, a primary control pushed off the column, and a field small
 * enough that mobile Safari zooms the page in on focus and never zooms back.
 */

/**
 * Minimum computed `font-size` for an editable field. Mobile Safari zooms the
 * viewport in when a field under this size takes focus, and leaves the reader
 * scrolled sideways on the form they were filling in.
 */
const MIN_FIELD_FONT_SIZE_PX = 16;

/**
 * What counts as an editable field: the controls a reader types into. Hidden,
 * checkbox, radio and file inputs are excluded because none of them renders
 * typed text, so none of them triggers the zoom.
 */
const EDITABLE_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
  "textarea",
  "select",
  '[contenteditable="true"]',
].join(", ");

/** One undersized field, named well enough to find in the markup. */
interface UndersizedField {
  field: string;
  fontSizePx: number;
}

/** The document is no wider than the viewport, so the page never scrolls sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `document.documentElement.scrollWidth (${scrollWidth}) must equal window.innerWidth (${innerWidth}): the page scrolls sideways`,
  ).toBe(innerWidth);
}

/** The page's primary control is visible and sits entirely inside the column. */
export async function expectControlInsideViewport(
  page: Page,
  control: Locator,
): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box, "the primary control has no bounding box").not.toBeNull();
  const innerWidth = await page.evaluate(() => window.innerWidth);
  // Non-null asserted through a local: `box` is proven above, and reading it
  // once keeps the two failure messages describing the same measurement.
  const { x, width } = box as { x: number; width: number };
  expect(x, `the primary control starts at x=${x}, left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    x + width,
    `the primary control ends at x=${x + width}, past the viewport width ${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth);
}

/** Every visible editable field renders at 16px or more. */
export async function expectReadableFieldText(page: Page): Promise<void> {
  const undersized: UndersizedField[] = await page.evaluate(
    ({ selector, minimum }) => {
      // Name a field by the attributes that locate it in the markup, in the
      // order a reader would search for: id, then name, then placeholder.
      const describe = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const id = el.getAttribute("id");
        const name = el.getAttribute("name");
        const placeholder = el.getAttribute("placeholder");
        const label = el.getAttribute("aria-label");
        const hint = id ?? name ?? label ?? placeholder ?? el.className;
        return `${tag}[${hint}]`;
      };

      const found: { field: string; fontSizePx: number }[] = [];
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        // A field inside a collapsed or `hidden` branch has no box, which is
        // how the submit form keeps its draft mounted while an import panel is
        // showing. Only what a reader can actually reach is asserted on.
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const fontSizePx = Number.parseFloat(style.fontSize);
        if (fontSizePx < minimum) found.push({ field: describe(el), fontSizePx });
      }
      return found;
    },
    { selector: EDITABLE_FIELD_SELECTOR, minimum: MIN_FIELD_FONT_SIZE_PX },
  );

  expect(
    undersized,
    `every visible editable field must render at ${MIN_FIELD_FONT_SIZE_PX}px or more`,
  ).toEqual([]);
}

/**
 * Run all three checks against the page as it currently stands. `control`
 * names the page's primary control, the one a reader came to press.
 */
export async function expectNarrowViewportLayout(
  page: Page,
  control: Locator,
): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectControlInsideViewport(page, control);
  await expectReadableFieldText(page);
}
