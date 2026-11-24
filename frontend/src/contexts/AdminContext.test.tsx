import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; is_admin: boolean } | null,
  loading: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, loading: session.loading }),
}));

import { useAdmin } from "./AdminContext";

function Probe() {
  const { isAdmin, loading } = useAdmin();
  return <p>{loading ? "loading" : isAdmin ? "admin" : "not admin"}</p>;
}

beforeEach(() => {
  session.user = null;
  session.loading = false;
});

describe("useAdmin", () => {
  it("reads the role from the session", () => {
    session.user = { id: "u1", is_admin: true };
    render(<Probe />);
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("reads an analyst without the role as not an admin", () => {
    session.user = { id: "u2", is_admin: false };
    render(<Probe />);
    expect(screen.getByText("not admin")).toBeInTheDocument();
  });

  it("stays loading until the session resolves", () => {
    session.loading = true;
    render(<Probe />);
    expect(screen.getByText("loading")).toBeInTheDocument();
  });
});
