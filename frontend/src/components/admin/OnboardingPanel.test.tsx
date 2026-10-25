import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchPage: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  apiFetchPage: api.apiFetchPage,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { OnboardingPanel } from "./OnboardingPanel";

const code = {
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

beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetchPage.mockReset();
  api.apiFetchPage.mockResolvedValue({ items: [code], nextCursor: null });
});

async function openItem(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: "More actions for abcdef" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
  return screen.getByRole("dialog");
}

describe("<OnboardingPanel>", () => {
  it("revokes a code only from the confirm dialog", async () => {
    api.apiFetch.mockResolvedValue({ ...code, status: "revoked" });
    render(<OnboardingPanel />);

    const dialog = await openItem("Revoke");
    expect(api.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/invite-codes/c1/revoke", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(api.apiFetchPage).toHaveBeenCalledTimes(2));
  });

  it("keeps the dialog open with the refusal when a delete fails", async () => {
    api.apiFetch.mockRejectedValue(new Error("nope"));
    render(<OnboardingPanel />);

    const dialog = await openItem("Delete");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Failed to delete invite code",
    );
    expect(api.apiFetch).toHaveBeenCalledWith("/admin/invite-codes/c1", { method: "DELETE" });
  });
});
