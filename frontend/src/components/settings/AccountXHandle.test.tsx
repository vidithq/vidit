import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { x_handle: null as string | null } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: session.user }) }));

import { AccountXHandle } from "./AccountXHandle";

describe("AccountXHandle", () => {
  it("shows the bound handle read-only", () => {
    session.user = { x_handle: "osint_hawk" };
    render(<AccountXHandle />);

    expect(screen.getByText("@osint_hawk")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The only button is the label's help.
    expect(screen.getByRole("button")).toHaveAccessibleName("What is the X handle for?");
  });

  it("says so when no handle is linked", () => {
    session.user = { x_handle: null };
    render(<AccountXHandle />);

    expect(screen.getByText("No X handle linked")).toBeInTheDocument();
  });
});
