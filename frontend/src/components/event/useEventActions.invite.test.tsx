import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ANA } from "@/test/auth";
import { apiFetch } from "@/test/apiStub";
import { eventDetail } from "@/test/eventDetail";
import { useEventActions } from "./useEventActions";

// The approvals read the event page makes stays in flight; these tests read the invitation only.
vi.mock("@/lib/api", () => import("@/test/apiStub"));
vi.mock("next/navigation", () => import("@/test/navigationStub"));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u2", username: "bo" } }),
}));

function Actions({ invited }: { invited: boolean }) {
  const event = {
    ...eventDetail("e1", "Bridge strike"),
    owner: ANA,
    viewer_invite_pending: invited,
  };
  const { actions, panels } = useEventActions({ event, surface: "event" });
  return (
    <>
      {actions?.pinned}
      {actions?.below}
      {panels}
    </>
  );
}

const row = () => screen.getByRole("group", { name: "Event actions" });

describe("useEventActions invitation", () => {
  it("shows the invitation from the event read, without asking the invitation list", () => {
    render(<Actions invited />);

    expect(screen.getByText("Geolocator invitation")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("geolocator-invites"),
      expect.anything(),
    );
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("geolocator-invites"));
  });

  it("puts Accept and Decline in the actions row, and what the invitation offers under it", () => {
    render(<Actions invited />);

    expect(
      within(row())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent)
        .slice(-2),
    ).toEqual(["Accept", "Decline"]);
    const card = screen.getByText("Geolocator invitation");
    expect(row()).not.toContainElement(card);
    // The row carries the answer, so the card does not point at it.
    expect(card.closest("section")).not.toHaveTextContent(/Accept|decline/);
    expect(row().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows nothing to a reader without an invitation", () => {
    render(<Actions invited={false} />);

    expect(screen.queryByText("Geolocator invitation")).toBeNull();
    expect(within(row()).queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
