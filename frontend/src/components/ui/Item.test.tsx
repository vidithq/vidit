import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { collectionItem, eventItem, searchHitItem, siteItem } from "@/lib/items";
import type { Media, SearchUserHit } from "@/types";
import { Item, type ItemData, type ItemVariant } from "./Item";

const MEDIA: Media = {
  id: "m1",
  role: "source",
  storage_url: "http://localhost:8000/strike.jpg",
  kind: "image",
  sha256: "0".repeat(64),
  original_filename: null,
};
const ANA = { id: "u1", username: "ana", avatar_url: null };
const TILE = { url: "http://localhost:8000/tile.jpg", kind: "image" as const, role: "source" as const };

const EVENT = {
  id: "e1",
  title: "Strike on the depot",
  status: "geolocated" as const,
  occurred_date: "2026-06-06",
  owner: ANA,
  geolocators: [],
};
const SITE = {
  id: "s1",
  name: "Saky airbase",
  kind: "airbase" as const,
  last_source: { captured_at: "2026-06-08T10:00:00Z" },
  owner: ANA,
};
const COLLECTION = {
  id: "c1",
  title: "Kupiansk rail corridor",
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  owner: ANA,
};

/** Each kind once with its picture and once without, and the detail line its anatomy prints. */
const KINDS: { name: string; bare: ItemData; pictured: ItemData; href: string; detail: RegExp; badge: string }[] = [
  {
    name: "geolocated event",
    bare: eventItem(EVENT),
    pictured: eventItem({ ...EVENT, media: MEDIA }),
    href: "/events/e1",
    detail: /Event ?· ?6 Jun 2026 ?· ?A?ana/,
    badge: "Geolocated",
  },
  {
    name: "detected event",
    bare: eventItem({ ...EVENT, status: "detected" }),
    pictured: eventItem({ ...EVENT, status: "detected", media: MEDIA }),
    href: "/events/e1",
    detail: /Event ?· ?6 Jun 2026 ?· ?A?ana/,
    badge: "Detected",
  },
  {
    name: "request",
    bare: eventItem({ ...EVENT, status: "requested", occurred_date: null }),
    pictured: eventItem({ ...EVENT, status: "requested", occurred_date: null, media: MEDIA }),
    href: "/requests/e1",
    detail: /Request ?· ?A?ana/,
    badge: "Requested",
  },
  {
    name: "site",
    bare: siteItem(SITE),
    pictured: siteItem({ ...SITE, media: MEDIA }),
    href: "/sites/s1",
    detail: /Site ?· ?8 Jun 2026 ?· ?A?ana/,
    badge: "Airbase",
  },
  {
    name: "collection",
    bare: collectionItem({ ...COLLECTION, cover: [] }),
    pictured: collectionItem({ ...COLLECTION, cover: [TILE, TILE, TILE] }),
    href: "/collections/c1",
    detail: /Collection ?· ?14 Mar 2026 to 16 Mar 2026 ?· ?A?ana/,
    badge: "5 events",
  },
];

const VARIANTS: ItemVariant[] = ["compact", "list", "card"];

