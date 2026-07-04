import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventDetailBody } from "./EventDetailBody";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { EventDetail } from "@/types";

function geoFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "g1",
    title: "Strike on ammunition depot",
    event_coords: { lat: 48.015883, lng: 37.802411 },
    capture_source_coords: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    is_demo: false,
    status: "geolocated",
    close_reason: null,
    before_closed_status: null,
    detected_from_url: null,
    detected_post_at: null,
    owner: {
      id: "u1",
      username: "ana",
      is_trusted: true,
      trust_reason: "Established track record",
    },
    tags: [{ id: "t1", name: "Ukraine", category: "conflict" }],
    source_url: "https://t.me/channel/12345",
    proof: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Anchor points match the imagery." }],
        },
      ],
    },
    created_at: "2026-06-02T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    requested_at: null,
    detected_at: null,
    geolocated_at: "2026-06-02T10:00:00Z",
    closed_at: null,
    media: [
      {
        id: "m1",
        storage_url: "/local-storage/evidence.jpg",
        media_type: "image",
        role: "source",
      },
    ],
    requested_by: {
      id: "u2",
      username: "poster",
      is_trusted: false,
      trust_reason: null,
    },
    geolocators: [],
    investigator_count: 0,
    investigators: [],
    ...overrides,
  };
}

