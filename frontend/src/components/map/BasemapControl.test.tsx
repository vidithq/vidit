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
  militaryAndAirports: true,
  relief: false,
  disputedDashed: true,
  grid: false,
  dailyImagery: false,
  fires: false,
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
    fireEvent.click(screen.getByRole("button", { name: "Satellite" }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: "satellite" });
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
    fireEvent.click(screen.getByRole("switch", { name: "Military areas and airports" }));
    expect(onChange).toHaveBeenLastCalledWith({ militaryAndAirports: false });
    fireEvent.click(screen.getByRole("switch", { name: "Relief" }));
    expect(onChange).toHaveBeenLastCalledWith({ relief: true });
    fireEvent.click(screen.getByRole("switch", { name: "Dashed disputed borders" }));
    expect(onChange).toHaveBeenLastCalledWith({ disputedDashed: false });
    fireEvent.click(screen.getByRole("switch", { name: "Coordinate grid" }));
    expect(onChange).toHaveBeenLastCalledWith({ grid: true });
    fireEvent.click(screen.getByRole("switch", { name: "Daily satellite imagery" }));
    expect(onChange).toHaveBeenLastCalledWith({ dailyImagery: true });
    fireEvent.click(screen.getByRole("switch", { name: "Fire detections" }));
    expect(onChange).toHaveBeenLastCalledWith({ fires: true });
  });

  it("hides the label and layer settings on a third-party basemap and keeps the overlays", () => {
    open({ preset: "streets" }, false);
    expect(screen.queryByRole("group", { name: "Label language" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Roads" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Buildings" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Relief" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Coordinate grid" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Daily satellite imagery" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Fire detections" })).toBeInTheDocument();
    expect(screen.getByText(/adjust on the Dark and Light basemaps/)).toBeInTheDocument();
  });
});
