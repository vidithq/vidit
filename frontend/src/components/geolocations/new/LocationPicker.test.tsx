import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";

import { LocationPicker } from "./LocationPicker";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
};

describe("LocationPicker", () => {
  it("renders the Location heading, the subject pair, and the ? help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Latitude")).toHaveLength(1);
    expect(screen.getAllByLabelText("Longitude")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "What goes in Location?" })
    ).toBeInTheDocument();
  });

  it("labels the subject and leaves the sensor position to the sources", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Subject")).toBeInTheDocument();
    expect(screen.queryByText("Sensor position")).toBeNull();
  });

  it("flags the Subject label red when the coordinates are missing", () => {
    render(<LocationPicker {...baseProps} invalid />);
    expect(screen.getByText("Subject").closest("span")).toHaveClass(
      FORM_INVALID_LABEL
    );
  });
});
