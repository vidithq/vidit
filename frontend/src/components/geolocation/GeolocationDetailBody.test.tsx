import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GeolocationDetailBody } from "./GeolocationDetailBody";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { GeolocationDetail } from "@/types";

function geoFixture(overrides: Partial<GeolocationDetail> = {}): GeolocationDetail {
  return {
    id: "g1",
    title: "Strike on ammunition depot",
    lat: 48.015883,
    lng: 37.802411,
    event_date: "2026-06-01",
    is_demo: false,
    state: "validated",
    detected_from_url: null,
    author: {
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
    media: [{ id: "m1", storage_url: "/local-storage/evidence.jpg", media_type: "image" }],
    originated_from_bounty: {
      id: "b1",
      title: "Where is this footage from?",
      author: {
        id: "u2",
        username: "poster",
        is_trusted: false,
        trust_reason: null,
      },
    },
    ...overrides,
  };
}

describe("GeolocationDetailBody", () => {
  it("panel variant: thumbnail media, no bounty/author rows, no section headings", () => {
    const geo = geoFixture();
    render(<GeolocationDetailBody geo={geo} variant="panel" />);
    const img = screen.getByRole("img");
    // Derive the expected URL from the same helper the component uses,
    // decoded so the assertion survives next/image's loader encoding.
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(geo.media[0]).thumbnail
    );
    expect(screen.queryByText("Bounty")).not.toBeInTheDocument();
    expect(screen.queryByText("Author")).not.toBeInTheDocument();
    // Not just the row label — the author's username must not appear
    // anywhere in the panel body (it lives in the panel header).
    expect(screen.queryByText("ana")).not.toBeInTheDocument();
    expect(screen.queryByText("Media")).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    // Shared fields + proof render
    expect(screen.getByText("Event date")).toBeInTheDocument();
    expect(screen.getByText("48.015883, 37.802411")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(
      screen.getByText("Anchor points match the imagery.")
    ).toBeInTheDocument();
  });

  it("page variant: hero media, bounty-trace + author rows, section headings", () => {
    const geo = geoFixture();
    render(<GeolocationDetailBody geo={geo} variant="page" />);
    const img = screen.getByRole("img");
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(
      displayUrlsFor(geo.media[0]).hero
    );
    expect(screen.getByText("Media")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Bounty")).toBeInTheDocument();
    const bountyLink = screen.getByRole("link", {
      name: "Where is this footage from?",
    });
    expect(bountyLink).toHaveAttribute("href", "/bounties/b1");
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute(
      "href",
      "/profile/ana"
    );
  });

  it("validated geo shows no detected markers", () => {
    render(<GeolocationDetailBody geo={geoFixture()} variant="page" />);
    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Detected from")).not.toBeInTheDocument();
  });

  it("detected geo shows the badge, status row, and provenance link", () => {
    render(
      <GeolocationDetailBody
        geo={geoFixture({
          state: "detected",
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
      screen.getByRole("button", { name: "What is 'Detected from'?" })
    ).toBeInTheDocument();
  });

  it("page variant without a bounty trace omits the row", () => {
    render(
      <GeolocationDetailBody
        geo={geoFixture({ originated_from_bounty: null })}
        variant="page"
      />
    );
    expect(screen.queryByText("Bounty")).not.toBeInTheDocument();
    expect(screen.getByText("Author")).toBeInTheDocument();
  });

  it("renders children between media and the key-value rows", () => {
    render(
      <GeolocationDetailBody geo={geoFixture()} variant="page">
        <div data-testid="location-map">map goes here</div>
      </GeolocationDetailBody>
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
      <GeolocationDetailBody
        geo={geoFixture({
          media: [
            { id: "m1", storage_url: "/local-storage/evidence.jpg", media_type: "image" },
            { id: "m2", storage_url: "/local-storage/clip.mp4", media_type: "video" },
          ],
        })}
        variant="panel"
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "/local-storage/clip.mp4");
    expect(video).toHaveAttribute("controls");
    // The image sibling still renders through next/image.
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("falls back on empty media and missing proof", () => {
    render(
      <GeolocationDetailBody
        geo={geoFixture({ media: [], proof: null })}
        variant="panel"
      />
    );
    expect(screen.getByText("No media available")).toBeInTheDocument();
    expect(screen.getByText("No proof provided")).toBeInTheDocument();
  });
});
