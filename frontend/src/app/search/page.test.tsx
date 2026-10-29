import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace, back: vi.fn() }),
}));

// The two pickers the filter panel fills from, read on every render, and the timelines.
const reads = vi.hoisted(() => ({
  tags: [{ id: "t1", name: "dam" }],
  dates: { occurred_date: [], submitted: [] } as {
    occurred_date: { date: string; count: number }[];
    submitted: { date: string; count: number }[];
  },
  paths: [] as (string | null)[],
}));
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => {
    reads.paths.push(path);
    return {
      data:
        path === "/tags"
          ? reads.tags
          : path?.startsWith("/search/dates")
            ? reads.dates
            : path
              ? []
              : null,
    };
  },
}));

const search = vi.fn();
const searchSections = vi.fn();
// The Author typeahead is stubbed: tests drive the field by hand.
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  search: (opts: unknown) => search(opts),
  searchSections: (opts: unknown) => searchSections(opts),
  suggestAuthors: () => Promise.resolve([]),
}));

const setViewState = vi.fn();
const setSelectedId = vi.fn();
vi.mock("@/contexts/MapStateContext", () => ({
  useMapState: () => ({ setViewState, setSelectedId }),
}));

let currentUser: { id: string; username: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: currentUser }) }));

const countCollectableMatches = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  countCollectableMatches: (match: unknown) => countCollectableMatches(match),
}));

import type {
  SearchCollectionHit,
  SearchEventHit,
  SearchHit,
  SearchOrganizationHit,
  SearchResponse,
  SearchSection,
  SearchSections,
  SearchSiteHit,
  SearchUserHit,
} from "@/types";

import { ApiError } from "@/lib/api";
import { NO_ANSWER } from "@/lib/errors";
import SearchPage from "./page";
import { openFilterGroups, sheetButton } from "@/test/filters";
import { pickOption } from "@/test/options";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collectionHit = (over: Partial<SearchCollectionHit> = {}): SearchCollectionHit => ({
  type: "collection",
  id: "c1",
  owner: OWNER,
  title: "Nova Kakhovka dam",
  description: "<p>The breach and the flooding downstream of it.</p>",
  description_text: "The breach and the flooding downstream of it.",
  cover: [],
  tags: [],
  event_count: 5,
  first_date: "2026-06-06",
  last_date: "2026-06-09",
  created_at: "2026-06-20T09:00:00Z",
  hidden_at: null,
  ...over,
});

const eventHit = (over: Partial<SearchEventHit> = {}): SearchEventHit => ({
  type: "event",
  id: "e1",
  title: "Kakhovka spillway",
  title_highlight: "Kakhovka spillway",
  lat: 46.77,
  lng: 33.37,
  occurred_date: "2026-06-06",
  created_at: "2026-06-07T10:00:00Z",
  is_graphic: false,
  status: "geolocated",
  owner: OWNER,
  geolocators: [],
  media: [],
  tags: [],
  ...over,
});

const siteHit = (): SearchSiteHit => ({
  type: "site",
  id: "s1",
  name: "Kakhovka depot",
  name_highlight: "\u0002Kakhovka\u0003 depot",
  kind: "depot",
  owner: OWNER,
  last_source: { id: "src1", captured_at: "2026-06-08T10:00:00Z", provider: null },
  media: [],
});

const userHit = (): SearchUserHit => ({
  type: "user",
  id: "u2",
  username: "kakhovka_watch",
  username_highlight: "kakhovka_watch",
  bio: null,
  bio_highlight: null,
  avatar_url: null,
});

const orgHit = (): SearchOrganizationHit => ({
  type: "organization",
  id: "o1",
  slug: "kakhovka-watch",
  name: "Kakhovka Watch",
  name_highlight: "\u0002Kakhovka\u0003 Watch",
  bio: "Tracks the reservoir.",
  bio_highlight: null,
  avatar_url: null,
  member_count: 1,
});

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  hits: [],
  total: over.hits?.length ?? 0,
  cursor: null,
  query: "kakhovka",
  ...over,
});

