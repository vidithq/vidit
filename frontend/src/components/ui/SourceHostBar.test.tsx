import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceHostBar } from "./SourceHostBar";

/**
 * The bar paints a breakdown the backend already ranked and capped, so its
 * own contract is what reaches the reader: a legend entry per slice, the two
 * non-host buckets shown only when they hold something, and a sentence when
 * there is no breakdown at all.
 */
describe("<SourceHostBar>", () => {
  it("names every host with its count", () => {
    render(
      <SourceHostBar
        hosts={[
          { name: "x.com", count: 33 },
          { name: "t.me", count: 14 },
        ]}
        otherCount={0}
        noSourceCount={0}
      />
    );

    expect(screen.getByText("x.com · 33")).toBeInTheDocument();
    expect(screen.getByText("t.me · 14")).toBeInTheDocument();
    // Nothing in the tail, so no bucket claiming events that aren't there.
    expect(screen.queryByText(/Other/)).toBeNull();
    expect(screen.queryByText(/No source/)).toBeNull();
  });

  it("shows the unnamed tail and the source-less events as their own slices", () => {
    render(
      <SourceHostBar
        hosts={[{ name: "x.com", count: 10 }]}
        otherCount={4}
        noSourceCount={2}
      />
    );

    // Both stay visible: the bar has to account for every event the card
    // counted, or it prints a smaller total than the tiles above it.
    expect(screen.getByText("Other · 4")).toBeInTheDocument();
    expect(screen.getByText("No source · 2")).toBeInTheDocument();
  });

  it("says there is no breakdown rather than drawing an empty bar", () => {
    render(<SourceHostBar hosts={[]} otherCount={0} noSourceCount={0} />);

    expect(screen.getByText("No event names a source yet.")).toBeInTheDocument();
  });
});
