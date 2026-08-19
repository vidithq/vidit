import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventDetailBody } from "./EventDetailBody";
import { FIELD_HELP } from "@/lib/fieldHelp";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { EventDetail } from "@/types";

// The body writes nothing, so who is looking changes none of it: the owner's
// own view is asserted below through the same render every reader gets.
const OWNER_ID = "u1";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: OWNER_ID } }),
}));

// The media gallery's alt text, which is the event title. Named because the
// detail rows carry archive glyphs of their own, so a media assertion has to
// say which image it means.
const TITLE = "Strike on ammunition depot";

function geoFixture(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "g1",
    title: TITLE,
    event_coords: { lat: 48.015883, lng: 37.802411 },
    capture_source_coords: null,
    archived_source: null,
    event_date: "2026-06-01",
    event_time: null,
    source_posted_at: "2026-05-30T14:32:00Z",
    is_graphic: false,
    status: "geolocated",
    version_no: 1,
    close_reason: null,
    before_closed_status: null,
    detected_from_url: null,
    detected_via: null,
    archived_detected_from: null,
    detected_post_at: null,
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
        ongoing: true,
        tier: "major",
      },
    ],
    source_url: "https://t.me/channel/12345",
    secondary_source_urls: [],
    archived_secondary_sources: [],
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
    thumbnail: {
      id: "m1",
      storage_url: "/local-storage/evidence.jpg",
      media_type: "image",
      role: "source",
    },
    requested_by: {
      id: "u2",
      username: "poster",
    },
    geolocators: [],
    ...overrides,
  };
}

