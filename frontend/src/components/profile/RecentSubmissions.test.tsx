import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentSubmissions, type RecentSubmission } from "./RecentSubmissions";
import type { PublicProfile } from "@/lib/users";

function profileFixture(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: "p1",
    username: "ana",
    bio: null,
    avatar_url: null,
    external_links: {},
    created_at: "2026-01-01T00:00:00Z",
    geolocations_count: 0,
    followers_count: 0,
    following_count: 0,
    is_following: false,
    ...overrides,
  };
}

function submission(id: string): RecentSubmission {
  return {
    id,
    title: `Strike ${id}`,
    status: "geolocated",
    before_closed_status: null,
    event_coords: { lat: 48.1, lng: 37.4 },
    event_date: "2026-03-15",
    is_graphic: false,
    media: null,
    owner: { id: "p1", username: "ana", avatar_url: null },
    tags: [],
    conflicts: [],
  };
}

describe("RecentSubmissions", () => {
  it("gates the heading copy on the rows, not on the profile count", () => {
    // The count and the feed arrive on separate requests, so a feed read that
    // failed leaves rows empty under a non-zero count. Keying the copy off the
    // count would promise "latest geolocations" above an empty list.
    render(
      <RecentSubmissions
        profile={profileFixture({ geolocations_count: 47 })}
        submissions={[]}
        isOwn={false}
      />
    );

    expect(screen.getByText("No geolocations yet.")).toBeInTheDocument();
    expect(screen.queryByText(/latest geolocations/)).not.toBeInTheDocument();
    // Nothing to expand into, so no "Show more" either.
    expect(screen.queryByRole("link", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("expands into the same published set the block shows", () => {
    // Search's located group otherwise widens to machine drafts, so the
    // status filter travels with the link.
    render(
      <RecentSubmissions
        profile={profileFixture({ geolocations_count: 47 })}
        submissions={[submission("a")]}
        isOwn={false}
      />
    );

    expect(screen.getByText("ana's latest geolocations, newest first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute(
      "href",
      "/search?type=event&author=ana&status=geolocated"
    );
  });
});
