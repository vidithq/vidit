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

function Rail({ invited }: { invited: boolean }) {
  const event = {
    ...eventDetail("e1", "Bridge strike"),
    owner: { id: "u1", username: "ana" },
    viewer_invite_pending: invited,
  };
  const { rail } = useEventActions({ event, surface: "event" });
  return <>{rail}</>;
}

describe("useEventActions invitation", () => {
  it("shows the invitation in the rail from the event read, without asking the invitation list", () => {
    render(<Rail invited />);

    expect(screen.getByText("Geolocator invitation")).toBeInTheDocument();
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("geolocator-invites"),
      expect.anything(),
    );
    expect(api.apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("geolocator-invites"));
  });

  it("puts the invitation under the row of actions", () => {
    render(<Rail invited />);

    const row = screen.getByRole("group", { name: "Event actions" });
    const card = screen.getByText("Geolocator invitation");
    expect(row.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows nothing to a reader without an invitation", () => {
    render(<Rail invited={false} />);

    expect(screen.queryByText("Geolocator invitation")).toBeNull();
  });
});
