import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Item } from "@/components/ui/Item";
import { detectionItem } from "./detectionItem";
import { source } from "@/test/eventDetail";
import type { EventDetail } from "@/types";

const MEDIA = {
  id: "m1",
  role: "source" as const,
  storage_url: "/local-storage/evidence.jpg",
  kind: "image" as const,
  sha256: "0".repeat(64),
};

const SOURCE = source({ media: MEDIA });

function detectionFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "d1",
    title: "Strike near Bakhmut",
    coords: { lat: 48.5, lng: 37.8 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    status: "detected",
    version_no: 1,
    is_graphic: false,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: "https://x.com/analyst/status/1",
    detected_via: null,
    owner: { id: "u1", username: "ana" },
    tags: [],
    conflicts: [],
    sources: [SOURCE],
    proof: '<img src="https://cdn.test/p.jpg">',
    created_at: "2026-06-02T10:00:00Z",
    hidden_at: null,
    geolocated_at: null,
    closed_at: null,
    thumbnail: MEDIA,
    requested_by: null,
    geolocators: [],
    ...overrides,
  };
}

function QueueRow({ detection }: { detection: EventDetail }) {
  return <Item variant="list" {...detectionItem(detection)} />;
}

describe("detectionItem", () => {
  it("badges a detection carrying the whole evidence floor as ready to review", () => {
    render(<QueueRow detection={detectionFixture()} />);
    // "Ready to review", never a bare "Ready": the detection still needs the conflict. The queue
    // filter's `?` explains the state, so the row has nothing to hover or press.
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("[title]")).toBeNull();
    expect(screen.getByText("Strike near Bakhmut")).toBeInTheDocument();
    expect(screen.getByText("t.me")).toBeInTheDocument();
    // The link is stretched over the row, so a middle click or a new tab opens it from anywhere on
    // it: to the form, inside a review pass starting at this detection.
    const row = screen.getByRole("link", { name: "Strike near Bakhmut" });
    expect(row).toHaveAttribute("href", "/events/d1/edit?queue=1");
  });

  it("says which entry the detection came in from, beside the date and the host", () => {
    render(<QueueRow detection={detectionFixture({ detected_via: "archive" })} />);
    expect(screen.getByText("From your archive")).toBeInTheDocument();
  });

  it("says nothing about the entry when the detection predates the record", () => {
    render(<QueueRow detection={detectionFixture({ detected_via: null })} />);
    // Absent rather than "Unknown": a triage line is better one segment short than saying nothing.
    expect(screen.queryByText(/archive|Pasted|bot/)).toBeNull();
  });

  it("names the one piece an incomplete detection is missing", () => {
    render(
      <QueueRow
        detection={detectionFixture({ proof: "<p></p>" })}
      />
    );
    expect(screen.queryByText("Ready to review")).not.toBeInTheDocument();
    // The common case is one missing piece, and its name tells the analyst whether the row is worth opening.
    expect(screen.getByText("Incomplete: Proof image")).toBeInTheDocument();
  });

  it("collapses several missing pieces to a count", () => {
    render(
      <QueueRow
        detection={detectionFixture({
          proof: "<p></p>",
          sources: [{ ...SOURCE, media: null }],
        })}
      />
    );
    // The row stays dense whatever the import missed: three joined names outgrow it, and the edit form names them in place.
    expect(screen.getByText("Incomplete: 2 pieces")).toBeInTheDocument();
  });

  it("says so when the detection declares no source and no event date", () => {
    render(
      <QueueRow
        detection={detectionFixture({ sources: [], occurred_date: null })}
      />
    );
    expect(screen.getByText("Incomplete: Source file")).toBeInTheDocument();
    expect(screen.getByText("No event date")).toBeInTheDocument();
    // The badge already says the source is missing, so the line names no host and no second state.
    expect(screen.queryByText(/no source|To confirm/)).toBeNull();
  });
});
