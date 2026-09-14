import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventListItem, MapPoint } from "@/types";

// MapLibre touches `window` at module scope, so the reader's map never loads
// its real canvas under jsdom. The stub reports what the reader handed it and
// offers one pin to click, which is how a click on the sequence is measured.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      points,
      selectedId,
      dimmedIds,
      flyTo,
      onPointClick,
    }: {
      points: MapPoint[];
      selectedId?: string | null;
      dimmedIds?: ReadonlySet<string>;
      flyTo?: { lat: number; lng: number } | null;
      onPointClick?: (id: string) => void;
    }) {
      return (
        <div
          data-testid="map"
          data-points={points.length}
          data-selected={selectedId ?? ""}
          data-dimmed={[...(dimmedIds ?? [])].join(",")}
          data-fly={flyTo ? `${flyTo.lat},${flyTo.lng}` : ""}
        >
          <button type="button" onClick={() => onPointClick?.("e3")}>
            pin e3
          </button>
        </div>
      );
    },
}));

// The panel is the map page's own, already covered there: the reader is
// measured on what it hands the panel, not on how the panel renders an event.
vi.mock("@/components/map/DetailSidePanel", () => ({
  DetailSidePanel: ({
    detail,
    header,
    footer,
  }: {
    detail: { title: string } | null;
    header?: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="panel">
      {header}
      <h2>{detail?.title ?? "Loading..."}</h2>
      {footer}
    </div>
  ),
}));

const useApiResource = vi.fn();
vi.mock("@/hooks/useApiResource", () => ({
  useApiResource: (path: string | null) => useApiResource(path),
}));

import { CollectionReader } from "./CollectionReader";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const item = (id: string, lat: number | null): EventListItem => ({
  id,
  title: `Strike ${id}`,
  status: "geolocated",
  event_date: "2026-03-14",
  event_coords: lat === null ? null : { lat, lng: 37.6 },
  before_closed_status: null,
  conflicts: [],
  is_graphic: false,
  media: null,
  owner: OWNER,
  tags: [],
});

// Four items, the third of which carries no coordinates: the map has to skip
// it and the count of steps must not.
const ITEMS = [item("e1", 49.1), item("e2", 49.2), item("e3", null), item("e4", 49.4)];

function renderReader(step = 2) {
  const onStep = vi.fn();
  render(<CollectionReader items={ITEMS} step={step} onStep={onStep} />);
  return { onStep };
}

beforeEach(() => {
  useApiResource.mockReset();
  useApiResource.mockReturnValue({
    data: { id: "e2", title: "Strike e2" },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe("CollectionReader", () => {
  it("reads the event of the current step and says where that is", () => {
    renderReader(2);

    expect(useApiResource).toHaveBeenCalledWith("/events/e2");
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Strike e2" })).toBeInTheDocument();
  });

  it("hands the map the whole set and the steps behind it", () => {
    renderReader(2);
    const map = screen.getByTestId("map");

    // Three of the four items carry a pin; the current one is selected and the
    // one step behind it is dimmed. Nothing joins them: the sequence is said
    // by the pins and the counter, not by a line across the map.
    expect(map).toHaveAttribute("data-points", "3");
    expect(map).toHaveAttribute("data-selected", "e2");
    expect(map).toHaveAttribute("data-dimmed", "e1");
    expect(map).toHaveAttribute("data-fly", "49.2,37.6");
  });

  it("leaves the camera alone on a step that carries no coordinates", () => {
    renderReader(3);

    expect(screen.getByTestId("map")).toHaveAttribute("data-fly", "");
  });

  it("jumps to the step a pin belongs to", () => {
    const { onStep } = renderReader(1);

    fireEvent.click(screen.getByRole("button", { name: "pin e3" }));

    expect(onStep).toHaveBeenCalledWith(3);
  });

  it("steps on the arrow keys", () => {
    const { onStep } = renderReader(2);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onStep).toHaveBeenLastCalledWith(3);

    // Back from where the last press left the reader, not from the step the
    // URL still holds while the caller lands the first one.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith(2);
  });

  it("walks a held key instead of re-reading the step it left", () => {
    // The caller lands the step in the URL, so the prop is still 1 when the
    // second press arrives: a handler counting off the prop would ask for
    // step 2 twice and the collection would stand still under a held key.
    const { onStep } = renderReader(1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(onStep.mock.calls).toEqual([[2], [3]]);
  });

  it("stops the held key at the last item", () => {
    const { onStep } = renderReader(3);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    // Four items: the walk reaches the end and the next press is the
    // browser's again.
    expect(onStep.mock.calls).toEqual([[4]]);
  });

  it("holds at either end of the sequence", () => {
    const first = renderReader(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(first.onStep).not.toHaveBeenCalled();
  });

  it("leaves the arrows to a field being typed into", () => {
    const onStep = vi.fn();
    render(
      <>
        <input aria-label="somewhere to type" />
        <CollectionReader items={ITEMS} step={2} onStep={onStep} />
      </>,
    );

    const field = screen.getByLabelText("somewhere to type");
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowRight" });

    expect(onStep).not.toHaveBeenCalled();
  });

  it("leaves a modified arrow to the browser", () => {
    const { onStep } = renderReader(2);

    // Command or Alt plus an arrow is history navigation or a word jump.
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    expect(onStep).not.toHaveBeenCalled();
  });
});
