import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoordinateInputs } from "./CoordinateInputs";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
};

/** Fire a paste carrying `text` and report whether the component took it over
 *  (a recognised pair) or let it land as ordinary text. */
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
    // The longitude field is just as likely to receive the whole pair.
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

  it("hides both while the pair is half-typed or out of bounds", () => {
    const { rerender } = render(<CoordinateInputs {...baseProps} lat="48.01" />);
    expect(screen.queryByRole("link", { name: /View on Maps/ })).toBeNull();
    rerender(<CoordinateInputs {...baseProps} lat="91" lng="37.8" />);
    expect(screen.queryByRole("link", { name: /View on Maps/ })).toBeNull();
  });

  it("keeps the camera pair's field ids distinct from the subject's", () => {
    render(<CoordinateInputs {...baseProps} idPrefix="capture_" required={false} />);
    expect(document.getElementById("capture_lat")).toBeInTheDocument();
    expect(document.getElementById("capture_lng")).toBeInTheDocument();
  });
});
