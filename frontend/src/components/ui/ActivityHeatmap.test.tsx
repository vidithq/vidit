import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityHeatmap } from "./ActivityHeatmap";

/**
 * The grid paints whatever span the backend derived, so its own contract is
 * how that span becomes rows: every calendar year the span touches gets a row
 * of twelve, the months with no event are drawn rather than skipped, and the
 * readout names a month on demand. The degenerate spans are the other half: a
 * single month keeps the grid, and no dated event at all gets a sentence.
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
    // Two years of twelve months, whatever part of them the span covers.
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

    // An empty month is a cell that says zero, not an absent one. It carries
    // no focus stop, so a keyboard reader walks the months that mean
    // something.
    expect(screen.getByTitle("Feb 2025 · 0 events")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feb 2025 · 0 events" })).toBeNull();
  });

  it("makes every month carrying events reachable and named", () => {
    render(<ActivityHeatmap buckets={[{ period: "2025-06", count: 1 }]} />);

    // Singular count, and a control rather than a hover-only tooltip: at
    // 375 px there is no pointer to hover with.
    expect(screen.getByRole("button", { name: "Jun 2025 · 1 event" })).toBeInTheDocument();
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

    screen.getByRole("button", { name: "Nov 2024 · 3 events" }).focus();
    expect(await screen.findByText("Nov 2024 · 3 events")).toBeInTheDocument();
  });

  it("keeps the grid for a single month, which is what says which month", () => {
    const { container } = render(
      <ActivityHeatmap buckets={[{ period: "2024-05", count: 12 }]} />
    );

    // One row, and the line under the grid names the year it covers without
    // reading as a second row label.
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("Covering 2024")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "May 2024 · 12 events" })).toBeInTheDocument();
  });

  it("says the grid is empty rather than drawing an empty frame", () => {
    const { container } = render(<ActivityHeatmap buckets={[]} />);

    expect(screen.getByText("No event carries a date yet.")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});
