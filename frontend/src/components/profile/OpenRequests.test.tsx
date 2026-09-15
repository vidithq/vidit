import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OpenRequests } from "./OpenRequests";
import type { PublicProfile } from "@/lib/users";
import type { EventListItem } from "@/types";

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

/** An open call: no coordinate, which is the thing it is asking for. */
function openRequest(id: string): EventListItem {
  return {
    id,
    title: `Where is this ${id}`,
    status: "requested",
    before_closed_status: null,
    event_coords: null,
    event_date: null,
    is_graphic: false,
    media: null,
    owner: { id: "p1", username: "ana", avatar_url: null },
    tags: [],
    conflicts: [],
  };
}

describe("OpenRequests", () => {
  it("sends each card to the request's own page, not the event route", () => {
    // A request is an `events` row, but it is read at `/requests/{id}`: the
    // event page is where a located row lives.
    render(
      <OpenRequests profile={profileFixture()} requests={[openRequest("r1")]} />
    );

    expect(screen.getByRole("link", { name: /Where is this r1/ })).toHaveAttribute(
      "href",
      "/requests/r1"
    );
  });

  it("expands into the same open set the block shows", () => {
    render(
      <OpenRequests profile={profileFixture()} requests={[openRequest("r1")]} />
    );

    expect(
      screen.getByText("ana's footage waiting to be geolocated, newest first.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute(
      "href",
      "/search?type=event&author=ana&status=requested"
    );
  });
});
