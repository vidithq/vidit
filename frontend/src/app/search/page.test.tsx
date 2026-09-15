import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
}));

// The two pickers the filter panel fills itself from. The page reads them
// declaratively on every render, whatever scope it is on.
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: () => ({ data: [] }),
}));

const search = vi.fn();
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  search: (opts: unknown) => search(opts),
}));

import type { Collection } from "@/lib/collections";
import type { SearchEventHit, SearchResponse, SearchUserHit } from "@/types";

import SearchPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: "c1",
  owner: OWNER,
  title: "Nova Kakhovka dam",
  description: "The breach and the flooding downstream of it.",
  cover: [],
  event_count: 5,
  first_date: "2026-06-06",
  last_date: "2026-06-09",
  created_at: "2026-06-20T09:00:00Z",
  ...over,
});

const eventHit = (): SearchEventHit => ({
  id: "e1",
  title: "Kakhovka spillway",
  title_highlight: "Kakhovka spillway",
  lat: 46.77,
  lng: 33.37,
  event_date: "2026-06-06",
  is_graphic: false,
  status: "geolocated",
  owner: OWNER,
  media: [],
  tags: [],
});

const userHit = (): SearchUserHit => ({
  id: "u2",
  username: "kakhovka_watch",
  username_highlight: "kakhovka_watch",
  bio: null,
  bio_highlight: null,
  avatar_url: null,
});

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  geolocations: [],
  requests: [],
  collections: [],
  users: [],
  total: { geolocations: 0, requests: 0, collections: 0, users: 0 },
  query: "kakhovka",
  type: "all",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams("q=kakhovka");
});

describe("the search page's Collections group", () => {
  it("renders the profile card, with the byline the profile hides", async () => {
    search.mockResolvedValue(
      response({
        collections: [collection()],
        total: { geolocations: 0, requests: 0, collections: 1, users: 0 },
      }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    // The count the group prints is the pre-limit total, and the card says
    // whose shelf this is: a result stands beside other analysts' work.
    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(screen.getByText("ana")).toBeInTheDocument();
  });

  it("stays off the page when nothing matched", async () => {
    search.mockResolvedValue(response({ geolocations: [eventHit()] }));

    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.queryByText("Nova Kakhovka dam")).not.toBeInTheDocument();
  });

  it("reads type=collection off the URL and shows that group alone", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=collection");
    // A response carrying every group, so what the page renders is the scope's
    // own gate rather than an empty payload.
    search.mockResolvedValue(
      response({
        type: "collection",
        collections: [collection()],
        geolocations: [eventHit()],
        users: [userHit()],
      }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    expect(screen.queryByText("Kakhovka spillway")).not.toBeInTheDocument();
    expect(screen.queryByText("kakhovka_watch")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ q: "kakhovka", type: "collection" }),
      ),
    );
  });

  it("browses one analyst's shelf on an author alone", async () => {
    // Where the profile's Collections `Show more` lands: no query, the author
    // as the only filter. The empty query is a valid search here, so the page
    // must issue the read rather than hold at the start-typing prompt.
    searchParams = new URLSearchParams("type=collection&author=ana");
    search.mockResolvedValue(
      response({ type: "collection", query: "", collections: [collection()] }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ q: "", type: "collection", author: "ana" }),
      ),
    );
  });
});
