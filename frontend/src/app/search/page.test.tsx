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
  useApiResource: () => ({ data: [] }),
}));

const search = vi.fn();
// The Author typeahead is stubbed: tests drive the field by hand.
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  search: (opts: unknown) => search(opts),
  suggestAuthors: () => Promise.resolve([]),
}));

let currentUser: { id: string; username: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: currentUser }) }));

const countCollectableMatches = vi.fn();
vi.mock("@/lib/collections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collections")>()),
  countCollectableMatches: (match: unknown) => countCollectableMatches(match),
}));

import type { Collection } from "@/lib/collections";
import type {
  SearchEventHit,
  SearchOrganizationHit,
  SearchResponse,
  SearchUserHit,
} from "@/types";

import SearchPage from "./page";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const collection = (over: Partial<Collection> = {}): Collection => ({
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
  ...over,
});

const eventHit = (over: Partial<SearchEventHit> = {}): SearchEventHit => ({
  id: "e1",
  title: "Kakhovka spillway",
  title_highlight: "Kakhovka spillway",
  lat: 46.77,
  lng: 33.37,
  occurred_date: "2026-06-06",
  is_graphic: false,
  status: "geolocated",
  owner: OWNER,
  geolocators: [],
  media: [],
  tags: [],
  ...over,
});

const userHit = (): SearchUserHit => ({
  id: "u2",
  username: "kakhovka_watch",
  username_highlight: "kakhovka_watch",
  bio: null,
  bio_highlight: null,
  avatar_url: null,
});

const orgHit = (): SearchOrganizationHit => ({
  id: "o1",
  slug: "kakhovka-watch",
  name: "Kakhovka Watch",
  name_highlight: "\u0002Kakhovka\u0003 Watch",
  bio: "Tracks the reservoir.",
  bio_highlight: null,
  avatar_url: null,
  member_count: 1,
});

const NO_TOTALS = { geolocations: 0, requests: 0, collections: 0, users: 0, organizations: 0 };

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  geolocations: [],
  requests: [],
  collections: [],
  users: [],
  organizations: [],
  total: NO_TOTALS,
  geolocations_cursor: null,
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
        total: { ...NO_TOTALS, collections: 1 },
      }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    // The group count is the pre-limit total, and the card says whose shelf it is.
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
    // A full response, so the render is the scope's own gate.
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
    // Where the profile's Collections `Show more` lands: author only, no query; the page must still issue the read.
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

describe("the search page's Geolocations group", () => {
  const loadMore = () => screen.queryByRole("button", { name: "Load more" });

  it("appends the next page from the cursor, with the request that minted it", async () => {
    searchParams = new URLSearchParams("conflict=Yemen&author=ana");
    search
      .mockResolvedValueOnce(
        response({
          query: "",
          type: "event",
          geolocations: [eventHit()],
          geolocations_cursor: "c1",
          total: { ...NO_TOTALS, geolocations: 2 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          query: "",
          type: "geolocation",
          geolocations: [eventHit({ id: "e2", title: "Mukalla port", title_highlight: "Mukalla port" })],
          total: { ...NO_TOTALS, geolocations: 2 },
        }),
      );

    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    fireEvent.click(loadMore()!);

    expect(await screen.findByText("Mukalla port")).toBeInTheDocument();
    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "",
        type: "geolocation",
        cursor: "c1",
        conflicts: ["Yemen"],
        author: "ana",
      }),
    );
    // The last page carries no cursor, so the control leaves.
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("offers no Load more when the first page holds every match", async () => {
    search.mockResolvedValue(
      response({ geolocations: [eventHit()], total: { ...NO_TOTALS, geolocations: 1 } }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(loadMore()).not.toBeInTheDocument();
  });

  it("keeps the loaded rows and offers a retry when a page fails", async () => {
    search
      .mockResolvedValueOnce(
        response({ geolocations: [eventHit()], geolocations_cursor: "c1" }),
      )
      .mockRejectedValueOnce(new Error("API error 500"));

    render(<SearchPage />);

    fireEvent.click((await screen.findByRole("button", { name: "Load more" })));

    expect(await screen.findByText("API error 500")).toBeInTheDocument();
    expect(screen.getByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the filter panel on the Collections scope", () => {
  const toggle = (title: string) =>
    screen.queryByRole("button", { name: `Toggle ${title}` });

  it("offers the Author section alone", async () => {
    // The backend empties the group on any other event predicate, so no other section opens.
    searchParams = new URLSearchParams("type=collection&author=ana");
    search.mockResolvedValue(
      response({ type: "collection", query: "", collections: [collection()] }),
    );

    render(<SearchPage />);

    expect(await screen.findByText("Nova Kakhovka dam")).toBeInTheDocument();
    expect(toggle("Author")).toBeInTheDocument();
    for (const title of ["Status", "Source media", "Event date", "Added", "Tags"]) {
      expect(toggle(title)).not.toBeInTheDocument();
    }
  });

  it("commits a picked author into the URL, the way the event scope does", async () => {
    searchParams = new URLSearchParams("type=collection");
    search.mockResolvedValue(response({ type: "collection", query: "" }));

    render(<SearchPage />);

    fireEvent.click(toggle("Author")!);
    const field = screen.getByLabelText("Author username");
    fireEvent.change(field, { target: { value: "ana" } });
    // Enter commits the draft, the same gesture the event scope takes.
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/search?type=collection&author=ana"),
    );
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ q: "", type: "collection", author: "ana" }),
      ),
    );
  });
});

