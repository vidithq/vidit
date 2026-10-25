import { expect, test } from "@playwright/test";

import { answerWith, grantSession, mockApi } from "./support/mockApi";
import { expectControlInsideViewport, expectNoHorizontalOverflow } from "./support/narrowLayout";

const INVITE_CODE = {
  id: "c1",
  code: "abcdef123456",
  status: "active",
  sponsor: null,
  redeemer: null,
  used_at: null,
  expires_at: null,
  created_at: "2026-10-01T00:00:00Z",
  x_handle: null,
};

const DETECTION_STATS = {
  machine_rejected: 0,
  machine_total: 0,
  pending: 0,
  pending_missing_proof_image: 0,
  pending_missing_source_media: 0,
  pending_missing_source_url: 0,
  reject_rate: 0,
};

/**
 * The admin console on a phone. The invite table scrolls sideways in its own box, so the row's
 * action menu, opened from the last row, must still land on screen and take the tap rather than
 * be clipped by that box. Revoke then confirms in a dialog.
 */
test.describe("admin", () => {
  test("opens an invite row's menu and confirm on a narrow column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await answerWith(page, "/admin/me", { is_admin: true });
    await answerWith(page, "/admin/invite-codes", [INVITE_CODE]);
    await answerWith(page, "/admin/detection-stats", DETECTION_STATS);
    await answerWith(page, "/admin/reports", { items: [], total: 0, page: 1, per_page: 20 });
    await page.goto("/admin");

    const trigger = page.getByRole("button", { name: "More actions for abcdef" });
    await expect(trigger).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const revoke = page.getByRole("menuitem", { name: "Revoke" });
    await expect(revoke).toBeVisible();
    // The open menu adds nothing to the table's scroll box.
    const box = page.getByRole("table").locator("..");
    expect(await box.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    await expectControlInsideViewport(page, revoke);
    // The item itself takes a tap at its centre, so the scroll box does not clip it.
    const item = (await revoke.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent,
      [item.x + item.width / 2, item.y + item.height / 2],
    );
    expect(hit).toBe("Revoke");

    await revoke.click();
    const dialog = page.getByRole("dialog");
    await expectControlInsideViewport(page, dialog.getByRole("button", { name: "Revoke" }));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});
