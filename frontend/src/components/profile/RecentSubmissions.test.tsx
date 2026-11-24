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
    organizations: [],
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
    requested_at: null,
    geolocators: [],
    coords: { lat: 48.1, lng: 37.4 },
    occurred_date: "2026-03-15",
    is_graphic: false,
    media: null,
    owner: { id: "p1", username: "ana", avatar_url: null },
    tags: [],
    conflicts: [],
  };
}

describe("RecentSubmissions", () => {
  it("says no geolocations yet when the feed holds no row", () => {
    render(
      <RecentSubmissions
        profile={profileFixture()}
        submissions={[]}
        isOwn={false}
      />
    );

    expect(screen.getByText("No geolocations yet.")).toBeInTheDocument();
    expect(screen.queryByText(/latest geolocations/)).not.toBeInTheDocument();
    // Nothing to expand into, so no "See all" either.
    expect(screen.queryByRole("link", { name: "See all" })).not.toBeInTheDocument();
    // The heading says it once; no second sentence repeats that the block is empty.
    expect(screen.queryByText("Nothing yet.")).not.toBeInTheDocument();
  });

  it("gives the owner of an empty block a next action", () => {
    render(
      <RecentSubmissions profile={profileFixture()} submissions={[]} isOwn={true} />
    );

    expect(screen.getByText("No geolocations submitted yet.")).toBeInTheDocument();
    expect(screen.queryByText("No geolocations yet.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Submit your first geolocation →" })
    ).toHaveAttribute("href", "/submit?mode=single");
  });

  it("expands into the same published set the block shows", () => {
    // Search's located group otherwise widens to machine detections, so the status filter travels with the link.
    render(
      <RecentSubmissions
        profile={profileFixture()}
        submissions={[submission("a")]}
        isOwn={false}
      />
    );

    expect(screen.getByText("ana's latest geolocations, newest first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/search?type=event&status=geolocated&author=ana"
    );
  });
});