describe("the search page's Analysts group", () => {
  it("prints the bare username, the highlight inline in it", async () => {
    search.mockResolvedValue(
      response({
        users: [{ ...userHit(), username: "Geo_Lego", username_highlight: "\u0002Geo\u0003_Lego" }],
        total: { ...NO_TOTALS, users: 1 },
      }),
    );

    render(<SearchPage />);

    const heading = (await screen.findByText("Geo")).closest("h3")!;
    expect(heading.textContent).toBe("Geo_Lego");
    // A flex heading would set the mark and the rest apart by its gap.
    expect(heading.className).not.toMatch(/flex|gap-/);
  });
});

describe("the search page's Organizations group", () => {
  it("renders a row tagged as an organization that links to its page", async () => {
    search.mockResolvedValue(
      response({
        users: [userHit()],
        organizations: [orgHit()],
        total: { ...NO_TOTALS, users: 1, organizations: 1 },
      }),
    );

    render(<SearchPage />);

    const name = await screen.findByText("Kakhovka");
    expect(name.tagName).toBe("MARK");
    const row = name.closest("a");
    expect(row).toHaveAttribute("href", "/organizations/kakhovka-watch");
    expect(row).toHaveTextContent("Organization · 1 member");
    // Analysts and organizations sit side by side under the All scope.
    expect(screen.getByText("Organizations ·", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Analysts ·", { exact: false })).toBeInTheDocument();
  });

  it("scopes to organizations from the type chip, and the filter panel stays closed", async () => {
    search.mockResolvedValue(response({ organizations: [orgHit()], users: [userHit()] }));

    render(<SearchPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Organizations/ }));

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ q: "kakhovka", type: "organization" }),
      ),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/search?q=kakhovka&type=organization"),
    );
    expect(screen.queryByText("kakhovka_watch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle Author" })).not.toBeInTheDocument();
  });
});

