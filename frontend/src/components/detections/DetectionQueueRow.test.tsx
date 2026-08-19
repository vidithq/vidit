import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetectionQueueRow } from "./DetectionQueueRow";
import type { EventDetail } from "@/types";

function detectionFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    event_coords: { lat: 48.5, lng: 37.8 },
    capture_source_coords: null,
    archived_source: null,
    archived_detected_from: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    status: "detected",
    version_no: 1,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    detected_post_at: "2026-05-30T15:00:00Z",
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
    proof: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://cdn.test/p.jpg" } }],
    },
    created_at: "2026-06-02T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    requested_at: null,
    detected_at: "2026-06-02T10:00:00Z",
    geolocated_at: null,
    closed_at: null,
    media: [
      {
        id: "m1",
        storage_url: "/local-storage/evidence.jpg",
        media_type: "image",
        role: "source",
      },
    ],
    thumbnail: {
      id: "m1",
      storage_url: "/local-storage/evidence.jpg",
      media_type: "image",
      role: "source",
    },
    requested_by: null,
    geolocators: [],
    ...overrides,
  };
}

describe("DetectionQueueRow", () => {
  it("badges a detection carrying the whole evidence floor as ready to review", () => {
    render(<DetectionQueueRow detection={detectionFixture()} />);
    // "Ready to review", never a bare "Ready": the detection still needs the
    // conflict and the capture source, which a review supplies. What the state
    // means is the queue filter's own `?`, so the row carries the label and
    // nothing to hover or press.
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("[title]")).toBeNull();
    // Title, event date and source host: the whole row, nothing else.
    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.getByText("t.me")).toBeInTheDocument();
    // One click, to the form, inside a review pass starting at this detection.
    expect(screen.getByRole("link", { name: "Strike near Bakhmut" })).toHaveAttribute(
      "href",
      "/events/d1/edit?queue=1"
    );
  });

  it("says which entry the detection came in from, beside the date and the host", () => {
    render(<DetectionQueueRow detection={detectionFixture({ detected_via: "archive" })} />);
    expect(screen.getByText("From your archive")).toBeInTheDocument();
  });

  it("says nothing about the entry when the detection predates the record", () => {
    render(<DetectionQueueRow detection={detectionFixture({ detected_via: null })} />);
    // Absent rather than "Unknown": the row is a triage line, and a segment
    // saying nothing is worse than one segment fewer.
    expect(screen.queryByText(/archive|Pasted|bot/)).toBeNull();
  });

  it("names the one piece a detection is missing", () => {
    render(
      <DetectionQueueRow
        detection={detectionFixture({ proof: { type: "doc", content: [{ type: "paragraph" }] } })}
      />
    );
    expect(screen.queryByText("Ready to review")).not.toBeInTheDocument();
    // The common case is one piece, and its name is what tells the analyst
    // whether the row is worth opening.
    expect(screen.getByText("Missing: Proof image")).toBeInTheDocument();
  });

  it("collapses several missing pieces to a count", () => {
    render(
      <DetectionQueueRow
        detection={detectionFixture({
          proof: { type: "doc", content: [{ type: "paragraph" }] },
          media: [],
        })}
      />
    );
    // The row stays dense whatever the import missed: three names joined into
    // one badge outgrow it, and the edit form names them in place.
    expect(screen.getByText("Missing: 2 pieces")).toBeInTheDocument();
  });

  it("says so when the detection declares no source and no event date", () => {
    render(
      <DetectionQueueRow
        detection={detectionFixture({ source_url: null, event_date: null })}
      />
    );
    expect(screen.getByText("Missing: Source URL")).toBeInTheDocument();
    expect(screen.getByText("No event date")).toBeInTheDocument();
    // A source-less detection says so rather than rendering an empty host.
    expect(screen.getByText("To confirm")).toBeInTheDocument();
  });
});
