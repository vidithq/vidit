import { render, screen } from "@testing-library/react";
import { MapPin } from "lucide-react";
import { describe, expect, it } from "vitest";

import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("is one click target carrying both the label and the value", () => {
    render(<StatTile icon={MapPin} label="Geolocated" value={42} href="/search?type=event" />);

    const link = screen.getByRole("link", { name: /Geolocated/ });
    expect(link).toHaveAttribute("href", "/search?type=event");
    // The whole tile navigates, so the figure sits inside the link rather
    // than beside it.
    expect(link).toHaveTextContent("42");
  });

  it("is inert without an href", () => {
    render(<StatTile icon={MapPin} label="Geolocated" value={42} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
