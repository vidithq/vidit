"use client";

import { useCallback, useState } from "react";

import type { DayCount } from "@/types";
import { AccountPicker, analystAccount } from "@/components/ui/AccountPicker";
import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { Button } from "@/components/ui/Button";
import { CARD_FRAME } from "@/components/ui/Card";
import { MediaOverlay } from "@/components/ui/MediaLightbox";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { PropertyName, PropertyRow } from "@/components/ui/PropertyRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { cn } from "@/lib/cn";
import { AUTHOR_FILTER_RE, suggestApprovers, suggestAuthors } from "@/lib/search";
import { TimelineScrubber } from "./TimelineScrubber";
import {
  DATES_HEADING,
  DATE_DIMENSIONS,
  DATE_KEYS,
  DIMENSIONS,
  FILTER_GROUPS,
  anyActive,
  datesOffered,
  offeredDimensions,
  type DateKey,
  type DimensionKey,
  type FilterPatch,
  type FilterState,
  type Surface,
} from "./model";
import { activePills, dimensionOptions, dimensionPills, type Vocabulary } from "./labels";

type SetPlaying = (v: boolean | ((prev: boolean) => boolean)) => void;

export interface FilterPanelProps {
  surface: Surface;
  state: FilterState;
  /** Stable across renders: playback re-subscribes its timer when the window setters change. */
  onPatch: FilterPatch;
  onClear: () => void;
  vocabulary: Vocabulary;
  /** Per date axis, the rows per day under every filter but that axis's own window. */
  timelines: Record<DateKey, ReadonlyArray<DayCount>>;
  /** The map's playback of each window. */
  playback?: Record<DateKey, { playing: boolean; setPlaying: SetPlaying }>;
}

function Timeline({
  dateKey,
  state,
  onPatch,
  days,
  playback,
}: {
  dateKey: DateKey;
  state: FilterState;
  onPatch: FilterPatch;
  days: ReadonlyArray<DayCount>;
  playback?: { playing: boolean; setPlaying: SetPlaying };
}) {
  const { name, concept, from, to } = DATE_DIMENSIONS[dateKey];
  const setStart = useCallback((v: string) => onPatch({ [from]: v }), [onPatch, from]);
  const setEnd = useCallback((v: string) => onPatch({ [to]: v }), [onPatch, to]);
  return (
    <div className="space-y-1.5 py-2">
      <PropertyName name={name} concept={concept} />
      <TimelineScrubber
        days={days}
        label={name}
        start={state[from]}
        setStart={setStart}
        end={state[to]}
        setEnd={setEnd}
        playing={playback?.playing}
        setPlaying={playback?.setPlaying}
      />
    </div>
  );
}

function DimensionLine({
  dimension,
  surface,
  state,
  onPatch,
  vocabulary,
}: {
  dimension: DimensionKey;
  surface: Surface;
  state: FilterState;
  onPatch: FilterPatch;
  vocabulary: Vocabulary;
}) {
  const { name, concept, control } = DIMENSIONS[dimension];
  if (control.kind === "switch") {
    return (
      <ToggleRow
        variant="setting"
        label={control.label}
        concept={concept}
        on={state[control.field]}
        onToggle={() => onPatch({ [control.field]: !state[control.field] })}
        className="py-2"
      />
    );
  }
  const values = dimensionPills(dimension, surface, state, vocabulary, onPatch);
  if (control.kind === "options") {
    const options = dimensionOptions(dimension, surface, vocabulary);
    const selected = state[control.field];
    if (options.length === 0 && selected.length === 0) return null;
    const toggle = (value: string) =>
      onPatch({
        [control.field]: selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value],
      });
    return (
      <PropertyRow
        name={name}
        concept={concept}
        values={values}
        editor={() => (
          <OptionPicker label={name} options={options} selected={selected} onToggle={toggle} />
        )}
      />
    );
  }
  const author = control.field === "author";
  // The server's author filters are exact, so a typed fragment becomes a name through the list;
  // a draft the gate refuses is not committed, instead of a 422.
  const commit = (typed: string) => {
    if (!AUTHOR_FILTER_RE.test(typed)) return;
    if (author) onPatch({ author: typed });
    else onPatch({ approvedBy: analystAccount({ username: typed }) });
  };
  return (
    <PropertyRow
      name={name}
      concept={concept}
      values={values}
      editor={(close) => (
        <AccountPicker
          search={author ? suggestAuthors : suggestApprovers}
          minQueryLength={2}
          selected={
            author
              ? state.author
                ? analystAccount({ username: state.author })
                : null
              : state.approvedBy
          }
          onSelect={(account) => {
            if (account.kind === "analyst" && author) onPatch({ author: account.username });
            else if (!author) onPatch({ approvedBy: account });
            close();
          }}
          onSubmitText={(typed) => {
            commit(typed);
            close();
          }}
          onClear={() => onPatch(author ? { author: "" } : { approvedBy: null })}
          placeholder={author ? "Search analysts" : "Search analysts and organizations"}
          aria-label={name}
          emptyText={author ? "No analyst matches" : "No analyst or organization matches"}
          autoFocus
        />
      )}
    />
  );
}

