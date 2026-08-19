import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileInsights } from "./ProfileInsights";
import type { UserStats } from "@/lib/users";

const getUserStats = vi.hoisted(() => vi.fn());
vi.mock("@/lib/users", () => ({ getUserStats }));

function statsFixture(overrides: Partial<UserStats> = {}): UserStats {
  return {
    geolocated_count: 12,
    detected_count: 3,
    closed_count: 1,
    total_events: 16,
    media_count: 20,
    top_conflicts: [{ name: "Russo-Ukrainian War", count: 9 }],
    capture_sources: [{ name: "drone", count: 5 }],
    source_hosts: [{ name: "t.me", count: 10 }],
    other_hosts_count: 0,
    no_source_count: 6,
    activity: [{ period: "2026-01", count: 16 }],
    ...overrides,
  };
}

/** Render the card and wait for the stats fetch to settle. */
async function renderCard(stats: UserStats) {
  getUserStats.mockResolvedValue(stats);
  render(<ProfileInsights username="ana" />);
  return screen.findByText("Insights");
}

afterEach(() => {
  getUserStats.mockReset();
});

describe("ProfileInsights", () => {
  it("opens the rows behind every tile, scoped to the analyst", async () => {
    await renderCard(statsFixture());

    // Each tile is the way into the set it was summed off: the status pair
    // carries the lifecycle vocabulary, the two leaders carry their own name
    // as the filter value.
    expect(screen.getByRole("link", { name: /Geolocated/ })).toHaveAttribute(
      "href",
      "/search?type=event&author=ana&status=geolocated"
    );
    expect(screen.getByRole("link", { name: /Detected/ })).toHaveAttribute(
      "href",
      "/search?type=event&author=ana&status=detected"
    );
    expect(screen.getByRole("link", { name: /Top conflict/ })).toHaveAttribute(
      "href",
      "/search?type=event&author=ana&conflict=Russo-Ukrainian+War"
    );
    expect(
      screen.getByRole("link", { name: /Top capture source/ })
    ).toHaveAttribute("href", "/search?type=event&author=ana&capture_source=drone");
  });

  it("names the leader of each ranked list once", async () => {
    await renderCard(statsFixture());

    expect(screen.getByText("Russo-Ukrainian War")).toBeInTheDocument();
    expect(screen.getByText("drone")).toBeInTheDocument();
    // The count behind a leader is not printed beside it: the search the tile
    // opens is where "by how much" is read.
    expect(screen.queryByText(/Russo-Ukrainian War · 9/)).not.toBeInTheDocument();
  });

  it("leaves a leaderless tile inert rather than linking nowhere", async () => {
    await renderCard(statsFixture({ top_conflicts: [], capture_sources: [] }));

    expect(screen.getAllByText("None")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: /Top conflict/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Top capture source/ })
    ).not.toBeInTheDocument();
    // The counted tiles still link: an empty ranked list says nothing about
    // whether the analyst has events.
    expect(screen.getByRole("link", { name: /Geolocated/ })).toBeInTheDocument();
  });

  it("renders nothing for a profile with no events", async () => {
    getUserStats.mockResolvedValue(
      statsFixture({
        total_events: 0,
        geolocated_count: 0,
        detected_count: 0,
        closed_count: 0,
        top_conflicts: [],
        capture_sources: [],
      })
    );
    const { container } = render(<ProfileInsights username="ana" />);

    await vi.waitFor(() => expect(getUserStats).toHaveBeenCalledWith("ana"));
    expect(container).toBeEmptyDOMElement();
  });
});
