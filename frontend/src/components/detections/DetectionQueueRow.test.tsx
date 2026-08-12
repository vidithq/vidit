import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetectionQueueRow } from "./DetectionQueueRow";
import { FIELD_HELP } from "@/lib/fieldHelp";
import type { EventDetail } from "@/types";

function draftFixture(overrides: Partial<EventDetail> = {}): EventDetail {
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
    is_demo: false,
    status: "detected",
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
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
    investigator_count: 0,
    investigators: [],
    ...overrides,
  };
}

describe("DetectionQueueRow", () => {
  it("badges a draft carrying the whole evidence floor as ready to review", () => {
    render(<DetectionQueueRow draft={draftFixture()} />);
    // "Ready to review", never a bare "Ready": the draft still needs the
    // conflict and the capture source, which a review supplies. What the state
    // means is the queue filter's own `?`, so a ready row carries the label and
    // nothing else.
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    // Title, event date and source host: the whole row, nothing else.
    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.getByText("t.me")).toBeInTheDocument();
    // One click, to the full form.
    expect(screen.getByRole("link", { name: "Strike near Bakhmut" })).toHaveAttribute(
      "href",
      "/events/d1/edit"
    );
  });

  it("names the one piece a draft is missing, and what to do about it", () => {
    render(
      <DetectionQueueRow
        draft={draftFixture({ proof: { type: "doc", content: [{ type: "paragraph" }] } })}
      />
    );
    expect(screen.queryByText("Ready to review")).not.toBeInTheDocument();
    expect(screen.getByText("Missing: Proof image")).toBeInTheDocument();
    // A named badge still earns a `?`: the name alone doesn't say that a review
    // can't fill it in.
    fireEvent.focus(
      screen.getByRole("button", { name: FIELD_HELP.detection_missing.label })
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Still missing: Proof image. A review can't supply it, so open the draft on the full form to fill it in."
    );
  });

  it("collapses several missing pieces to a count, with the list behind the `?`", () => {
    render(
      <DetectionQueueRow
        draft={draftFixture({
          proof: { type: "doc", content: [{ type: "paragraph" }] },
          media: [],
        })}
      />
    );
    // The row stays dense whatever the import missed; the names sit behind the
    // `?` rather than growing the badge to three lines.
    expect(screen.getByText("Missing: 2 pieces")).toBeInTheDocument();
    fireEvent.focus(
      screen.getByRole("button", { name: FIELD_HELP.detection_missing.label })
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Still missing: Source media, Proof image. A review can't supply them, so open the draft on the full form to fill it in."
    );
  });

  it("says so when the draft declares no source and no event date", () => {
    render(
      <DetectionQueueRow
        draft={draftFixture({ source_url: null, event_date: null })}
      />
    );
    expect(screen.getByText("Missing: Source URL")).toBeInTheDocument();
    expect(screen.getByText("No event date")).toBeInTheDocument();
    // A source-less draft says so rather than rendering an empty host.
    expect(screen.getByText("To confirm")).toBeInTheDocument();
  });
});
