import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ username: "ana" }),
  usePathname: () => "/profile/ana",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// MapLibre touches `window` at module scope, so the coverage map never loads
// its real canvas under jsdom.
vi.mock("next/dynamic", () => ({
  default: () => function MapStub() {
    return <div data-testid="map" />;
  },
}));

const useAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuth() }));

const useDetectionsCount = vi.fn();
vi.mock("@/contexts/DetectionsContext", () => ({
  useDetectionsCount: () => useDetectionsCount(),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

const getUserStats = vi.fn();
vi.mock("@/lib/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/users")>()),
  getUserStats: vi.fn((username: string) => getUserStats(username)),
}));

import type { PublicProfile, UserStats } from "@/lib/users";
import type { EventListItem, MapPoint } from "@/types";

import ProfilePage from "./page";

const PROFILE: PublicProfile = {
  id: "u1",
  username: "ana",
  bio: "Open-source imagery, mostly Sahel.",
  avatar_url: null,
  external_links: { x: "ana_osint", website: "https://ana.example" },
  followers_count: 4,
  following_count: 2,
  // Equal to `geolocated_count` below on purpose: both count the analyst's
  // published geolocations, so a fixture splitting them would let a component
  // read the wrong one and still pass.
  geolocations_count: 2,
  created_at: "2026-01-05T09:00:00Z",
  is_following: false,
};

const SUBMISSION: EventListItem = {
  id: "e1",
  title: "Strike near Bakhmut",
  status: "geolocated",
  event_date: "2026-06-01",
  event_coords: { lat: 48.5, lng: 37.8 },
  before_closed_status: null,
  conflicts: [],
  is_graphic: false,
  media: null,
  owner: { id: "u1", username: "ana" },
  tags: [],
};

