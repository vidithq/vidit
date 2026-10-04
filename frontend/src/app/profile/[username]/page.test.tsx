import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ username: "ana" }),
  usePathname: () => "/profile/ana",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// MapLibre touches `window` at module scope.
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

import { buttonClasses } from "@/components/ui/Button";
import type { CollectionPage } from "@/lib/collections";
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
  // Equal to `geolocated_count` on purpose, so a component reading the wrong one still fails.
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

const COLLECTIONS: CollectionPage = {
  items: [
    {
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
      event_count: 2,
      first_date: "2026-06-01",
      last_date: "2026-06-02",
      created_at: "2026-06-03T09:00:00Z",
    },
  ],
  total: 1,
  page: 1,
  per_page: 6,
};

/** The blocks a reader meets, each named by text only that block shows, pinned by document position. */
const BLOCKS: Record<string, string> = {
  "Recent submissions": "recent submissions",
  Collections: "collections",
  Insights: "insights",
  Coverage: "coverage",
  // Edit mode only: this eyebrow titles the inputs.
  "Linked accounts": "linked accounts",
  "1 detection to submit": "detections queue",
  "Sign out": "account controls",
};

/** The named blocks, in the order the document puts them. */
function blockOrder(container: HTMLElement): string[] {
  const seen: string[] = [];
  for (const el of container.querySelectorAll("*")) {
    // The element's own words, else every ancestor of a marker would match.
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
      if (path?.startsWith("/users/ana/collections")) {
        return { data: COLLECTIONS, error: null, loading: false, refetch: vi.fn() };
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
    // Insights arrive from their own fetch; wait before reading the order.
    await screen.findByText("Insights");

    // Map and Insights sit together; the growing list reads last.
    expect(blockOrder(container)).toEqual([
      "coverage",
      "insights",
      // The analyst's grouping, between the Insights card and the list.
      "collections",
      "recent submissions",
    ]);
    // The links are buttons in the header here, so the section that titles
    // their inputs belongs to edit mode alone.
    expect(screen.queryByText("Linked accounts")).toBeNull();
  });

  it("puts where to reach the analyst in the header, above the work", async () => {
    mountProfile();
    await screen.findByText("Insights");

    // Bare marks: the handle goes in the accessible name, since a brand mark names only the platform.
    const x = screen.getByRole("link", { name: "X / Twitter: @ana_osint" });
    expect(x).toHaveAttribute("href", "https://x.com/ana_osint");
    expect(x.textContent).toBe("");
    // The href is the pasted URL as `URL` normalises it; the name shows the domain, not the scheme.
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

    // Follow sits at the far right of the header cluster; the edit pair is the owner's; sharing has no control here.
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy profile link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });

  it("draws the whole header row as marks, the owner's edit control included", async () => {
    useAuth.mockReturnValue({
      user: { id: "u1", username: "ana", email: "ana@example.test" },
      loading: false,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    mountProfile();
    await screen.findByText("Insights");

    // One kind of control in the row: the owner's Edit uses the same ghost square as the accounts.
    const marks = [
      screen.getByRole("link", { name: "X / Twitter: @ana_osint" }),
      screen.getByRole("link", { name: "Website: ana.example" }),
      screen.getByRole("button", { name: "Edit profile" }),
    ];
    const shape = buttonClasses("ghost", { icon: true });
    for (const mark of marks) expect(mark.className).toBe(shape);
  });

  it("names each chart by what it counts, in words that need no tooltip", async () => {
    mountProfile();
    await screen.findByText("Insights");

    // Headings must not need a `?`: the calendar counts when events happened (the field's own name, as in the forms), the bar counts source-link hosts, undated or hostless events accounted for.
    expect(await screen.findByText("Event dates")).toBeInTheDocument();
    // The grid's population summed off the buckets, not `total_events` (undated events have no cell).
    expect(
      screen.getByText(
        "The month each event took place, not when it was posted, imported or published. It covers the 21 events dated in the years shown."
      )
    ).toBeInTheDocument();
    // The population line is scoped to the tiles: the grid counts dated events only and the bar splits by a field an event may lack.
    expect(
      screen.getByText(
        "The tiles below read one set of 3 events: this analyst's geolocations and machine detections. Two count it, two name what leads it."
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
      "collections",
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
      if (path?.startsWith("/users/ana/collections")) {
        return {
          data: { ...COLLECTIONS, items: [], total: 0 },
          error: null,
          loading: false,
          refetch: vi.fn(),
        };
      }
      return { data: profile, error: null, loading: false, refetch: vi.fn() };
    });
  }

  it("reads the bio beside the handle rather than in a section of its own", () => {
    withProfile({});
    mountProfile();

    expect(screen.getByText("Open-source imagery, mostly Sahel.")).toBeInTheDocument();
    // A section eyebrow would put the bio back as a block and push the evidence below the fold.
    expect(screen.queryByText("Bio")).not.toBeInTheDocument();
  });

  it("leaves the metadata line under the handle when the analyst wrote no bio", () => {
    withProfile({ bio: null });
    const { container } = mountProfile();

    // No empty line or orphaned card: the identity line sits under the handle.
    expect(container.querySelector("h1 + div")?.textContent).toBe(
      "4 followers·2 following·Member since 5 Jan 2026"
    );
    expect(screen.getByText("ana")).toBeInTheDocument();
  });

  it("copies the Discord username rather than linking it", () => {
    withProfile({ external_links: { discord: "mpgeoint" } });
    mountProfile();

    // Discord has no profile URL for a username, so the reader can only copy it.
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

    // The counters strip named the Insights `Geolocated` figure under a vaguer word.
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("Since")).not.toBeInTheDocument();
  });

  it("keeps a bio that carries a link inside the frame", () => {
    withProfile({ bio: "Notes at https://a-very-long-domain-name.example/analyst/notes" });
    mountProfile();

    const line = screen.getByText(/Notes at https/);
    // The link breaks where it must; PageShell's subtitle slot owns the anywhere-break so a token cannot scroll a phone sideways.
    expect(line.closest(".wrap-anywhere")).not.toBeNull();
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
      if (path?.startsWith("/users/ana/collections")) {
        return { data: COLLECTIONS, error: null, loading: false, refetch: vi.fn() };
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
    // The read-only portfolio drops out; the links inputs are the one section left.
    expect(blockOrder(container)).toEqual(["linked accounts"]);
    // The two field groups stay contiguous and in reading order.
    expect(
      screen
        .getByText("Bio")
        .compareDocumentPosition(screen.getByText("Linked accounts")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // One place to read a linked account per mode: buttons give way to inputs.
    expect(screen.queryByRole("link", { name: /X \/ Twitter/ })).toBeNull();
    // The saved bio is not printed under the handle; the owner's email keeps the slot.
    expect(container.querySelector("h1 + div")?.textContent).toBe("ana@example.test");
  });
});
