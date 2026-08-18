import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEventActions, type ActionSurface } from "./useEventActions";
import type { EventDetail, EventStatus } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The signed-in reader IS the row's author in every case below, which is the
// only interesting one here: the owner tier is what the surfaces disagree on.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

function eventFixture(status: EventStatus): EventDetail {
  return {
    id: "e1",
    title: "Strike near Bakhmut",
    event_coords: { lat: 48.5, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    archived_detected_from: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    status,
    revision_no: 1,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: null,
    detected_via: null,
    detected_post_at: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: null,
    created_at: "2026-06-02T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    requested_at: null,
    detected_at: null,
    geolocated_at: null,
    closed_at: null,
    media: [],
    thumbnail: null,
    requested_by: null,
    geolocators: [],
  };
}

function Harness({
  status,
  surface,
}: {
  status: EventStatus;
  surface: ActionSurface;
}) {
  const { actions, panels } = useEventActions({
    event: eventFixture(status),
    surface,
  });
  return (
    <>
      {actions}
      {panels}
    </>
  );
}

/** The owner menu's entries, as labels. Empty when the ⋯ never renders. */
function ownerMenuItems(): string[] {
  const disclosure = screen.queryByRole("button", { name: "More actions" });
  if (disclosure === null) return [];
  fireEvent.click(disclosure);
  return screen.queryAllByRole("menuitem").map((item) => item.textContent ?? "");
}

describe("owner management is scoped to the surface that owns the verb", () => {
  it("offers the published correction on the event surface, and nothing else", () => {
    render(<Harness status="geolocated" surface="event" />);
    expect(ownerMenuItems()).toEqual(["Edit this geolocation"]);
  });

  // `/events/{id}` serves a row of ANY status, so the request verbs must not
  // appear there just because the reader owns the row: a requested or closed
  // event opened by id is not the request surface.
  it.each<EventStatus>(["requested", "closed", "detected"])(
    "offers no request verb on the event surface for a %s row",
    (status) => {
      render(<Harness status={status} surface="event" />);
      expect(ownerMenuItems()).toEqual([]);
      expect(screen.queryByText("Close this request")).toBeNull();
      expect(screen.queryByText("Delete this request")).toBeNull();
    }
  );

  it("keeps closing and deleting on the request surface", () => {
    render(<Harness status="requested" surface="request" />);
    expect(ownerMenuItems()).toEqual([
      "Close this request",
      "Delete this request",
    ]);
  });

  it("leaves a closed request deletable on the request surface", () => {
    render(<Harness status="closed" surface="request" />);
    expect(ownerMenuItems()).toEqual(["Delete this request"]);
  });

  it("gives the map panel and the edit form the utilities alone", () => {
    for (const surface of ["panel", "edit"] as const) {
      const { unmount } = render(
        <Harness status="geolocated" surface={surface} />
      );
      expect(ownerMenuItems()).toEqual([]);
      unmount();
    }
  });
});
