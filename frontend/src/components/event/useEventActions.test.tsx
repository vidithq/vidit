import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEventActions, type ActionSurface } from "./useEventActions";
import type { BeforeClosedStatus, EventDetail, EventStatus } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The signed-in reader IS the row's author in every case below, which is the
// only interesting one here: the owner tier is what the surfaces disagree on.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "ana" } }),
}));

function eventFixture(
  status: EventStatus,
  beforeClosedStatus: BeforeClosedStatus | null = null
): EventDetail {
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
    before_closed_status: beforeClosedStatus,
    detected_from_url: null,
    detected_via: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: null,
    created_at: "2026-06-02T10:00:00Z",
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
  beforeClosedStatus = null,
}: {
  status: EventStatus;
  surface: ActionSurface;
  beforeClosedStatus?: BeforeClosedStatus | null;
}) {
  const { actions, panels } = useEventActions({
    event: eventFixture(status, beforeClosedStatus),
    surface,
  });
  return (
    <>
      {actions}
      {panels}
    </>
  );
}

/** The close control the row is showing, as its accessible name, or `null`.
 *  Every owner verb is a button in the row, so there is nothing to open first. */
function closeControl(): string | null {
  for (const name of [
    "Close this request",
    "Close this detection",
    "Close this geolocation",
    "Close this event",
  ]) {
    if (screen.queryByRole("button", { name }) !== null) return name;
  }
  return null;
}

/** No surface offers a destructive verb: an owner takes a row back, an admin
 *  removes it. Matched loosely so a delete control under any wording fails. */
function hasDeleteControl(): boolean {
  return screen.queryByRole("button", { name: /delete/i }) !== null;
}

describe("owner management: correcting, taking back, and never destroying", () => {
  // Every owner verb is a control in the row: the author's own actions are the
  // ones they reach for most, and a disclosure over them costs a click per use.
  it("offers the published correction on the event surface as a visible icon", () => {
    render(<Harness status="geolocated" surface="event" />);
    expect(screen.getByRole("link", { name: "Edit this geolocation" })).toHaveAttribute(
      "href",
      "/events/e1/edit"
    );
  });

  it.each<EventStatus>(["requested", "closed", "detected"])(
    "shows no edit icon on the event surface for a %s row",
    (status) => {
      render(<Harness status={status} surface="event" />);
      expect(screen.queryByRole("link", { name: "Edit this geolocation" })).toBeNull();
    }
  );

  // One verb closes all three live states, and the noun names the row it
  // closes, so a reader learns one word rather than three.
  it.each<[EventStatus, string]>([
    ["requested", "Close this request"],
    ["detected", "Close this detection"],
    ["geolocated", "Close this geolocation"],
  ])("names the row a %s close applies to", (status, label) => {
    render(<Harness status={status} surface="event" />);
    expect(closeControl()).toBe(label);
  });

  it.each<ActionSurface>(["event", "request"])(
    "carries the close verb on the %s surface",
    (surface) => {
      render(<Harness status="requested" surface={surface} />);
      expect(closeControl()).toBe("Close this request");
    }
  );

  // Closing is terminal and there is no owner un-close, so the verb goes once
  // it has been taken.
  it.each<ActionSurface>(["event", "request"])(
    "offers nothing to close on a closed row (%s surface)",
    (surface) => {
      render(<Harness status="closed" surface={surface} beforeClosedStatus="requested" />);
      expect(closeControl()).toBeNull();
    }
  );

  // Destruction is admin-only, so no surface and no status shows a delete.
  it.each<EventStatus>(["requested", "detected", "geolocated", "closed"])(
    "offers no delete for a %s row on either detail surface",
    (status) => {
      for (const surface of ["event", "request"] as const) {
        const { unmount } = render(<Harness status={status} surface={surface} />);
        expect(hasDeleteControl()).toBe(false);
        unmount();
      }
    }
  );

  // The reason is what makes a closed row readable as a decision rather than a
  // disappearance, so the panel that captures it opens named for the row.
  it("opens the close panel named for the row it closes", () => {
    render(<Harness status="geolocated" surface="event" />);
    fireEvent.click(screen.getByRole("button", { name: "Close this geolocation" }));
    expect(screen.getByLabelText("Close reason")).toBeInTheDocument();
    // The panel's own submit repeats the label, so the reader confirms the row
    // they picked rather than a bare "Close".
    expect(screen.getAllByRole("button", { name: "Close this geolocation" })).toHaveLength(2);
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
      expect(closeControl()).toBeNull();
      // Not merely empty: an empty wrapper is still a flex item, and a host
      // adds its own controls (the form's queue position, Skip, Close) to
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

  // A retraction keeps the record it took back, and the history is the part of
  // it a reader most needs after one.
  it("keeps the version history on a retracted row", () => {
    render(<Harness status="closed" surface="event" beforeClosedStatus="geolocated" />);
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      "/events/e1/history"
    );
  });

  it.each<[EventStatus, BeforeClosedStatus | null]>([
    ["requested", null],
    ["detected", null],
    ["closed", "requested"],
    ["closed", "detected"],
  ])("offers no version history for a %s row, which never published", (status, before) => {
    render(<Harness status={status} surface="event" beforeClosedStatus={before} />);
    expect(screen.queryByRole("link", { name: "Version history" })).toBeNull();
  });

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
