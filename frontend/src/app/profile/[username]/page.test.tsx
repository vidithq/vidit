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
  geolocations_count: 3,
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
  activity_granularity: "month",
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

  it("shows a visitor the work, then the explanation, then where to reach the analyst", async () => {
    const { container } = mountProfile();
    // Insights arrive from their own fetch, so wait for the last block.
    await screen.findByText("Insights");

    expect(blockOrder(container)).toEqual([
      "coverage",
      "recent submissions",
      "insights",
      "linked accounts",
    ]);
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
      "recent submissions",
      "insights",
      "linked accounts",
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

  it("collapses the page to the form, bio and linked accounts contiguous", async () => {
    const { container } = mountProfile();
    await screen.findByText("Insights");

    screen.getByRole("button", { name: "Edit profile" }).click();

    await waitFor(() =>
      expect(screen.getByLabelText("Avatar URL")).toBeInTheDocument()
    );
    // The read-only portfolio drops out, so every field sits between the
    // header and Save.
    expect(blockOrder(container)).toEqual(["linked accounts"]);
    expect(screen.getByText("Bio")).toBeInTheDocument();
    // The saved bio is not also printed under the handle: one field, one copy
    // of it on screen. The owner's email keeps the slot.
    expect(container.querySelector("h1 + div")?.textContent).toBe("ana@example.test");
  });
});
