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
    version_no: 1,
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

/** The owner verbs the row is showing, as accessible names. Every one of them
 *  is a button in the row, so there is nothing to open first. */
function ownerControls(): string[] {
  return ["Close this request", "Delete this request"].filter(
    (name) => screen.queryByRole("button", { name }) !== null
  );
}

describe("owner management is scoped to the surface that owns the verb", () => {
  // Every owner verb is a control in the row: the author's own actions are the
  // ones they reach for most, and a disclosure over them costs a click per use.
  it("offers the published correction on the event surface as a visible icon", () => {
    render(<Harness status="geolocated" surface="event" />);
    expect(screen.getByRole("link", { name: "Edit this geolocation" })).toHaveAttribute(
      "href",
      "/events/e1/edit"
    );
    expect(ownerControls()).toEqual([]);
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
      expect(ownerControls()).toEqual([]);
    }
  );

  it("keeps closing and deleting on the request surface, in the row", () => {
    render(<Harness status="requested" surface="request" />);
    expect(ownerControls()).toEqual([
      "Close this request",
      "Delete this request",
    ]);
  });

  it("leaves a closed request deletable on the request surface", () => {
    render(<Harness status="closed" surface="request" />);
    expect(ownerControls()).toEqual(["Delete this request"]);
  });

  // The row is gone for good, so the destructive verb asks twice rather than
  // firing on the click that reached it.
  it("arms the delete before it fires, and says so", () => {
    render(<Harness status="requested" surface="request" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete this request" }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/cannot be undone/);
  });

  it("gives the map panel no action row at all", () => {
    const { container } = render(<Harness status="geolocated" surface="panel" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("utilities are the detail pages' tier", () => {
  // Passing an event on and flagging it are reads, so the pages that show a
  // record to read carry them.
  it.each<ActionSurface>(["event", "request"])(
    "carries the X share and the report flag on the %s surface",
    (surface) => {
      render(<Harness status="geolocated" surface={surface} />);
      expect(screen.getByRole("button", { name: "Share on X" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
    }
  );

  // The form is where a record is rewritten, so sharing or reporting it there
  // would act on something other than what is on screen; the map panel is a
  // preview of a page one click away, which is where its actions live.
  it.each<ActionSurface>(["edit", "panel"])(
    "carries none on the %s surface, and no row at all",
    (surface) => {
      const { container } = render(<Harness status="geolocated" surface={surface} />);
      expect(screen.queryByRole("button", { name: "Share on X" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
      expect(ownerControls()).toEqual([]);
      // Not merely empty: an empty wrapper is still a flex item, and a host
      // adds its own controls (the form's queue position, Skip, Reject) to
      // that cluster.
      expect(container).toBeEmptyDOMElement();
    }
  );

  // The history is a read like the two beside it, public like the record: a
  // corrected record is auditable only where any reader can walk the
  // corrections. It is on the event page and nowhere else, because that is the
  // one surface serving the record whose versions it lists.
  it("opens the version history from the event surface of a published row", () => {
    render(<Harness status="geolocated" surface="event" />);
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      "/events/e1/history"
    );
  });

  it.each<EventStatus>(["requested", "detected", "closed"])(
    "offers no version history for a %s row, which has no versions to walk",
    (status) => {
      render(<Harness status={status} surface="event" />);
      expect(screen.queryByRole("link", { name: "Version history" })).toBeNull();
    }
  );

  it.each<ActionSurface>(["request", "edit", "panel"])(
    "carries no version history on the %s surface",
    (surface) => {
      render(<Harness status="geolocated" surface={surface} />);
      expect(screen.queryByRole("link", { name: "Version history" })).toBeNull();
    }
  );

  // The link is in the address bar the reader is already looking at; the
  // coordinates, which are not, keep their own copy control.
  it("offers no copy-link control anywhere", () => {
    for (const surface of ["event", "request"] as const) {
      const { unmount } = render(
        <Harness status="geolocated" surface={surface} />
      );
      expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
      unmount();
    }
  });
});
