import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_EVENT_GEOLOCATORS } from "@/lib/geolocatorCredit";
import { eventDetail } from "@/test/eventDetail";

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  invites: [] as { user: { id: string; username: string }; invited_at: string }[],
}));

vi.mock("@/lib/api", () => ({
  apiFetch: api.apiFetch,
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
  ApiError: class extends Error {},
}));
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({ data: api.invites, error: null, refetch: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

import { GeolocatorsByline, useDraftGeolocatorsByline } from "./useGeolocatorsByline";

const ANA = { id: "u1", username: "ana" };
const BO = { id: "u2", username: "bo" };
const CY = { id: "u3", username: "cy" };

const shared = { ...eventDetail("e1", "Bridge strike"), geolocators: [ANA, BO] };

/** Open the add button's popover and commit `username` with Enter. */
function pick(username: string) {
  const add = screen.getByRole("button", { name: "Invite a geolocator" });
  if (add.getAttribute("aria-expanded") !== "true") fireEvent.click(add);
  const field = within(screen.getByRole("dialog", { name: "Invite a geolocator" })).getByRole(
    "combobox",
  );
  fireEvent.change(field, { target: { value: username } });
  fireEvent.keyDown(field, { key: "Enter" });
}

describe("<GeolocatorsByline>", () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
    api.apiFetch.mockResolvedValue(undefined);
    api.invites = [{ user: CY, invited_at: "2026-10-15T09:00:00Z" }];
  });

  it("shows the owner, a co-geolocator and a faded pending invitation on one line", () => {
    render(<GeolocatorsByline event={shared} onChanged={vi.fn()} />);

    const pictures = screen.getByRole("list", { name: "Co-geolocators" });
    expect(within(pictures).getByRole("link", { name: "bo" })).toBeInTheDocument();
    const pending = within(pictures).getByRole("link", { name: "cy, invitation pending" });
    expect(pending).toHaveClass("opacity-50");
    // The owner leads the line and has no picture of their own to remove.
    expect(screen.queryByRole("button", { name: "Remove ana" })).toBeNull();
    // Nothing opens in the page: no card, no heading.
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("asks before it removes a co-geolocator or withdraws an invitation", async () => {
    const onChanged = vi.fn();
    render(<GeolocatorsByline event={shared} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove bo" }));
    expect(api.apiFetch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Remove bo?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/geolocators/bo", { method: "DELETE" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Withdraw the invitation of cy" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.apiFetch).not.toHaveBeenCalledWith(
      "/events/e1/geolocator-invites/cy",
      expect.anything(),
    );
  });

  it("invites from the popover, which closes once the invitation lands", async () => {
    render(<GeolocatorsByline event={shared} onChanged={vi.fn()} />);

    pick("dee");
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/events/e1/geolocator-invites", {
        method: "POST",
        body: JSON.stringify({ username: "dee" }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the popover open on a refusal and says why", async () => {
    api.apiFetch.mockRejectedValue(new Error("No analyst with that username"));
    render(<GeolocatorsByline event={shared} onChanged={vi.fn()} />);

    pick("nobody");
    const dialog = screen.getByRole("dialog", { name: "Invite a geolocator" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No analyst with that username");
  });

  it("refuses a pick past the cap without asking the server", () => {
    // The owner, bo, cy pending, and seven more pending: ten held.
    api.invites = [CY, ...Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, username: `p${i}` }))].map(
      (user) => ({ user, invited_at: "2026-10-15T09:00:00Z" }),
    );
    render(<GeolocatorsByline event={shared} onChanged={vi.fn()} />);

    pick("dee");
    expect(screen.getByRole("alert")).toHaveTextContent(`at most ${MAX_EVENT_GEOLOCATORS} geolocators`);
    expect(api.apiFetch).not.toHaveBeenCalled();
  });
});

function Draft({ onInvitees }: { onInvitees: (names: string[]) => void }) {
  const { byline, invitees } = useDraftGeolocatorsByline();
  onInvitees(invitees);
  return <>{byline}</>;
}

describe("useDraftGeolocatorsByline", () => {
  it("collects the picks in the byline, sends nothing, and removes a pick at once", () => {
    let invitees: string[] = [];
    render(<Draft onInvitees={(names) => (invitees = names)} />);

    pick("dee");
    pick("eve");
    expect(invitees).toEqual(["dee", "eve"]);
    expect(screen.getByRole("img", { name: "dee, invited when you publish" })).toHaveClass(
      "opacity-50",
    );
    expect(api.apiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove eve" }));
    expect(invitees).toEqual(["dee"]);
  });

  it("refuses yourself and a repeat in the popover", () => {
    render(<Draft onInvitees={() => {}} />);

    pick("ana");
    expect(screen.getByRole("alert")).toHaveTextContent("already a geolocator");
    pick("dee");
    pick("dee");
    expect(screen.getByRole("alert")).toHaveTextContent("already invited");
  });

  it("stops at the cap, the reader included", () => {
    let invitees: string[] = [];
    render(<Draft onInvitees={(names) => (invitees = names)} />);

    for (let i = 1; i < MAX_EVENT_GEOLOCATORS; i++) pick(`p${i}`);
    expect(invitees).toHaveLength(MAX_EVENT_GEOLOCATORS - 1);
    pick("one-more");
    expect(screen.getByRole("alert")).toHaveTextContent(`at most ${MAX_EVENT_GEOLOCATORS} geolocators`);
    expect(invitees).toHaveLength(MAX_EVENT_GEOLOCATORS - 1);
  });
});
