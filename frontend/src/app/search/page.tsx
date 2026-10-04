"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { MapPin, Search as SearchIcon, Users } from "lucide-react";
import { CollectionCard } from "@/components/collections/CollectionCard";
import { CollectionIcon } from "@/lib/collections";
import { StatusBadge } from "@/components/event/StatusBadge";
import { AUTHOR_FILTER_RE, search, splitHighlights } from "@/lib/search";
import { Avatar } from "@/components/ui/Avatar";
import { EntityCard } from "@/components/ui/EntityCard";
import type {
  Conflict,
  SearchRequestHit,
  SearchEventHit,
  SearchResponse,
  SearchType,
  SearchUserHit,
  Tag,
} from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, LABEL_TEXT } from "@/components/ui/form-styles";
import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { rangeSummary } from "@/components/ui/FilterSection";
import {
  ALL_FILTER_SECTIONS,
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  STATUS_FILTER_OPTIONS,
  addedWindowActive,
  buildActiveFilterPills,
  buildDateWindowPills,
  eventWindowActive,
  hasAnyFilter,
  type DateWindows,
  type EventFilterPatch,
  type EventFilterSectionName,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { useApiResource } from "@/hooks/useApiResource";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";

import { TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";

// The type picker: the two event groups are one "Events" entry (the filters only apply to
// events); results still render as two groups.
const TYPE_FILTERS: { value: SearchType; label: string; icon?: ReactNode }[] = [
  { value: "all", label: "All" },
  { value: "event", label: "Events", icon: <MapPin size={11} /> },
  { value: "collection", label: "Collections", icon: <CollectionIcon size={11} /> },
  { value: "user", label: "Analysts", icon: <Users size={11} /> },
];

// Types that scope to events (the legacy singletons stay valid in shared URLs).
const EVENT_TYPES: ReadonlyArray<SearchType> = ["event", "geolocation", "request"];

// The requests group serves status `requested` only, so on the legacy request scope both
// status chips could only empty the result. A URL-carried status still shows as a removable pill.
const REQUEST_SECTIONS = ALL_FILTER_SECTIONS.filter((s) => s !== "status");

// The backend narrows collections on `author` and empties the group on every other event
// predicate, so that scope offers the Author section alone.
const COLLECTION_SECTIONS: ReadonlyArray<EventFilterSectionName> = ["author"];

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
  const initialValues: EventFilterValues = {
    // Only the vocabulary the panel offers: a crafted `?status=` the chips can't represent is dropped.
    statuses: searchParams
      .getAll("status")
      .filter((s) => STATUS_FILTER_OPTIONS.some(([value]) => value === s)),
    conflicts: searchParams.getAll("conflict"),
    captureSources: searchParams.getAll("capture_source"),
    tags: searchParams.getAll("tag"),
    mediaTypes: searchParams.getAll("media"),
    // A crafted URL can carry anything; the shared gate keeps an ineligible value from 422ing
    // every fetch.
    author: (() => {
      const raw = searchParams.get("author") ?? "";
      return AUTHOR_FILTER_RE.test(raw) ? raw : "";
    })(),
  };
  const initialDates: DateWindows = {
    eventFrom: searchParams.get("event_date_from") ?? "",
    eventTo: searchParams.get("event_date_to") ?? "",
    addedFrom: searchParams.get("submitted_from") ?? "",
    addedTo: searchParams.get("submitted_to") ?? "",
  };
  const arrivedFiltered = hasAnyFilter(initialValues, initialDates);
  // A filtered link without a type (the profile's "Show more") lands on Events: filters are
  // event predicates.
  const initialType =
    (searchParams.get("type") as SearchType) || (arrivedFiltered ? "event" : "all");

  const [queryInput, setQueryInput] = useState(initialQ);
  const [typeFilter, setTypeFilter] = useState<SearchType>(initialType);
  const [values, setValues] = useState<EventFilterValues>(initialValues);
  const [dates, setDates] = useState<DateWindows>(initialDates);

  // The debounced snapshot the fetch and URL run on, so typing doesn't fire a request per keystroke.
  const [committed, setCommitted] = useState({ q: initialQ, values: initialValues, dates: initialDates });

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same pickers as the map: the live taxonomy + the used-conflict list.
  const { data: tagsData } = useApiResource<Tag[]>("/tags");
  const { data: conflictsData } = useApiResource<Conflict[]>("/conflicts?used=true");

  const onPatch: EventFilterPatch = (patch) => setValues((v) => ({ ...v, ...patch }));
  const clearFilters = () => {
    setValues(EMPTY_EVENT_FILTERS);
    setDates(EMPTY_DATE_WINDOWS);
  };

  const activeFilters: ActiveFilter[] = [
    ...buildActiveFilterPills(values, onPatch),
    ...buildDateWindowPills(
      dates,
      () => setDates((d) => ({ ...d, eventFrom: "", eventTo: "" })),
      () => setDates((d) => ({ ...d, addedFrom: "", addedTo: "" }))
    ),
  ];
  const hasActiveFilters = hasAnyFilter(values, dates);
  const onEventScope = EVENT_TYPES.includes(typeFilter);
  // Panel sections the scope offers, or null where no filter narrows it (Analysts, and All,
  // which spans four groups).
  const filterSections: ReadonlyArray<EventFilterSectionName> | null = onEventScope
    ? typeFilter === "request"
      ? REQUEST_SECTIONS
      : ALL_FILTER_SECTIONS
    : typeFilter === "collection"
      ? COLLECTION_SECTIONS
      : null;

  // Monotonic request token: late responses apply only if still latest. Comparing
  // `response.query` alone missed the type-filter race (same `q`, different `type`).
  const latestRequestId = useRef<number>(0);

  // Debounced commit of inputs to the snapshot and URL via `replace`, so Back doesn't fill
  // with intermediate states.
  useDebouncedEffect(
    () => {
      // Identity-preserving: if nothing changed (e.g. a chip click already committed), keep the
      // previous object so the fetch doesn't refire.
      setCommitted((prev) => {
        const next = { q: queryInput, values, dates };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      const params = new URLSearchParams();
      if (queryInput) params.set("q", queryInput);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (values.author.trim()) params.set("author", values.author.trim());
      values.statuses.forEach((n) => params.append("status", n));
      values.conflicts.forEach((n) => params.append("conflict", n));
      values.captureSources.forEach((n) => params.append("capture_source", n));
      values.tags.forEach((n) => params.append("tag", n));
      values.mediaTypes.forEach((n) => params.append("media", n));
      if (dates.eventFrom) params.set("event_date_from", dates.eventFrom);
      if (dates.eventTo) params.set("event_date_to", dates.eventTo);
      if (dates.addedFrom) params.set("submitted_from", dates.addedFrom);
      if (dates.addedTo) params.set("submitted_to", dates.addedTo);
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    },
    [queryInput, typeFilter, values, dates, router],
    DEBOUNCE_MS
  );

  // Fetch whenever the committed snapshot or type changes. Any active filter with an empty
  // query is a valid search (browse mode, the profile's "Show more" landing).
  useEffect(() => {
    const q = committed.q.trim();
    const v = committed.values;
    const d = committed.dates;
    if (!q && !hasAnyFilter(v, d)) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    search({
      q,
      type: typeFilter,
      author: v.author.trim() || undefined,
      status: v.statuses,
      conflict: v.conflicts,
      captureSource: v.captureSources,
      tag: v.tags,
      media: v.mediaTypes,
      eventDateFrom: d.eventFrom || undefined,
      eventDateTo: d.eventTo || undefined,
      submittedFrom: d.addedFrom || undefined,
      submittedTo: d.addedTo || undefined,
    })
      .then((response) => {
        // Stale response (a newer request started): drop it.
        if (requestId !== latestRequestId.current) return;
        setResults(response);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (requestId !== latestRequestId.current) return;
        setError(err.message);
        setLoading(false);
      });
  }, [committed, typeFilter]);

  const activeQuery = committed.q;

  const totalHits = useMemo(() => {
    if (!results) return 0;
    return (
      results.total.geolocations +
      results.total.requests +
      results.total.collections +
      results.total.users
    );
  }, [results]);

  const onChipClick = (t: SearchType) => {
    // Filters are event predicates: leaving Events with some active would silently keep
    // constraining the event groups, so they clear with the scope. Collections keep the author
    // (the one predicate that narrows that group), so stepping from an analyst's events to
    // their shelf stays on them. The snapshot updates in the same render: waiting for the
    // 300 ms debounce would fire one request with stale filters first (`type=user&conflict=…`
    // flashing "No matches").
    if (!EVENT_TYPES.includes(t) && hasActiveFilters) {
      const kept: EventFilterValues =
        t === "collection" && values.author.trim()
          ? { ...EMPTY_EVENT_FILTERS, author: values.author.trim() }
          : EMPTY_EVENT_FILTERS;
      setValues(kept);
      setDates(EMPTY_DATE_WINDOWS);
      setCommitted({ q: queryInput, values: kept, dates: EMPTY_DATE_WINDOWS });
    } else {
      setCommitted({ q: queryInput, values, dates });
    }
    setTypeFilter(t);
  };

  const showGroup = (
    group: "geolocation" | "request" | "collection" | "user"
  ): boolean => {
    if (typeFilter === "all") return true;
    // The Events scope is the two event groups; a collection is not an event.
    if (typeFilter === "event") return group === "geolocation" || group === "request";
    return typeFilter === group;
  };

  return (
    <PageShell title="Search">
        <Input
          type="search"
          icon={<SearchIcon size={14} />}
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Try a location, an analyst handle, or a keyword from a title…"
          autoFocus
          className="bg-neutral-900 placeholder:text-neutral-500"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((opt) => (
            <Pill
              key={opt.value}
              tone={
                typeFilter === opt.value || (opt.value === "event" && onEventScope)
                  ? "accent"
                  : "neutral"
              }
              icon={opt.icon}
              onClick={() => onChipClick(opt.value)}
            >
              {opt.label}
            </Pill>
          ))}
        </div>

        <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />

        {/* The panel shows directly when the scope has filters (sections collapse individually).
            Date windows are event predicates, so they stay off the Collections scope. */}
        {filterSections && (
          <EventFilterSections
            tags={tagsData ?? []}
            conflicts={conflictsData ?? []}
            values={values}
            onPatch={onPatch}
            sections={filterSections}
            dateSections={onEventScope ? [
              {
                title: "Event date",
                concept: "event_date",
                summary: rangeSummary(dates.eventFrom, dates.eventTo),
                active: eventWindowActive(dates),
                children: (
                  <DateRange
                    label="Event date"
                    from={dates.eventFrom}
                    to={dates.eventTo}
                    onChange={(from, to) => setDates((d) => ({ ...d, eventFrom: from, eventTo: to }))}
                  />
                ),
              },
              {
                title: "Added",
                concept: "added",
                summary: rangeSummary(dates.addedFrom, dates.addedTo),
                active: addedWindowActive(dates),
                children: (
                  <DateRange
                    label="Added"
                    from={dates.addedFrom}
                    to={dates.addedTo}
                    onChange={(from, to) => setDates((d) => ({ ...d, addedFrom: from, addedTo: to }))}
                  />
                ),
              },
            ] : []}
          />
        )}

        {(activeQuery.trim() || hasActiveFilters) && (
          <div className="flex items-center justify-between text-[11px] text-neutral-500 min-h-[16px]">
            <span>
              {loading
                ? "Searching…"
                : results
                  ? `${totalHits} result${totalHits === 1 ? "" : "s"}${activeQuery.trim() ? " for " : ""}`
                  : null}
              {!loading && results && activeQuery.trim() && (
                <span className="text-neutral-300 font-medium">
                  &ldquo;{activeQuery.trim()}&rdquo;
                </span>
              )}
              {!loading && results && values.author.trim() && (
                <span> by <span className="text-neutral-300 font-medium">@{values.author.trim()}</span></span>
              )}
            </span>
          </div>
        )}

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {/* Emptiness gates read the LIVE inputs, so clearing filters doesn't flash stale results
            under the start-typing prompt for a debounce window. */}
        {!queryInput.trim() && !hasActiveFilters && (
          <EmptyState>
            Start typing to search across geolocations, requests, collections
            and analysts.
          </EmptyState>
        )}

        {(activeQuery.trim() || hasActiveFilters) && results && totalHits === 0 && !loading && (
          <EmptyState>
            No matches
            {activeQuery.trim() && (
              <> for <span className="text-neutral-300">&ldquo;{activeQuery.trim()}&rdquo;</span></>
            )}
            {hasActiveFilters && <> with the active filters</>}.
            {typeFilter !== "all" && !hasActiveFilters && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => onChipClick("all")}
                  className={TEXT_LINK}
                >
                  Try searching all types
                </button>
                .
              </>
            )}
          </EmptyState>
        )}

        {(queryInput.trim() || hasActiveFilters) && results && (
          <>
            {showGroup("geolocation") && results.geolocations.length > 0 && (
              <ResultGroup
                title="Geolocations"
                count={results.total.geolocations}
              >
                {results.geolocations.map((g) => (
                  <EventResult key={g.id} hit={g} />
                ))}
              </ResultGroup>
            )}

            {showGroup("request") && results.requests.length > 0 && (
              <ResultGroup title="Requests" count={results.total.requests}>
                {results.requests.map((r) => (
                  <RequestResult key={r.id} hit={r} />
                ))}
              </ResultGroup>
            )}

            {showGroup("collection") && results.collections.length > 0 && (
              <ResultGroup
                title="Collections"
                count={results.total.collections}
              >
                {/* The profile's grid: a mosaic at a card's width, one column on a phone. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {results.collections.map((collection) => (
                    // The profile's card with the byline it hides there: a result stands beside other
                    // analysts' shelves.
                    <CollectionCard
                      key={collection.id}
                      collection={collection}
                      showOwner
                    />
                  ))}
                </div>
              </ResultGroup>
            )}

            {showGroup("user") && results.users.length > 0 && (
              <ResultGroup title="Analysts" count={results.total.users}>
                {results.users.map((u) => (
                  <UserResult key={u.id} hit={u} />
                ))}
              </ResultGroup>
            )}
          </>
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
    // The pair stacks below `sm`: a native date control needs more width than two columns leave
    // on 320px, and the separator only reads on a row.
    <div className="flex max-sm:flex-col max-sm:items-stretch items-center gap-2">
      <Input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label={`${label} from`}
        className="bg-neutral-800 sm:text-[11px]"
      />
      <span className="max-sm:hidden text-neutral-500 text-xs">–</span>
      <Input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label={`${label} to`}
        className="bg-neutral-800 sm:text-[11px]"
      />
    </div>
  );
}

/**
 * Render a sentinel-wrapped highlight string as text and `<mark>`; `splitHighlights`' even/odd
 * parity is safe since the backend emits well-formed pairs.
 */
function Highlighted({ value }: { value: string }) {
  const segments = splitHighlights(value);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="bg-orange-500/30 text-orange-200 rounded-sm px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

function ResultGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className={LABEL_TEXT}>
        {title} · <span className="text-neutral-300 font-medium">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EventResult({ hit }: { hit: SearchEventHit }) {
  return (
    <EntityCard
      variant="compact"
      detailHref={`/events/${hit.id}`}
      title={<Highlighted value={hit.title_highlight} />}
      titleText={hit.title}
      badge={<StatusBadge status={hit.status} />}
      media={hit.media[0]}
      isGraphic={hit.is_graphic}
      author={hit.owner}
      date={hit.event_date ?? undefined}
      coords={{ lat: hit.lat, lng: hit.lng }}
      tags={hit.tags}
    />
  );
}

function RequestResult({ hit }: { hit: SearchRequestHit }) {
  return (
    <EntityCard
      variant="compact"
      detailHref={`/requests/${hit.id}`}
      title={<Highlighted value={hit.title_highlight} />}
      titleText={hit.title}
      badge={<StatusBadge status={hit.status} />}
      media={hit.media[0]}
      isGraphic={hit.is_graphic}
      author={hit.owner}
      source={{ url: hit.source_url }}
    />
  );
}

function UserResult({ hit }: { hit: SearchUserHit }) {
  // Sanctioned duplicate of EntityCard's shell (see design.md): a user hit has no media slot or
  // meta rows, and folding it in would leak avatar and no-thumb conditionals into the card.
  return (
    <Link
      href={`/profile/${hit.username}`}
      className={`flex items-start gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <Avatar src={hit.avatar_url} username={hit.username} size="size-10" />
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-medium text-neutral-100 inline-flex items-center gap-1.5">
          @<Highlighted value={hit.username_highlight} />
        </h3>
        {hit.bio_highlight && (
          <p className="text-xs text-neutral-400 line-clamp-2">
            <Highlighted value={hit.bio_highlight} />
          </p>
        )}
      </div>
    </Link>
  );
}
