import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
}));

// The two pickers the filter panel fills from, read on every render.
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string) => ({
    data: path === "/tags" ? [{ id: "t1", name: "dam" }] : [],
  }),
}));

const search = vi.fn();
// The Author typeahead is stubbed: tests drive the field by hand.
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  search: (opts: unknown) => search(opts),
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
  SearchOrganizationHit,
  SearchResponse,
  SearchSiteHit,
  SearchUserHit,
} from "@/types";

import { ApiError } from "@/lib/api";
import { NO_ANSWER } from "@/lib/errors";
import SearchPage from "./page";

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

const toggle = (title: string) => screen.queryByRole("button", { name: `Toggle ${title}` });
const rail = () => screen.getByRole("complementary", { name: "Filters" });
const chip = (name: string) => within(rail()).getByRole("button", { name });
const linkTo = (href: string) => document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
/** The item a link is stretched over. */
const rowOf = (href: string) => linkTo(href).parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams("q=kakhovka");
});

describe("the search page's list", () => {
  it("shows one row per hit, each naming its kind first, with no headings and no count", async () => {
    search.mockResolvedValue(
      response({
        hits: [
          eventHit(),
          siteHit(),
          collectionHit(),
          userHit(),
          orgHit(),
          eventHit({ id: "r1", status: "requested", title: "Open call", title_highlight: "Open call", occurred_date: null }),
        ],
      }),
    );

    render(<SearchPage />);

    await screen.findByText("Kakhovka spillway");
    expect(screen.getByRole("link", { name: "Kakhovka spillway" })).toHaveAttribute(
      "href",
      "/events/e1",
    );
    expect(rowOf("/events/e1")).toHaveTextContent(/Event·6 Jun 2026·A?anaGeolocated/);

    const site = rowOf("/sites/s1");
    expect(site.querySelector("mark")).toHaveTextContent("Kakhovka");
    expect(site).toHaveTextContent(/Site·8 Jun 2026·A?anaDepot/);

    expect(rowOf("/collections/c1")).toHaveTextContent(/^Nova Kakhovka damCollection·.*5 events$/);
    expect(rowOf("/profile/kakhovka_watch")).toHaveTextContent(/kakhovka_watchAnalyst$/);
    expect(rowOf("/organizations/kakhovka-watch")).toHaveTextContent(
      "Kakhovka WatchOrganization1 member",
    );

    expect(rowOf("/requests/r1")).toHaveTextContent(/Open callRequest·A?anaRequested/);

    expect(screen.queryByText(/result/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Geolocations/)).not.toBeInTheDocument();
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
    search.mockResolvedValue(
      response({
        hits: [
          eventHit({ media: [media] }),
          eventHit({ id: "e2", title: "Graphic", title_highlight: "Graphic", media: [media], is_graphic: true }),
        ],
      }),
    );
    const { container } = render(<SearchPage />);

    await screen.findByText("Graphic");
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Show graphic content (18 or older)" }),
    ).toHaveLength(1);
  });
});

