"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Search as SearchIcon } from "lucide-react";
import {
  SearchSelectionActions,
  SelectAllRow,
  SelectableHit,
  useSearchSelection,
} from "@/components/collections/SearchSelection";
import {
  SEARCH_KINDS,
  SEARCH_KIND_SECTIONS,
  exactProfile,
  hitsOf,
  readEventFilterParams,
  readShowPick,
  search,
  searchPageParams,
  searchSections,
  searchTypes,
} from "@/lib/search";
import { GO_TO_ZOOM, formatCoordinates, parsePastedCoordinates } from "@/lib/coordinates";
import { showFieldScope } from "@/lib/showField";
import { useMapState } from "@/contexts/MapStateContext";
import { LinkRow } from "@/components/ui/LinkRow";
import { Item } from "@/components/ui/Item";
import { searchHitItem, searchTypeLabel } from "@/lib/items";
import type { SearchHit, SearchHitType, SearchResponse, SearchSection } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadMoreRow, SeeAllLink } from "@/components/ui/LoadMoreRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
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
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { readError, type ReadableError } from "@/lib/errors";

const STATUS_VALUES = SHOW_OPTIONS.map(([value]) => value);
const SHOW_CHIPS = [
  ...SHOW_OPTIONS,
  ...SEARCH_KINDS.map((kind) => [kind, searchTypeLabel(kind)] as const),
].map(([id, label]) => ({ id, name: id, label }));

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
  if (showFieldScope(pick.values.show, pick.kinds.length > 0).events) return pick;
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

/** The pick of a section's See all: that kind alone. Events keep the statuses the pick names,
 *  or take every status. */
function seeAllPick(pick: SearchPick, type: SearchHitType): SearchPick {
  if (type === "event") {
    const show = pick.values.show.length > 0 ? pick.values.show : STATUS_VALUES;
    return { ...pick, kinds: [], values: { ...pick.values, show } };
  }
  return scoped({ ...pick, kinds: [type], values: { ...pick.values, show: [] } });
}

/** The query and the pick a URL names. */
function readPage(params: URLSearchParams): { q: string; pick: SearchPick } {
  const { eventFrom, eventTo, addedFrom, addedTo, ...read } = readEventFilterParams(params);
  const shown = readShowPick(params, STATUS_VALUES);
  return {
    q: params.get("q") ?? "",
    pick: scoped({
      // The search list serves no location-guess predicate, so the panel never offers it here.
      values: { ...read, show: shown.statuses, locationGuess: [] },
      dates: { eventFrom, eventTo, addedFrom, addedTo },
      kinds: shown.kinds,
    }),
  };
}

/** The page's query string for a query and a pick. */
function pageQuery(q: string, pick: SearchPick): string {
  return searchPageParams(q, pick.kinds, { ...pick.values, ...pick.dates }).toString();
}

const pageHref = (query: string) => (query ? `/search?${query}` : "/search");

/** The Show pick of a query string: what a history entry stands for. */
function shownKinds(query: string): string {
  const params = new URLSearchParams(query);
  return [...params.getAll("type"), ...params.getAll("status")].join(",");
}

type SearchRequest = Parameters<typeof search>[0];

/** What the page shows: the sections of every kind the pick lists, or the list of its one kind.
 *  `request` is the request behind it, which a further page repeats. */
