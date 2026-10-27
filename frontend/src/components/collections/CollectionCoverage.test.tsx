import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventListItem, MapPoint } from "@/types";

// MapLibre needs WebGL, so the map is stubbed: it reports what the section
// handed it and offers one pin to click.
vi.mock("@/components/map/Map", () => ({
  default: function MapStub({
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

import { CollectionCoverage, HeldCoverage } from "./CollectionCoverage";

const OWNER = { id: "u1", username: "ana", avatar_url: null };

const item = (id: string, lat: number | null): EventListItem => ({
  id,
  title: `Strike ${id}`,
  status: "geolocated",
  occurred_date: "2026-03-14",
  coords: lat === null ? null : { lat, lng: 37.6 },
  before_closed_status: null,
  requested_at: null,
  geolocators: [],
  conflicts: [],
  is_graphic: false,
  media: null,
  owner: OWNER,
  tags: [],
});

// Four items; the third has no coordinates: the map skips it, the step count
// does not.
const ITEMS = [item("e1", 49.1), item("e2", 49.2), item("e3", null), item("e4", 49.4)];

async function renderCoverage(step = 2) {
  const onStep = vi.fn();
  render(<CollectionCoverage items={ITEMS} step={step} onStep={onStep} />);
  await screen.findByTestId("map");
  return { onStep };
}

describe("CollectionCoverage", () => {
  it("says where the reader stands and links the current event", async () => {
    await renderCoverage(2);

    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Strike e2" })).toHaveAttribute(
      "href",
      "/events/e2",
    );
    expect(screen.getByText("49.200000, 37.600000")).toBeInTheDocument();
  });

  it("hands the map the whole set and the steps behind it", async () => {
    await renderCoverage(2);
    const map = screen.getByTestId("map");

    // Three pins; the current one is selected and the one behind it dimmed. No line
    // joins them.
    expect(map).toHaveAttribute("data-points", "3");
    expect(map).toHaveAttribute("data-selected", "e2");
    expect(map).toHaveAttribute("data-dimmed", "e1");
    expect(map).toHaveAttribute("data-fly", "49.2,37.6");
  });

  it("leaves the camera alone on a step that carries no coordinates", async () => {
    await renderCoverage(3);

    expect(screen.getByTestId("map")).toHaveAttribute("data-fly", "");
    expect(screen.queryByText("Coordinates")).not.toBeInTheDocument();
  });

  it("steps with Previous and Next, disabled at either end", async () => {
    const { onStep } = await renderCoverage(1);

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onStep).toHaveBeenCalledWith(2);
  });

  it("jumps to the step a pin belongs to", async () => {
    const { onStep } = await renderCoverage(1);

    fireEvent.click(screen.getByRole("button", { name: "pin e3" }));

    expect(onStep).toHaveBeenCalledWith(3);
  });

  it("steps on the arrow keys", async () => {
    const { onStep } = await renderCoverage(2);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onStep).toHaveBeenLastCalledWith(3);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith(2);
  });

  it("walks a held key instead of re-reading the step it left", async () => {
    // The prop is still 1 when the second press arrives: counting off it would
    // ask for step 2 twice.
    const { onStep } = await renderCoverage(1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(onStep.mock.calls).toEqual([[2], [3]]);
  });

  it("stops the held key at the last item", async () => {
    const { onStep } = await renderCoverage(3);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(onStep.mock.calls).toEqual([[4]]);
  });

  it("holds at either end of the sequence", async () => {
    const { onStep } = await renderCoverage(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("leaves the arrows to a field being typed into", async () => {
    const onStep = vi.fn();
    render(
      <>
        <input aria-label="somewhere to type" />
        <CollectionCoverage items={ITEMS} step={2} onStep={onStep} />
      </>,
    );
    await screen.findByTestId("map");

    const field = screen.getByLabelText("somewhere to type");
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowRight" });

    expect(onStep).not.toHaveBeenCalled();
  });

  it("leaves a modified arrow to the browser", async () => {
    const { onStep } = await renderCoverage(2);

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    expect(onStep).not.toHaveBeenCalled();
  });

  it("renders nothing for a set with no mappable point", () => {
    const { container } = render(
      <CollectionCoverage items={[item("e3", null)]} step={1} onStep={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("HeldCoverage", () => {
  it("maps the held events, and says what it will show while none has coordinates", async () => {
    const { rerender } = render(<HeldCoverage events={[item("e3", null)]} />);
    expect(screen.getByText("The map shows the events you add.")).toBeInTheDocument();

    rerender(<HeldCoverage events={ITEMS} />);
    expect(await screen.findByTestId("map")).toHaveAttribute("data-points", "3");
  });
});