/** A sections response: one section per type its hits hold, in the order given. */
const sections = (
  hits: SearchHit[],
  over: Partial<SearchSections> & { more?: SearchHit["type"][] } = {},
): SearchSections => {
  const { more = [], ...rest } = over;
  const types = [...new Set(hits.map((hit) => hit.type))];
  return {
    sections: types.map(
      (type): SearchSection => ({
        type,
        hits: hits.filter((hit) => hit.type === type),
        total: hits.filter((hit) => hit.type === type).length + (more.includes(type) ? 5 : 0),
        cursor: more.includes(type) ? `next-${type}` : null,
      }),
    ),
    suggestion: null,
    query: "kakhovka",
    ...rest,
  };
};

const rail = () => screen.getByRole("complementary", { name: "Filters" });
/** A dimension's line in the rail, or null while the panel does not offer it. */
const line = (name: string) => within(rail()).queryByRole("combobox", { name });
const heading = (name: string) => within(rail()).queryByRole("heading", { name });
/** Toggles a Show option: a pick through the Show line's search, a removal from its pill. */
function chip(name: string) {
  const pill = within(rail()).queryByRole("button", { name: `Remove ${name}` });
  if (pill) fireEvent.click(pill);
  else pickOption(line("Show")!, name);
}
const linkTo = (href: string) => document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
/** The item a link is stretched over. */
const rowOf = (href: string) => linkTo(href).parentElement!;

beforeEach(openFilterGroups);

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams("q=kakhovka");
  reads.dates = { occurred_date: [], submitted: [] };
  reads.paths = [];
  search.mockResolvedValue(response());
  searchSections.mockResolvedValue(sections([]));
});

describe("the search page with no kind picked", () => {
  it("groups the hits by kind under headings, in the order the API sends, with no count", async () => {
    searchSections.mockResolvedValue(
      sections([
        eventHit(),
        eventHit({ id: "r1", status: "requested", title: "Open call", title_highlight: "Open call", occurred_date: null }),
        siteHit(),
        collectionHit(),
        userHit(),
        orgHit(),
      ]),
    );

    render(<SearchPage />);

    await screen.findByText("Kakhovka spillway");
    expect(searchSections).toHaveBeenCalledWith(expect.objectContaining({ q: "kakhovka", types: [] }));
    expect(search).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Events",
      "Sites",
      "Collections",
      "Analysts",
      "Organizations",
    ]);

    const events = screen.getByRole("region", { name: "Events" });
    expect(within(events).getByRole("link", { name: "Kakhovka spillway" })).toHaveAttribute(
      "href",
      "/events/e1",
    );
    expect(rowOf("/events/e1")).toHaveTextContent(/Event·6 Jun 2026·A?anaGeolocated/);
    expect(rowOf("/requests/r1")).toHaveTextContent(/Open callRequest·A?anaRequested/);
    expect(events).toContainElement(rowOf("/requests/r1"));

    const site = rowOf("/sites/s1");
    expect(site.querySelector("mark")).toHaveTextContent("Kakhovka");
    expect(site).toHaveTextContent(/Site·8 Jun 2026·A?anaDepot/);
    expect(rowOf("/collections/c1")).toHaveTextContent(/^Nova Kakhovka damCollection·.*5 events$/);
    expect(rowOf("/profile/kakhovka_watch")).toHaveTextContent(/kakhovka_watchAnalyst$/);
    expect(rowOf("/organizations/kakhovka-watch")).toHaveTextContent(
      "Kakhovka WatchOrganization1 member",
    );

    expect(screen.queryByText(/result/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("leads each kind that holds more to its own list through See all", async () => {
    searchParams = new URLSearchParams("q=kakhovka&tag=dam&author=ana");
    searchSections.mockResolvedValue(
      sections([eventHit(), siteHit(), collectionHit()], { more: ["event", "collection"] }),
    );

    render(<SearchPage />);
    await screen.findByText("Kakhovka spillway");

    const seeAll = (name: string) =>
      within(screen.getByRole("region", { name })).queryByRole("link", { name: "See all" });
    // Events keep the filters and take every status.
    expect(seeAll("Events")).toHaveAttribute(
      "href",
      "/search?q=kakhovka&type=event&tag=dam&author=ana",
    );
    // A kind other than events keeps only the filters it answers.
    expect(seeAll("Collections")).toHaveAttribute(
      "href",
      "/search?q=kakhovka&type=collection&tag=dam&author=ana",
    );
    expect(seeAll("Sites")).not.toBeInTheDocument();
  });

  it("covers a graphic picture with the gate", async () => {
    const media = {
      id: "m1",
      role: "source" as const,
      storage_url: "http://localhost:8000/x.jpg",
      kind: "image" as const,
      sha256: "0".repeat(64),
      original_filename: null,
    };
    searchSections.mockResolvedValue(
      sections([
        eventHit({ media: [media] }),
        eventHit({ id: "e2", title: "Graphic", title_highlight: "Graphic", media: [media], is_graphic: true }),
      ]),
    );
    const { container } = render(<SearchPage />);

    await screen.findByText("Graphic");
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Show graphic content (18 or older)" }),
    ).toHaveLength(1);
  });

  it("lists sections for a pick of several kinds", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=site&type=collection");
    searchSections.mockResolvedValue(sections([siteHit(), collectionHit()]));

    render(<SearchPage />);

    expect(await screen.findByRole("region", { name: "Sites" })).toBeInTheDocument();
    expect(searchSections).toHaveBeenCalledWith(
      expect.objectContaining({ types: ["site", "collection"] }),
    );
  });
});

