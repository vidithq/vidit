import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/lib/api-types";

type FeedItem = components["schemas"]["FeedItemRead"];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => {
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
  error: null as string | null,
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

beforeEach(() => {
  walk.items = [];
  walk.error = null;
  walk.loading = false;
  walk.loadingMore = false;
  walk.hasMore = false;
  walk.loadMore = vi.fn();
  walk.paths = [];
  profile.following_count = 0;
  auth.loading = false;
});

/** Observers by the node they watch: card media observes too, so a test fires the one watching
 *  the Load more row. */
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
  const row = screen.getByRole("button", { name: "Load more" }).parentElement!;
  const report = watchers.get(row);
  expect(report, "nothing observes the Load more row").toBeDefined();
  report!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeedPage", () => {
  it("cards a request and a geolocation, each linked and credited by kind", () => {
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
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "bob" })).toHaveAttribute("href", "/profile/bob");
  });

  it("starts on Following and walks everyone's activity on All", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    expect(lastPath()).toBe("/feed?scope=following");
    expect(screen.getByRole("button", { name: "Following" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(lastPath()).toBe("/feed?scope=all");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
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
    walk.error = "API error 500";
    render(<FeedPage />);

    expect(screen.getByRole("link", { name: "Already loaded" })).toBeInTheDocument();
    expect(screen.getByText("API error 500")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(watchers.has(retry.parentElement!)).toBe(false);

    fireEvent.click(retry);
    expect(walk.loadMore).toHaveBeenCalledTimes(1);
  });

  it("shows only the error when the first page fails", () => {
    walk.error = "API error 500";
    render(<FeedPage />);

    expect(screen.getByText("API error 500")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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

  it("puts the title first, names both dates, and keys the conflict, tags plain", () => {
    walk.items = [
      item({
        id: "g1",
        occurred_date: "2009-08-25",
        feed_at: "2026-10-03T09:00:00Z",
        conflicts: [
          {
            id: "c1",
            name: "Russo-Ukrainian war",
            wikidata_id: null,
            start_year: 2014,
            end_year: null,
            is_ongoing: true,
            tier: "major",
          },
        ],
        tags: [{ id: "t3", name: "airstrike" }],
      }),
      item({ id: "r1", title: "Where is this bridge", status: "requested", feed_at: "2026-10-04T09:00:00Z" }),
    ];
    const { container } = render(<FeedPage />);

    const card = container.querySelector("article")!;
    const heading = card.querySelector("h2")!;
    const byline = card.querySelector("a[href^='/profile/']")!;
    expect(heading.compareDocumentPosition(byline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(card).getByText("Event 25 Aug 2009")).toBeInTheDocument();
    expect(within(card).getByText("Published 3 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Requested 4 Oct 2026")).toBeInTheDocument();

    expect(within(card).getByText("Conflict:").parentElement).toHaveTextContent(
      "Conflict:Russo-Ukrainian war",
    );
    // A card carries no source, so it names no sensor.
    expect(within(card).queryByText("Sensor:")).toBeNull();
    expect(within(card).getByText("airstrike")).toBeInTheDocument();
  });

  it("cards a detection with its badge and date, linked to its event page", () => {
    walk.items = [
      item({ id: "d1", title: "Imported strike", status: "detected", feed_at: "2026-10-05T09:00:00Z" }),
    ];
    render(<FeedPage />);

    expect(screen.getByRole("link", { name: "Imported strike" })).toHaveAttribute(
      "href",
      "/events/d1",
    );
    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Detected 5 Oct 2026")).toBeInTheDocument();
  });

  it("shows detections by default and hides them from the Kind switch", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    expect(lastPath()).toBe("/feed?scope=following");
    const rail = screen.getByRole("complementary", { name: "Filters" });
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Kind" }));
    const toggle = within(rail).getByRole("switch", { name: "Show detections" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(lastPath()).toBe("/feed?scope=following&kind=geolocation&kind=request");
    expect(within(rail).getByRole("switch", { name: "Show detections" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Remove filter: Detections hidden"));
    expect(lastPath()).toBe("/feed?scope=following");
  });

  it("sends only the chosen kinds and disables the detections switch while a chip is selected", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    const rail = screen.getByRole("complementary", { name: "Filters" });
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Kind" }));
    const toggle = () => within(rail).getByRole("switch", { name: "Show detections" });

    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));
    expect(lastPath()).toBe("/feed?scope=following&kind=request");
    expect(toggle()).toBeDisabled();

    fireEvent.click(within(rail).getByRole("button", { name: "Geolocations" }));
    expect(lastPath()).toBe("/feed?scope=following&kind=request&kind=geolocation");

    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Geolocations" }));
    expect(lastPath()).toBe("/feed?scope=following");
    expect(toggle()).toBeEnabled();
  });

  it("keeps the switch off across a chip choice, and shows its pill only while it applies", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    const rail = screen.getByRole("complementary", { name: "Filters" });
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Kind" }));
    fireEvent.click(within(rail).getByRole("switch", { name: "Show detections" }));
    expect(screen.getByTitle("Remove filter: Detections hidden")).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));
    expect(lastPath()).toBe("/feed?scope=following&kind=request");
    expect(screen.queryByTitle("Remove filter: Detections hidden")).toBeNull();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));
    expect(lastPath()).toBe("/feed?scope=following&kind=geolocation&kind=request");
    expect(screen.getByTitle("Remove filter: Detections hidden")).toBeInTheDocument();
  });

  it("narrows the walk from the rail: kind, conflict and tag", () => {
    walk.items = [item({})];
    render(<FeedPage />);
    const rail = screen.getByRole("complementary", { name: "Filters" });

    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Kind" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));
    expect(lastPath()).toBe("/feed?scope=following&kind=request");

    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Conflict" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Russo-Ukrainian war" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Tags" }));
    fireEvent.click(within(rail).getByRole("button", { name: "airstrike" }));
    expect(lastPath()).toBe(
      "/feed?scope=following&kind=request&conflict=Russo-Ukrainian+war&tag=airstrike",
    );
    expect(screen.getByRole("button", { name: "Filters (3)" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Remove filter: Requests"));
    expect(lastPath()).toBe(
      "/feed?scope=following&conflict=Russo-Ukrainian+war&tag=airstrike",
    );
  });

  it("edits a draft in the Filters dialog and applies it once", () => {
    walk.items = [item({})];
    render(<FeedPage />);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Toggle Kind" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Geolocations" }));
    expect(lastPath()).toBe("/feed?scope=following");

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastPath()).toBe("/feed?scope=following&kind=geolocation");

    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    const reopened = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Clear" }));
    fireEvent.click(within(reopened).getByRole("button", { name: "Apply" }));
    expect(lastPath()).toBe("/feed?scope=following");
  });

  it("drops the draft when the dialog closes without Apply", () => {
    walk.items = [item({})];
    render(<FeedPage />);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Toggle Kind" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Requests" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastPath()).toBe("/feed?scope=following");
  });

  it("says nothing matched the filters instead of the follow prompts", () => {
    profile.following_count = 0;
    render(<FeedPage />);
    const rail = screen.getByRole("complementary", { name: "Filters" });
    fireEvent.click(within(rail).getByRole("button", { name: "Toggle Kind" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Requests" }));

    expect(screen.getByText("Nothing in the feed matches the filters.")).toBeInTheDocument();
    expect(screen.queryByText("You follow no analysts yet")).toBeNull();
  });
});
