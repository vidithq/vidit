import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionCard } from "./CollectionCard";
import type { Collection } from "@/lib/collections";

/**
 * What the card has to get right is the readings it prints beside the mosaic:
 * the meta line, and the tags the collection's items carry.
 *
 * The tags are derived server-side from the items, so the card neither builds
 * nor caps them: it prints the row the event card prints, in the same pills,
 * and prints nothing at all for a collection holding nothing tagged.
 */
const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Three days of strikes on the eastern approach." },
        ],
      },
    ],
  },
  description_text: "Three days of strikes on the eastern approach.",
  cover: [],
  tags: [],
  event_count: 5,
  first_date: "2026-03-14",
  last_date: "2026-03-16",
  created_at: "2026-03-21T09:00:00Z",
  ...over,
});

describe("CollectionCard", () => {
  it("prints every tag its items carry", () => {
    render(
      <CollectionCard
        collection={collection({
          tags: [
            { id: "t1", name: "satellite", category: "capture_source" },
            { id: "t2", name: "rail", category: "free" },
            { id: "t3", name: "corridor", category: "free" },
          ],
        })}
      />,
    );

    // Uncapped, the event card's own rule: every tag the union holds reaches
    // the card, and the meta line it sits under still reads.
    for (const name of ["satellite", "rail", "corridor"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("5 events")).toBeInTheDocument();
  });

  it("renders no tag row for a collection holding nothing tagged", () => {
    render(<CollectionCard collection={collection()} />);

    expect(screen.queryByText("satellite")).toBeNull();
    expect(screen.getByText("5 events")).toBeInTheDocument();
  });
});
