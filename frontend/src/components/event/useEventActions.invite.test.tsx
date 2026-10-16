import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { eventDetail } from "@/test/eventDetail";
import { useEventActions } from "./useEventActions";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
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

function Panels({ invited }: { invited: boolean }) {
  const event = {
    ...eventDetail("e1", "Bridge strike"),
    owner: { id: "u1", username: "ana" },
    viewer_invite_pending: invited,
  };
  const { panels } = useEventActions({ event, surface: "event" });
  return <>{panels}</>;
}

describe("useEventActions invitation", () => {
  it("shows the invitation from the event read, without asking the invitation list", () => {
    render(<Panels invited />);

    expect(screen.getByText("Geolocator invitation")).toBeInTheDocument();
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("geolocator-invites"),
      expect.anything(),
    );
    expect(api.apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("geolocator-invites"));
  });

  it("shows nothing to a reader without an invitation", () => {
    render(<Panels invited={false} />);

    expect(screen.queryByText("Geolocator invitation")).toBeNull();
  });
});
