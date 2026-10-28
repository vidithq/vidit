import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

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

  it("names the map link on the control itself, beside the fields", () => {
    render(<CoordinateInputs {...baseProps} lat="48.015883" lng="37.802411" />);
    const link = screen.getByRole("link", { name: "View on Maps" });
    expect(link).toHaveTextContent("");
    // The shared tooltip carries the name, so no native title shows a second one.
    expect(link).not.toHaveAttribute("title");
    // Its own item on the fields' line, not an adornment inside the longitude field.
    expect(screen.getByLabelText("Longitude").parentElement).not.toContainElement(link);
  });

  // Greyed, not gone: the line keeps one width. The map control names the true reason.
  it.each([
    ["empty", "", "", "No map link. Type a latitude and a longitude."],
    ["half-typed", "48.01", "", "No map link. Type a longitude."],
    ["out of bounds", "91", "37.8", "No map link. Latitude must be between -90 and 90."],
    ["malformed", "48.01", "37,8", "No map link. Longitude must be a number in decimal degrees, like 37.802411."],
  ])("greys both while the pair is %s", (_case, lat, lng, reason) => {
    render(<CoordinateInputs {...baseProps} lat={lat} lng={lng} />);
    // Not a link: without a point the map control is a disabled button.
    expect(screen.queryByRole("link", { name: "View on Maps" })).toBeNull();
    // The icon button's name is also its tooltip.
    expect(screen.getByRole("button", { name: reason })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeDisabled();
  });

  it("says under the fields why a typed value is refused, and reddens that field only", () => {
    render(<CoordinateInputs {...baseProps} lat="91" lng="0" />);
    expect(screen.getByLabelText("Latitude")).toHaveAccessibleDescription(
      "Latitude must be between -90 and 90."
    );
    expect(screen.getByLabelText("Latitude").className).toContain(FORM_INVALID_FIELD);
    expect(screen.getByLabelText("Longitude").className).not.toContain(FORM_INVALID_FIELD);
  });

  it("waits for the write before flagging a blank half of a required pair", () => {
    render(<CoordinateInputs {...baseProps} lat="48.01" />);
    expect(screen.queryByText("Type a longitude.")).toBeNull();
    expect(screen.getByLabelText("Longitude")).not.toHaveAccessibleDescription();
  });

  it("says an optional pair holding one half is not saved", () => {
    render(<CoordinateInputs {...baseProps} lat="48.01" required={false} />);
    expect(screen.getByLabelText("Longitude")).toHaveAccessibleDescription(
      "Type a longitude. Until the pair is complete or both fields are empty, the position is not saved."
    );
  });

  it("enables both once the pair parses", () => {
    render(<CoordinateInputs {...baseProps} lat="48.015883" lng="37.802411" />);
    expect(screen.queryByRole("button", { name: /No map link/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy coordinates" })
    ).toBeEnabled();
  });

  it("keeps the capture pair's field ids distinct from the subject's", () => {
    render(<CoordinateInputs {...baseProps} idPrefix="capture_" required={false} />);
    expect(document.getElementById("capture_lat")).toBeInTheDocument();
    expect(document.getElementById("capture_lng")).toBeInTheDocument();
  });
});