type Results = { request: SearchRequest; suggestion: string | null | undefined } & (
  | { mode: "sections"; sections: SearchSection[] }
  | { mode: "list"; page: SearchResponse }
);

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

  // The URL is the source of truth, so shared links and Back land in the same view; inputs bind
  // to local state so typing isn't gated on URL round-trips.
  const initial = readPage(searchParams);

  const [queryInput, setQueryInput] = useState(initial.q);
  const [pick, setPick] = useState<SearchPick>(initial.pick);
  const { values, dates, kinds } = pick;
  const update = (next: Partial<SearchPick>) => setPick((p) => scoped({ ...p, ...next }));

  // The debounced snapshot the fetch and URL run on, so typing doesn't fire a request per keystroke.
  const [committed, setCommitted] = useState({ q: initial.q, ...initial.pick });

  // The query string the page last wrote or read, so its own write is not read back as a move.
  const written = useRef(pageQuery(initial.q, initial.pick));
  const urlQuery = searchParams.toString();
  // Back, Forward and a See all link move the URL: the page takes the view it names at once.
  useEffect(() => {
    const read = readPage(new URLSearchParams(urlQuery));
    const query = pageQuery(read.q, read.pick);
    if (query === written.current) return;
    written.current = query;
    setQueryInput(read.q);
    setPick(read.pick);
    setCommitted({ q: read.q, ...read.pick });
  }, [urlQuery]);

  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReadableError | null>(null);
  // Bumped by Retry, to run the same search again.
  const [attempt, setAttempt] = useState(0);
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

  const eventsListed = showFieldScope(values.show, kinds.length > 0).events;
  const sections = sectionsFor(eventsListed, kinds);

  const filterPills = buildActiveFilterPills(values, onPatch);
  const statusPillCount = values.show.length;
  const activeFilters: ActiveFilter[] = [
    ...filterPills.slice(0, statusPillCount),
    ...kinds.map((kind) => ({
      key: `kind:${kind}`,
      filter: FILTER_NAMES.show,
      label: searchTypeLabel(kind),
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

  // Debounced commit of inputs to the snapshot and the URL. A new Show pick is a history entry;
  // typing and the other filters replace the current one, so Back doesn't fill with
  // intermediate states.
  useDebouncedEffect(
    () => {
      // Identity-preserving: if nothing changed, keep the previous object so the fetch doesn't
      // refire.
      setCommitted((prev) => {
        const next = { q: queryInput, ...pick };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      const query = pageQuery(queryInput, pick);
      if (query === written.current) return;
      const moved = shownKinds(query) !== shownKinds(written.current);
      written.current = query;
      if (moved) router.push(pageHref(query));
      else router.replace(pageHref(query));
    },
    [queryInput, pick, router],
    DEBOUNCE_MS,
  );

  // Fetch whenever the committed snapshot changes. A pick of one kind reads its ranked list, any
  // other pick the sections of its kinds. Any active filter with an empty query is a valid search
  // (browse mode, the profile's "See all" landing). The shown results stay until the next ones
  // land, so typing never blanks the page.
  useEffect(() => {
    const q = committed.q.trim();
    if (!q && !hasAnyFilter(committed.values, committed.dates)) {
      latestRequestId.current++;
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
    const read: Promise<Results> =
      request.types?.length === 1
        ? search(request).then((page) => ({
            mode: "list",
            request,
            page,
            suggestion: page.suggestion,
          }))
        : searchSections(request).then((data) => ({
            mode: "sections",
            request,
            sections: data.sections,
            suggestion: data.suggestion,
          }));
    read
      .then((next) => {
        // Stale response (a newer request started): drop it.
        if (requestId !== latestRequestId.current) return;
        setResults(next);
        setMoreError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setError(readError(err));
        setLoading(false);
      });
  }, [committed, attempt]);

  const { setViewState, setSelectedId } = useMapState();
  const point = parsePastedCoordinates(queryInput);
  const shownHits: SearchHit[] = !results
    ? []
    : results.mode === "list"
      ? results.page.hits
      : results.sections.flatMap((section) => section.hits);
  const named =
    results && queryInput.trim() === results.request.q
      ? exactProfile(results.request.q, shownHits)
      : null;
  // The bulk add serves the list of events alone, where Select all reads as every match.
  const selection = useSearchSelection(
    { q: committed.q, ...committed.values, ...committed.dates },
    results?.mode === "list" ? hitsOf(results.page.hits, "event") : [],
  );

  // Appends the next page, with the request that minted the cursor rather than the live inputs,
  // which may have moved on since. A page that lands after a new search started is dropped, like
  // a stale first page.
  const loadMore = () => {
    if (results?.mode !== "list" || !results.page.cursor || loadingMore) return;
    const { request } = results;
    const cursor = results.page.cursor;
    const requestId = latestRequestId.current;
    setLoadingMore(true);
    search({ ...request, cursor })
      .then((page) => {
        if (requestId !== latestRequestId.current) return;
        setMoreError(null);
        setResults((prev) =>
          prev?.mode === "list"
            ? {
                ...prev,
                page: { ...prev.page, hits: [...prev.page.hits, ...page.hits], cursor: page.cursor },
              }
            : prev,
        );
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

  // Emptiness gates read the LIVE inputs, so clearing the field doesn't flash stale results
  // under the empty state for a debounce window.
  const searching = !!(queryInput.trim() || hasAnyFilter(values, dates));
  const empty =
    !!results &&
    (results.mode === "list" ? results.page.hits.length === 0 : results.sections.length === 0);
  const committedPick: SearchPick = {
    values: committed.values,
    dates: committed.dates,
    kinds: committed.kinds,
  };

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
      ) : named ? (
        <Item variant="list" {...searchHitItem(named.hit)} highlight={undefined} />
      ) : null}

      <FilterBar count={filterCount} pills={activeFilters} onClearAll={clearFilters}>
        {panel}
      </FilterBar>

      {searching && results?.mode === "list" && <SelectAllRow selection={selection} />}

      <ErrorNotice error={error} onRetry={() => setAttempt((n) => n + 1)} />

      {!searching && <EmptyState variant="plain" icon={SearchIcon} />}

      {searching && empty && !loading && (
        <EmptyState>
          No matches.
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

      {searching && results?.mode === "sections" && !empty && (
        <div className="space-y-6" aria-busy={loading}>
          {results.sections.map((section) => (
            <ResultSection
              key={section.type}
              section={section}
              seeAllHref={pageHref(
                pageQuery(results.request.q, seeAllPick(committedPick, section.type)),
              )}
            />
          ))}
        </div>
      )}

      {searching && results?.mode === "list" && !empty && (
        <div className="space-y-1.5" aria-busy={loading}>
          {results.page.hits.map((hit) => (
            <SelectableHit key={`${hit.type}:${hit.id}`} hit={hit} selection={selection}>
              <Item variant="list" {...searchHitItem(hit)} />
            </SelectableHit>
          ))}
          <LoadMoreRow
            walk={{
              hasMore: results.page.cursor !== null,
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

/** One kind's top hits under its name, with See all while the kind holds more. */
function ResultSection({ section, seeAllHref }: { section: SearchSection; seeAllHref: string }) {
  const label = searchTypeLabel(section.type);
  return (
    <section aria-label={label} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <SectionEyebrow title={label} margin="none" />
        {section.cursor !== null && <SeeAllLink href={seeAllHref} className="shrink-0" />}
      </div>
      <div className="space-y-1.5">
        {section.hits.map((hit) => (
          <Item key={hit.id} variant="list" {...searchHitItem(hit)} />
        ))}
      </div>
    </section>
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
