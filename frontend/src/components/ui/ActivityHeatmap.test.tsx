import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityHeatmap } from "./ActivityHeatmap";

/**
 * Every year the span touches gets a row of twelve, empty months are drawn, and
 * the readout names a month on demand. A single month keeps the grid; no dated
 * event gets a sentence.
 */
describe("<ActivityHeatmap>", () => {
  it("draws one row per calendar year the span touches, twelve cells each", () => {
    const { container } = render(
      <ActivityHeatmap
        buckets={[
          { period: "2024-11", count: 3 },
          { period: "2024-12", count: 0 },
          { period: "2025-01", count: 1 },
        ]}
      />
    );

    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(24);
  });

  it("draws a month with no event rather than leaving a hole", () => {
    render(
      <ActivityHeatmap
        buckets={[
          { period: "2025-01", count: 2 },
          { period: "2025-02", count: 0 },
        ]}
      />
    );

    expect(screen.getByTitle("Feb 2025 · 0 events")).toBeInTheDocument();
  });

  it("paints the accent on the months that answer and on nothing else", () => {
    const { container } = render(
      <ActivityHeatmap
        buckets={[
          { period: "2025-01", count: 4 },
          { period: "2025-02", count: 0 },
        ]}
      />
    );

    // A lit month takes the ramp step its count earns; an empty month keeps the
    // absence paint; the legend copies the cells.
    const painted = container.querySelectorAll("[class*='bg-orange']");
    const inGrid = [...painted].filter((el) => el.closest("[title]") === el);
    expect(inGrid.length).toBeGreaterThan(0);
    expect(screen.getByTitle("Feb 2025 · 0 events").className).not.toMatch(/bg-orange/);
  });

  it("names every month carrying events, singular count included", () => {
    render(<ActivityHeatmap buckets={[{ period: "2025-06", count: 1 }]} />);

    expect(screen.getByTitle("Jun 2025 · 1 event")).toBeInTheDocument();
  });

  it("states the span until a month is picked, then names that month", async () => {
    render(
      <ActivityHeatmap
        buckets={[
          { period: "2024-11", count: 3 },
          { period: "2025-01", count: 1 },
        ]}
      />
    );

    expect(screen.getByText("Covering 2024 to 2025")).toBeInTheDocument();

    // A tap, not only a hover.
    fireEvent.click(screen.getByTitle("Nov 2024 · 3 events"));
    expect(await screen.findByText("Nov 2024 · 3 events")).toBeInTheDocument();
  });

  it("keeps the grid for a single month, which is what says which month", () => {
    const { container } = render(
      <ActivityHeatmap buckets={[{ period: "2024-05", count: 12 }]} />
    );

    // The line names the year without reading as a second row label.
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("Covering 2024")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(12);
    expect(screen.getByTitle("May 2024 · 12 events")).toBeInTheDocument();
  });

  it("says the grid is empty rather than drawing an empty frame", () => {
    const { container } = render(<ActivityHeatmap buckets={[]} />);

    expect(screen.getByText("No event carries a date yet.")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});