describe("the Show field", () => {
  it("offers every kind as a chip, without counts, and sends no type while none is picked", async () => {
    search.mockResolvedValue(response({ hits: [eventHit()] }));
    render(<SearchPage />);

    await screen.findByText("Kakhovka spillway");
    for (const name of [
      "Requested",
      "Detected",
      "Geolocated",
      "Sites",
      "Collections",
      "Analysts",
      "Organizations",
    ]) {
      expect(chip(name)).toBeInTheDocument();
    }
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: "kakhovka", types: [] }));
  });

  it("lists only what the picked chips name, and drops the event filters once no event is listed", async () => {
    search.mockResolvedValue(response({ hits: [siteHit()] }));
    render(<SearchPage />);
    await waitFor(() => expect(linkTo("/sites/s1")).toBeInTheDocument());
    expect(toggle("Dates")).toBeInTheDocument();

    fireEvent.click(chip("Sites"));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ types: ["site"] })),
    );
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/search?q=kakhovka&type=site"));
    expect(toggle("Dates")).not.toBeInTheDocument();
    expect(within(rail()).queryByRole("combobox", { name: "Conflict" })).not.toBeInTheDocument();
    expect(toggle("Author")).toBeInTheDocument();
    expect(within(rail()).getByTitle("Remove filter Show: Sites")).toBeInTheDocument();

    fireEvent.click(chip("Geolocated"));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ types: ["event", "site"], show: ["geolocated"] }),
      ),
    );
    expect(toggle("Dates")).toBeInTheDocument();
  });

  it("keeps the tags and the author when the pick steps from events to collections", async () => {
    searchParams = new URLSearchParams("type=event&status=geolocated&tag=dam&author=ana&conflict=Yemen");
    search.mockResolvedValue(response({ query: "" }));

    render(<SearchPage />);
    await waitFor(() => expect(search).toHaveBeenCalled());
    fireEvent.click(chip("Geolocated"));
    fireEvent.click(chip("Collections"));

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ types: ["collection"], tags: ["dam"], author: "ana", conflicts: [] }),
      ),
    );
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeInTheDocument();
    expect(toggle("Author")).toBeInTheDocument();
    for (const title of ["Dates", "Source"]) expect(toggle(title)).not.toBeInTheDocument();
  });

  it("browses one analyst's shelf on an author alone", async () => {
    // Where the profile's Collections `Show more` lands: author only, no query.
    searchParams = new URLSearchParams("type=collection&author=ana");
    search.mockResolvedValue(response({ query: "", hits: [collectionHit()] }));

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "", types: ["collection"], author: "ana" }),
    );
    expect(within(rail()).getByTitle("Remove filter Show: Collections")).toBeInTheDocument();
  });

  it("reads a profile link's type=event as every status", async () => {
    searchParams = new URLSearchParams("type=event&author=ana");
    search.mockResolvedValue(response({ query: "" }));

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
    search.mockResolvedValue(response({ hits: [userHit()] }));
    render(<SearchPage />);
    await screen.findByText("kakhovka_watch");

    fireEvent.click(chip("Analysts"));

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ types: ["user"] })),
    );
    for (const title of ["Dates", "Source", "People", "Author"]) {
      expect(toggle(title)).not.toBeInTheDocument();
    }
  });
});

