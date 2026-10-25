import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  sessionEnded: true,
  dismissSessionEnded: vi.fn(),
}));
const nav = vi.hoisted(() => ({ pathname: "/events/e1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import SessionEndedNotice from "./SessionEndedNotice";

describe("<SessionEndedNotice>", () => {
  beforeEach(() => {
    auth.user = null;
    auth.sessionEnded = true;
    nav.pathname = "/events/e1";
  });

  it("says the session ended and links to sign in, back to this page", () => {
    render(<SessionEndedNotice />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your session ended. Sign in again.");
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login?next=%2Fevents%2Fe1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(auth.dismissSessionEnded).toHaveBeenCalled();
  });

  it("stays hidden while no session ended, once signed in again, and on the sign-in page", () => {
    auth.sessionEnded = false;
    const { rerender } = render(<SessionEndedNotice />);
    expect(screen.queryByRole("alert")).toBeNull();
    auth.sessionEnded = true;
    auth.user = { id: "u1" };
    rerender(<SessionEndedNotice />);
    expect(screen.queryByRole("alert")).toBeNull();
    auth.user = null;
    nav.pathname = "/login";
    rerender(<SessionEndedNotice />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
