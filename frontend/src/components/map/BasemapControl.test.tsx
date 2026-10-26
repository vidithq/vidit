import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BasemapControl } from "./BasemapControl";
import type { BasemapSettings } from "./basemapSettings";

// No map in jsdom: the control's element goes straight into the document.
vi.mock("react-map-gl/maplibre", () => ({
  useControl: (create: () => { onAdd: () => HTMLElement }) => {
    document.body.appendChild(create().onAdd());
  },
}));

const SETTINGS: BasemapSettings = {
  preset: "auto",
  language: "latin",
  density: "sparse",
  regionBorders: false,
  roads: true,
};

function open(settings: Partial<BasemapSettings> = {}) {
  const onChange = vi.fn();
  render(<BasemapControl settings={{ ...SETTINGS, ...settings }} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Basemap" }));
  return onChange;
}

describe("<BasemapControl>", () => {
  it("opens a named panel from a map control", () => {
    open();
    expect(screen.getByRole("button", { name: "Basemap" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Basemap" })).toBeInTheDocument();
  });

  it("marks the current preset and reports a pick", () => {
    const onChange = open();
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Terrain" }));
    expect(onChange).toHaveBeenCalledWith({ preset: "terrain" });
  });
});
