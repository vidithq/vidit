import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GeolocationDetailBody } from "./GeolocationDetailBody";
import type { GeolocationDetail } from "@/types";

function geoFixture(overrides: Partial<GeolocationDetail> = {}): GeolocationDetail {
  return {
    id: "g1",
    title: "Strike on ammunition depot",
    lat: 48.015883,
    lng: 37.802411,
    event_date: "2026-06-01",
    is_demo: false,
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
    render(<GeolocationDetailBody geo={geoFixture()} variant="panel" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toContain("thumb");
    expect(screen.queryByText("Bounty")).not.toBeInTheDocument();
    expect(screen.queryByText("Author")).not.toBeInTheDocument();
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
    render(<GeolocationDetailBody geo={geoFixture()} variant="page" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toContain("hero");
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
    expect(screen.getByTestId("location-map")).toBeInTheDocument();
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
