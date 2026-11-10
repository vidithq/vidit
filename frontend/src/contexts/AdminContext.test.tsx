import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/test/apiStub";

const session = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock("@/lib/api", () => import("@/test/apiStub"));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, loading: false }),
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

const adminProbes = () => apiFetch.mock.calls.filter(([path]) => path === "/admin/me").length;

beforeEach(() => {
  session.user = null;
});

describe("<AdminProvider>", () => {
  it("shares one /admin/me probe between every reader", async () => {
    session.user = { id: "u1", username: "mod" };
    apiFetch.mockResolvedValue({ is_admin: true });
    render(<Readers />);

    expect(await screen.findByText("sidebar: admin")).toBeInTheDocument();
    expect(screen.getByText("approvals: admin")).toBeInTheDocument();
    expect(screen.getByText("page: admin")).toBeInTheDocument();
    expect(adminProbes()).toBe(1);
  });

  it("reads a refused probe as not an admin", async () => {
    session.user = { id: "u2", username: "bo" };
    apiFetch.mockRejectedValue(new Error("Forbidden"));
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
