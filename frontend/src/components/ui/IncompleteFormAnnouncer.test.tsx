import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncompleteFormAnnouncer } from "./IncompleteFormAnnouncer";

describe("IncompleteFormAnnouncer", () => {
  it("keeps an empty polite region mounted while nothing is missing", () => {
    render(<IncompleteFormAnnouncer missing={[]} attempt={0} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says every missing field at once, visually hidden, and no alert", () => {
    render(<IncompleteFormAnnouncer missing={["Title", "Proof", "Source media"]} attempt={1} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(
      "Fill in the required fields before continuing: Title, Proof, Source media.",
    );
    expect(region).toHaveClass("sr-only");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds a new sentence on each attempt, in the same region", () => {
    const { rerender } = render(<IncompleteFormAnnouncer missing={["Title"]} attempt={1} />);
    const region = screen.getByRole("status");
    const first = region.firstChild;
    rerender(<IncompleteFormAnnouncer missing={["Title"]} attempt={2} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.firstChild).not.toBe(first);
  });
});
