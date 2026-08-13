import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

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

  it("is a label and nothing else, carrying no hover text of its own", () => {
    // What a status means is the `status` concept, read by the `?` on the
    // Status row and on the status filter, so the badge never explains itself.
    const { container } = render(<StatusBadge status="geolocated" />);
    expect(container.querySelector("[title]")).toBeNull();
  });
});
