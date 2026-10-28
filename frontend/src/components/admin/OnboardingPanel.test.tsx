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

const deletedCode = {
  ...code,
  status: "used",
  used_at: "2026-10-02T00:00:00Z",
  redeemer: {
    user_id: "u1",
    username: "ana",
    email: "ana@example.org",
    is_admin: false,
    x_handle: null,
    is_invite_minting_enabled: true,
    archives_imported: 0,
    bot_detection_count: 0,
    detected_count: 0,
    geolocated_count: 3,
    last_seen_at: null,
    deleted_at: "2026-10-20T10:00:00Z",
  },
};

async function manageDeletedAccount() {
  api.apiFetchPage.mockResolvedValue({ items: [deletedCode], nextCursor: null });
  render(<OnboardingPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
  fireEvent.click(screen.getByRole("button", { name: "Actions for ana" }));
}

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

  it("marks a soft-deleted account and offers only Restore and Hard delete", async () => {
    await manageDeletedAccount();

    expect(screen.getByText("Soft-deleted")).toBeInTheDocument();
    expect(screen.getByText("Soft-deleted 20 Oct 2026, 10:00 UTC")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Restore",
      "Hard delete",
    ]);
    expect(screen.queryByText("Can mint invite codes")).toBeNull();
  });

  it("restores a soft-deleted account from the confirm dialog", async () => {
    api.apiFetch.mockResolvedValue({ user_id: "u1", username: "ana", restored_events: 3 });
    await manageDeletedAccount();

    fireEvent.click(screen.getByRole("menuitem", { name: "Restore" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/users/u1/restore", { method: "POST" }),
    );
    expect(
      await screen.findByText(
        "Restored the account and 3 events. Link its X handle again if it had one.",
      ),
    ).toBeInTheDocument();
  });

  it("sums up what a hard delete erased", async () => {
    api.apiFetch.mockResolvedValue({
      user_id: "u1",
      username: "ana",
      mode: "hard",
      deleted_at: null,
      cascaded_geolocations: 3,
      transferred_events: 1,
      media_count: 7,
    });
    await manageDeletedAccount();

    fireEvent.click(screen.getByRole("menuitem", { name: "Hard delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hard delete" }));

    expect(
      await screen.findByText(
        "Erased the account, 3 events and 7 storage objects. Handed 1 event to a co-geolocator.",
      ),
    ).toBeInTheDocument();
    expect(api.apiFetch).toHaveBeenCalledWith("/admin/users/u1?hard=true", { method: "DELETE" });
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
