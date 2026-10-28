import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom cannot mount the draw canvas (WebGL).
vi.mock("@/components/map/ZoneDrawMap", () => ({ default: () => <div data-testid="draw-map" /> }));

import type { DrawState, Position } from "@/lib/siteZone";
import { ZoneEditor, useDrawHistory } from "./ZoneEditor";

function Editor({ initial }: { initial: DrawState }) {
  return <ZoneEditor label="Contour" history={useDrawHistory(initial)} />;
}

const square = (side: number): Position[] => [
  [30, 10],
  [30 + side, 10],
  [30 + side, 10 + side],
  [30, 10 + side],
];

describe("ZoneEditor", () => {
  it("refuses a contour over the size cap while it is drawn, its area grouped by thousands", () => {
    render(<Editor initial={{ vertices: square(2), closed: true, selected: null }} />);
    expect(screen.getByText(/^48,\d{3}\.\d{2} km² · 4 corners$/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A site covers at most 1,000 km². Move the corners closer.",
    );
  });

  it("refuses it before the ring closes", () => {
    render(<Editor initial={{ vertices: square(2), closed: false, selected: null }} />);
    expect(screen.getByText("4 corners, not closed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("A site covers at most 1,000 km².");
  });

  it("shows no refusal for a contour under the cap", () => {
    render(<Editor initial={{ vertices: square(0.01), closed: true, selected: null }} />);
    expect(screen.getByText(/^1\.2\d km² · 4 corners$/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