describe("the search page's URL", () => {
  it("opens the list of one kind from See all, and Back returns to the sections", async () => {
    searchSections.mockResolvedValue(sections([siteHit(), userHit()], { more: ["site"] }));
    search.mockResolvedValue(response({ hits: [siteHit()] }));
    const { rerender } = render(<SearchPage />);
    const href = within(await screen.findByRole("region", { name: "Sites" }))
      .getByRole("link", { name: "See all" })
      .getAttribute("href")!;

    // The link navigates; the page follows the URL it lands on.
    searchParams = new URLSearchParams(href.split("?")[1]);
    rerender(<SearchPage />);

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: "kakhovka", types: ["site"] })),
    );
    expect(await screen.findByRole("link", { name: "Kakhovka depot" })).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Remove Sites" })).toBeInTheDocument();

    searchParams = new URLSearchParams("q=kakhovka");
    rerender(<SearchPage />);

    expect(await screen.findByRole("region", { name: "Analysts" })).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: "Remove Sites" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("kakhovka");
    // Reading the URL writes nothing back.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("pushes a new Show pick and replaces the URL as the query changes", async () => {
    searchSections.mockResolvedValue(sections([siteHit()]));
    render(<SearchPage />);
    await screen.findByRole("link", { name: "Kakhovka depot" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kakhovka dam" } });
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/search?q=kakhovka+dam", { scroll: false }));
    expect(push).not.toHaveBeenCalled();

    chip("Sites");
    await waitFor(() => expect(push).toHaveBeenLastCalledWith("/search?q=kakhovka+dam&type=site", { scroll: false }));
  });
});

