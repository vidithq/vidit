"use client";

import { useState } from "react";

import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { PropertyRow } from "@/components/ui/PropertyRow";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { type PaletteCategory } from "./shared";

const ACTIVE_FILTERS: ReadonlyArray<[string, string]> = [
  ["Conflict", "Russo-Ukrainian War"],
  ["Tags", "dashcam"],
  ["Event date", "Until 1 Jan 2025"],
];

const LEVELS = [
  { value: "direct", label: "Direct" },
  { value: "indirect", label: "Indirect" },
  { value: "context", label: "Context" },
];

const PANEL = "rounded-lg border border-neutral-700 bg-neutral-900";

function PaletteActiveFilterPills() {
  const [active, setActive] = useState(ACTIVE_FILTERS);
  if (active.length === 0)
    return (
      <button className="text-[11px] text-neutral-500" onClick={() => setActive(ACTIVE_FILTERS)}>
        All removed. Reset the demo
      </button>
    );
  return (
    <ActiveFilterPills
      filters={active.map(([filter, label]) => ({
        key: filter + label,
        filter,
        label,
        onRemove: () => setActive((prev) => prev.filter(([, l]) => l !== label)),
      }))}
      onClearAll={() => setActive([])}
    />
  );
}

function PalettePropertyRow() {
  const [levels, setLevels] = useState<string[]>(["direct"]);
  return (
    <div className={`w-72 px-3 ${PANEL}`}>
      <PropertyRow
        name="Level"
        concept="source_level"
        values={levels.map((value) => ({
          key: value,
          label: LEVELS.find((o) => o.value === value)?.label ?? value,
          onRemove: () => setLevels((prev) => prev.filter((v) => v !== value)),
        }))}
        field={
          <OptionSearch
            aria-label="Level"
            placeholder="Search levels"
            options={LEVELS}
            selected={levels}
            onChange={setLevels}
            picks={false}
          />
        }
      />
    </div>
  );
}

function PaletteToggleRow() {
  const [on, setOn] = useState(true);
  const [described, setDescribed] = useState(false);
  return (
    <>
      <div className={`w-72 px-3 ${PANEL}`}>
        <ToggleRow label="Hide closed rows" on={on} onToggle={() => setOn((v) => !v)} />
      </div>
      <div className={`w-72 p-3 ${PANEL}`}>
        <ToggleRow
          label="Show help tooltips"
          description="The small ? icons that explain each field and section."
          on={described}
          onToggle={() => setDescribed((v) => !v)}
        />
      </div>
      <div className={`w-72 p-3 ${PANEL}`}>
        <ToggleRow
          label="Also file source 1 on the site"
          description="Satellite source: a site source needs a file and a capture time, and this source lacks one."
          on={false}
          disabled
          onToggle={() => {}}
        />
      </div>
      <div className={`w-72 p-3 ${PANEL}`}>
        <ToggleRow
          label="Relief"
          concept="map_relief"
          variant="setting"
          on={on}
          onToggle={() => setOn((v) => !v)}
        />
      </div>
    </>
  );
}

export const FILTERS: PaletteCategory = {
  id: "filters",
  title: "Filters",
  entries: [
    { name: "ActiveFilterPills", demo: <PaletteActiveFilterPills /> },
    { name: "PropertyRow", demo: <PalettePropertyRow /> },
    { name: "ToggleRow", demo: <PaletteToggleRow /> },
  ],
};
