import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";

import { LocationPicker } from "./LocationPicker";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
};

describe("LocationPicker", () => {
  it("renders the subject pair under Coordinates, with its ? help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Coordinates")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Latitude")).toHaveLength(1);
    expect(screen.getAllByLabelText("Longitude")).toHaveLength(1);
  });

  it("leaves the capture position to the sources", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.queryByText("Subject")).toBeNull();
    expect(screen.queryByText("Capture position")).toBeNull();
  });

  it("flags the Latitude and Longitude fields red when the coordinates are missing", () => {
    render(<LocationPicker {...baseProps} invalid />);
    expect(screen.getByLabelText("Latitude").className).toContain(FORM_INVALID_FIELD);
    expect(screen.getByLabelText("Longitude").className).toContain(FORM_INVALID_FIELD);
  });
});
