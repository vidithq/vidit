import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// MapLibre touches `window` at module scope, so the real canvas never loads
// under jsdom. The stub reports the points it was handed, which is what the
// camera is fitted to.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({ points }: { points: unknown[] }) {
      return <div data-testid="map" data-points={points.length} />;
    },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

import type { MapPoint } from "@/types";

import { ProfileMap } from "./ProfileMap";

// [id, lat, lng, event_date, added_date, detected, demo]
const point = (id: string, detected: 0 | 1): MapPoint => [
  id,
  48.1,
  2.3,
  "2026-01-01",
  "2026-01-02",
  detected,
  0,
];

describe("ProfileMap", () => {
  it("maps the drafts beside the submissions and counts each in its own words", () => {
    useApiResource.mockReturnValue({
      data: [point("a", 0), point("b", 0), point("c", 1)],
    });

    render(<ProfileMap username="ana" />);

    // The whole set frames the camera, drafts included.
    expect(screen.getByTestId("map")).toHaveAttribute("data-points", "3");
    // The Insights card above splits its own status counts under these two
    // names, so the two numbers on the page can't contradict each other.
    expect(screen.getByText("2 geolocated, 1 detected on the map")).toBeInTheDocument();
  });

  it("names only the published work when the analyst has no drafts on the map", () => {
    useApiResource.mockReturnValue({ data: [point("a", 0)] });

    render(<ProfileMap username="ana" />);

    expect(screen.getByText("1 geolocated on the map")).toBeInTheDocument();
  });

  it("renders nothing for an analyst with no located events", () => {
    useApiResource.mockReturnValue({ data: [] });

    const { container } = render(<ProfileMap username="ana" />);

    expect(container).toBeEmptyDOMElement();
  });
});
