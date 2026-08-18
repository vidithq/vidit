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
  // The one owner verb of the event page is a visible icon, not a menu entry:
  // a `⋯` holding a single non-destructive entry hides the author's most used
  // control for nothing.
  it("offers the published correction on the event surface as a visible icon, and no menu", () => {
    render(<Harness status="geolocated" surface="event" />);
    expect(screen.getByRole("link", { name: "Edit this geolocation" })).toHaveAttribute(
      "href",
      "/events/e1/edit"
    );
    expect(ownerMenuItems()).toEqual([]);
  });

  it.each<EventStatus>(["requested", "closed", "detected"])(
    "shows no edit icon on the event surface for a %s row",
    (status) => {
      render(<Harness status={status} surface="event" />);
      expect(screen.queryByRole("link", { name: "Edit this geolocation" })).toBeNull();
    }
  );

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

  it("gives the map panel the utilities alone", () => {
    render(<Harness status="geolocated" surface="panel" />);
    expect(ownerMenuItems()).toEqual([]);
    expect(screen.getByRole("button", { name: "Share on X" })).toBeInTheDocument();
  });
});

describe("utilities are the reading surfaces' tier", () => {
  // Passing an event on and flagging it are reads, so every surface that shows
  // a record to read carries them.
  it.each<ActionSurface>(["event", "request", "panel"])(
    "carries the X share and the report flag on the %s surface",
    (surface) => {
      render(<Harness status="geolocated" surface={surface} />);
      expect(screen.getByRole("button", { name: "Share on X" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
    }
  );

  // The form is where a record is rewritten, so sharing or reporting it there
  // would act on something other than what is on screen.
  it("carries none on the edit surface, and no row at all", () => {
    const { container } = render(<Harness status="geolocated" surface="edit" />);
    expect(screen.queryByRole("button", { name: "Share on X" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    expect(ownerMenuItems()).toEqual([]);
    // Not merely empty: an empty wrapper is still a flex item, and the form
    // adds its own controls (the queue position, Skip, Reject) to that cluster.
    expect(container).toBeEmptyDOMElement();
  });

  // The link is in the address bar the reader is already looking at; the
  // coordinates, which are not, keep their own copy control.
  it("offers no copy-link control anywhere", () => {
    for (const surface of ["event", "request", "panel"] as const) {
      const { unmount } = render(
        <Harness status="geolocated" surface={surface} />
      );
      expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
      unmount();
    }
  });
});
