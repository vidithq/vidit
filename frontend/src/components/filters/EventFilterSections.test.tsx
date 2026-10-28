import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Conflict, Tag } from "@/types";

import {
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  buildActiveFilterPills,
  buildDateWindowPills,
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
  it("opens on the lead fields, Show, Conflict and Tags in view under no group heading", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        lead={[{ title: "Activity", children: <p>scope</p> }]}
        dateSections={DATE_SECTIONS(false)}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("scope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Geolocated" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Conflict" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeInTheDocument();
    expect(["Activity", "Show", "Conflict", "Tags"].map((t) => screen.getAllByText(t).length)).toEqual([
      1, 1, 1, 1,
    ]);
    const rows = screen.getAllByRole("button", { expanded: false }).filter((b) => b.textContent);
    expect(rows.map((b) => b.textContent)).toEqual([
      "Dates",
      "Source",
      "People",
    ]);
  });

  it("names the status filter Show and ends it with a layer chip", () => {
    const onPatch = vi.fn();
    const onToggle = vi.fn();
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={onPatch}
        layer={{ label: "Sites", selected: false, onToggle }}
      />,
    );

    const chips = ["Requested", "Detected", "Geolocated", "Sites"];
    const row = screen.getByRole("button", { name: "Requested" }).parentElement!;
    expect([...row.children].map((c) => c.textContent)).toEqual(chips);
    expect(screen.getByText("Show")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sites" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Geolocated" }));
    expect(onPatch).toHaveBeenCalledWith({ show: ["geolocated"] });
  });

  it("names the Show field the same without a layer", () => {
    renderPanel();
    expect(screen.getByText("Show")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sites" })).not.toBeInTheDocument();
  });

  it("keeps a lone section of a row as its own row", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
        sections={["conflict", "tags", "location_guess", "author"]}
      />,
    );

    expect(screen.queryByText("Show")).not.toBeInTheDocument();
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
    expect(header("People")).toHaveAttribute("aria-expanded", "false");
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
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"], levels: ["direct"] });

    fireEvent.click(header("Source"));
    expect(screen.getByRole("button", { name: "Toggle Source" })).toHaveTextContent("Drone, Direct");
    expect(screen.getByRole("button", { name: "Toggle People" })).toHaveTextContent("Any");
  });

  it("toggles an active row closed and a collapsed one open", () => {
    renderPanel({ ...EMPTY_EVENT_FILTERS, sourceKinds: ["drone"] });

    fireEvent.click(header("Source"));
    expect(header("Source")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header("People"));
    expect(header("People")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("buildActiveFilterPills", () => {
  it("names each pill after its filter and reads each value as its chip does", () => {
    const values: EventFilterValues = {
      ...EMPTY_EVENT_FILTERS,
      show: ["geolocated"],
      conflicts: ["Russian invasion of Ukraine"],
      tags: ["Drone"],
      mediaTypes: ["video"],
      author: "ana",
      approved: true,
    };
    expect(buildActiveFilterPills(values, vi.fn()).map((p) => [p.filter, p.label])).toEqual([
      ["Show", "Geolocated"],
      ["Conflict", "Russian invasion of Ukraine"],
      ["Tags", "Drone"],
      ["Media", "Video"],
      ["Author", "ana"],
      ["Approvals", "Approved only"],
    ]);
  });

  it("names a date window after its filter, with a readable range", () => {
    const pills = buildDateWindowPills(
      { ...EMPTY_DATE_WINDOWS, eventTo: "2025-01-01", addedFrom: "2024-03-05" },
      vi.fn(),
      vi.fn(),
    );
    expect(pills.map((p) => [p.filter, p.label])).toEqual([
      ["Event date", "Until 1 Jan 2025"],
      ["Added", "From 5 Mar 2024"],
    ]);
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
    expect(pills.map((p) => [p.filter, p.label])).toEqual([
      ["Approvals", "Approved only"],
      ["Approved by", "Open Source Watch"],
    ]);
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
    expect(pills.map((p) => [p.filter, p.label])).toEqual([
      ["Tags", "drone"],
      ["Author", "ana"],
    ]);
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

  it("closes the conflict list on a pick, so it leaves the Tags field in view, and reopens on a click", () => {
    render(
      <EventFilterSections
        tags={TAGS}
        conflicts={CONFLICTS}
        values={EMPTY_EVENT_FILTERS}
        onPatch={vi.fn()}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Conflict" });
    fireEvent.focus(field);
    fireEvent.click(screen.getByRole("option", { name: /^Russian invasion of Ukraine/ }));
    expect(screen.queryByRole("listbox", { name: "Conflict" })).not.toBeInTheDocument();
    expect(field).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(field);
    expect(screen.getByRole("listbox", { name: "Conflict" })).toBeInTheDocument();
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