const STATS: UserStats = {
  total_events: 3,
  geolocated_count: 2,
  detected_count: 1,
  closed_count: 0,
  media_count: 5,
  top_conflicts: [{ name: "Sahel", count: 3 }],
  capture_sources: [{ name: "Drone", count: 2 }],
  source_hosts: [{ name: "t.me", count: 3 }],
  other_hosts_count: 0,
  no_source_count: 0,
  activity: Array.from({ length: 7 }, (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, "0")}`,
    count: i,
  })),
};

// [id, lat, lng, event_date, added_date, detected]
const POINT: MapPoint = ["e1", 48.5, 37.8, "2026-06-01", "2026-06-02", 0];

/**
 * The blocks a reader meets, each named by the one piece of text that block
 * alone puts on the page. Pinned by document position rather than by test
 * hooks on the components, so this reads the page the way a visitor scrolling
 * it does.
 */
const BLOCKS: Record<string, string> = {
  "Recent submissions": "recent submissions",
  Insights: "insights",
  Coverage: "coverage",
  // Edit mode only: reading the links is the header action cluster, so this
  // eyebrow titles the inputs and nothing else.
  "Linked accounts": "linked accounts",
  "1 detection to submit": "detections queue",
  "Sign out": "account controls",
};

/** The named blocks, in the order the document puts them. */
function blockOrder(container: HTMLElement): string[] {
  const seen: string[] = [];
  for (const el of container.querySelectorAll("*")) {
    // The element's own words, not its descendants': every ancestor of a
    // marker would otherwise match it and the walk would report wrappers.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim();
    const block = BLOCKS[own];
    if (block && !seen.includes(block)) seen.push(block);
  }
  return seen;
}

function mountProfile() {
  return render(<ProfilePage />);
}

describe("public profile order", () => {
  beforeEach(() => {
    useDetectionsCount.mockReturnValue({ count: 0, refresh: vi.fn() });
    getUserStats.mockResolvedValue(STATS);
    useApiResource.mockImplementation((path: string | null) => {
      if (path?.startsWith("/users/ana/events")) {
        return { data: { items: [SUBMISSION] }, error: null, loading: false, refetch: vi.fn() };
      }
      if (path?.startsWith("/events/points")) {
        return { data: [POINT], error: null, loading: false, refetch: vi.fn() };
      }
      return { data: PROFILE, error: null, loading: false, refetch: vi.fn() };
    });
    useAuth.mockReturnValue({
      user: null,
      loading: false,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it("shows a visitor the work, then the explanation", async () => {
    const { container } = mountProfile();
    // Insights arrive from their own fetch, so wait for the block that needs
    // them before reading the order.
    await screen.findByText("Insights");

    // The map shows the work at its widest and Insights interprets it, so the
    // two sit together; the list that grows reads last of the work blocks.
    expect(blockOrder(container)).toEqual([
      "coverage",
      "insights",
      "recent submissions",
    ]);
    // The links are buttons in the header here, so the section that titles
    // their inputs belongs to edit mode alone.
    expect(screen.queryByText("Linked accounts")).toBeNull();
  });

  it("puts where to reach the analyst in the header, above the work", async () => {
    mountProfile();
    await screen.findByText("Insights");

    // Icon buttons, so the handle carrying the account is in the accessible
    // name rather than on screen: a bare brand mark says the platform and
    // nothing else, and a bare handle does not say which account it is.
    const x = screen.getByRole("link", { name: "X / Twitter: @ana_osint" });
    expect(x).toHaveAttribute("href", "https://x.com/ana_osint");
    expect(x.textContent).toBe("");
    // The href is the pasted URL as `URL` normalises it; the name spends its
    // width on the domain rather than on the scheme the reader can assume.
    const site = screen.getByRole("link", { name: "Website: ana.example" });
    expect(site).toHaveAttribute("href", "https://ana.example/");

    // The row rides the header action cluster, right of the handle, not a
    // scroll of the portfolio away.
    expect(
      x.compareDocumentPosition(screen.getByText("Coverage")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("gives a visitor Follow and no edit or copy-link control", async () => {
    mountProfile();
    await screen.findByText("Insights");

    // Follow is the one gesture on the analyst themselves, and it sits at the
    // far right of the header cluster. The edit pair is the owner's, and
    // sharing has no control on this page.
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy profile link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });

  it("names each chart by what it counts, in words that need no tooltip", async () => {
    mountProfile();
    await screen.findByText("Insights");

    // A heading a visitor has to open a `?` to understand is a heading that
    // said nothing: the calendar counts when the documented events happened,
    // not when they were posted, and the bar counts the host of a source
    // link, with the events naming none accounted for rather than dropped.
    // The calendar's heading is the field's own name, the one the submit and
    // edit forms print, so one concept keeps one name across the app.
    expect(await screen.findByText("Event dates")).toBeInTheDocument();
    // The grid's own population, summed off the buckets (0 + 1 + ... + 6),
    // not the card's `total_events`: an undated event has no cell here.
    expect(
      screen.getByText(
        "The month each event took place, not when it was posted, imported or published. It covers the 21 events dated in the years shown."
      )
    ).toBeInTheDocument();
    // The population line is scoped to the tiles, because it is not true of
    // everything under it: `Media` counts media rows, which routinely run
    // past `total_events`, and the grid counts dated events only.
    expect(
      screen.getByText(
        "The tiles below describe one set of 3 events: this analyst's geolocations, machine drafts and closed rows."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Source origin")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The host of each event's source link. Events naming no source have their own share."
      )
    ).toBeInTheDocument();
  });

  it("keeps the owner's queue above the work and the account controls under it", async () => {
    useAuth.mockReturnValue({
      user: { id: "u1", username: "ana", email: "ana@example.test" },
      loading: false,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    useDetectionsCount.mockReturnValue({ count: 1, refresh: vi.fn() });

    const { container } = mountProfile();
    await screen.findByText("Insights");

    // Pending work outranks the portfolio; signing out sinks below all of it.
    expect(blockOrder(container)).toEqual([
      "detections queue",
      "coverage",
      "insights",
      "recent submissions",
      "account controls",
    ]);
  });
});

describe("public profile identity", () => {
  beforeEach(() => {
    useDetectionsCount.mockReturnValue({ count: 0, refresh: vi.fn() });
    getUserStats.mockRejectedValue(new Error("no stats"));
    useAuth.mockReturnValue({
      user: null,
      loading: false,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  function withProfile(overrides: Partial<PublicProfile>) {
    const profile = { ...PROFILE, ...overrides };
    useApiResource.mockImplementation((path: string | null) => {
      if (path?.startsWith("/users/ana/events")) {
        return { data: { items: [] }, error: null, loading: false, refetch: vi.fn() };
      }
      if (path?.startsWith("/events/points")) {
        return { data: [], error: null, loading: false, refetch: vi.fn() };
      }
      return { data: profile, error: null, loading: false, refetch: vi.fn() };
    });
  }

  it("reads the bio beside the handle rather than in a section of its own", () => {
    withProfile({});
    mountProfile();

    expect(screen.getByText("Open-source imagery, mostly Sahel.")).toBeInTheDocument();
    // A section eyebrow would put the bio back on the page as a block, which
    // is what pushed the evidence below the fold.
    expect(screen.queryByText("Bio")).not.toBeInTheDocument();
  });

  it("leaves the metadata line under the handle when the analyst wrote no bio", () => {
    withProfile({ bio: null });
    const { container } = mountProfile();

    // No empty line and no orphaned card: the identity line is what the
    // handle sits over.
    expect(container.querySelector("h1 + div")?.textContent).toBe(
      "4 followers·2 following·Member since 5 Jan 2026"
    );
    expect(screen.getByText("ana")).toBeInTheDocument();
  });

  it("copies the Discord username rather than linking it", () => {
    withProfile({ external_links: { discord: "mpgeoint" } });
    mountProfile();

    // Discord publishes no profile URL for a username, so the one thing a
    // reader can do with it is take it to their own client.
    expect(
      screen.getByRole("button", { name: "Copy Discord username: mpgeoint" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Discord/ })).toBeNull();
  });

  it("renders no links line for a profile that carries no link", () => {
    withProfile({ external_links: {} });
    mountProfile();

    // Nothing at all rather than an empty row: the line is the links.
    expect(screen.queryByRole("link", { name: /X \/ Twitter/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Website/ })).toBeNull();
  });

  it("prints the analyst's zeros in the identity line rather than hiding them", () => {
    withProfile({ followers_count: 0, following_count: 0 });
    mountProfile();

    // A profile that hides its zeros is one whose numbers cannot be read.
    expect(screen.getByText("0 followers")).toBeInTheDocument();
    expect(screen.getByText("0 following")).toBeInTheDocument();
    expect(screen.getByText("Member since 5 Jan 2026")).toBeInTheDocument();
  });

  it("keeps the work figures to the Insights card", () => {
    withProfile({});
    mountProfile();

    // The counters strip named the same figure Insights calls `Geolocated`,
    // under a vaguer word and in the more prominent slot.
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("Since")).not.toBeInTheDocument();
  });

  it("keeps a bio that carries a link inside the frame", () => {
    withProfile({ bio: "Notes at https://a-very-long-domain-name.example/analyst/notes" });
    mountProfile();

    const line = screen.getByText(/Notes at https/);
    // The link is plain text that breaks where it must; PageShell's subtitle
    // slot owns the anywhere-break, so one unbreakable token cannot scroll a
    // phone sideways.
    expect(line.closest("[class*='overflow-wrap']")).not.toBeNull();
  });
});

describe("public profile edit mode", () => {
  beforeEach(() => {
    useDetectionsCount.mockReturnValue({ count: 1, refresh: vi.fn() });
    getUserStats.mockResolvedValue(STATS);
    useApiResource.mockImplementation((path: string | null) => {
      if (path?.startsWith("/users/ana/events")) {
        return { data: { items: [SUBMISSION] }, error: null, loading: false, refetch: vi.fn() };
      }
      if (path?.startsWith("/events/points")) {
        return { data: [POINT], error: null, loading: false, refetch: vi.fn() };
      }
      return { data: PROFILE, error: null, loading: false, refetch: vi.fn() };
    });
    useAuth.mockReturnValue({
      user: { id: "u1", username: "ana", email: "ana@example.test" },
      loading: false,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it("collapses the page to the fields: the bio, then the linked-account inputs", async () => {
    const { container } = mountProfile();
    await screen.findByText("Insights");

    screen.getByRole("button", { name: "Edit profile" }).click();

    await waitFor(() =>
      expect(screen.getByText("Profile picture")).toBeInTheDocument()
    );
    // The read-only portfolio drops out, so every field sits between the
    // header and Save, with the links inputs the one section left.
    expect(blockOrder(container)).toEqual(["linked accounts"]);
    // The two field groups stay contiguous and in reading order.
    expect(
      screen
        .getByText("Bio")
        .compareDocumentPosition(screen.getByText("Linked accounts")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The header's link buttons give way to those inputs: one place to read a
    // linked account per mode, so the page never shows both at once.
    expect(screen.queryByRole("link", { name: /X \/ Twitter/ })).toBeNull();
    // The saved bio is not also printed under the handle: one field, one copy
    // of it on screen. The owner's email keeps the slot.
    expect(container.querySelector("h1 + div")?.textContent).toBe("ana@example.test");
  });
});
