import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionCard } from "./CollectionCard";
import type { Collection } from "@/lib/collections";

/**
 * The meta line and the tags the collection's items carry. Tags are derived
 * server-side: the card prints the event card's pills, uncapped, and nothing for
 * an untagged collection.
 */
const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: "<p>Three days of strikes on the eastern approach.</p>",
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
            { id: "t1", name: "satellite" },
            { id: "t2", name: "rail" },
            { id: "t3", name: "corridor" },
          ],
        })}
      />,
    );

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
