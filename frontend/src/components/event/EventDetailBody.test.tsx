import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventDetailBody } from "./EventDetailBody";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Source } from "@/lib/sources";
import { source } from "@/test/eventDetail";
import type { EventDetail } from "@/types";

// The body writes nothing, so who is looking changes none of it: the owner's view is asserted through the same render.
const OWNER_ID = "u1";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: OWNER_ID } }),
}));

// The media gallery's alt text is the event title.
const TITLE = "Strike on ammunition depot";

const IMAGE = {
  id: "m1",
  role: "source" as const,
  storage_url: "/local-storage/evidence.jpg",
  kind: "image" as const,
  sha256: "0".repeat(64),
};

// The footage: a drone image posted twice, the first link archived.
const FOOTAGE: Source = source({
  id: "s1",
  title: "Drone footage of the strike",
  sensor: "drone",
  captured_at: "2026-06-01T09:30:00Z",
  sensor_position: { lat: 48.02, lng: 37.79 },
  links: [
    {
      url: "https://t.me/channel/12345",
      posted_at: "2026-06-01T10:05:00Z",
      archived: {
        url: "https://web.archive.org/web/2026/https://t.me/channel/12345",
        provider: "wayback",
        archived_at: "2026-06-02T00:00:00Z",
      },
    },
    { url: "https://www.youtube.com/watch?v=x", posted_at: null, archived: null },
  ],
  tags: [{ id: "t9", name: "armor" }],
  media: IMAGE,
});

// An article: context, a URL only.
const ARTICLE: Source = source({
  id: "s2",
  level: "context",
  links: [{ url: "https://news.example/a", posted_at: null, archived: null }],
});

function geoFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "g1",
    title: TITLE,
    coords: { lat: 48.015883, lng: 37.802411 },
    occurred_date: "2026-06-01",
    occurred_time: null,
    is_graphic: false,
    status: "geolocated",
    version_no: 1,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: null,
    detected_via: null,
    owner: {
      id: "u1",
      username: "ana",
    },
    tags: [],
    conflicts: [
      {
        id: "c1",
        name: "Russian invasion of Ukraine",
        wikidata_id: "Q110999040",
        start_year: 2022,
        end_year: null,
        is_ongoing: true,
        tier: "major",
      },
    ],
    sources: [FOOTAGE, ARTICLE],
    proof: "<p>Anchor points match the imagery.</p>",
    created_at: "2026-06-02T10:00:00Z",
    geolocated_at: "2026-06-03T10:00:00Z",
    closed_at: null,
    thumbnail: IMAGE,
    requested_by: {
      id: "u2",
      username: "poster",
    },
    geolocators: [],
    ...overrides,
  };
}

const block = (n: number) => screen.getByRole("region", { name: `Source ${n}` });

