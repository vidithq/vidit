import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocationPicker } from "./LocationPicker";

const baseProps = {
  lockedMedia: null,
  files: [],
  setFiles: () => {},
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
  extraCoordCandidates: [],
  onSwapCandidate: () => {},
};

describe("LocationPicker", () => {
  it("renders the Location heading, the merged source media + coordinates, and the ? help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Location")).toBeInTheDocument();
    // Source media is merged into this Location block.
    expect(
      screen.getByRole("button", { name: "What is the source media?" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitude")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What goes in Location?" })
    ).toBeInTheDocument();
  });

  it("offers detected swap candidates and reports the pick", () => {
    const onSwap = vi.fn();
    render(
      <LocationPicker
        {...baseProps}
        extraCoordCandidates={[{ lat: 48.01, lng: 37.8 }]}
        onSwapCandidate={onSwap}
      />
    );
    const chip = screen.getByRole("button", { name: /48\.01000, 37\.80000/ });
    fireEvent.click(chip);
    expect(onSwap).toHaveBeenCalledWith({ lat: 48.01, lng: 37.8 });
  });

  it("drops the coordinates when showCoords is false (bounty), keeping source media", () => {
    render(<LocationPicker {...baseProps} showCoords={false} />);
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is the source media?" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
  });
});