/**
 * The filter panel of every surface that lists events: the two date timelines, then one line per
 * dimension under its heading, then **Clear all** once a filter is on. The surface decides which
 * dimensions it offers (`offeredDimensions`); the order, the names and the controls are the
 * model's.
 */
export function FilterPanel({
  surface,
  state,
  onPatch,
  onClear,
  vocabulary,
  timelines,
  playback,
}: FilterPanelProps) {
  const offered = offeredDimensions(surface, state.show);
  const groups = FILTER_GROUPS.map((g) => ({
    title: g.title,
    dimensions: g.dimensions.filter((d) => offered.includes(d)),
  })).filter((g) => g.dimensions.length > 0);
  const active = anyActive(surface, state);
  return (
    <div className="space-y-4">
      {datesOffered(surface, state.show) && (
        <section>
          <SectionEyebrow as="h3" margin="none" title={DATES_HEADING} />
          <div className="divide-y divide-neutral-800">
            {DATE_KEYS.map((key) => (
              <Timeline
                key={key}
                dateKey={key}
                state={state}
                onPatch={onPatch}
                days={timelines[key]}
                playback={playback?.[key]}
              />
            ))}
          </div>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.title}>
          <SectionEyebrow as="h3" margin="none" title={group.title} />
          <div className="divide-y divide-neutral-800">
            {group.dimensions.map((d) => (
              <DimensionLine
                key={d}
                dimension={d}
                surface={surface}
                state={state}
                onPatch={onPatch}
                vocabulary={vocabulary}
              />
            ))}
          </div>
        </section>
      ))}
      {active && (
        <div className="flex justify-end">
          <Button action="clear" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/** The panel in a list page's right rail, from `lg` up. */
export function FilterRailPanel(props: FilterPanelProps) {
  return (
    <div className={cn(CARD_FRAME, "p-3")}>
      <FilterPanel {...props} />
    </div>
  );
}

/**
 * The phone's entry to the panel: a **Filters** button and every active filter as a removable
 * pill. The button opens the panel in a sheet from the bottom edge; each change applies at once,
 * and **Done**, Escape or the backdrop closes it.
 */
export function FilterSheetBar({ className, ...props }: FilterPanelProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const pills = activePills(props.surface, props.state, props.vocabulary, props.onPatch);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        action="filter"
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Filters
      </Button>
      <ActiveFilterPills filters={pills} onClearAll={props.onClear} />
      {open && (
        <MediaOverlay variant="sheet" label="Filters" onClose={() => setOpen(false)}>
          <div className="sticky -top-3 z-10 -mx-4 mb-1 flex justify-end bg-neutral-900 px-4 py-2">
            <Button
              action="accept"
              variant="primary"
              data-overlay-close=""
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
          <FilterPanel {...props} />
        </MediaOverlay>
      )}
    </div>
  );
}
