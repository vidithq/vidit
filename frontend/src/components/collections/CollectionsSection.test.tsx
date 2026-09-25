import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

import { type Collection, type CollectionPage } from "@/lib/collections";

import { CollectionsSection } from "./CollectionsSection";

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Three days of strikes on the eastern approach." }] },
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

const page = (
  items: Collection[],
  total = items.length,
  number = 1,
): CollectionPage => ({
  items,
  total,
  page: number,
  per_page: 4,
});

/** A shelf of `count` collections, each with its own id and title. */
const shelf = (count: number): Collection[] =>
  Array.from({ length: count }, (_, i) =>
    collection({ id: `c${i + 1}`, title: `Collection ${i + 1}` }),
  );

beforeEach(() => {
  useApiResource.mockReset();
});

describe("CollectionsSection", () => {
  it("reads the collections a visitor may see and opens each on its own page", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(
      screen.getByRole("link", { name: "Kupiansk rail corridor" }),
    ).toHaveAttribute("href", "/collections/c1");
    // The same meta line the collection's own page prints.
    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(screen.getByText("14 Mar 2026 to 16 Mar 2026")).toBeInTheDocument();
  });

  it("renders nothing for a visitor when the analyst has none to show", () => {
    useApiResource.mockReturnValue({ data: page([]) });

    const { container } = render(
      <CollectionsSection username="ana" isOwn={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers no create control to a visitor", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(
      screen.queryByRole("link", { name: "New collection" }),
    ).not.toBeInTheDocument();
  });

  it("sends the owner of an empty shelf to the create page", () => {
    useApiResource.mockReturnValue({ data: page([]) });

    render(<CollectionsSection username="ana" isOwn />);

    // A first-run surface keeps the heading and hands over: opening a
    // collection is a page of its own, so the section grows no form.
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "New collection" }),
    ).toHaveAttribute("href", "/collections/new");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("prints what a card says the collection holds", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(
      screen.getByText("Three days of strikes on the eastern approach."),
    ).toBeInTheDocument();
  });

  it("offers no expansion once the whole shelf is on screen", () => {
    useApiResource.mockReturnValue({ data: page(shelf(4)) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(useApiResource).toHaveBeenCalledWith(
      "/users/ana/collections?per_page=4",
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(
      screen.queryByRole("link", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("sends the reader to the analyst's collections in search past four", () => {
    useApiResource.mockReturnValue({ data: page(shelf(4), 6) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    // The grid still previews four; the whole shelf is walked in search,
    // scoped to this analyst on the one filter a collection carries.
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute(
      "href",
      "/search?type=collection&author=ana",
    );
  });

  it("renders nothing until the read lands", () => {
    useApiResource.mockReturnValue({ data: null });

    const { container } = render(<CollectionsSection username="ana" isOwn />);

    expect(container).toBeEmptyDOMElement();
  });
});
