import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoordinateInputs } from "./CoordinateInputs";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
};

/**
 * Fire a paste carrying `text`; true if the component took it over (a recognised
 *  pair) rather than letting it land as text.
 */
function paste(target: Element, text: string): boolean {
  const event = createEvent.paste(target, {
    clipboardData: { getData: () => text },
  });
  fireEvent(target, event);
  return event.defaultPrevented;
}

describe("CoordinateInputs", () => {
  it("fills both halves from a pair pasted into either field", () => {
    const setLat = vi.fn();
    const setLng = vi.fn();
    render(<CoordinateInputs {...baseProps} setLat={setLat} setLng={setLng} />);

    expect(paste(screen.getByLabelText("Latitude"), "48.015883, 37.802411")).toBe(
      true
    );
    expect(setLat).toHaveBeenCalledWith("48.015883");
    expect(setLng).toHaveBeenCalledWith("37.802411");

    setLat.mockClear();
    setLng.mockClear();
    paste(
      screen.getByLabelText("Longitude"),
      "https://www.google.com/maps/@48.015883,37.802411,17z"
    );
    expect(setLat).toHaveBeenCalledWith("48.015883");
    expect(setLng).toHaveBeenCalledWith("37.802411");
  });

  it("lets a paste that isn't a pair land as ordinary text", () => {
    const setLat = vi.fn();
    const setLng = vi.fn();
    render(<CoordinateInputs {...baseProps} setLat={setLat} setLng={setLng} />);
    expect(paste(screen.getByLabelText("Latitude"), "48.015883")).toBe(false);
    expect(setLat).not.toHaveBeenCalled();
    expect(setLng).not.toHaveBeenCalled();
  });

  it("offers the map link and the copy button once the pair is in bounds", () => {
    render(<CoordinateInputs {...baseProps} lat="48.015883" lng="37.802411" />);
    expect(screen.getByRole("link", { name: /View on Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps?q=48.015883,37.802411"
    );
    expect(screen.getByRole("link", { name: /View on Maps/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeInTheDocument();
  });

  // Both controls are icon-only, named from the label, so they take no width from
  // the field.
  it("names the map link on the control itself, beside the fields", () => {
    render(<CoordinateInputs {...baseProps} lat="48.015883" lng="37.802411" />);
    const link = screen.getByRole("link", { name: "View on Maps" });
    expect(link).toHaveTextContent("");
    expect(link).toHaveAttribute("title", "View on Maps");
  });

  // Greyed, not gone: the cell keeps one width.
  it.each([
    ["half-typed", "48.01", ""],
    ["out of bounds", "91", "37.8"],
  ])("greys both while the pair is %s", (_case, lat, lng) => {
    render(<CoordinateInputs {...baseProps} lat={lat} lng={lng} />);
    // Not a link: without a point the map control is a disabled button.
    expect(screen.queryByRole("link", { name: "View on Maps" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "No map link until the coordinate pair is complete",
      })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeDisabled();
  });

  it("enables both once the pair parses", () => {
    render(<CoordinateInputs {...baseProps} lat="48.015883" lng="37.802411" />);
    expect(screen.queryByRole("button", { name: /No map link/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeEnabled();
  });

  it("keeps the camera pair's field ids distinct from the subject's", () => {
    render(<CoordinateInputs {...baseProps} idPrefix="capture_" required={false} />);
    expect(document.getElementById("capture_lat")).toBeInTheDocument();
    expect(document.getElementById("capture_lng")).toBeInTheDocument();
  });
});