describe("the Show field", () => {
  it("offers every kind, without counts", async () => {
    searchSections.mockResolvedValue(sections([eventHit()]));
    render(<SearchPage />);

    await screen.findByText("Kakhovka spillway");
    fireEvent.focus(line("Show")!);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Requested",
      "Detected",
      "Geolocated",
      "Sites",
      "Collections",
      "Analysts",
      "Organizations",
    ]);
  });

  it("lists only what the picked chips name, and drops the event filters once no event is listed", async () => {
    searchSections.mockResolvedValue(sections([siteHit()]));
    search.mockResolvedValue(response({ hits: [siteHit()] }));
    render(<SearchPage />);
    await waitFor(() => expect(linkTo("/sites/s1")).toBeInTheDocument());
    expect(heading("When")).toBeInTheDocument();

    chip("Sites");
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ types: ["site"] })),
    );
    expect(heading("When")).not.toBeInTheDocument();
    expect(line("Conflict")).not.toBeInTheDocument();
    expect(line("Author")).toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Remove Sites" })).toBeInTheDocument();

    chip("Geolocated");
    await waitFor(() =>
      expect(searchSections).toHaveBeenLastCalledWith(
        expect.objectContaining({ types: ["event", "site"], show: ["site", "geolocated"] }),
      ),
    );
    expect(heading("When")).toBeInTheDocument();
  });

  it("keeps the tags and the author when the pick steps from events to collections", async () => {
    searchParams = new URLSearchParams("type=event&status=geolocated&tag=dam&author=ana&conflict=Yemen");

    render(<SearchPage />);
    await waitFor(() => expect(search).toHaveBeenCalled());
    chip("Geolocated");
    chip("Collections");

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ types: ["collection"], tags: ["dam"], author: "ana", conflicts: [] }),
      ),
    );
    expect(line("Tags")).toBeInTheDocument();
    expect(line("Author")).toBeInTheDocument();
    for (const name of ["Conflict", "Source kind", "Location guess"]) {
      expect(line(name)).not.toBeInTheDocument();
    }
    expect(heading("When")).not.toBeInTheDocument();
  });

  it("browses one analyst's shelf on an author alone", async () => {
    // Where the profile's Collections `See all` lands: author only, no query.
    searchParams = new URLSearchParams("type=collection&author=ana");
    search.mockResolvedValue(response({ query: "", hits: [collectionHit()] }));

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "", types: ["collection"], author: "ana" }),
    );
    expect(within(rail()).getByRole("button", { name: "Remove Collections" })).toBeInTheDocument();
  });

  it("reads a profile link's type=event as every status", async () => {
    searchParams = new URLSearchParams("type=event&author=ana");

    render(<SearchPage />);

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["event"],
          show: ["requested", "detected", "geolocated"],
          author: "ana",
        }),
      ),
    );
  });

  it("offers only the Show field on analysts", async () => {
    searchSections.mockResolvedValue(sections([userHit()]));
    render(<SearchPage />);
    await screen.findByText("kakhovka_watch");

    chip("Analysts");

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ types: ["user"] })),
    );
    expect(within(rail()).getAllByRole("heading").map((h) => h.textContent)).toEqual(["What"]);
    expect(line("Author")).not.toBeInTheDocument();
  });
});

