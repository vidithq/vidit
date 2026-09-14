import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PickableEvent } from "@/lib/collections";

import { CollectionItemCard } from "./CollectionItemCard";

/**
 * The row every collection surface renders, measured once for both of them:
 * the picker's blocks open the event, the collection page's list picks the
 * player's step instead. A row carries one gesture either way.
 */
const ITEM: PickableEvent = {
  id: "e1",
  title: "Strike on the rail junction",
  status: "geolocated",
  media: null,
  is_graphic: false,
  event_date: "2026-03-14",
  event_coords: { lat: 49.71, lng: 37.616 },
  tags: [],
};

describe("CollectionItemCard", () => {
  it("opens the event, under its lifecycle badge and without a byline", () => {
    render(<CollectionItemCard item={ITEM} />);

    expect(
      screen.getByRole("link", { name: "Strike on the rail junction" }),
    ).toHaveAttribute("href", "/events/e1");
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    // A collection is one analyst's own work and the block above names them.
    expect(screen.queryByText(/^by/)).not.toBeInTheDocument();
  });

  it("picks the step instead of opening, when the surface steps", () => {
    const onSelect = vi.fn();

    render(<CollectionItemCard item={ITEM} selected onSelect={onSelect} />);

    // One gesture: the row is the button, and the title is plain text.
    expect(
      screen.queryByRole("link", { name: "Strike on the rail junction" }),
    ).not.toBeInTheDocument();
    const control = screen.getByRole("button", {
      name: "Read this collection from Strike on the rail junction",
    });
    expect(control).toHaveAttribute("aria-current", "true");

    fireEvent.click(control);
    expect(onSelect).toHaveBeenCalled();
  });

  it("lifts the surface's own control above the row", () => {
    const onRemove = vi.fn();

    render(
      <CollectionItemCard
        item={ITEM}
        action={<button onClick={onRemove}>Remove</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemove).toHaveBeenCalled();
  });
});
