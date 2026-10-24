import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Conflict, Tag } from "@/types";

import {
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  buildActiveFilterPills,
  countActiveFilters,
  type EventFilterValues,
} from "./EventFilterSections";

const TAGS: Tag[] = [{ id: "t1", name: "Drone" }];
const CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: null,
    start_year: 2022,
    end_year: null,
    is_ongoing: true,
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

    for (const name of [
      "Status",
      "Conflict",
      "Source kind",
      "Level",
      "Media",
      "Author",
      "Approvals",
    ]) {
      expect(header(name)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("button", { name: "Drone" })).not.toBeInTheDocument();
  });

  it("starts a section expanded when it holds an active value", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"] });

    expect(header("Source kind")).toHaveAttribute("aria-expanded", "true");
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
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"] });

    fireEvent.click(header("Source kind"));
    expect(header("Source kind")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header("Conflict"));
    expect(header("Conflict")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the Approvals section", () => {
  const approvedByOrg: EventFilterValues = {
    ...EMPTY_EVENT_FILTERS,
    approved: true,
    approvedBy: { kind: "organization", slug: "osw", name: "Open Source Watch" },
  };

  it("opens on an active value and toggles Approved only", () => {
    const onPatch = vi.fn();
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={{ ...EMPTY_EVENT_FILTERS, approved: true }}
        onPatch={onPatch}
      />,
    );

    expect(header("Approvals")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Approved only" }));
    expect(onPatch).toHaveBeenCalledWith({ approved: false });
  });

  it("commits a typed username as an analyst approver", () => {
    const onPatch = vi.fn();
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(header("Approvals"));
    const field = screen.getByLabelText("Approved by");
    fireEvent.change(field, { target: { value: "ana" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPatch).toHaveBeenCalledWith({
      approvedBy: { kind: "analyst", username: "ana", avatar_url: undefined },
    });
  });

  it("counts both values and gives each a removable pill", () => {
    const onPatch = vi.fn();
    expect(countActiveFilters(approvedByOrg, EMPTY_DATE_WINDOWS)).toBe(2);
    const pills = buildActiveFilterPills(approvedByOrg, onPatch);
    expect(pills.map((p) => p.label)).toEqual(["Approved", "Approved by Open Source Watch"]);
    pills[1].onRemove();
    expect(onPatch).toHaveBeenCalledWith({ approvedBy: null });
  });

  it("is left out where the surface does not offer it", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        sections={["author"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approvals" })).not.toBeInTheDocument();
  });
});