describe("the list of one kind", () => {
  const loadMore = () => screen.queryByRole("button", { name: "Show more" });

  it("appends the next page from the cursor, with the request that minted it", async () => {
    searchParams = new URLSearchParams("type=event&conflict=Yemen&author=ana");
    search
      .mockResolvedValueOnce(response({ query: "", hits: [eventHit()], cursor: "c1", total: 2 }))
      .mockResolvedValueOnce(
        response({
          query: "",
          hits: [eventHit({ id: "e2", title: "Mukalla port", title_highlight: "Mukalla port" })],
          total: 2,
        }),
      );

    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    fireEvent.click(loadMore()!);

    expect(await screen.findByText("Mukalla port")).toBeInTheDocument();
    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "", cursor: "c1", types: ["event"], conflicts: ["Yemen"], author: "ana" }),
    );
    // The last page carries no cursor, so the control leaves.
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("offers no Show more when the first page holds every match", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=site");
    search.mockResolvedValue(response({ hits: [siteHit()] }));

    render(<SearchPage />);

    expect(await screen.findByRole("link", { name: "Kakhovka depot" })).toBeInTheDocument();
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("keeps the loaded rows and offers a retry when a page fails", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=event");
    search
      .mockResolvedValueOnce(response({ hits: [eventHit()], cursor: "c1" }))
      .mockRejectedValueOnce(new ApiError("Vidit does not respond.", 0, null, false, NO_ANSWER));

    render(<SearchPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Vidit does not respond")).toBeInTheDocument();
    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("the search page's states", () => {
  it("focuses the search field and shows no text before a query", () => {
    searchParams = new URLSearchParams();
    render(<SearchPage />);

    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(searchSections).not.toHaveBeenCalled();
    expect(screen.queryByText(/search|type/i, { selector: "p" })).not.toBeInTheDocument();
  });

  it("keeps the shown results while the next ones load", async () => {
    searchSections.mockResolvedValueOnce(sections([eventHit()]));
    render(<SearchPage />);
    await screen.findByText("Kakhovka spillway");

    searchSections.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kakhovka spill" } });
    await waitFor(() => expect(searchSections).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });

  it("says No matches on one line when nothing matches", async () => {
    render(<SearchPage />);

    expect(await screen.findByText("No matches.")).toBeInTheDocument();
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
  });
});

describe("the search page's filter panel", () => {
  it("puts the panel in the rail and applies the sheet's dates at once", async () => {
    searchSections.mockResolvedValue(sections([eventHit()]));
    reads.dates = {
      occurred_date: [
        { date: "2026-05-01", count: 2 },
        { date: "2026-06-09", count: 1 },
      ],
      submitted: [],
    };

    render(<SearchPage />);
    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(heading("When")).toBeInTheDocument();

    fireEvent.click(sheetButton());
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.change(within(sheet).getByLabelText("Event date window start date"), {
      target: { value: "2026-06-01" },
    });

    await waitFor(() =>
      expect(searchSections).toHaveBeenCalledWith(
        expect.objectContaining({ eventFrom: "2026-06-01" }),
      ),
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove filter Event date: From 1 Jun 2026")).toBeInTheDocument();
  });

  it("reads its timelines for the events the query and the filters match", async () => {
    reads.dates = {
      occurred_date: [
        { date: "2026-06-01", count: 2 },
        { date: "2026-06-09", count: 1 },
      ],
      submitted: [],
    };
    searchParams = new URLSearchParams("q=kakhovka&tag=dam&type=site&type=event&status=geolocated");
    render(<SearchPage />);

    await waitFor(() => expect(searchSections).toHaveBeenCalled());
    const path = reads.paths.findLast((p) => p?.startsWith("/search/dates"))!;
    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.get("q")).toBe("kakhovka");
    expect(query.getAll("type")).toEqual(["event"]);
    expect(query.getAll("status")).toEqual(["geolocated"]);
    expect(query.getAll("tag")).toEqual(["dam"]);
    expect(within(rail()).getAllByRole("slider", { name: /Event date window/ })).toHaveLength(2);
  });

  it("shows the active filters in their lines, and as pills on the phone bar", async () => {
    searchParams = new URLSearchParams("q=kakhovka&tag=drone&author=ana&has_coords=false");
    searchSections.mockResolvedValue(sections([eventHit()]));
    render(<SearchPage />);

    await waitFor(() =>
      expect(searchSections).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["drone"], author: "ana", locationGuess: ["blind"] }),
      ),
    );
    for (const value of ["drone", "ana", "No guess"]) {
      expect(within(rail()).getByRole("button", { name: `Remove ${value}` })).toBeInTheDocument();
    }
    expect(within(rail()).queryByTitle(/^Remove filter/)).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove filter Tags: drone")).toBeInTheDocument();
    expect(screen.getByTitle("Remove filter Location guess: No guess")).toBeInTheDocument();
  });
});

describe("the approval filters on the search page", () => {
  it("reads them off the URL, sends them and shows their pills", async () => {
    searchParams = new URLSearchParams("approved=true&approved_by_org=kakhovka-watch");
    searchSections.mockResolvedValue(sections([eventHit()], { query: "" }));

    render(<SearchPage />);

    await waitFor(() =>
      expect(searchSections).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          approvedBy: { kind: "organization", slug: "kakhovka-watch", name: "kakhovka-watch" },
        }),
      ),
    );
    expect(screen.getByTitle("Remove filter Approved by: kakhovka-watch")).toBeInTheDocument();
    expect(screen.getByTitle("Remove filter Approved only")).toBeInTheDocument();
    expect(within(rail()).getByRole("switch", { name: "Approved only" })).toBeChecked();
  });

  it("commits Approved only from the panel into the URL", async () => {
    searchSections.mockResolvedValue(sections([eventHit()]));

    render(<SearchPage />);
    await screen.findByText("Kakhovka spillway");
    fireEvent.click(within(rail()).getByRole("switch", { name: "Approved only" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/search?q=kakhovka&approved=true", { scroll: false }),
    );
  });
});

describe("the selection", () => {
  const theirs = (): SearchEventHit => ({
    ...eventHit(),
    id: "e2",
    title: "Their strike",
    title_highlight: "Their strike",
    owner: { id: "u9", username: "bo", avatar_url: null },
  });
  const actions = () => screen.queryByRole("complementary", { name: "Actions" });
  const own = () => screen.getByRole("checkbox", { name: "Select Kakhovka spillway" });

  beforeEach(() => {
    currentUser = { id: OWNER.id, username: OWNER.username };
    searchParams = new URLSearchParams("q=kakhovka&type=event");
    countCollectableMatches.mockResolvedValue(7);
    search.mockResolvedValue(response({ hits: [eventHit(), theirs()] }));
  });

  afterEach(() => {
    currentUser = null;
  });

  it("offers no checkbox and no actions to a signed-out reader", async () => {
    currentUser = null;
    render(<SearchPage />);

    expect(await screen.findByText("Their strike")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(actions()).not.toBeInTheDocument();
  });

  it("puts a checkbox on the reader's own events only, and holds the actions' room idle", async () => {
    render(<SearchPage />);

    expect(
      await screen.findByRole("checkbox", { name: "Select Kakhovka spillway" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Their strike" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    // Mounted but inert: the header keeps its height for when a row is picked.
    expect(actions()).toHaveAttribute("inert");
    const head = await screen.findByRole("checkbox", { name: "Select all" });
    await waitFor(() => expect(head).toBeEnabled());
  });

  it("wakes Add to collection on a pick, and the head checkbox clears a partial selection", async () => {
    render(<SearchPage />);
    await screen.findByRole("checkbox", { name: "Select all" });
    fireEvent.click(own());

    expect(actions()).not.toHaveAttribute("inert");
    expect(
      within(actions() as HTMLElement).getByRole("button", { name: "Add to collection" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const head = screen.getByRole("checkbox", { name: "Clear selection" }) as HTMLInputElement;
    expect(head.indeterminate).toBe(true);

    fireEvent.click(head);
    expect(own()).not.toBeChecked();
    expect(actions()).toHaveAttribute("inert");
    expect(screen.getByRole("checkbox", { name: "Select all" })).not.toBeChecked();
  });

  it("selects every match from the head checkbox, with the statuses of the pick alone", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=event&status=geolocated");
    render(<SearchPage />);
    const head = await screen.findByRole("checkbox", { name: "Select all" });
    // The box stays disabled until the match count lands.
    await waitFor(() => expect(head).toBeEnabled());
    fireEvent.click(head);

    expect(countCollectableMatches).toHaveBeenCalledWith(
      expect.objectContaining({ q: "kakhovka", show: ["geolocated"] }),
    );
    expect(screen.getByText("7 selected")).toBeInTheDocument();
    expect(own()).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Clear selection" }));
    expect(screen.getByText("Select all")).toBeInTheDocument();
    expect(own()).not.toBeChecked();
  });

  it("refuses Select all past the bulk add's cap and says why, while rows stay pickable", async () => {
    countCollectableMatches.mockResolvedValue(501);
    render(<SearchPage />);

    expect(await screen.findByText("Narrow to 500 or fewer to select all")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeDisabled();

    fireEvent.click(own());
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("makes a row from Show more selectable, and Select all covers it", async () => {
    search.mockReset();
    search
      .mockResolvedValueOnce(response({ hits: [eventHit()], cursor: "c1", total: 2 }))
      .mockResolvedValueOnce(
        response({
          hits: [eventHit({ id: "e3", title: "Mukalla port", title_highlight: "Mukalla port" })],
          total: 2,
        }),
      );
    countCollectableMatches.mockResolvedValue(2);
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Mukalla port" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Clear selection" }));
    const head = screen.getByRole("checkbox", { name: "Select all" });
    await waitFor(() => expect(head).toBeEnabled());
    fireEvent.click(head);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Mukalla port" })).toBeChecked();
    expect(own()).toBeChecked();
  });

  it("offers no checkbox on the sections", async () => {
    searchParams = new URLSearchParams("q=kakhovka");
    searchSections.mockResolvedValue(sections([eventHit(), siteHit()]));
    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(actions()).not.toBeInTheDocument();
  });

  it("starts over when the query changes", async () => {
    render(<SearchPage />);
    await screen.findByRole("checkbox", { name: "Select all" });
    fireEvent.click(own());
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kakhovka dam" } });

    await waitFor(() => expect(screen.queryByText("1 selected")).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(own()).not.toBeChecked();
  });
});

describe("the shortcut under the search field", () => {
  it("opens a typed coordinate pair on the map", async () => {
    searchParams = new URLSearchParams("q=31.46939%2C+34.38510");
    render(<SearchPage />);

    const row = screen.getByRole("link", { name: /31\.469390, 34\.385100/ });
    expect(row).toHaveAttribute("href", "/map");
    fireEvent.click(row);
    expect(setSelectedId).toHaveBeenCalledWith(null);
    expect(setViewState).toHaveBeenCalledWith({ latitude: 31.46939, longitude: 34.3851, zoom: 14 });
  });

  it("lists the analyst a query names exactly once, first in its section", async () => {
    searchParams = new URLSearchParams("q=%40KAKHOVKA_WATCH");
    const other = { ...userHit(), id: "u3", username: "kakhovka_fan", username_highlight: "kakhovka_fan" };
    searchSections.mockResolvedValue(sections([other, userHit()], { query: "@KAKHOVKA_WATCH" }));
    render(<SearchPage />);

    const rows = await screen.findAllByRole("link", { name: "kakhovka_watch" });
    expect(rows).toHaveLength(1);
    const analysts = within(screen.getByRole("region", { name: "Analysts" })).getAllByRole("link");
    expect(analysts[0]).toHaveAttribute("href", "/profile/kakhovka_watch");
  });

  it("lists the organization a query names by its name once, first in its section", async () => {
    searchParams = new URLSearchParams("q=kakhovka+watch");
    const other = { ...orgHit(), id: "o2", slug: "watchers", name: "Watchers", name_highlight: "Watchers" };
    searchSections.mockResolvedValue(sections([other, orgHit()], { query: "kakhovka watch" }));
    render(<SearchPage />);

    const rows = await screen.findAllByRole("link", { name: "Kakhovka Watch" });
    expect(rows).toHaveLength(1);
    const organizations = within(screen.getByRole("region", { name: "Organizations" })).getAllByRole(
      "link",
    );
    expect(organizations[0]).toHaveAttribute("href", "/organizations/kakhovka-watch");
  });
});

describe("a search that finds nothing", () => {
  it("offers the closest spelling, and a click searches it", async () => {
    searchParams = new URLSearchParams("q=Khan+Younis");
    const found = eventHit({ title: "Khan Yunis", title_highlight: "Khan Yunis" });
    searchSections.mockImplementation(({ q }: { q: string }) =>
      Promise.resolve(
        q === "Khan Yunis"
          ? sections([found], { query: q })
          : sections([], { query: q, suggestion: "Khan Yunis" }),
      ),
    );
    render(<SearchPage />);

    const offer = await screen.findByRole("button", { name: "Khan Yunis" });
    expect(screen.getByText(/No matches\. Did you mean/)).toBeInTheDocument();
    fireEvent.click(offer);

    await waitFor(() =>
      expect(searchSections).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Khan Yunis" })),
    );
    expect(await screen.findByRole("link", { name: /^Khan Yunis/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("Khan Yunis");
  });
});
