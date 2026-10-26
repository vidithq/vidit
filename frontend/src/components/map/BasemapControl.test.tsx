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
  buildings: true,
  disputedDashed: true,
};

function open(settings: Partial<BasemapSettings> = {}, adjustable = true) {
  const onChange = vi.fn();
  render(
    <BasemapControl
      settings={{ ...SETTINGS, ...settings }}
      adjustable={adjustable}
      onChange={onChange}
    />,
  );
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

  it("reports a change to each detail setting", () => {
    const onChange = open();
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(onChange).toHaveBeenLastCalledWith({ language: "local" });
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    expect(onChange).toHaveBeenLastCalledWith({ density: "normal" });
    fireEvent.click(screen.getByRole("switch", { name: "Region borders" }));
    expect(onChange).toHaveBeenLastCalledWith({ regionBorders: true });
    fireEvent.click(screen.getByRole("switch", { name: "Roads" }));
    expect(onChange).toHaveBeenLastCalledWith({ roads: false });
    fireEvent.click(screen.getByRole("switch", { name: "Buildings" }));
    expect(onChange).toHaveBeenLastCalledWith({ buildings: false });
    fireEvent.click(screen.getByRole("switch", { name: "Dashed disputed borders" }));
    expect(onChange).toHaveBeenLastCalledWith({ disputedDashed: false });
  });

  it("hides the detail settings on a third-party basemap", () => {
    open({ preset: "streets" }, false);
    expect(screen.queryByRole("group", { name: "Label language" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Roads" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Buildings" })).toBeNull();
    expect(screen.getByText(/adjust on the Dark and Light basemaps/)).toBeInTheDocument();
  });
});
