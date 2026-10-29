"use client";

import { useCallback, useId, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";

import type { DayCount } from "@/types";
import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { Button } from "@/components/ui/Button";
import { CARD_FRAME } from "@/components/ui/Card";
import { Dot } from "@/components/ui/Dot";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { MediaOverlay } from "@/components/ui/MediaLightbox";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { PropertyName, PropertyRow } from "@/components/ui/PropertyRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { accountKey, analystAccount } from "@/lib/accounts";
import { cn } from "@/lib/cn";
import { accountItem } from "@/lib/items";
import { AUTHOR_FILTER_RE, suggestApprovers, suggestAuthors } from "@/lib/search";
import { TimelineScrubber } from "./TimelineScrubber";
import { useOpenGroups, usePanelOpen } from "@/hooks/useFilterPanelState";
import {
  DATE_DIMENSIONS,
  DATE_KEYS,
  DIMENSIONS,
  FILTER_GROUPS,
  anyActive,
  datesOffered,
  offeredDimensions,
  type DateKey,
  type DimensionKey,
  type FilterGroup,
  type FilterPatch,
  type FilterState,
  type Surface,
} from "./model";
import {
  activePills,
  dimensionOptions,
  dimensionPills,
  groupPills,
  type Vocabulary,
} from "./labels";

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
        label={name}
        concept={concept}
        on={state[control.field]}
        onToggle={() => onPatch({ [control.field]: !state[control.field] })}
      />
    );
  }
  const values = dimensionPills(dimension, surface, state, vocabulary, onPatch);
  if (control.kind === "options") {
    const options = dimensionOptions(dimension, surface, vocabulary);
    const selected = state[control.field];
    if (options.length === 0 && selected.length === 0) return null;
    return (
      <PropertyRow
        name={name}
        concept={concept}
        values={values}
        field={
          <OptionSearch
            aria-label={name}
            placeholder={control.placeholder}
            options={options}
            selected={selected}
            onChange={(next) => onPatch({ [control.field]: next })}
            picks={false}
          />
        }
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
      field={
        <ItemSearch
          search={author ? suggestAuthors : suggestApprovers}
          minChars={2}
          toItem={accountItem}
          rowKey={accountKey}
          onPick={(account) => {
            if (account.kind === "analyst" && author) onPatch({ author: account.username });
            else if (!author) onPatch({ approvedBy: account });
          }}
          onSubmitText={commit}
          placeholder="Search"
          aria-label={name}
          emptyText={author ? "No analyst matches." : "No analyst or organization matches."}
        />
      }
    />
  );
}

/** One heading of the panel and its lines. Collapsed, it keeps its active filters on show as
 *  pills under the heading. */
function Group({
  group,
  open,
  onToggle,
  ...props
}: FilterPanelProps & { group: FilterGroup; open: boolean; onToggle: () => void }) {
  const { surface, state, onPatch, vocabulary, timelines, playback } = props;
  const bodyId = useId();
  const pills = open ? [] : groupPills(group, surface, state, vocabulary, onPatch);
  return (
    <section>
      <SectionEyebrow
        as="h3"
        margin="none"
        title={group.title}
        toggle={{ open, onToggle, controls: open ? bodyId : undefined }}
      />
      {open ? (
        <div id={bodyId}>
          {group.dates &&
            DATE_KEYS.map((key) => (
              <Timeline
                key={key}
                dateKey={key}
                state={state}
                onPatch={onPatch}
                days={timelines[key]}
                playback={playback?.[key]}
              />
            ))}
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
      ) : (
        pills.length > 0 && (
          <div className="pt-1">
            <ActiveFilterPills filters={pills} />
          </div>
        )
      )}
    </section>
  );
}

/**
 * The filter panel of every surface that lists events: one collapsible heading per group of
 * dimensions (the When group holds the two date timelines), then **Clear all** once a filter is
 * on. The surface decides which dimensions it offers (`offeredDimensions`); the order, the names
 * and the controls are the model's.
 */
export function FilterPanel(props: FilterPanelProps) {
  const { surface, state, onClear } = props;
  const [openGroups, toggleGroup] = useOpenGroups();
  const offered = offeredDimensions(surface, state.show);
  const dates = datesOffered(surface, state.show);
  const groups = FILTER_GROUPS.map((g) => ({
    ...g,
    dimensions: g.dimensions.filter((d) => offered.includes(d)),
  })).filter((g) => g.dimensions.length > 0 || (g.dates && dates));
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Group
          key={group.title}
          {...props}
          group={group}
          open={openGroups.includes(group.title)}
          onToggle={() => toggleGroup(group.title)}
        />
      ))}
      {anyActive(surface, state) && (
        <div className="flex justify-end">
          <Button action="clear" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The panel under its **Filters** header, from `lg` up: in a list page's right rail and floating
 * over the map. The header opens and closes the panel; closed, the active filters show under it
 * as removable pills. The viewer's choice holds per surface (`usePanelOpen`).
 */
export function FilterCard({
  loading = false,
  className,
  bodyClassName,
  ...props
}: FilterPanelProps & {
  /** A pulsing dot in the header while the surface fetches. */
  loading?: boolean;
  className?: string;
  /** The open panel's own height cap and scroll. */
  bodyClassName?: string;
}) {
  const [open, toggle] = usePanelOpen(props.surface);
  const bodyId = useId();
  const pills = activePills(props.surface, props.state, props.vocabulary, props.onPatch);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm transition-colors hover:bg-neutral-800/80"
      >
        <span className="flex items-center gap-2">
          <Filter size={14} className={pills.length > 0 ? "text-orange-400" : "text-neutral-400"} />
          <span className="font-medium text-neutral-300">Filters</span>
        </span>
        <span className="flex items-center gap-2">
          {loading && <Dot className="animate-pulse" />}
          <ChevronDown
            size={14}
            aria-hidden
            className={cn("text-neutral-500 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open ? (
        <div id={bodyId} className={cn(CARD_FRAME, "mt-1 p-3", bodyClassName)}>
          <FilterPanel {...props} />
        </div>
      ) : (
        pills.length > 0 && (
          <div className={cn(CARD_FRAME, "mt-1 px-2.5 py-2")}>
            <ActiveFilterPills filters={pills} onClearAll={props.onClear} />
          </div>
        )
      )}
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
