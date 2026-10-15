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
const CY = { id: "u3", username: "cy" };

const shared = { ...eventDetail("e1", "Bridge strike"), geolocators: [ANA, BO] };

describe("<GeolocatorsPanel>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.viewer = ANA;
  });

  it("gives the owner remove, withdraw and invite, and keeps the owner's row inert", async () => {
    api.apiFetch.mockResolvedValue([{ user: CY, created_at: "2026-10-15T09:00:00Z" }]);
    render(<GeolocatorsPanel event={shared} onChanged={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Invite a geolocator"), {
      target: { value: "dee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/geolocator-invites", {
        method: "POST",
        body: JSON.stringify({ username: "dee" }),
      }),
    );
  });

  it("lets a co-geolocator leave and nothing more", async () => {
    api.viewer = BO;
    api.apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<GeolocatorsPanel event={shared} onChanged={onChanged} />);

    expect(screen.queryByLabelText("Invite a geolocator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/geolocators/bo", { method: "DELETE" });
  });
});
