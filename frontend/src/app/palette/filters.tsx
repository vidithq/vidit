"use client";

import { useCallback, useState } from "react";

import { FilterCard } from "@/components/filters/FilterPanel";
import { EMPTY_FILTERS, type FilterState } from "@/components/filters/model";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { MOCK_CONFLICTS, type PaletteCategory } from "./shared";

const PANEL = "rounded-lg border border-neutral-700 bg-neutral-900";

const DAYS = ["2026-03-02", "2026-03-09", "2026-04-14", "2026-05-01", "2026-05-20", "2026-06-11"].map(
  (date, i) => ({ date, count: [3, 8, 2, 12, 5, 9][i] }),
);
const TIMELINES = { eventDate: DAYS, added: DAYS };
const VOCABULARY = {
  tags: ["drone", "armor", "artillery", "air defence"].map((name, i) => ({ id: `t${i}`, name })),
  conflicts: MOCK_CONFLICTS,
};
const STARTING: FilterState = { ...EMPTY_FILTERS, levels: ["direct"], tags: ["drone"] };

/** The whole panel under its header: the groups, a line per dimension with its search field,
 *  the value pills under a line, the switch lines, the timelines and the result count. */
function PaletteFilterCard() {
  const [state, setState] = useState<FilterState>(STARTING);
  const onPatch = useCallback((patch: Partial<FilterState>) => setState((s) => ({ ...s, ...patch })), []);
  return (
    <div className="w-80 max-w-full">
      <FilterCard
        surface="search"
        state={state}
        onPatch={onPatch}
        onClear={() => setState(EMPTY_FILTERS)}
        vocabulary={VOCABULARY}
        timelines={TIMELINES}
        count={284}
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
  tier: "high",
  entries: [
    { entry: "FilterCard / FilterPanel", demo: <PaletteFilterCard /> },
    { entry: "ToggleRow", demo: <PaletteToggleRow /> },
  ],
};