describe("Item", () => {
  describe.each(VARIANTS)("the %s variant", (variant) => {
    it.each(KINDS)("shows a $name with its anatomy and links it", ({ pictured, href, detail, badge }) => {
      const { container } = render(<Item variant={variant} {...pictured} />);
      const link = screen.getByRole("link", { name: pictured.title });
      expect(link).toHaveAttribute("href", href);
      expect(link.parentElement).toHaveTextContent(detail);
      expect(link.parentElement).toHaveTextContent(badge);
      expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
    });

    it.each(KINDS)("shows the kind's tile in place of a missing $name picture", ({ bare }) => {
      const { container } = render(<Item variant={variant} {...bare} />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      expect(container).not.toHaveTextContent(/no media/i);
    });
  });

  it("lays a collection's mosaic out in as many tiles as its cover holds, one in compact", () => {
    const pictured = collectionItem({ ...COLLECTION, cover: [TILE, TILE, TILE] });
    const { container, rerender } = render(<Item variant="list" {...pictured} />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    rerender(<Item variant="compact" {...pictured} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("marks the words a search matched in the title", () => {
    const item = { ...eventItem(EVENT), highlight: "\u0002Strike\u0003 on the depot" };
    render(<Item variant="list" {...item} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Strike on the depot");
    expect(screen.getByText("Strike").tagName).toBe("MARK");
    expect(screen.getByRole("link", { name: "Strike on the depot" })).toBeInTheDocument();
  });

  it("shows an analyst found by search with their picture and the bio's highlight", () => {
    const hit: SearchUserHit = {
      type: "user",
      id: "u1",
      username: "ana",
      username_highlight: "\u0002ana\u0003",
      bio: "Tracks the reservoir.",
      bio_highlight: "Tracks the \u0002reservoir\u0003.",
      avatar_url: null,
    };
    render(<Item variant="list" {...searchHitItem(hit)} />);
    expect(screen.getByRole("link", { name: "ana" })).toHaveAttribute("href", "/profile/ana");
    expect(screen.getByText("reservoir").tagName).toBe("MARK");
    expect(screen.getByText("Analyst")).toBeInTheDocument();
  });

  it("covers a graphic picture with the gate, and leaves it out of the compact slot", () => {
    const item = eventItem({ ...EVENT, media: MEDIA, is_graphic: true });
    const { container, rerender } = render(<Item variant="list" {...item} />);
    expect(
      screen.getByRole("button", { name: "Show graphic content (18 or older)" }),
    ).toBeInTheDocument();
    rerender(<Item variant="compact" {...item} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /graphic/ })).toBeNull();
  });

  it("picks instead of opening with onSelect, and marks the item it stands on", () => {
    const onSelect = vi.fn();
    render(
      <Item
        variant="list"
        {...eventItem(EVENT)}
        onSelect={onSelect}
        selectLabel="Read from here"
        selected
      />,
    );
    expect(screen.queryByRole("link", { name: "Strike on the depot" })).toBeNull();
    const button = screen.getByRole("button", { name: "Read from here" });
    expect(button).toHaveAttribute("aria-current", "true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("stays static without href or onSelect, the analyst unlinked", () => {
    render(<Item variant="compact" {...eventItem(EVENT)} href={undefined} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/· ana$/)).toBeInTheDocument();
  });

  it("puts actions after the badge, outside the item's link", () => {
    render(
      <Item variant="compact" {...eventItem(EVENT)} actions={<button type="button">Remove</button>} />,
    );
    const link = screen.getByRole("link", { name: "Strike on the depot" });
    expect(link).not.toContainElement(screen.getByRole("button", { name: "Remove" }));
  });

  it("opens a new tab with newTab", () => {
    render(<Item variant="compact" {...eventItem(EVENT)} newTab />);
    expect(screen.getByRole("link", { name: "Strike on the depot" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});

describe("<Item variant=\"compact\">, a long title and a long analyst", () => {
  const long = {
    kind: "event" as const,
    title: "Ceremony of the anniversary of the regiment at the northern training ground near the river",
    analyst: { author: { username: "Stinky915846091_with_a_very_long_handle" } },
    date: "7 Jan 2025",
    badge: <span>Detected</span>,
  };

  it("keeps the badge out of the text column, so no text runs under it", () => {
    render(<Item variant="compact" {...long} />);
    const badge = screen.getByText("Detected");
    const title = screen.getByText(long.title);
    const column = title.parentElement!;
    expect(column).not.toContainElement(badge);
    expect(column.parentElement).toContainElement(badge);
  });

  it("gives the title two lines and ends the detail line in an ellipsis", () => {
    render(<Item variant="compact" {...long} />);
    expect(screen.getByText(long.title)).toHaveClass("line-clamp-2");
    const detail = screen.getByText(/Stinky915846091/);
    expect(detail.tagName).toBe("P");
    expect(detail).toHaveClass("truncate");
    expect(detail).toHaveTextContent("Event · 7 Jan 2025 · Stinky915846091_with_a_very_long_handle");
  });
});
