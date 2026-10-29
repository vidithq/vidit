import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/lib/api-types";
import type { ReadableError } from "@/lib/errors";

type FeedItem = components["schemas"]["FeedItemRead"];

// The page's URL: what it reads on load and what it writes back on each change.
const nav = vi.hoisted(() => {
  const state = { query: "", replace: (href: string, options?: object) => void [href, options] };
  return {
    state,
    router: {
      push: () => {},
      back: () => {},
      replace: (href: string, options?: object) => state.replace(href, options),
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.state.query),
}));

// Mutable so a test can hold the page behind the auth gate while the first page arrives.
const auth = vi.hoisted(() => ({ loading: false }));
vi.mock("@/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    user: auth.loading ? null : { username: "ana" },
    loading: auth.loading,
  }),
}));

// The profile read answers the follow count once the following view comes back empty, and the
// taxonomy reads feed the filter panel.
const profile = vi.hoisted(() => ({ following_count: 0 }));
// The histogram answers each `/feed/dates` path with `dates.total(path)` rows, or loads.
const dates = vi.hoisted(() => ({ total: (_path: string): number => 0, loading: false }));
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => {
    if (path?.startsWith("/feed/dates")) {
      return dates.loading
        ? { data: null, error: null, loading: true, refetch: () => {} }
        : { data: histogram(path, dates.total(path)), error: null, loading: false, refetch: () => {} };
    }
    const data =
      path === "/tags"
        ? [{ id: "t1", name: "airstrike" }]
        : path === "/conflicts?used=true"
          ? [{ id: "c1", name: "Russo-Ukrainian war" }]
          : path
            ? profile
            : null;
    return { data, error: null, loading: false, refetch: () => {} };
  },
}));

// The walk is `useCursorList`'s; this page owns the path it builds and what it makes of the rows.
const walk = vi.hoisted(() => ({
  items: [] as FeedItem[],
  error: null as ReadableError | null,
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: () => {},
  reload: () => {},
  paths: [] as string[],
}));
vi.mock("@/hooks/useCursorList", () => ({
  useCursorList: (buildPath: (cursor: string | null) => string) => {
    walk.paths.push(buildPath(null));
    return walk;
  },
}));

import FeedPage from "./page";
import { histogram, openFilterGroups, sheetButton } from "@/test/filters";

const ANA = { id: "u1", username: "ana", avatar_url: null };
const BOB = { id: "u2", username: "bob", avatar_url: null };

function item(extra: Partial<FeedItem>): FeedItem {
  return {
    id: "e1",
    title: "Strike on a depot",
    coords: null,
    occurred_date: null,
    is_graphic: false,
    status: "geolocated",
    before_closed_status: null,
    owner: ANA,
    geolocators: [],
    media: null,
    tags: [],
    conflicts: [],
    feed_at: "2026-06-01T10:00:00Z",
    requested_at: null,
    ...extra,
  };
}

const lastPath = () => walk.paths[walk.paths.length - 1];

beforeEach(openFilterGroups);

beforeEach(() => {
  walk.items = [];
  walk.error = null;
  walk.loading = false;
  walk.loadingMore = false;
  walk.hasMore = false;
  walk.loadMore = vi.fn();
  walk.paths = [];
  profile.following_count = 0;
  dates.total = () => 0;
  dates.loading = false;
  auth.loading = false;
  nav.state.query = "";
  nav.state.replace = vi.fn();
});

/** Observers by the node they watch: card media observes too, so a test fires the one watching
 *  the Show more row. */
function stubObservers(): Map<Element, IntersectionObserverCallback> {
  const watchers = new Map<Element, IntersectionObserverCallback>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(node: Element) {
        watchers.set(node, this.callback);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  return watchers;
}

function scrollToFoot(watchers: Map<Element, IntersectionObserverCallback>) {
  const row = screen.getByRole("button", { name: "Show more" }).parentElement!;
  const report = watchers.get(row);
  expect(report, "nothing observes the Show more row").toBeDefined();
  report!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});


const rail = () => screen.getByRole("complementary", { name: "Filters" });

/** Picks an option of a dimension through its line in the rail. */
function pick(dimension: string, option: string | RegExp) {
  const field = within(rail()).queryByRole("combobox", { name: dimension });
  if (field) {
    fireEvent.focus(field);
    fireEvent.click(screen.getByRole("option", { name: option }));
    return;
  }
  fireEvent.click(within(rail()).getByRole("button", { name: dimension }));
  fireEvent.click(within(screen.getByRole("dialog", { name: dimension })).getByRole("button", { name: option }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: dimension }), { key: "Escape" });
}

