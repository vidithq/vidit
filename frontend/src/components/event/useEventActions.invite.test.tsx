import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { eventDetail } from "@/test/eventDetail";
import { useEventActions } from "./useEventActions";

// The approvals read the event page makes stays in flight; these tests read the invitation only.
const api = vi.hoisted(() => ({ apiFetch: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  apiFetchPage: vi.fn(),
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u2", username: "bo" } }),
}));

function Actions({ invited }: { invited: boolean }) {
  const event = {
    ...eventDetail("e1", "Bridge strike"),
    owner: { id: "u1", username: "ana" },
    viewer_invite_pending: invited,
  };
  const { actions } = useEventActions({ event, surface: "event" });
  return <>{actions}</>;
}

describe("useEventActions invitation", () => {
  it("shows the invitation in the actions from the event read, without asking the invitation list", () => {
    render(<Actions invited />);

    expect(screen.getByText("Geolocator invitation")).toBeInTheDocument();
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("geolocator-invites"),
      expect.anything(),
    );
    expect(api.apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("geolocator-invites"));
  });

  it("puts the invitation under the row of actions", () => {
    render(<Actions invited />);

    const row = screen.getByRole("group", { name: "Event actions" });
    const card = screen.getByText("Geolocator invitation");
    expect(row.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows nothing to a reader without an invitation", () => {
    render(<Actions invited={false} />);

    expect(screen.queryByText("Geolocator invitation")).toBeNull();
  });
});
