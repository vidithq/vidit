import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  user: null as { id: string; username: string } | null,
}));

vi.mock("@/lib/api", () => ({ apiFetch: api.apiFetch }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.user, loading: false }),
}));

import { AdminProvider, useAdmin } from "./AdminContext";

function Probe({ name }: { name: string }) {
  const { isAdmin, loading } = useAdmin();
  return <p>{`${name}: ${loading ? "loading" : isAdmin ? "admin" : "not admin"}`}</p>;
}

function Readers() {
  return (
    <AdminProvider>
      <Probe name="sidebar" />
      <Probe name="approvals" />
      <Probe name="page" />
    </AdminProvider>
  );
}

const adminProbes = () => api.apiFetch.mock.calls.filter(([path]) => path === "/admin/me").length;

beforeEach(() => {
  api.apiFetch.mockReset();
  api.user = null;
});

describe("<AdminProvider>", () => {
  it("shares one /admin/me probe between every reader", async () => {
    api.user = { id: "u1", username: "mod" };
    api.apiFetch.mockResolvedValue({ is_admin: true });
    render(<Readers />);

    expect(await screen.findByText("sidebar: admin")).toBeInTheDocument();
    expect(screen.getByText("approvals: admin")).toBeInTheDocument();
    expect(screen.getByText("page: admin")).toBeInTheDocument();
    expect(adminProbes()).toBe(1);
  });

  it("reads a refused probe as not an admin", async () => {
    api.user = { id: "u2", username: "bo" };
    api.apiFetch.mockRejectedValue(new Error("Forbidden"));
    render(<Readers />);

    await waitFor(() => expect(screen.getByText("sidebar: not admin")).toBeInTheDocument());
    expect(adminProbes()).toBe(1);
  });

  it("sends no probe while signed out", () => {
    render(<Readers />);
    expect(screen.getByText("sidebar: not admin")).toBeInTheDocument();
    expect(adminProbes()).toBe(0);
  });
});