describe("EventDetailBody", () => {
  it("panel variant: thumbnail media, section headings, no request/author rows", () => {
    const geo = geoFixture();
    render(<EventDetailBody geo={geo} variant="panel" />);
    const img = screen.getByRole("img");
    // Derive the expected URL from the same helper the component uses,
    // decoded so the assertion survives next/image's loader encoding.
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(geo.media[0]).thumbnail
    );
    expect(screen.queryByText("Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Author")).not.toBeInTheDocument();
    // Not just the row label — the author's username must not appear
    // anywhere in the panel body (it lives in the panel header).
    expect(screen.queryByText("ana")).not.toBeInTheDocument();
    // The panel carries the same section headings as the page (denser).
    expect(screen.getByText("Source media")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    // Shared fields + proof render
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("48.015883, 37.802411")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(
      screen.getByText("Anchor points match the imagery.")
    ).toBeInTheDocument();
  });

  it("panel variant carries the same ? help as the page", () => {
    render(<EventDetailBody geo={geoFixture()} variant="panel" />);
    expect(
      screen.getByRole("button", { name: "What are the coordinates?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the event date?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source?" })
    ).toBeInTheDocument();
  });

  it("splits curated tags into their own rows, free tags under Tags", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          tags: [
            { id: "t1", name: "Ukraine", category: "conflict" },
            { id: "t2", name: "Drone", category: "capture_source" },
            { id: "t3", name: "armor", category: "free" },
          ],
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByText("Capture source")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("page variant: hero media, requested-by + author rows, section headings", () => {
    const geo = geoFixture();
    render(<EventDetailBody geo={geo} variant="page" />);
    const img = screen.getByRole("img");
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(geo.media[0]).hero
    );
    expect(screen.getByText("Source media")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Requested by")).toBeInTheDocument();
    const requesterLink = screen.getByRole("link", { name: "@poster" });
    expect(requesterLink).toHaveAttribute("href", "/profile/poster");
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute(
      "href",
      "/profile/ana"
    );
  });

  it("geolocated geo shows the Geolocated status, not detected markers", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
    // Status is always shown now; a geolocated (non-detected) row reads "Geolocated".
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
    expect(screen.queryByText("Detected from")).not.toBeInTheDocument();
  });

  it("detected geo shows the badge, status row, and provenance link", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "detected",
          detected_from_url: "https://x.com/ana/status/123",
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Detected from")).toBeInTheDocument();
    // Detected from renders via SourceLabel — host display, full URL as href,
    // the same nature as the Source row.
    expect(screen.getByRole("link", { name: "x.com" })).toHaveAttribute(
      "href",
      "https://x.com/ana/status/123"
    );
    // ? help on the Status + Detected-from fields.
    expect(
      screen.getByRole("button", { name: "What does the status mean?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is 'detected from'?" })
    ).toBeInTheDocument();
  });

  it("page variant without a requested-by trace omits the row", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ requested_by: null })}
        variant="page"
      />
    );
    expect(screen.queryByText("Requested by")).not.toBeInTheDocument();
    expect(screen.getByText("Author")).toBeInTheDocument();
  });

  it("renders children between media and the key-value rows", () => {
    render(
      <EventDetailBody geo={geoFixture()} variant="page">
        <div data-testid="location-map">map goes here</div>
      </EventDetailBody>
    );
    const slot = screen.getByTestId("location-map");
    const media = screen.getByRole("img");
    const details = screen.getByText("Details");
    // Position is the contract, not mere presence: media → slot → details.
    expect(
      media.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      slot.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders video media as a controllable <video>, not an image", () => {
    const { container } = render(
      <EventDetailBody
        geo={geoFixture({
          media: [
            {
              id: "m1",
              storage_url: "/local-storage/evidence.jpg",
              media_type: "image",
              role: "source",
            },
            {
              id: "m2",
              storage_url: "/local-storage/clip.mp4",
              media_type: "video",
              role: "source",
            },
          ],
        })}
        variant="panel"
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    // `#t=0.1` + preload="metadata" paints the first frame as a poster
    // (MediaGallery's video treatment) instead of a black box before play.
    expect(video).toHaveAttribute("src", "/local-storage/clip.mp4#t=0.1");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("controls");
    // The image sibling still renders through next/image.
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("falls back on empty media and missing proof", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ media: [], proof: null })}
        variant="panel"
      />
    );
    expect(screen.getByText("No media available")).toBeInTheDocument();
    expect(screen.getByText("No proof provided")).toBeInTheDocument();
  });

  it("shows the closer's reason on a closed row, and the closed tooltip reflects before_closed_status", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "closed",
          before_closed_status: "requested",
          close_reason: "Duplicate of an existing request.",
          closed_at: "2026-06-05T12:00:00Z",
          event_coords: null,
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(
      screen.getByText("Duplicate of an existing request.")
    ).toBeInTheDocument();
    // Closed badge tooltip distinguishes a withdrawn request from a rejected
    // detection via before_closed_status.
    expect(screen.getByText("Closed").closest("[title]")).toHaveAttribute(
      "title",
      "The author withdrew this request"
    );
  });

  it("omits the Reason row when a closed row has no reason", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "closed",
          before_closed_status: "detected",
          close_reason: null,
        })}
        variant="page"
      />
    );
    expect(screen.queryByText("Reason")).not.toBeInTheDocument();
  });

  it("always shows the Source posted row (a post always has a time)", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ source_posted_at: "2026-05-03T09:15:00Z" })}
        variant="page"
      />
    );
    expect(screen.getByText("Source posted")).toBeInTheDocument();
    expect(screen.getByText("3 May 2026, 09:15 UTC")).toBeInTheDocument();
  });

  it("puts the event time on its own row, date-only in Event date", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ event_date: "2026-06-01", event_time: "14:30:00" })}
        variant="page"
      />
    );
    // The time is a separate row, not folded into the date value.
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("14:30 UTC")).toBeInTheDocument();
    expect(screen.getByText("1 Jun 2026")).toBeInTheDocument();
  });

  it("surfaces a standalone event time even when the date is unknown", () => {
    // The relaxed request path: an approximate hour (sun position) with no day.
    render(
      <EventDetailBody
        geo={geoFixture({ event_date: null, event_time: "14:30:00" })}
        variant="page"
      />
    );
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("14:30 UTC")).toBeInTheDocument();
  });

  it("omits the Event time row when no time is set", () => {
    render(<EventDetailBody geo={geoFixture({ event_time: null })} variant="page" />);
    expect(screen.queryByText("Event time")).not.toBeInTheDocument();
  });
});
