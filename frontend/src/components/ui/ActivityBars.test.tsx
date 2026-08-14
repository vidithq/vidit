import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityBars } from "./ActivityBars";

/**
 * The row paints whatever span the backend derived, so its own contract is
 * the three shapes that span can take: a row worth drawing, a single bucket,
 * and no bucket at all. The last two get a sentence, because a lone bar
 * carries no shape and an empty frame reads as a bug.
 */
describe("<ActivityBars>", () => {
  it("draws one bar per bucket and labels the two ends", () => {
    const { container } = render(
      <ActivityBars
        buckets={[
          { period: "2025-03", count: 2 },
          { period: "2025-04", count: 0 },
          { period: "2025-05", count: 7 },
        ]}
      />
    );

    expect(container.querySelectorAll("[title]")).toHaveLength(3);
    // The period reads as a date, not as the wire key.
    expect(container.querySelector("[title]")).toHaveAttribute("title", "Mar 2025: 2");
    expect(screen.getByText("Mar 2025")).toBeInTheDocument();
    expect(screen.getByText("May 2025")).toBeInTheDocument();
    // Nothing in between labels the axis: two ends are what fits at 375 px.
    expect(screen.queryByText("Apr 2025")).not.toBeInTheDocument();
  });

  it("names quarters and years by their own shape", () => {
    render(
      <ActivityBars
        buckets={[
          { period: "2023-Q1", count: 4 },
          { period: "2024-Q2", count: 1 },
        ]}
      />
    );

    expect(screen.getByText("Q1 2023")).toBeInTheDocument();
    expect(screen.getByText("Q2 2024")).toBeInTheDocument();
  });

  it("says what a single bucket holds instead of drawing one bar", () => {
    const { container } = render(<ActivityBars buckets={[{ period: "2024", count: 12 }]} />);

    expect(screen.getByText("12 events, all in 2024.")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("counts one event in the singular", () => {
    render(<ActivityBars buckets={[{ period: "2024-05", count: 1 }]} />);

    expect(screen.getByText("1 event, all in May 2024.")).toBeInTheDocument();
  });

  it("says the row is empty rather than drawing an empty frame", () => {
    const { container } = render(<ActivityBars buckets={[]} />);

    expect(screen.getByText("No event carries a date yet.")).toBeInTheDocument();
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});
