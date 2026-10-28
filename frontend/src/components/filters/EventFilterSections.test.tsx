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

const DATE_SECTIONS = (eventActive: boolean) => [
  {
    title: "Event date",
    summary: eventActive ? "2024" : "Any",
    active: eventActive,
    children: <p>event scrubber</p>,
  },
  { title: "Added", summary: "Any", active: false, children: <p>added scrubber</p> },
];

describe("<EventFilterSections>", () => {
  it("stacks its rows under no group heading and merges the sections that belong together", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        lead={[{ title: "Kind", summary: "Any", active: false, children: <p>kind</p> }]}
        dateSections={DATE_SECTIONS(false)}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent)).toEqual([
      "Kind",
      "Status, conflict, tags",
      "Dates",
      "Source",
      "People",
    ]);
    expect(screen.queryByRole("button", { name: "Drone" })).not.toBeInTheDocument();
  });

  it("offers a layer as one more chip after the status chips, under a Show label", () => {
    const onPatch = vi.fn();
    const onToggle = vi.fn();
    const panel = (on: boolean) => (
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={{ ...EMPTY_EVENT_FILTERS, statuses: on ? ["detected"] : [] }}
        onPatch={onPatch}
        layer={{ label: "Sites", on, onToggle, note: <p>zones note</p> }}
      />
    );
    const { rerender } = render(panel(false));

    expect(header("Show, conflict, tags")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header("Show, conflict, tags"));
    const chips = ["Requested", "Detected", "Geolocated", "Sites"];
    const row = screen.getByRole("button", { name: "Requested" }).parentElement!;
    expect([...row.children].map((c) => c.textContent)).toEqual(chips);
    expect(screen.getByText("Show")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("zones note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sites" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPatch).not.toHaveBeenCalled();

    rerender(panel(true));
    expect(screen.getByText("zones note")).toBeInTheDocument();
    fireEvent.click(header("Show, conflict, tags"));
    expect(screen.getByRole("button", { name: "Toggle Show, conflict, tags" })).toHaveTextContent(
      "Detected +1",
    );
  });

  it("names a merged row after the sections the surface offers, and keeps a lone one as its own row", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        sections={["conflict", "tags", "location_guess", "author"]}
      />,
    );

    expect(header("Conflict, tags")).toBeInTheDocument();
    expect(header("Location guess")).toBeInTheDocument();
    expect(header("Author")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "People" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source" })).not.toBeInTheDocument();
  });

  it("starts a row expanded when one of its sections holds an active value", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"] });

    expect(header("Source")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Drone" })).toBeInTheDocument();
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(header("Status, conflict, tags")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the Dates row on an active window and shows both windows", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        dateSections={DATE_SECTIONS(true)}
      />,
    );

    expect(header("Dates")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("event scrubber")).toBeInTheDocument();
    expect(screen.getByText("added scrubber")).toBeInTheDocument();
  });

  it("sums up a collapsed merged row with its active values", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, statuses: ["geolocated"], tags: ["Drone"] });

    fireEvent.click(header("Status, conflict, tags"));
    expect(screen.getByRole("button", { name: "Toggle Status, conflict, tags" })).toHaveTextContent(
      "Geolocated, Drone",
    );
    expect(screen.getByRole("button", { name: "Toggle People" })).toHaveTextContent("Any");
  });

  it("toggles an active row closed and a collapsed one open", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"] });

    fireEvent.click(header("Source"));
    expect(header("Source")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header("Status, conflict, tags"));
    expect(header("Status, conflict, tags")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the Approvals section", () => {
  const approvedByOrg: EventFilterValues = {
    ...EMPTY_EVENT_FILTERS,
    approved: true,
    approvedBy: { kind: "organization", slug: "osw", name: "Open Source Watch" },
  };

  it("opens its row on an active value and toggles Approved only", () => {
    const onPatch = vi.fn();
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={{ ...EMPTY_EVENT_FILTERS, approved: true }}
        onPatch={onPatch}
      />,
    );

    expect(header("People")).toHaveAttribute("aria-expanded", "true");
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

    fireEvent.click(header("People"));
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

describe("the author filter", () => {
  it("has a removable pill like every other value and counts once", () => {
    const onPatch = vi.fn();
    const values = { ...EMPTY_EVENT_FILTERS, tags: ["drone"], author: "ana" };
    expect(countActiveFilters(values, EMPTY_DATE_WINDOWS)).toBe(2);
    const pills = buildActiveFilterPills(values, onPatch);
    expect(pills.map((p) => p.label)).toEqual(["drone", "By ana"]);
    pills[1].onRemove();
    expect(onPatch).toHaveBeenCalledWith({ author: "" });
  });

  it("has no pill while the field is blank", () => {
    const pills = buildActiveFilterPills({ ...EMPTY_EVENT_FILTERS, author: "  " }, vi.fn());
    expect(pills).toEqual([]);
  });
});

describe("the Conflict and Tags search fields", () => {
  const ENDED: Conflict = {
    id: "c2",
    name: "Gulf War",
    wikidata_id: null,
    start_year: 1990,
    end_year: 1991,
    is_ongoing: false,
    tier: null,
  };
  const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

  it("offers every conflict in use, ended ones included, and patches the picked name", () => {
    const onPatch = vi.fn();
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={[...CONFLICTS, ENDED]}
        values={{ ...EMPTY_EVENT_FILTERS, conflicts: ["Russian invasion of Ukraine"] }}
        onPatch={onPatch}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Russian invasion of Ukraine (2022-present)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox", { name: "Conflict" }));
    expect(options()).toEqual(["Gulf War (1990-1991)"]);
    fireEvent.click(screen.getByRole("option", { name: "Gulf War (1990-1991)" }));
    expect(onPatch).toHaveBeenCalledWith({
      conflicts: ["Russian invasion of Ukraine", "Gulf War"],
    });
  });

  it("searches the tags in use by name, with no Create row", () => {
    const onPatch = vi.fn();
    render(
      <EventFilterSections
        tags={[...TAGS, { id: "t2", name: "Artillery" }]}
        conflicts={CONFLICTS}
        values={{ ...EMPTY_EVENT_FILTERS, tags: ["Drone"] }}
        onPatch={onPatch}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Tags" });
    fireEvent.change(field, { target: { value: "zz" } });
    expect(options()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No tags match.");
    fireEvent.change(field, { target: { value: "art" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPatch).toHaveBeenCalledWith({ tags: ["Drone", "Artillery"] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Drone" }));
    expect(onPatch).toHaveBeenCalledWith({ tags: [] });
  });

  it("keeps a picked name its catalogue lacks on show", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, tags: ["Retired tag"] });
    expect(screen.getByRole("button", { name: "Remove Retired tag" })).toBeInTheDocument();
  });
});