describe("EventDetailBody", () => {
  it("panel variant: thumbnail media, section headings, no request/author rows", () => {
    render(<EventDetailBody geo={geoFixture()} variant="panel" />);
    const img = screen.getByRole("img", { name: TITLE });
    // Derive the expected URL from the component's helper, decoded to survive next/image's loader encoding.
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(IMAGE).thumbnail
    );
    expect(screen.queryByText("Author")).not.toBeInTheDocument();
    // The author's username must appear nowhere in the panel body (it lives in the panel header).
    expect(screen.queryByText("ana")).not.toBeInTheDocument();
    // The panel carries the same section headings as the page (denser).
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("48.015883, 37.802411")).toBeInTheDocument();
    // An ongoing conflict carries its years too.
    expect(screen.getByText("Russian invasion of Ukraine (2022-present)")).toBeInTheDocument();
    expect(screen.getByText("Anchor points match the imagery.")).toBeInTheDocument();
  });

  it("page variant: hero media, requested-by + author rows", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
    const img = screen.getByRole("img", { name: TITLE });
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(IMAGE).hero
    );
    expect(screen.getByText("Requested by")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "poster" })).toHaveAttribute("href", "/profile/poster");
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
  });

  it("renders one block per source, in the order served", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
    const first = block(1);
    expect(within(first).getByText("Drone footage of the strike")).toBeInTheDocument();
    expect(within(first).getByText("Direct")).toBeInTheDocument();
    expect(within(first).getByText("Drone")).toBeInTheDocument();
    expect(within(first).getByText("1 Jun 2026, 09:30 UTC")).toBeInTheDocument();
    expect(within(first).getByText("48.0200, 37.7900")).toBeInTheDocument();
    expect(within(first).getByText("armor")).toBeInTheDocument();
    // An untitled source reads Untitled, and a source without a file says so in place of the file.
    const second = block(2);
    expect(within(second).getByText("Untitled")).toBeInTheDocument();
    expect(within(second).getByText("Context")).toBeInTheDocument();
    expect(within(second).queryByRole("img")).toBeNull();
    expect(within(second).getByText("No file")).toBeInTheDocument();
  });

  it("names no sensor without a file, nor an unknown one", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ sources: [{ ...FOOTAGE, sensor: "unknown" }, { ...ARTICLE, sensor: "drone" }] })}
        variant="page"
      />
    );
    expect(screen.queryByText("Sensor")).toBeNull();
  });

  it("lists each link with its post date and its archived copy, named by source and link", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
    const first = block(1);
    expect(within(first).getByRole("link", { name: "t.me/channel/12345" })).toHaveAttribute(
      "href",
      "https://t.me/channel/12345"
    );
    expect(within(first).getByText("Posted 1 Jun 2026")).toBeInTheDocument();
    expect(
      within(first).getByRole("link", { name: "Wayback Machine copy of source 1, link 1, t.me" })
    ).toHaveAttribute("href", "https://web.archive.org/web/2026/https://t.me/channel/12345");
    // A link with no copy states it, inert, for every reader.
    expect(
      within(first).getByRole("button", { name: "No archived copy of source 1, link 2, www.youtube.com" })
    ).toBeDisabled();
    expect(
      within(block(2)).getByRole("button", { name: "No archived copy of source 2, news.example" })
    ).toBeDisabled();
  });

  it("gates only the flagged source's file", () => {
    const clip = {
      ...FOOTAGE,
      id: "s3",
      title: "Second angle",
      is_graphic: true,
      media: { ...IMAGE, id: "m2", storage_url: "/local-storage/other.jpg" },
    };
    render(<EventDetailBody geo={geoFixture({ sources: [FOOTAGE, clip] })} variant="page" />);
    expect(within(block(1)).queryByRole("button", { name: /Show graphic/ })).toBeNull();
    expect(
      within(block(2)).getByRole("button", { name: "Show graphic content (18 or older)" })
    ).toBeInTheDocument();
  });

  it("says so when the event has no source yet", () => {
    render(<EventDetailBody geo={geoFixture({ sources: [], proof: null })} variant="panel" />);
    expect(screen.getByText("No source yet")).toBeInTheDocument();
    expect(screen.getByText("No proof provided")).toBeInTheDocument();
  });

  it("renders video media in the shared player, not as an image", () => {
    const { container } = render(
      <EventDetailBody
        geo={geoFixture({
          sources: [
            { ...FOOTAGE, media: { ...IMAGE, id: "m2", storage_url: "/local-storage/clip.mp4", kind: "video" } },
          ],
        })}
        variant="panel"
      />
    );
    // A clip plays in `VideoPlayer`, so the tile is the player's controller, not a bare native element.
    expect(container.querySelector("media-controller")).not.toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
  });

  it("renders children between the sources and the key-value rows", () => {
    render(
      <EventDetailBody geo={geoFixture()} variant="page">
        <div data-testid="location-map">map goes here</div>
      </EventDetailBody>
    );
    const slot = screen.getByTestId("location-map");
    const media = screen.getByRole("img", { name: TITLE });
    const details = screen.getByText("Details");
    // Position is the contract, not mere presence: sources, then the slot, then details.
    expect(media.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists the conflicts and the event's tags in their own rows", () => {
    render(
      // The footage source carries a Tags row of its own; the article source does not.
      <EventDetailBody
        geo={geoFixture({ tags: [{ id: "t3", name: "night" }], sources: [ARTICLE] })}
        variant="page"
      />
    );
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("night")).toBeInTheDocument();
  });

  it("geolocated geo shows the Geolocated status, not detected markers", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
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
          // A detection is nobody's request: the two provenance stamps never share a row outside a fixture.
          requested_by: null,
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Detected from")).toBeInTheDocument();
    // Detected from renders via SourceLabel: host display, full URL as href, like the Source row.
    expect(screen.getByRole("link", { name: "x.com" })).toHaveAttribute(
      "href",
      "https://x.com/ana/status/123"
    );
    expect(
      screen.getByRole("button", { name: "What does the status mean?" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Where was this read from?" })
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

  it("shows the closer's reason on a closed row, beside the status badge", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "closed",
          before_closed_status: "requested",
          close_reason: "Duplicate of an existing request.",
          closed_at: "2026-06-05T12:00:00Z",
          coords: null,
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(
      screen.getByText("Duplicate of an existing request.")
    ).toBeInTheDocument();
    expect(screen.getByText("5 Jun 2026")).toBeInTheDocument();
    // The badge is the state, the Reason is why: neither carries hover text, and the `status`
    // concept's `?` names every dismissal shape.
    for (const node of screen.getAllByText("Closed")) {
      expect(node.closest("[title]")).toBeNull();
    }
  });

  // A retraction is the one closed shape with a full published record behind it: the page must say
  // the claim was taken back.
  it("marks a retracted geolocation as closed, with the reason and the day", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "closed",
          before_closed_status: "geolocated",
          close_reason: "Wrong village: the footage is from Vovchansk.",
          closed_at: "2026-06-05T12:00:00Z",
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(
      screen.getByText("Wrong village: the footage is from Vovchansk.")
    ).toBeInTheDocument();
    expect(screen.getByText("5 Jun 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
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

  it("puts the event time on its own row, date-only in Event date", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ occurred_date: "2026-06-01", occurred_time: "14:30:00", sources: [ARTICLE] })}
        variant="page"
      />
    );
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("14:30 UTC")).toBeInTheDocument();
    expect(screen.getByText("1 Jun 2026")).toBeInTheDocument();
  });

  it("surfaces a standalone event time even when the date is unknown", () => {
    // The relaxed request path: an approximate hour (sun position) with no day.
    render(
      <EventDetailBody
        geo={geoFixture({ occurred_date: null, occurred_time: "14:30:00" })}
        variant="page"
      />
    );
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("14:30 UTC")).toBeInTheDocument();
    // A null date reads as Unknown, not an empty cell.
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("omits the Event time row when no time is set", () => {
    render(<EventDetailBody geo={geoFixture({ occurred_time: null })} variant="page" />);
    expect(screen.queryByText("Event time")).not.toBeInTheDocument();
  });

  it("a request opened from a post reads Requested from, not Detected from", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "requested",
          coords: null,
          geolocated_at: null,
          detected_from_url: "https://x.com/ana/status/123",
          detected_via: "bot",
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Requested from")).toBeInTheDocument();
    expect(screen.queryByText("Detected from")).not.toBeInTheDocument();
  });

});
