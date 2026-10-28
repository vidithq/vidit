import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// MapLibre touches `window` at module scope, so the canvas never loads under jsdom. The stub
// reports the points it was handed, which the camera fits to.
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

// [id, lat, lng, occurred_date, added_date, detected]
const point = (id: string, detected: 0 | 1): MapPoint => [
  id,
  48.1,
  2.3,
  "2026-01-01",
  "2026-01-02",
  detected,
];

describe("ProfileMap", () => {
  it("maps the detections beside the submissions and prints no count", () => {
    useApiResource.mockReturnValue({
      data: [point("a", 0), point("b", 0), point("c", 1)],
    });

    render(<ProfileMap username="ana" />);

    // The whole set frames the camera, detections included.
    expect(screen.getByTestId("map")).toHaveAttribute("data-points", "3");
    // The Insights tiles hold the counts once.
    expect(screen.queryByText(/on the map/)).not.toBeInTheDocument();
  });

  it("renders nothing for an analyst with no located events", () => {
    useApiResource.mockReturnValue({ data: [] });

    const { container } = render(<ProfileMap username="ana" />);

    expect(container).toBeEmptyDOMElement();
  });
});