describe("the search page's filter rail", () => {
  it("puts the event panel in the rail and applies the dialog's dates on Apply", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=event");
    search.mockResolvedValue(response({ type: "event", geolocations: [eventHit()] }));

    render(<SearchPage />);
    expect(await screen.findByText("Kakhovka spillway")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Filters" })).toContainElement(
      screen.getByRole("button", { name: "Toggle Event date" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Toggle Event date" }));
    fireEvent.change(within(dialog).getByLabelText("Event date from"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ type: "event", eventFrom: "2026-06-01" }),
      ),
    );
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
  });

  it("leaves the rail out on a scope no filter narrows", async () => {
    search.mockResolvedValue(response({ users: [userHit()] }));

    render(<SearchPage />);
    expect(await screen.findByText("kakhovka_watch")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
  });
});

describe("the approval filters on the search page", () => {
  it("reads them off the URL, sends them, shows their pills and writes them back", async () => {
    searchParams = new URLSearchParams("type=event&approved=true&approved_by_org=kakhovka-watch");
    search.mockResolvedValue(response({ type: "event", query: "", geolocations: [eventHit()] }));

    render(<SearchPage />);

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          approvedBy: { kind: "organization", slug: "kakhovka-watch", name: "kakhovka-watch" },
        }),
      ),
    );
    expect(screen.getAllByText("Approved by kakhovka-watch").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/search?type=event&approved=true&approved_by_org=kakhovka-watch",
      ),
    );
  });

  it("commits Approved only from the panel into the URL", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=event");
    search.mockResolvedValue(response({ type: "event", geolocations: [eventHit()] }));

    render(<SearchPage />);
    const rail = await screen.findByRole("complementary", { name: "Filters" });
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Approvals" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Approved only" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/search?q=kakhovka&type=event&approved=true"),
    );
  });
});

describe("the Geolocations selection", () => {
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
    search.mockResolvedValue(
      response({
        geolocations: [eventHit(), theirs()],
        total: { ...NO_TOTALS, geolocations: 2 },
      }),
    );
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

  it("puts a checkbox on the reader's own rows only, and holds the actions' room idle", async () => {
    render(<SearchPage />);

    expect(
      await screen.findByRole("checkbox", { name: "Select Kakhovka spillway" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Their strike" })).not.toBeInTheDocument();
    // Mounted but inert: the header keeps its height for when a row is picked.
    expect(actions()).toHaveAttribute("inert");
    expect(await screen.findByRole("checkbox", { name: "Select all" })).toBeEnabled();
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

  it("selects every match from the head checkbox, then clears it from there", async () => {
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select all" }));

    expect(countCollectableMatches).toHaveBeenCalledWith(
      expect.objectContaining({ q: "kakhovka" }),
    );
    expect(screen.getByText("7 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Clear selection" })).toBeChecked();
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

describe("the search page's group headers", () => {
  afterEach(() => {
    currentUser = null;
  });

  it("drops the header of a lone group, which the head row's total already counts", async () => {
    search.mockResolvedValue(
      response({ geolocations: [eventHit()], total: { ...NO_TOTALS, geolocations: 1 } }),
    );
    render(<SearchPage />);

    expect(await screen.findByRole("region", { name: "Geolocations" })).toBeInTheDocument();
    expect(screen.queryByText(/^Geolocations ·/)).not.toBeInTheDocument();
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("titles each group once several show, and Select all moves under its own", async () => {
    currentUser = { id: OWNER.id, username: OWNER.username };
    countCollectableMatches.mockResolvedValue(1);
    search.mockResolvedValue(
      response({
        geolocations: [eventHit()],
        users: [userHit()],
        total: { ...NO_TOTALS, geolocations: 1, users: 1 },
      }),
    );
    render(<SearchPage />);

    const header = await screen.findByText(/^Geolocations ·/);
    expect(screen.getByText(/^Analysts ·/)).toBeInTheDocument();
    expect(header.closest("section")).toContainElement(
      screen.getByRole("checkbox", { name: "Select all" }),
    );
  });
});

describe("the active filters on the search page", () => {
  it("head the rail, minus the author its Author section names, and the narrow row keeps both", async () => {
    searchParams = new URLSearchParams("q=kakhovka&type=event&tag=drone&author=ana");
    search.mockResolvedValue(response({ type: "event", geolocations: [eventHit()] }));
    render(<SearchPage />);

    const rail = screen.getByRole("complementary", { name: "Filters" });
    expect(await within(rail).findByTitle("Remove filter: drone")).toBeInTheDocument();
    expect(within(rail).queryByTitle("Remove filter: By ana")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Remove filter: By ana")).toHaveLength(1);
    expect(screen.getAllByTitle("Remove filter: drone")).toHaveLength(2);
  });
});
