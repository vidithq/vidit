import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

const titleOf = (label: string) =>
  screen.getByText(label).closest("[title]")?.getAttribute("title");

describe("StatusBadge", () => {
  it("renders each lifecycle label", () => {
    const { rerender } = render(<StatusBadge status="requested" />);
    expect(screen.getByText("Requested")).toBeInTheDocument();
    rerender(<StatusBadge status="detected" />);
    expect(screen.getByText("Detected")).toBeInTheDocument();
    rerender(<StatusBadge status="geolocated" />);
    expect(screen.getByText("Geolocated")).toBeInTheDocument();
    rerender(<StatusBadge status="closed" />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("closed tooltip reflects a withdrawn request", () => {
    render(<StatusBadge status="closed" beforeClosedStatus="requested" />);
    expect(titleOf("Closed")).toBe("The author withdrew this request");
  });

  it("closed tooltip reflects a rejected detection", () => {
    render(<StatusBadge status="closed" beforeClosedStatus="detected" />);
    expect(titleOf("Closed")).toBe("The owner rejected this detection");
  });

  it("closed tooltip falls back to a generic line without before_closed_status", () => {
    render(<StatusBadge status="closed" />);
    expect(titleOf("Closed")).toBe("Closed, kept as an audit row");
  });

  it("a non-closed status ignores before_closed_status", () => {
    // A stray before_closed_status must not leak into an open row's tooltip.
    render(<StatusBadge status="geolocated" beforeClosedStatus="requested" />);
    expect(titleOf("Geolocated")).toBe(
      "Geolocated by a person, not independently verified"
    );
  });
});
