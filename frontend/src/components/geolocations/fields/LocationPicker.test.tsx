import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import type { CoordinatePair } from "@/lib/coordinates";

// MapLibre cannot load under jsdom: the stub records what the form hands its map.
interface MapStubProps {
  point: CoordinatePair | null;
  onPick?: (pair: CoordinatePair) => void;
  goTo?: CoordinatePair | null;
}
const mapProps = vi.fn<(props: MapStubProps) => void>();
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub(props: MapStubProps) {
      mapProps(props);
      return <div data-testid="map" />;
    },
}));

import { LocationPicker } from "./LocationPicker";

const baseProps = {
  lat: "",
  setLat: () => {},
  lng: "",
  setLng: () => {},
};

const lastMap = () => mapProps.mock.lastCall![0];

beforeEach(() => mapProps.mockClear());

describe("LocationPicker", () => {
  it("renders the subject pair under Coordinates, with its ? help", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.getByText("Coordinates")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Latitude")).toHaveLength(1);
    expect(screen.getAllByLabelText("Longitude")).toHaveLength(1);
  });

  it("leaves the capture position to the sources", () => {
    render(<LocationPicker {...baseProps} />);
    expect(screen.queryByText("Capture position")).toBeNull();
  });

  it("flags the Latitude and Longitude fields red when the coordinates are missing", () => {
    render(<LocationPicker {...baseProps} invalid />);
    expect(screen.getByLabelText("Latitude").className).toContain(FORM_INVALID_FIELD);
    expect(screen.getByLabelText("Longitude").className).toContain(FORM_INVALID_FIELD);
  });

  it("shows the map with no pin while the pair is empty or refused", () => {
    const { rerender } = render(<LocationPicker {...baseProps} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(lastMap().point).toBeNull();
    rerender(<LocationPicker {...baseProps} lat="91" lng="37.8" />);
    expect(lastMap().point).toBeNull();
  });

  it("writes the coordinates a click or a drag on the map picks, at 6 decimals", () => {
    const setLat = vi.fn();
    const setLng = vi.fn();
    render(<LocationPicker {...baseProps} setLat={setLat} setLng={setLng} />);
    act(() => lastMap().onPick!({ lat: 48.0125999871, lng: 37.80240001 }));
    expect(setLat).toHaveBeenLastCalledWith("48.012600");
    expect(setLng).toHaveBeenLastCalledWith("37.802400");
  });

  it("moves the pin and the camera to a typed pair, and only the pin to a picked one", () => {
    const { rerender } = render(<LocationPicker {...baseProps} lat="48.5" lng="37.8" />);
    // The pair the form opened with is the map's own frame.
    expect(lastMap()).toMatchObject({ point: { lat: 48.5, lng: 37.8 }, goTo: null });

    rerender(<LocationPicker {...baseProps} lat="48.6" lng="37.9" />);
    expect(lastMap()).toMatchObject({
      point: { lat: 48.6, lng: 37.9 },
      goTo: { lat: 48.6, lng: 37.9 },
    });

    act(() => lastMap().onPick!({ lat: 48.7, lng: 38 }));
    rerender(<LocationPicker {...baseProps} lat="48.700000" lng="38.000000" />);
    expect(lastMap()).toMatchObject({
      point: { lat: 48.7, lng: 38 },
      goTo: { lat: 48.6, lng: 37.9 },
    });
  });
});
