import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoToCoordinates } from "./GoToCoordinates";
import { GoToCoordinatesControl } from "./GoToCoordinatesControl";

const flyTo = vi.fn();

// No map in jsdom: the control's element goes straight into the document, once (moving it would
// drop the focus the close gives back), and the map is a stub.
vi.mock("react-map-gl/maplibre", () => ({
  useControl: (create: () => { onAdd: () => HTMLElement }) => {
    const element = create().onAdd();
    if (!element.isConnected) document.body.appendChild(element);
  },
  useMap: () => ({ current: { flyTo, getZoom: () => 4 } }),
}));

function field() {
  return screen.getByRole("textbox", { name: "Go to coordinates" });
}

describe("<GoToCoordinates>", () => {
  it("hands a typed pair to the caller on Go and on Enter", () => {
    const onGo = vi.fn();
    render(<GoToCoordinates onGo={onGo} />);
    fireEvent.change(field(), { target: { value: "48.015883, 37.802411" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onGo).toHaveBeenCalledWith({ lat: 48.015883, lng: 37.802411 });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onGo).toHaveBeenCalledTimes(2);
  });

  it("says why a pair does not read, and clears the reason on the next keystroke", () => {
    const onGo = vi.fn();
    render(<GoToCoordinates onGo={onGo} />);
    fireEvent.change(field(), { target: { value: "95, 200" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onGo).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Latitude must be between -90 and 90.");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("Latitude must be between -90 and 90.");
    fireEvent.change(field(), { target: { value: "45, 37" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("<GoToCoordinatesControl>", () => {
  it("opens the field from a map control, centres the map and closes", () => {
    render(<GoToCoordinatesControl />);
    const trigger = screen.getByRole("button", { name: "Go to coordinates" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Go to coordinates" })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    fireEvent.change(field(), { target: { value: "-33.9, 151.2" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(flyTo).toHaveBeenCalledWith({ center: [151.2, -33.9], zoom: 14 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