describe("the search page's paging", () => {
  const loadMore = () => screen.queryByRole("button", { name: "Show more" });

  it("appends the next page from the cursor, with the request that minted it", async () => {
    searchParams = new URLSearchParams("conflict=Yemen&author=ana");
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
    fireEvent.click(loadMore()!);

    expect(await screen.findByText("Mukalla port")).toBeInTheDocument();
    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "", cursor: "c1", conflicts: ["Yemen"], author: "ana" }),
    );
    // The last page carries no cursor, so the control leaves.
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("offers no Show more when the first page holds every match", async () => {
    search.mockResolvedValue(response({ hits: [eventHit()] }));

    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("keeps the loaded rows and offers a retry when a page fails", async () => {
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

describe("the search page's filter rail", () => {
  it("puts the panel in the rail and applies the dialog's dates at once", async () => {
    search.mockResolvedValue(response({ hits: [eventHit()] }));

    render(<SearchPage />);
    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(rail()).toContainElement(screen.getByRole("button", { name: "Toggle Dates" }));

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Toggle Dates" }));
    fireEvent.change(within(dialog).getByLabelText("Event date from"), {
      target: { value: "2026-06-01" },
    });
    expect(within(dialog).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ eventFrom: "2026-06-01" })),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
  });

  it("heads the rail with the active filters, minus the author its Author section names", async () => {
    searchParams = new URLSearchParams("q=kakhovka&tag=drone&author=ana");
    search.mockResolvedValue(response({ hits: [eventHit()] }));
    render(<SearchPage />);

    expect(await within(rail()).findByTitle("Remove filter Tags: drone")).toBeInTheDocument();
    expect(within(rail()).queryByTitle("Remove filter Author: ana")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Remove filter Author: ana")).toHaveLength(1);
    expect(screen.getAllByTitle("Remove filter Tags: drone")).toHaveLength(2);
  });
});

describe("the approval filters on the search page", () => {
  it("reads them off the URL, sends them, shows their pills and writes them back", async () => {
    searchParams = new URLSearchParams("approved=true&approved_by_org=kakhovka-watch");
    search.mockResolvedValue(response({ query: "", hits: [eventHit()] }));

    render(<SearchPage />);

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          approvedBy: { kind: "organization", slug: "kakhovka-watch", name: "kakhovka-watch" },
        }),
      ),
    );
    expect(screen.getAllByTitle("Remove filter Approved by: kakhovka-watch").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Remove filter Approvals: Approved only").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/search?approved=true&approved_by_org=kakhovka-watch"),
    );
  });

  it("commits Approved only from the panel into the URL", async () => {
    search.mockResolvedValue(response({ hits: [eventHit()] }));

    render(<SearchPage />);
    await screen.findByText("Kakhovka spillway");
    fireEvent.click(within(rail()).getByRole("button", { name: "Toggle People" }));
    fireEvent.click(within(rail()).getByRole("button", { name: "Approved only" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/search?q=kakhovka&approved=true"));
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
    countCollectableMatches.mockResolvedValue(7);
    search.mockResolvedValue(response({ hits: [eventHit(), siteHit(), theirs()] }));
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
    // The site row keeps the empty column, so it lines up with the events.
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
    searchParams = new URLSearchParams("q=kakhovka&type=event&type=site&status=geolocated");
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
    search.mockResolvedValue(response({ query: "31.46939, 34.38510" }));
    render(<SearchPage />);

    const row = screen.getByRole("link", { name: /31\.469390, 34\.385100/ });
    expect(row).toHaveAttribute("href", "/map");
    fireEvent.click(row);
    expect(setSelectedId).toHaveBeenCalledWith(null);
    expect(setViewState).toHaveBeenCalledWith({ latitude: 31.46939, longitude: 34.3851, zoom: 14 });
  });

  it("leads to the analyst a query names exactly", async () => {
    searchParams = new URLSearchParams("q=%40KAKHOVKA_WATCH");
    search.mockResolvedValue(response({ query: "@KAKHOVKA_WATCH", hits: [userHit()] }));
    render(<SearchPage />);

    const rows = await screen.findAllByRole("link", { name: "kakhovka_watch" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/profile/kakhovka_watch");
  });

  it("leads to the organization a query names by its name", async () => {
    searchParams = new URLSearchParams("q=kakhovka+watch");
    search.mockResolvedValue(response({ query: "kakhovka watch", hits: [orgHit()] }));
    render(<SearchPage />);

    const rows = await screen.findAllByRole("link", { name: "Kakhovka Watch" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/organizations/kakhovka-watch");
  });
});

describe("a search that finds nothing", () => {
  it("offers the closest spelling, and a click searches it", async () => {
    searchParams = new URLSearchParams("q=Khan+Younis");
    const found = eventHit({ title: "Khan Yunis", title_highlight: "Khan Yunis" });
    search.mockImplementation(({ q }: { q: string }) =>
      Promise.resolve(
        q === "Khan Yunis"
          ? response({ query: q, hits: [found] })
          : response({ query: q, suggestion: "Khan Yunis" }),
      ),
    );
    render(<SearchPage />);

    const offer = await screen.findByRole("button", { name: "Khan Yunis" });
    expect(screen.getByText(/Did you mean/)).toBeInTheDocument();
    fireEvent.click(offer);

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Khan Yunis" })),
    );
    expect(await screen.findByRole("link", { name: /^Khan Yunis/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("Khan Yunis");
  });
});
