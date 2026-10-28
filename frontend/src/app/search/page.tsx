"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, MapPin, Search as SearchIcon, Users } from "lucide-react";
import {
  SearchSelectionActions,
  SelectAllRow,
  SelectableHit,
  useSearchSelection,
} from "@/components/collections/SearchSelection";
import { SearchHitRow } from "@/components/search/SearchHitRow";
import {
  SEARCH_KIND_OPTIONS,
  SEARCH_KIND_SECTIONS,
  exactProfile,
  hitsOf,
  readEventFilterParams,
  readShowPick,
  search,
  searchPageParams,
  searchTypes,
} from "@/lib/search";
import { GO_TO_ZOOM, formatCoordinates, parsePastedCoordinates } from "@/lib/coordinates";
import { useMapState } from "@/contexts/MapStateContext";
import { LinkRow } from "@/components/ui/LinkRow";
import { Avatar } from "@/components/ui/Avatar";
import type { SearchHitType, SearchResponse } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { ChipBucket } from "@/components/ui/ChipBucket";
import type { ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { rangeSummary } from "@/components/ui/FilterSection";
import {
  ALL_FILTER_SECTIONS,
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  FILTER_NAMES,
  SHOW_OPTIONS,
  addedWindowActive,
  buildActiveFilterPills,
  buildDateWindowPills,
  countActiveFilters,
  eventWindowActive,
  hasAnyFilter,
  type DateWindows,
  type EventFilterPatch,
  type EventFilterSectionName,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { FilterBar } from "@/components/filters/FilterBar";
import { FilterRail } from "@/components/filters/FilterRail";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { TEXT_LINK } from "@/components/ui/styles";
import { memberCountLabel, organizationPath } from "@/lib/organizations";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { profileHref } from "@/lib/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { readError, type ReadableError } from "@/lib/errors";

const STATUS_VALUES = SHOW_OPTIONS.map(([value]) => value);
const KIND_LABELS: Record<string, string> = Object.fromEntries(SEARCH_KIND_OPTIONS);
const SHOW_CHIPS = [...SHOW_OPTIONS, ...SEARCH_KIND_OPTIONS].map(([id, label]) => ({
  id,
  name: id,
  label,
}));

// The Show field heads the panel through `lead`, so the panel's own status-only one stays off.
const EVENT_SECTIONS = ALL_FILTER_SECTIONS.filter((s) => s !== "show");

/** The filter sections a pick offers: every event section while it lists events, otherwise the
 *  ones its kinds answer. */
function sectionsFor(eventsListed: boolean, kinds: SearchHitType[]) {
  if (eventsListed) return EVENT_SECTIONS;
  const answered = new Set<EventFilterSectionName>(
    kinds.flatMap((kind) => (kind === "event" ? [] : SEARCH_KIND_SECTIONS[kind])),
  );
  return EVENT_SECTIONS.filter((s) => answered.has(s));
}

type SearchPick = { values: EventFilterValues; dates: DateWindows; kinds: SearchHitType[] };

/** A pick with the filters it no longer offers dropped: once the list holds no event, only the
 *  author and the tags its kinds answer stay, and the date windows go. */
function scoped(pick: SearchPick): SearchPick {
  const types = searchTypes(pick.values.show, pick.kinds);
  if (types.length === 0 || types.includes("event")) return pick;
  const offered = sectionsFor(false, pick.kinds);
  return {
    kinds: pick.kinds,
    dates: EMPTY_DATE_WINDOWS,
    values: {
      ...EMPTY_EVENT_FILTERS,
      author: offered.includes("author") ? pick.values.author : "",
      tags: offered.includes("tags") ? pick.values.tags : [],
    },
  };
}

type SearchRequest = Parameters<typeof search>[0];

// Debounce window: live-feeling, but not one request per keystroke.
const DEBOUNCE_MS = 300;

export default function SearchPage() {
  // `useSearchParams` opts out of static prerender, so the body sits under Suspense.
  return (
    <Suspense fallback={<PageLoading />}>
      <SearchPageBody />
    </Suspense>
  );
}

function SearchPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the source of truth so shared links land in the same view; inputs bind to local
  // state so typing isn't gated on URL round-trips.
  const initialQ = searchParams.get("q") ?? "";
  const { eventFrom, eventTo, addedFrom, addedTo, ...read } = readEventFilterParams(searchParams);
  const shown = readShowPick(searchParams, STATUS_VALUES);
  const initialPick = scoped({
    // The search list serves no location-guess predicate, so the panel never offers it here.
    values: { ...read, show: shown.statuses, locationGuess: [] },
    dates: { eventFrom, eventTo, addedFrom, addedTo },
    kinds: shown.kinds,
  });

  const [queryInput, setQueryInput] = useState(initialQ);
  const [pick, setPick] = useState<SearchPick>(initialPick);
  const { values, dates, kinds } = pick;
  const update = (next: Partial<SearchPick>) => setPick((p) => scoped({ ...p, ...next }));

  // The debounced snapshot the fetch and URL run on, so typing doesn't fire a request per keystroke.
  const [committed, setCommitted] = useState({ q: initialQ, ...initialPick });

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReadableError | null>(null);
  // Bumped by Retry, to run the same search again.
  const [attempt, setAttempt] = useState(0);
  // The request behind `results`: a further page must repeat its query and filters, not the
  // live inputs, which may have moved on since.
  const resultsRequest = useRef<SearchRequest | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ReadableError | null>(null);

  const { tags, conflicts } = useFilterVocabulary();

  const onPatch: EventFilterPatch = (patch) =>
    setPick((p) => scoped({ ...p, values: { ...p.values, ...patch } }));
  const clearFilters = () =>
    setPick({ values: EMPTY_EVENT_FILTERS, dates: EMPTY_DATE_WINDOWS, kinds: [] });
  const toggleShow = (chip: string) => {
    if (STATUS_VALUES.includes(chip)) {
      const show = values.show.includes(chip)
        ? values.show.filter((s) => s !== chip)
        : [...values.show, chip];
      onPatch({ show });
      return;
    }
    const kind = chip as SearchHitType;
    update({ kinds: kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind] });
  };

  const types = searchTypes(values.show, kinds);
  const eventsListed = types.length === 0 || types.includes("event");
  const sections = sectionsFor(eventsListed, kinds);

  const filterPills = buildActiveFilterPills(values, onPatch);
  const statusPillCount = values.show.length;
  const activeFilters: ActiveFilter[] = [
    ...filterPills.slice(0, statusPillCount),
    ...kinds.map((kind) => ({
      key: `kind:${kind}`,
      filter: FILTER_NAMES.show,
      label: KIND_LABELS[kind],
      onRemove: () => update({ kinds: kinds.filter((k) => k !== kind) }),
    })),
    ...filterPills.slice(statusPillCount),
    ...buildDateWindowPills(
      dates,
      () => update({ dates: { ...dates, eventFrom: "", eventTo: "" } }),
      () => update({ dates: { ...dates, addedFrom: "", addedTo: "" } }),
    ),
  ];
  const filterCount = countActiveFilters(values, dates) + kinds.length;
  const hasActiveFilters = filterCount > 0;

  // Monotonic request token: late responses apply only if still latest.
  const latestRequestId = useRef<number>(0);

  const panel = (
    <EventFilterSections
      tags={tags}
      conflicts={conflicts}
      values={values}
      onPatch={onPatch}
      sections={sections}
      lead={[
        {
          title: FILTER_NAMES.show,
          concept: "status",
          children: (
            <ChipBucket
              options={SHOW_CHIPS}
              selected={[...values.show, ...kinds]}
              onToggle={toggleShow}
            />
          ),
        },
      ]}
      dateSections={
        eventsListed
          ? [
              {
                title: FILTER_NAMES.eventDate,
                concept: "occurred_date",
                summary: rangeSummary(dates.eventFrom, dates.eventTo),
                active: eventWindowActive(dates),
                children: (
                  <DateRange
                    label={FILTER_NAMES.eventDate}
                    from={dates.eventFrom}
                    to={dates.eventTo}
                    onChange={(from, to) =>
                      update({ dates: { ...dates, eventFrom: from, eventTo: to } })
                    }
                  />
                ),
              },
              {
                title: FILTER_NAMES.added,
                concept: "added",
                summary: rangeSummary(dates.addedFrom, dates.addedTo),
                active: addedWindowActive(dates),
                children: (
                  <DateRange
                    label={FILTER_NAMES.added}
                    from={dates.addedFrom}
                    to={dates.addedTo}
                    onChange={(from, to) =>
                      update({ dates: { ...dates, addedFrom: from, addedTo: to } })
                    }
                  />
                ),
              },
            ]
          : []
      }
    />
  );

  // Debounced commit of inputs to the snapshot and URL via `replace`, so Back doesn't fill
  // with intermediate states.
  useDebouncedEffect(
    () => {
      // Identity-preserving: if nothing changed, keep the previous object so the fetch doesn't
      // refire.
      setCommitted((prev) => {
        const next = { q: queryInput, ...pick };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      const qs = searchPageParams(queryInput, kinds, { ...values, ...dates }).toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    },
    [queryInput, pick, router],
    DEBOUNCE_MS,
  );

  // Fetch whenever the committed snapshot changes. Any active filter with an empty query is a
  // valid search (browse mode, the profile's "Show more" landing).
  useEffect(() => {
    const q = committed.q.trim();
    if (!q && !hasAnyFilter(committed.values, committed.dates) && committed.kinds.length === 0) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    const request: SearchRequest = {
      q,
      types: searchTypes(committed.values.show, committed.kinds),
      ...committed.values,
      ...committed.dates,
    };
    search(request)
      .then((response) => {
        // Stale response (a newer request started): drop it.
        if (requestId !== latestRequestId.current) return;
        resultsRequest.current = request;
        setResults(response);
        setMoreError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setError(readError(err));
        setLoading(false);
      });
  }, [committed, attempt]);

  const activeQuery = committed.q;
  const { setViewState, setSelectedId } = useMapState();
  const point = parsePastedCoordinates(queryInput);
  const named =
    results && queryInput.trim() === activeQuery.trim()
      ? exactProfile(activeQuery, results.hits)
      : null;
  const selection = useSearchSelection(
    { q: committed.q, ...committed.values, ...committed.dates },
    results ? hitsOf(results.hits, "event") : [],
  );

  // Appends the next page. A page that lands after a new search started is dropped, like a
  // stale first page.
  const loadMore = () => {
    const cursor = results?.cursor;
    const request = resultsRequest.current;
    if (!cursor || !request || loadingMore) return;
    const requestId = latestRequestId.current;
    setLoadingMore(true);
    search({ ...request, cursor })
      .then((page) => {
        if (requestId !== latestRequestId.current) return;
        setMoreError(null);
        setResults((prev) => prev && { ...prev, hits: [...prev.hits, ...page.hits], cursor: page.cursor });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setMoreError(readError(err));
      })
      .finally(() => setLoadingMore(false));
  };

  // A suggestion replaces the query at once, without waiting out the typing debounce.
  const respell = (q: string) => {
    setQueryInput(q);
    setCommitted({ q, ...pick });
  };

  const searching = !!(queryInput.trim() || hasActiveFilters);

  return (
    <PageShell
      title="Search"
      titleField={
        <Input
          type="search"
          icon={<SearchIcon size={14} />}
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Place, analyst or keyword"
          aria-label="Search"
          autoFocus
        />
      }
      rail={
        <FilterRail pills={activeFilters} onClearAll={clearFilters} sections={sections}>
          {panel}
        </FilterRail>
      }
      railLabel="Filters"
      narrowRail="hidden"
      stickyActions={
        selection.gutter ? <SearchSelectionActions selection={selection} /> : undefined
      }
      stickyActionsIdle={selection.count === 0}
    >
      {/* One shortcut under the field: a typed coordinate pair opens the map there, a query
          that names an analyst or an organization exactly opens their page. */}
      {point ? (
        <LinkRow
          icon={MapPin}
          value={formatCoordinates(point.lat, point.lng)}
          meta="Open on the map"
          href="/map"
          external={false}
          variant="arrow"
          onClick={() => {
            setSelectedId(null);
            setViewState({ latitude: point.lat, longitude: point.lng, zoom: GO_TO_ZOOM });
          }}
        />
      ) : named?.kind === "analyst" ? (
        <LinkRow
          icon={Users}
          leading={
            <Avatar src={named.hit.avatar_url} username={named.hit.username} size="size-7" />
          }
          value={named.hit.username}
          meta="Analyst"
          href={profileHref(named.hit.username)}
          external={false}
          variant="arrow"
        />
      ) : named?.kind === "organization" ? (
        <LinkRow
          icon={Building2}
          leading={
            <Avatar
              src={named.hit.avatar_url}
              username={named.hit.name}
              size="size-7"
              shape="square"
            />
          }
          value={named.hit.name}
          meta={`Organization · ${memberCountLabel(named.hit.member_count)}`}
          href={organizationPath(named.hit.slug)}
          external={false}
          variant="arrow"
        />
      ) : null}

      <FilterBar count={filterCount} pills={activeFilters} onClearAll={clearFilters}>
        {panel}
      </FilterBar>

      {searching && results && <SelectAllRow selection={selection} />}

      <ErrorNotice error={error} onRetry={() => setAttempt((n) => n + 1)} />

      {/* Emptiness gates read the LIVE inputs, so clearing filters doesn't flash stale results
          under the start-typing prompt for a debounce window. */}
      {!searching && (
        <EmptyState>
          Start typing to search across events, sites, collections, analysts and organizations.
        </EmptyState>
      )}

      {searching && results && results.hits.length === 0 && !loading && (
        <EmptyState>
          No matches
          {activeQuery.trim() && (
            <> for <span className="text-neutral-300">&ldquo;{activeQuery.trim()}&rdquo;</span></>
          )}
          {hasActiveFilters && <> with the active filters</>}.
          {results.suggestion && (
            <>
              {" "}Did you mean{" "}
              <button
                type="button"
                onClick={() => respell(results.suggestion ?? "")}
                className={TEXT_LINK}
              >
                {results.suggestion}
              </button>
              ?
            </>
          )}
        </EmptyState>
      )}

      {searching && results && results.hits.length > 0 && (
        <div className="space-y-1.5">
          {results.hits.map((hit) => (
            <SelectableHit key={`${hit.type}:${hit.id}`} hit={hit} selection={selection}>
              <SearchHitRow hit={hit} />
            </SelectableHit>
          ))}
          <LoadMoreRow
            walk={{
              hasMore: results.cursor !== null,
              loadingMore,
              loadMore,
              error: moreError,
            }}
          />
        </div>
      )}
    </PageShell>
  );
}

/** The date controls (the map uses timeline scrubbers for the same sections): a from/to pair
 *  of native date inputs. */
function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    // Stacked: two native date controls at the field type size need more width than a row of the
    // filter rail or of a 320px screen leaves.
    <div className="flex flex-col gap-2">
      <Input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label={`${label} from`}
      />
      <Input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label={`${label} to`}
      />
    </div>
  );
}
