import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The three checks every narrow-viewport spec runs, in one place so a page
 * cannot be covered by a weaker version of them.
 *
 * Each check answers one way a page breaks on a phone:
 * sideways scroll, a primary control pushed off the column, and a field small
 * enough that mobile Safari zooms the page in on focus and never zooms back.
 *
 * **Every check waits.** `page.goto` resolves on `load`, which lands before
 * React hydrates and before the session and catalogue fetches answer, so a
 * geometry read taken right after it measures the loading skeleton and passes
 * on a page that has not rendered. Two things keep that from happening. The
 * page's primary control is awaited before any measurement, so the client tree
 * is mounted and the page is the one a reader meets; and the two whole-document
 * reads retry through `expect.poll` until they hold, so a late image or a
 * deferred panel cannot land an overflow after the last assertion.
 */

/**
 * Minimum computed `font-size` for an editable field. Mobile Safari zooms the
 * viewport in when a field under this size takes focus, and leaves the reader
 * scrolled sideways on the form they were filling in.
 */
const MIN_FIELD_FONT_SIZE_PX = 16;

/**
 * What counts as an editable field: the controls a reader types into. The
 * excluded `type` values are the inputs that render no typed text, so none of
 * them triggers the zoom: `hidden` has no box, `checkbox` / `radio` / `file` /
 * `range` / `color` are pickers drawn by the engine, and `submit` / `button` /
 * `reset` / `image` are buttons that happen to be spelled `<input>`.
 */
const NON_TEXT_INPUT_TYPES = [
  "hidden",
  "checkbox",
  "radio",
  "file",
  "submit",
  "button",
  "reset",
  "image",
  "range",
  "color",
];

const EDITABLE_FIELD_SELECTOR = [
  `input${NON_TEXT_INPUT_TYPES.map((t) => `:not([type="${t}"])`).join("")}`,
  "textarea",
  "select",
  '[contenteditable="true"]',
].join(", ");

/** One undersized field, named well enough to find in the markup. */
interface UndersizedField {
  field: string;
  fontSizePx: number;
}

/**
 * The document is no wider than the viewport, so the page never scrolls
 * sideways.
 *
 * Measured against `document.documentElement.clientWidth`, the width of the
 * viewport's content box, and not against `window.innerWidth`, which counts a
 * classic scrollbar's gutter as part of the viewport. On a runner that paints
 * one, every page would then read as 15px narrower than the window and the
 * check would pass with a real 15px overflow in it.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      {
        message:
          "document.documentElement.scrollWidth must not exceed its clientWidth: the page scrolls sideways",
      },
    )
    .toBeLessThanOrEqual(0);
}

/**
 * The page's primary control is visible and lies entirely inside the viewport.
 *
 * `toBeInViewport({ ratio: 1 })` asserts the whole of the control's box
 * intersects the viewport, vertically as well as horizontally, which is the
 * check a hand-rolled comparison of the box against `window.innerWidth` only
 * made on one axis. It is preceded by a scroll, so a control below the fold is
 * measured where a reader would meet it rather than failing for being further
 * down a long form.
 */
export async function expectControlInsideViewport(
  page: Page,
  control: Locator,
): Promise<void> {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 1 });
}

/** The visible editable fields rendering under the floor, read once. */
function undersizedFields(page: Page): Promise<UndersizedField[]> {
  return page.evaluate(
    ({ selector, minimum }) => {
      // Name a field by the first attribute that locates it in the markup,
      // preferring the ones a reader can search for over the ones they cannot:
      // id, then name, then the accessible name, then the placeholder, and the
      // class list when the field carries none of them.
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
}

/** Every visible editable field renders at 16px or more. */
export async function expectReadableFieldText(page: Page): Promise<void> {
  await expect
    .poll(() => undersizedFields(page), {
      message: `every visible editable field must render at ${MIN_FIELD_FONT_SIZE_PX}px or more`,
    })
    .toEqual([]);
}

/**
 * Run all three checks against the rendered page. `control` names the page's
 * primary control, the one a reader came to press, and waiting for it is what
 * says the page is rendered: it comes from the client tree, so it is on screen
 * only once React has hydrated and the fetches the page gates itself on have
 * answered. Measure before that and the three checks read a skeleton, where
 * there is no column to overflow and no field to size.
 */
export async function expectNarrowViewportLayout(
  page: Page,
  control: Locator,
): Promise<void> {
  await expect(control).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectControlInsideViewport(page, control);
  await expectReadableFieldText(page);
}
