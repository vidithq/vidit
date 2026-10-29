import { expect, type Locator } from "@playwright/test";

/** Opens the groups of the filter panel in `panel`, which all start collapsed: the ones named, or
 *  every one. */
export async function openFilterGroups(panel: Locator, titles?: string[]) {
  const headings = panel.locator("h3 > button[aria-expanded]");
  await expect(headings.first()).toBeVisible();
  for (const name of titles ?? (await headings.allTextContents())) {
    const heading = panel.getByRole("button", { name, exact: true });
    await heading.click();
    await expect(heading).toHaveAttribute("aria-expanded", "true");
  }
}
