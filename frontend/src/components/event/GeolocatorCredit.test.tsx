import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventDetail } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  viewer: { id: "u1", username: "ana" },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: api.viewer }),
}));

import { GeolocatorsPanel } from "./GeolocatorCredit";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };

const shared = { ...eventDetail("e1", "Bridge strike"), geolocators: [ANA, BO] };

describe("<GeolocatorsPanel>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.viewer = BO;
  });

  it("lets a co-geolocator leave and nothing more", async () => {
    api.apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<GeolocatorsPanel event={shared} onChanged={onChanged} />);

    expect(screen.queryByLabelText("Invite a geolocator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    // The first click arms in place and sends nothing.
    expect(api.apiFetch).not.toHaveBeenCalledWith("/events/e1/geolocators/bo", { method: "DELETE" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/geolocators/bo", { method: "DELETE" });
  });
});
