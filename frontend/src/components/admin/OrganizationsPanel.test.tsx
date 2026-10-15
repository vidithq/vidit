import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { OrganizationsPanel } from "./OrganizationsPanel";

const row = (slug: string, admins: number) => ({
  slug,
  name: slug.toUpperCase(),
  member_count: admins,
  admin_count: admins,
  created_at: "2026-10-01T00:00:00Z",
});

describe("<OrganizationsPanel>", () => {
  it("offers to name an org-admin on an organization flagged without one only", async () => {
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path === "/admin/organizations" ? [row("orphan", 0), row("osw", 1)] : {}),
    );
    render(<OrganizationsPanel />);

    const field = await screen.findByLabelText("New org-admin of orphan (username)");
    expect(screen.queryByLabelText("New org-admin of osw (username)")).toBeNull();
    fireEvent.change(field, { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Name org-admin" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/organizations/orphan/admins", {
        method: "POST",
        body: JSON.stringify({ username: "ana" }),
      }),
    );
  });
});
