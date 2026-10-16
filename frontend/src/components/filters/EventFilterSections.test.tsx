import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Conflict, Tag } from "@/types";

import {
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  type EventFilterValues,
} from "./EventFilterSections";

const TAGS: Tag[] = [{ id: "t1", name: "Drone", category: "capture_source" }];
const CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: null,
    start_year: 2022,
    end_year: null,
    ongoing: true,
    tier: "major",
  },
];

const renderPanel = (values: EventFilterValues = EMPTY_EVENT_FILTERS) =>
  render(
    <EventFilterSections tags={TAGS} conflicts={CONFLICTS} values={values} onPatch={vi.fn()} />,
  );

const header = (name: string) => screen.getByRole("button", { name });

describe("<EventFilterSections>", () => {
  it("starts every section collapsed when no filter is set", () => {
    renderPanel();

    for (const name of ["Status", "Conflict", "Capture source", "Source media", "Author"]) {
      expect(header(name)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("button", { name: "Drone" })).not.toBeInTheDocument();
  });

  it("starts a section expanded when it holds an active value", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, captureSources: ["Drone"] });

    expect(header("Capture source")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Drone" })).toBeInTheDocument();
    expect(header("Conflict")).toHaveAttribute("aria-expanded", "false");
  });

  it("starts an injected date section expanded when its window is active", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        dateSections={[
          { title: "Event date", summary: "2024", active: true, children: <p>event scrubber</p> },
          { title: "Added date", summary: "Any", active: false, children: <p>added scrubber</p> },
        ]}
      />,
    );

    expect(screen.getByText("event scrubber")).toBeInTheDocument();
    expect(screen.queryByText("added scrubber")).not.toBeInTheDocument();
  });

  it("toggles an active section closed and a collapsed one open", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, captureSources: ["Drone"] });

    fireEvent.click(header("Capture source"));
    expect(header("Capture source")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header("Conflict"));
    expect(header("Conflict")).toHaveAttribute("aria-expanded", "true");
  });
});
