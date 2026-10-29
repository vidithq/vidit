"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Search as SearchIcon } from "lucide-react";
import {
  SearchSelectionActions,
  SelectAllRow,
  SelectableHit,
  useSearchSelection,
} from "@/components/collections/SearchSelection";
import {
  exactProfile,
  hitsOf,
  readEventFilterParams,
  readShowPick,
  search,
  searchDatesPath,
  searchPageParams,
  searchSections,
  searchTypes,
} from "@/lib/search";
import { GO_TO_ZOOM, formatCoordinates, parsePastedCoordinates } from "@/lib/coordinates";
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
import {
  FilterCard,
  FilterSheetBar,
  type FilterPanelProps,
} from "@/components/filters/FilterPanel";
import {
  EMPTY_FILTERS,
  FILTER_STATUSES,
  anyActive,
  datesOffered,
  scopeState,
  splitShow,
  type FilterState,
} from "@/components/filters/model";
import { useFilterSurface, usePageUrl, type PageUrl } from "@/components/filters/useFilterSurface";
import { useTimelines } from "@/components/filters/useTimelines";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { TEXT_LINK } from "@/components/ui/styles";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { readError, type ReadableError } from "@/lib/errors";

/** A state with the filters its Show pick no longer offers dropped. */
const scoped = (state: FilterState) => scopeState("search", state);

/** The filters of a section's See all: that kind alone. Events keep the statuses the pick names,
 *  or take every status. */
function seeAllFilters(filters: FilterState, type: SearchHitType): FilterState {
  if (type === "event") {
    const { statuses } = splitShow(filters.show);
    return { ...filters, show: statuses.length > 0 ? statuses : [...FILTER_STATUSES] };
  }
  return scoped({ ...filters, show: [type] });
}

type PageState = { q: string; filters: FilterState };

/** The Show pick of a query string: what a history entry stands for. */
function shownKinds(query: string): string {
  const params = new URLSearchParams(query);
  return [...params.getAll("type"), ...params.getAll("status")].join(",");
}

/** The page's URL: the query and the filters in the `GET /search` vocabulary. A new Show pick is
 *  a history entry; typing and the other filters replace the current one, so Back doesn't fill
 *  with intermediate states. */
const SEARCH_PAGE: PageUrl<PageState> = {
  path: "/search",
  read: (params) => ({
    q: params.get("q") ?? "",
    filters: scoped({ ...EMPTY_FILTERS, ...readEventFilterParams(params), show: readShowPick(params) }),
  }),
  write: ({ q, filters }) => searchPageParams(q, filters),
  pushes: (from, to) => shownKinds(from) !== shownKinds(to),
};

/** The page's href for a query and its filters. */
function pageHref(q: string, filters: FilterState): string {
  const query = searchPageParams(q, filters).toString();
  return query ? `/search?${query}` : "/search";
}

/** Whether the filters alone make a search: a picked kind other than a status narrows nothing
 *  until a query or a filter names what to list. */
const filtersSearch = (filters: FilterState): boolean =>
  anyActive("search", { ...filters, show: splitShow(filters.show).statuses });

/** The hits with the profile the query names exactly moved to the front, so it leads its kind. */
function leadWithNamed(q: string, hits: SearchHit[]): SearchHit[] {
  const named = exactProfile(q, hits)?.hit;
  return named ? [named, ...hits.filter((hit) => hit !== named)] : hits;
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
  // The URL is the source of truth, so shared links and Back land in the same view; inputs bind
  // to local state so typing isn't gated on URL round-trips.
  const query = useSearchParams().toString();
  const initial = SEARCH_PAGE.read(new URLSearchParams(query));

  const [queryInput, setQueryInput] = useState(initial.q);
  const filterStore = useState<FilterState>(initial.filters);
  const { filters, setFilters, panel: filterPanel } = useFilterSurface("search", {
    store: filterStore,
  });

  // The debounced snapshot the fetch and URL run on, so typing doesn't fire a request per keystroke.
  const [committed, setCommitted] = useState(initial);

  // Back, Forward and a See all link move the URL: the page takes the view it names at once.
  const onReadPage = useCallback(
    (read: PageState) => {
      setQueryInput(read.q);
      setFilters(read.filters);
      setCommitted(read);
    },
    [setFilters],
  );
  usePageUrl(SEARCH_PAGE, query, committed, onReadPage);

  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReadableError | null>(null);
  // Bumped by Retry, to run the same search again.
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ReadableError | null>(null);

  const timelines = useTimelines(
    datesOffered("search", committed.filters.show)
      ? searchDatesPath({ q: committed.q.trim(), types: ["event"], ...committed.filters })
      : null,
  );
  const panel: FilterPanelProps = { ...filterPanel, timelines };

  // Monotonic request token: late responses apply only if still latest.
  const latestRequestId = useRef<number>(0);

  // Debounced commit of inputs to the snapshot.
  useDebouncedEffect(
    () => {
      // Identity-preserving: if nothing changed, keep the previous object so the fetch and the URL
      // don't refire.
      setCommitted((prev) => {
        const next = { q: queryInput, filters };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    },
    [queryInput, filters],
    DEBOUNCE_MS,
  );

  // Fetch whenever the committed snapshot changes. A pick of one kind reads its ranked list, any
  // other pick the sections of its kinds. Any active filter with an empty query is a valid search
  // (browse mode, the profile's "See all" landing). The shown results stay until the next ones
  // land, so typing never blanks the page.
  useEffect(() => {
    const q = committed.q.trim();
    if (!q && !filtersSearch(committed.filters)) {
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
      types: searchTypes(committed.filters.show),
      ...committed.filters,
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
  // The bulk add serves the list of events alone, where Select all reads as every match.
  const selection = useSearchSelection(
    { q: committed.q, ...committed.filters },
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
    setCommitted({ q, filters });
  };

  // Emptiness gates read the LIVE inputs, so clearing the field doesn't flash stale results
  // under the empty state for a debounce window.
  const searching = !!(queryInput.trim() || filtersSearch(filters));
  const empty =
    !!results &&
    (results.mode === "list" ? results.page.hits.length === 0 : results.sections.length === 0);

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
      rail={<FilterCard {...panel} />}
      railLabel="Filters"
      narrowRail="hidden"
      stickyActions={
        selection.gutter ? <SearchSelectionActions selection={selection} /> : undefined
      }
      stickyActionsIdle={selection.count === 0}
    >
      {/* A typed coordinate pair opens the map there. */}
      {point && (
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
      )}

      <FilterSheetBar {...panel} className="lg:hidden" />

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
              section={{ ...section, hits: leadWithNamed(results.request.q, section.hits) }}
              seeAllHref={pageHref(results.request.q, seeAllFilters(committed.filters, section.type))}
            />
          ))}
        </div>
      )}

      {searching && results?.mode === "list" && !empty && (
        <div className="space-y-1.5" aria-busy={loading}>
          {leadWithNamed(results.request.q, results.page.hits).map((hit) => (
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
