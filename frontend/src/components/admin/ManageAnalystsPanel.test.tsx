import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { ManageAnalystsPanel } from "./ManageAnalystsPanel";

const ana = {
  id: "u1",
  username: "ana",
  email: "ana@example.org",
  is_admin: false,
  x_handle: null,
  is_invite_minting_enabled: false,
  sponsor: null,
  created_at: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  api.apiFetch.mockReset();
});

describe("<ManageAnalystsPanel>", () => {
  it("picks an analyst from the search and hard deletes from the dialog", async () => {
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/admin/users?q=")
          ? [ana]
          : { username: "ana", mode: "hard", cascaded_geolocations: 1, transferred_events: 0, media_count: 2 },
      ),
    );
    render(<ManageAnalystsPanel />);

    const field = screen.getByLabelText("Find an analyst (username or email)");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "ana@" } });
    fireEvent.click(await screen.findByRole("option", { name: /^ana/ }));
    expect(screen.getByText("ana@example.org")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions for ana" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hard delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Hard delete is irreversible.");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Hard delete" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/users/u1?hard=true", { method: "DELETE" }),
    );
    expect(
      await screen.findByText("Erased the account, 1 event and 2 storage objects."),
    ).toBeInTheDocument();
    expect(screen.queryByText("ana@example.org")).toBeNull();
  });
});
