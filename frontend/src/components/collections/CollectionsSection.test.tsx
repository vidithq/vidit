import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const fetchUserCollections = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  fetchUserCollections: (username: string, perPage: number, page: number) =>
    fetchUserCollections(username, perPage, page),
}));

import { type Collection, type CollectionPage } from "@/lib/collections";

import { CollectionsSection } from "./CollectionsSection";

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: { id: "u1", username: "ana", avatar_url: null },
  title: "Kupiansk rail corridor",
  description: "Three days of strikes on the eastern approach.",
  cover: [],
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
  fetchUserCollections.mockReset();
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

  it("sends the owner of a filled shelf to the same page", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn />);

    expect(
      screen.getByRole("link", { name: "New collection" }),
    ).toHaveAttribute("href", "/collections/new");
  });

  it("gives a card no type square: the mosaic is its picture", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    // The card's only picture is the mosaic. The accent square that used to
    // stand in front of the heading took width from the two lines the title
    // renders in, and the mosaic already says which collection this is.
    const card = screen
      .getByRole("heading", { name: "Kupiansk rail corridor" })
      .closest("div.group");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".bg-orange-500\\/15")).toBeNull();
  });

  it("clamps a card's description to two lines", () => {
    useApiResource.mockReturnValue({ data: page([collection()]) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(
      screen.getByText("Three days of strikes on the eastern approach."),
    ).toHaveClass("line-clamp-2");
  });

  it("asks for nothing further once the whole shelf is on screen", () => {
    useApiResource.mockReturnValue({ data: page(shelf(4)) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(useApiResource).toHaveBeenCalledWith(
      "/users/ana/collections?page=1&per_page=4",
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("appends the next page in place and drops the control at the end", async () => {
    useApiResource.mockReturnValue({ data: page(shelf(4), 6) });
    fetchUserCollections.mockResolvedValue(
      page(
        [
          collection({ id: "c5", title: "Collection 5" }),
          collection({ id: "c6", title: "Collection 6" }),
        ],
        6,
        2,
      ),
    );

    render(<CollectionsSection username="ana" isOwn={false} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    await waitFor(() =>
      expect(fetchUserCollections).toHaveBeenCalledWith("ana", 4, 2),
    );
    // The first page stays on screen and the second one lands under it.
    const titles = screen
      .getAllByRole("heading", { level: 3 })
      .map((row) => row.textContent);
    expect(titles).toEqual([
      "Collection 1",
      "Collection 2",
      "Collection 3",
      "Collection 4",
      "Collection 5",
      "Collection 6",
    ]);
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("offers the control while the shelf holds more than the grid", () => {
    useApiResource.mockReturnValue({ data: page(shelf(4), 11) });

    render(<CollectionsSection username="ana" isOwn={false} />);

    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("renders nothing until the read lands", () => {
    useApiResource.mockReturnValue({ data: null });

    const { container } = render(<CollectionsSection username="ana" isOwn />);

    expect(container).toBeEmptyDOMElement();
  });
});
