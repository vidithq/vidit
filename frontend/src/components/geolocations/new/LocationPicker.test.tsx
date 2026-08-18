import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { LocationPicker } from "./LocationPicker";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
  captureLat: "",
  setCaptureLat: () => {},
  captureLng: "",
  setCaptureLng: () => {},
};

describe("LocationPicker", () => {
  it("renders the Location heading, both coordinate pairs, and the ? help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Location")).toBeInTheDocument();
    // Subject pair + the optional camera pair each carry a Latitude / Longitude
    // input, so there are two of each.
    expect(screen.getAllByLabelText("Latitude")).toHaveLength(2);
    expect(screen.getAllByLabelText("Longitude")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "What goes in Location?" })
    ).toBeInTheDocument();
  });

  it("labels the subject and the camera position, and the camera help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Subject")).toBeInTheDocument();
    expect(screen.getByText("Camera position")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the camera position?" })
    ).toBeInTheDocument();
  });

  it("reports the camera-position inputs distinctly from the subject", () => {
    const setCaptureLat = vi.fn();
    render(<LocationPicker {...baseProps} setCaptureLat={setCaptureLat} />);
    // The camera latitude has its own id so it doesn't collide with the subject.
    fireEvent.change(document.getElementById("capture_lat")!, {
      target: { value: "50.1" },
    });
    expect(setCaptureLat).toHaveBeenCalledWith("50.1");
  });

  it("flags the Subject label red when the coordinates are missing", () => {
    render(<LocationPicker {...baseProps} invalid />);
    // Same treatment as the field-block outline already on the lat/lng
    // inputs (via CoordinateInputs' `invalid` prop): the section's own label
    // turns red too, not just the inputs.
    expect(screen.getByText("Subject").closest("span")).toHaveClass(
      FORM_INVALID_LABEL
    );
    // The optional camera position never gets flagged.
    expect(screen.getByText("Camera position").closest("span")).not.toHaveClass(
      FORM_INVALID_LABEL
    );
  });
});