describe("FeedPage", () => {
  it("links a request and a geolocation to their own pages, credited by kind", () => {
    walk.items = [
      item({ id: "r1", title: "Where is this bridge", status: "requested", owner: BOB }),
      item({ id: "g1", title: "Strike on a depot", coords: { lat: 48.01, lng: 37.8 } }),
    ];
    render(<FeedPage />);

    expect(screen.getByRole("link", { name: "Where is this bridge" })).toHaveAttribute(
      "href",
      "/requests/r1",
    );
    expect(screen.getByRole("link", { name: "Strike on a depot" })).toHaveAttribute(
      "href",
      "/events/g1",
    );
    expect(screen.getByRole("link", { name: "bob" })).toHaveAttribute("href", "/profile/bob");
  });

  it("starts on Following and walks everyone's activity once the switch is off", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    expect(lastPath()).toBe("/feed?scope=following");
    const following = within(rail()).getByRole("switch", { name: "Following" });
    expect(following).toBeChecked();

    fireEvent.click(following);

    expect(lastPath()).toBe("/feed?scope=all");
    expect(following).not.toBeChecked();
    expect(nav.state.replace).toHaveBeenLastCalledWith("/feed?scope=all", { scroll: false });
  });

  it("offers All to an analyst who follows nobody", () => {
    render(<FeedPage />);

    expect(screen.getByText("You follow no analysts yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all activity" }));
    expect(lastPath()).toBe("/feed?scope=all");
  });

  it("says nothing matched when the analysts followed have posted nothing", () => {
    profile.following_count = 3;
    render(<FeedPage />);

    expect(screen.getByText("Nothing from analysts you follow yet")).toBeInTheDocument();
    expect(screen.queryByText("You follow no analysts yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Show all activity" })).toBeInTheDocument();
  });

  it("loads the next page when the end of the list scrolls into view", () => {
    const watchers = stubObservers();
    walk.items = [item({})];
    walk.hasMore = true;
    render(<FeedPage />);

    expect(walk.loadMore).not.toHaveBeenCalled();
    scrollToFoot(watchers);
    expect(walk.loadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps scrolling when the first page lands before the auth gate opens", () => {
    // A fresh load: the walk answers while auth is still loading, so the foot row mounts a
    // render after the page already knew a next page exists.
    const watchers = stubObservers();
    walk.items = [item({})];
    walk.hasMore = true;
    auth.loading = true;
    const { rerender } = render(<FeedPage />);
    auth.loading = false;
    rerender(<FeedPage />);

    scrollToFoot(watchers);
    expect(walk.loadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps the cards when the next page fails, and retries on click only", () => {
    const watchers = stubObservers();
    walk.items = [item({ title: "Already loaded" })];
    walk.hasMore = true;
    walk.error = { title: "Vidit hit a problem", message: "Retry in a moment.", fields: {} };
    render(<FeedPage />);

    expect(screen.getByRole("link", { name: "Already loaded" })).toBeInTheDocument();
    expect(screen.getByText("Vidit hit a problem")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(watchers.has(retry.parentElement!)).toBe(false);

    fireEvent.click(retry);
    expect(walk.loadMore).toHaveBeenCalledTimes(1);
  });

  it("shows only the error when the first page fails", () => {
    walk.error = { title: "Vidit hit a problem", message: "Retry in a moment.", fields: {} };
    render(<FeedPage />);

    expect(screen.getByText("Vidit hit a problem")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("spins while the next page loads and marks the end of the feed", () => {
    walk.items = [item({})];
    walk.hasMore = true;
    walk.loadingMore = true;
    const { rerender } = render(<FeedPage />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    expect(screen.queryByText("You have reached the end of the feed")).toBeNull();

    walk.hasMore = false;
    walk.loadingMore = false;
    rerender(<FeedPage />);
    expect(screen.queryByRole("button", { name: /Load/ })).toBeNull();
    expect(screen.getByText("You have reached the end of the feed")).toBeInTheDocument();
  });

  it("names when each card entered the feed, by kind", () => {
    walk.items = [
      item({ id: "g1", feed_at: "2026-10-03T09:00:00Z" }),
      item({ id: "r1", title: "Where is this bridge", status: "requested", feed_at: "2026-10-04T09:00:00Z" }),
    ];
    render(<FeedPage />);

    const [event, request] = screen.getAllByRole("article");
    expect(event).toHaveTextContent("Published 3 Oct 2026");
    expect(request).toHaveTextContent("Requested 4 Oct 2026");
  });

  it("links a detection to its event page and dates its entry", () => {
    walk.items = [
      item({ id: "d1", title: "Imported strike", status: "detected", feed_at: "2026-10-05T09:00:00Z" }),
    ];
    render(<FeedPage />);

    expect(screen.getByRole("link", { name: "Imported strike" })).toHaveAttribute(
      "href",
      "/events/d1",
    );
    expect(screen.getByText("Detected 5 Oct 2026")).toBeInTheDocument();
  });

  it("lists every kind with no Show pick, and narrows to the chosen statuses, Detected included", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    expect(lastPath()).toBe("/feed?scope=following");

    pick("Show", "Detected");
    expect(lastPath()).toBe("/feed?scope=following&status=detected");
    expect(within(rail()).getByRole("button", { name: "Remove Detected" })).toBeInTheDocument();

    pick("Show", "Geolocated");
    expect(lastPath()).toBe("/feed?scope=following&status=detected&status=geolocated");

    fireEvent.click(within(rail()).getByRole("button", { name: "Remove Detected" }));
    expect(lastPath()).toBe("/feed?scope=following&status=geolocated");
  });

  it("narrows the walk from the rail with every dimension the feed serves", () => {
    walk.items = [item({})];
    render(<FeedPage />);

    pick("Show", "Requested");
    pick("Conflict", /^Russo-Ukrainian war/);
    pick("Tags", "airstrike");
    pick("Media", "Video");
    pick("Location guess", "No guess");
    expect(lastPath()).toBe(
      "/feed?scope=following&status=requested&conflict=Russo-Ukrainian+war&tag=airstrike&media=video" +
        "&has_coords=false",
    );
    expect(nav.state.replace).toHaveBeenLastCalledWith(
      "/feed?status=requested&conflict=Russo-Ukrainian+war&tag=airstrike&media=video&has_coords=false",
      { scroll: false },
    );
  });

  it("reads its filters off the URL, the date windows included", () => {
    nav.state.query = "scope=all&status=detected&author=ana&occurred_date_from=2024-01-01";
    walk.items = [item({})];
    render(<FeedPage />);

    expect(lastPath()).toBe("/feed?scope=all&status=detected&author=ana&occurred_date_from=2024-01-01");
    expect(within(rail()).getByRole("switch", { name: "Following" })).not.toBeChecked();
    expect(within(rail()).getByRole("button", { name: "Remove ana" })).toBeInTheDocument();
    expect(nav.state.replace).not.toHaveBeenCalled();
  });

  it("counts the rows the filters match beside the Filters header and the phone button", () => {
    const header = () => within(rail()).getByRole("button", { name: "Filters" });
    walk.items = [item({})];
    dates.total = (path) => (path.includes("scope=all") ? 284 : 1);
    const { rerender } = render(<FeedPage />);

    expect(header()).toHaveAccessibleDescription("1 result");
    expect(sheetButton()).toHaveAccessibleDescription("1 result");

    fireEvent.click(within(rail()).getByRole("switch", { name: "Following" }));
    expect(header()).toHaveAccessibleDescription("284 results");
    expect(sheetButton()).toHaveAccessibleDescription("284 results");
    expect(header()).toHaveAttribute("aria-busy", "false");

    // While the next count loads, the last one stays under the loading dot.
    dates.loading = true;
    rerender(<FeedPage />);
    expect(header()).toHaveAttribute("aria-busy", "true");
    expect(header()).toHaveAccessibleDescription("284 results");
  });

  it("applies each change in the sheet at once, Following included", () => {
    walk.items = [item({})];
    render(<FeedPage />);

    fireEvent.click(sheetButton());
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(sheet).getByRole("switch", { name: "Following" }));
    expect(lastPath()).toBe("/feed?scope=all");
    fireEvent.click(within(sheet).getByRole("switch", { name: "Approved only" }));
    expect(lastPath()).toBe("/feed?scope=all&approved=true");

    fireEvent.click(within(sheet).getByRole("button", { name: "Clear all" }));
    expect(lastPath()).toBe("/feed?scope=all");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("says nothing matched the filters instead of the follow prompts", () => {
    profile.following_count = 0;
    render(<FeedPage />);
    pick("Show", "Requested");

    expect(screen.getByText("Nothing in the feed matches the filters.")).toBeInTheDocument();
    expect(screen.queryByText("You follow no analysts yet")).toBeNull();
  });
});