describe("EventDetailBody", () => {
  it("panel variant: thumbnail media, section headings, no request/author rows", () => {
    const geo = geoFixture();
    render(<EventDetailBody geo={geo} variant="panel" />);
    const img = screen.getByRole("img", { name: geo.title });
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
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("48.015883, 37.802411")).toBeInTheDocument();
    // An ongoing conflict carries its years too.
    expect(
      screen.getByText("Russian invasion of Ukraine (2022-present)")
    ).toBeInTheDocument();
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

  it("splits conflicts and curated tags into their own rows, free tags under Tags", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          tags: [
            { id: "t2", name: "Drone", category: "capture_source" },
            { id: "t3", name: "armor", category: "free" },
          ],
          conflicts: [
            {
              id: "c2",
              name: "Falklands War",
              wikidata_id: "Q127076",
              start_year: 1982,
              end_year: 1982,
              ongoing: false,
              tier: null,
            },
          ],
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    // An ended conflict carries its years for disambiguation.
    expect(screen.getByText("Falklands War (1982)")).toBeInTheDocument();
    expect(screen.getByText("Capture source")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("page variant: hero media, requested-by + author rows, section headings", () => {
    const geo = geoFixture();
    render(<EventDetailBody geo={geo} variant="page" />);
    const img = screen.getByRole("img", { name: geo.title });
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
    const media = screen.getByRole("img", { name: TITLE });
    const details = screen.getByText("Details");
    // Position is the contract, not mere presence: media → slot → details.
    expect(
      media.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      slot.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders video media in the shared player, not as an image", () => {
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
    // A clip plays in `VideoPlayer`, so the tile is the player's controller
    // rather than a bare native element with `controls`.
    expect(container.querySelector("media-controller")).not.toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
    // The image sibling still renders through next/image.
    expect(screen.getByRole("img", { name: TITLE })).toBeInTheDocument();
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

  it("shows the closer's reason on a closed row, beside the status badge", () => {
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
    // The badge is the state, the Reason is why: it carries no hover text of
    // its own, and the `status` concept's `?` on the row names both dismissal
    // shapes.
    expect(screen.getByText("Closed").closest("[title]")).toBeNull();
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

  it("always shows the Source posted row", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ source_posted_at: "2026-05-03T09:15:00Z" })}
        variant="page"
      />
    );
    expect(screen.getByText("Source posted")).toBeInTheDocument();
    expect(screen.getByText("3 May 2026, 09:15 UTC")).toBeInTheDocument();
  });

  it("shows a dash on the Source posted row when the instant is unknown", () => {
    // A machine detection whose source is an undated footage link
    // (or has no source at all) leaves source_posted_at null.
    render(
      <EventDetailBody
        geo={geoFixture({ source_posted_at: null })}
        variant="page"
      />
    );
    expect(screen.getByText("Source posted")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the muted 'To confirm' label on the Source row when no source is declared", () => {
    // A machine detection is partial by definition: its tweet may
    // declare no source at all.
    render(
      <EventDetailBody
        geo={geoFixture({ status: "detected", source_url: null })}
        variant="page"
      />
    );
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("To confirm")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "To confirm" })).not.toBeInTheDocument();
  });

  it("puts the event time on its own row, date-only in Event date", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ event_date: "2026-06-01", event_time: "14:30:00" })}
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
        geo={geoFixture({ event_date: null, event_time: "14:30:00" })}
        variant="page"
      />
    );
    expect(screen.getByText("Event time")).toBeInTheDocument();
    expect(screen.getByText("14:30 UTC")).toBeInTheDocument();
    // A null date reads as Unknown, not an empty cell.
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("omits the Event time row when no time is set", () => {
    render(<EventDetailBody geo={geoFixture({ event_time: null })} variant="page" />);
    expect(screen.queryByText("Event time")).not.toBeInTheDocument();
  });

  it("links the archived copy of the source, named for its service", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          archived_source: {
            url: "https://web.archive.org/web/2026/t.me/channel/12345",
            provider: "wayback",
          },
        })}
        variant="page"
      />
    );
    // Named per service and per target, since every glyph on the page looks
    // alike and a screen reader has nothing else to tell them apart by.
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toHaveAttribute("href", "https://web.archive.org/web/2026/t.me/channel/12345");
    // The original stays the primary link; the copy is the fallback.
    expect(screen.getByRole("link", { name: "t.me" })).toBeInTheDocument();
  });

  // Every unarchived link row states the absence and offers nothing, the
  // event's own owner included: recording a copy is an edit, filed through the
  // edit form, so no detail surface writes one.
  it("states a missing copy on every link row, offering no action to anyone", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          detected_from_url: "https://x.com/ana/status/123",
          secondary_source_urls: ["https://t.me/mirror/1"],
          archived_secondary_sources: [null],
        })}
        variant="page"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 more source/ }));
    for (const name of [
      "No archived copy of the source",
      "No archived copy of t.me",
      "No archived copy of the post it was detected from",
    ]) {
      expect(screen.getByRole("img", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows no archival affordance on a detection that declares no source", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          status: "detected",
          detected_at: "2026-06-02T09:00:00Z",
          geolocated_at: null,
          source_url: null,
        })}
        variant="page"
      />
    );
    // There is no link, so the mark would be about nothing.
    expect(screen.queryByRole("img", { name: /archived copy/ })).not.toBeInTheDocument();
  });

  it("omits the Secondary sources row when the event declares no mirror", () => {
    render(<EventDetailBody geo={geoFixture()} variant="page" />);
    expect(screen.queryByText("Secondary sources")).not.toBeInTheDocument();
  });

  it("collapses the secondary sources behind a count, expanding to the links", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          secondary_source_urls: [
            "https://x.com/user/status/9",
            "https://www.youtube.com/watch?v=abc",
          ],
        })}
        variant="page"
      />
    );
    expect(screen.getByText("Secondary sources")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /2 more sources/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed: no link is reachable yet.
    expect(screen.queryByRole("link", { name: "x.com" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: "x.com" });
    expect(link).toHaveAttribute("href", "https://x.com/user/status/9");
    // Same new-tab affordance as the primary Source row.
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "www.youtube.com" })).toBeInTheDocument();
    // One `?` for the whole expanded list, hoisted off the mirrors: ten mirrors
    // must not carry ten copies of the same sentence. The Source row keeps its
    // own, one per group, so the page shows exactly two.
    expect(
      screen.getAllByRole("button", { name: FIELD_HELP.archived_copies.label })
    ).toHaveLength(2);
  });

  it("keeps each mirror's archived copy on its own mirror", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          secondary_source_urls: [
            "https://x.com/user/status/9",
            "https://www.youtube.com/watch?v=abc",
          ],
          // Only the second mirror has a copy: the alignment is by position, so
          // a copy must not slide onto the neighbouring mirror.
          archived_secondary_sources: [
            null,
            {
              url: "https://web.archive.org/web/2026/youtube.com/watch?v=abc",
              provider: "wayback",
            },
          ],
        })}
        variant="page"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /2 more sources/ }));

    // Named per target, so the archived affordances on this page stay tellable
    // apart by their accessible name. The position leads, since a host is not
    // an identity: two mirrors of one channel would otherwise share a name.
    const archived = screen.getByRole("link", {
      name: "Wayback Machine copy of mirror 2, www.youtube.com",
    });
    expect(archived).toHaveAttribute(
      "href",
      "https://web.archive.org/web/2026/youtube.com/watch?v=abc"
    );
    expect(archived).toHaveAttribute("target", "_blank");
    expect(archived).toHaveAttribute("rel", "noopener noreferrer");
    // The uncopied mirror says so rather than showing nothing.
    expect(
      screen.getByRole("img", { name: "No archived copy of mirror 1, x.com" })
    ).toBeInTheDocument();
    // The mirror itself stays the primary link either way.
    expect(screen.getByRole("link", { name: "www.youtube.com" })).toBeInTheDocument();
  });

  it("renders the archived copy beside the Detected from link", () => {
    render(
      <EventDetailBody
        geo={geoFixture({
          detected_from_url: "https://x.com/ana/status/123",
          archived_detected_from: {
            url: "https://web.archive.org/web/2026/x.com/ana/status/123",
            provider: "wayback",
          },
        })}
        variant="page"
      />
    );
    // Named apart from the source: the provenance link is the analyst's own
    // post, not the footage origin, and both rows carry the same glyph.
    expect(
      screen.getByRole("link", {
        name: "Wayback Machine copy of the post it was detected from",
      })
    ).toHaveAttribute("href", "https://web.archive.org/web/2026/x.com/ana/status/123");
  });

  it("the map panel carries the copy on every link row it shows", () => {
    // The panel renders the same rows as the page, so a regression that drops
    // the affordance from one surface only would pass the page tests alone.
    render(
      <EventDetailBody
        geo={geoFixture({
          archived_source: {
            url: "https://web.archive.org/web/2026/t.me/channel/12345",
            provider: "wayback",
          },
          detected_from_url: "https://x.com/ana/status/123",
          archived_detected_from: {
            url: "https://web.archive.org/web/2026/x.com/ana/status/123",
            provider: "wayback",
          },
          secondary_source_urls: ["https://t.me/mirror/1"],
          archived_secondary_sources: [
            {
              url: "https://web.archive.org/web/2026/t.me/mirror/1",
              provider: "wayback",
            },
          ],
        })}
        variant="panel"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 more source/ }));
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of t.me" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Wayback Machine copy of the post it was detected from",
      })
    ).toBeInTheDocument();
  });

  it("names two mirrors sharing a host apart, and the primary apart from both", () => {
    const captured = (url: string) => ({ url, provider: "wayback" as const });
    render(
      <EventDetailBody
        geo={geoFixture({
          archived_source: captured("https://web.archive.org/web/2026/t.me/channel/12345"),
          secondary_source_urls: ["https://t.me/mirror/1", "https://t.me/mirror/2"],
          archived_secondary_sources: [
            captured("https://web.archive.org/web/2026/t.me/mirror/1"),
            captured("https://web.archive.org/web/2026/t.me/mirror/2"),
          ],
        })}
        variant="page"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /2 more sources/ }));

    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of the source" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of mirror 1, t.me" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of mirror 2, t.me" })
    ).toBeInTheDocument();
  });

  it("names a lone mirror by its host, falling back to a literal without one", () => {
    const { unmount } = render(
      <EventDetailBody
        geo={geoFixture({
          secondary_source_urls: ["https://t.me/mirror/1"],
          archived_secondary_sources: [
            {
              url: "https://web.archive.org/web/2026/t.me/mirror/1",
              provider: "wayback",
            },
          ],
        })}
        variant="page"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 more source/ }));
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of t.me" })
    ).toBeInTheDocument();
    unmount();

    // A stored value the URL parser gives no host for still announces
    // something a reader can act on.
    render(
      <EventDetailBody
        geo={geoFixture({
          secondary_source_urls: ["mailto:tips@example.org"],
          archived_secondary_sources: [
            { url: "https://web.archive.org/web/2026/tips", provider: "wayback" },
          ],
        })}
        variant="page"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /1 more source/ }));
    expect(
      screen.getByRole("link", { name: "Wayback Machine copy of this mirror" })
    ).toBeInTheDocument();
  });

  it("singularises the toggle on a lone secondary source", () => {
    render(
      <EventDetailBody
        geo={geoFixture({ secondary_source_urls: ["https://t.me/mirror/1"] })}
        variant="panel"
      />
    );
    expect(
      screen.getByRole("button", { name: /1 more source$/ })
    ).toBeInTheDocument();
  });
});
