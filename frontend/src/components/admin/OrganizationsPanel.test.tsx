import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

import { OrganizationsPanel } from "./OrganizationsPanel";

const row = (slug: string, managers: number) => ({
  slug,
  name: slug.toUpperCase(),
  member_count: managers,
  manager_count: managers,
  created_at: "2026-10-01T00:00:00Z",
});

describe("<OrganizationsPanel>", () => {
  it("deletes an organization only once its slug is typed", async () => {
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path === "/admin/organizations" ? [row("osw", 1)] : undefined),
    );
    render(<OrganizationsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("button", { name: "Delete organization" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type osw to confirm"), { target: { value: "os" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type osw to confirm"), { target: { value: "osw" } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/organizations/osw", { method: "DELETE" }),
    );
  });

  it("offers to name an org manager on an organization flagged without one only", async () => {
    api.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/admin/organizations"
          ? [row("orphan", 0), row("osw", 1)]
          : path.startsWith("/admin/users")
            ? [{ id: "u1", username: "ana" }]
            : {},
      ),
    );
    render(<OrganizationsPanel />);

    const field = await screen.findByLabelText("New org manager of orphan (username)");
    expect(screen.queryByLabelText("New org manager of osw (username)")).toBeNull();
    fireEvent.change(field, { target: { value: "ana" } });
    fireEvent.click(await screen.findByRole("option", { name: "ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Name org manager" }));

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/admin/organizations/orphan/managers", {
        method: "POST",
        body: JSON.stringify({ username: "ana" }),
      }),
    );
  });
});
