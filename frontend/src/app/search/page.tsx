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
import { Building2, MapPin, Search as SearchIcon, Users } from "lucide-react";
import { CollectionCard } from "@/components/collections/CollectionCard";
import { CollectionIcon } from "@/lib/collections";
import { StatusBadge } from "@/components/event/StatusBadge";
import {
  appendEventFilterParams,
  readEventFilterParams,
  search,
  splitHighlights,
} from "@/lib/search";
import { Avatar } from "@/components/ui/Avatar";
import { EntityCard } from "@/components/ui/EntityCard";
import type {
  SearchRequestHit,
  SearchEventHit,
  SearchOrganizationHit,
  SearchResponse,
  SearchType,
  SearchUserHit,
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
  countActiveFilters,
  eventWindowActive,
  hasAnyFilter,
  type DateWindows,
  type EventFilterPatch,
  type EventFilterSectionName,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { FilterBar } from "@/components/filters/FilterBar";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";

import { META_LINE, TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/SegmentedControl";
import { creditProps } from "@/lib/geolocatorCredit";
import { memberCountLabel, organizationPath } from "@/lib/organizations";
import { countLabel } from "@/lib/format";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { eventHref, profileHref, requestHref } from "@/lib/routes";

const ICON = { size: 13, strokeWidth: 1.8, className: "max-sm:hidden" } as const;

function typeLabel(icon: ReactNode, label: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {label}
    </span>
  );
}

// The type picker: the two event groups are one "Events" entry (the filters only apply to
// events); results still render as two groups.
const TYPE_OPTIONS: SegmentedControlOption<SearchType>[] = [
  { value: "all", label: "All" },
  { value: "event", label: typeLabel(<MapPin {...ICON} />, "Events") },
  { value: "collection", label: typeLabel(<CollectionIcon {...ICON} />, "Collections") },
  { value: "user", label: typeLabel(<Users {...ICON} />, "Analysts") },
  { value: "organization", label: typeLabel(<Building2 {...ICON} />, "Organizations") },
];

// Types that scope to events (the legacy singletons stay valid in shared URLs).
const EVENT_TYPES: ReadonlyArray<SearchType> = ["event", "geolocation", "request"];

// The requests group serves status `requested` only, so on the legacy request scope both
// status chips could only empty the result. A URL-carried status still shows as a removable pill.
// Approvals stay off too: a request carries none.
const REQUEST_SECTIONS = ALL_FILTER_SECTIONS.filter((s) => s !== "status" && s !== "approval");

// The backend narrows collections on `author` and empties the group on every other event
// predicate, so that scope offers the Author section alone.
const COLLECTION_SECTIONS: ReadonlyArray<EventFilterSectionName> = ["author"];

interface SearchFilters {
  values: EventFilterValues;
  dates: DateWindows;
}

const EMPTY_SEARCH_FILTERS: SearchFilters = {
  values: EMPTY_EVENT_FILTERS,
  dates: EMPTY_DATE_WINDOWS,
};

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
  const initialValues: EventFilterValues = {
    ...read,
    // Only the vocabulary the panel offers: a crafted `?status=` the chips can't represent is dropped.
    statuses: read.statuses.filter((s) => STATUS_FILTER_OPTIONS.some(([value]) => value === s)),
    // The search groups serve no location-guess predicate, so the panel never offers it here.
    locationGuess: [],
  };
  const initialDates: DateWindows = { eventFrom, eventTo, addedFrom, addedTo };
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

  const { tags, conflicts } = useFilterVocabulary();

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
  // Panel sections the scope offers, or null where no filter narrows it (Analysts,
  // Organizations, and All, which spans every group).
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

  const applyFilters = (next: SearchFilters) => {
    setValues(next.values);
    setDates(next.dates);
  };
  // The date windows are event predicates, so they stay off the Collections scope.
  const renderPanel = (
    panel: SearchFilters,
    setPanel: (next: SearchFilters) => void
  ) =>
    filterSections && (
      <EventFilterSections
        tags={tags}
        conflicts={conflicts}
        values={panel.values}
        onPatch={(patch) =>
          setPanel({ ...panel, values: { ...panel.values, ...patch } })
        }
        sections={filterSections}
        dateSections={
          onEventScope
            ? [
                {
                  title: "Event date",
                  concept: "occurred_date",
                  summary: rangeSummary(panel.dates.eventFrom, panel.dates.eventTo),
                  active: eventWindowActive(panel.dates),
                  children: (
                    <DateRange
                      label="Event date"
                      from={panel.dates.eventFrom}
                      to={panel.dates.eventTo}
                      onChange={(from, to) =>
                        setPanel({
                          ...panel,
                          dates: { ...panel.dates, eventFrom: from, eventTo: to },
                        })
                      }
                    />
                  ),
                },
                {
                  title: "Added",
                  concept: "added",
                  summary: rangeSummary(panel.dates.addedFrom, panel.dates.addedTo),
                  active: addedWindowActive(panel.dates),
                  children: (
                    <DateRange
                      label="Added"
                      from={panel.dates.addedFrom}
                      to={panel.dates.addedTo}
                      onChange={(from, to) =>
                        setPanel({
                          ...panel,
                          dates: { ...panel.dates, addedFrom: from, addedTo: to },
                        })
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
      // Identity-preserving: if nothing changed (e.g. a chip click already committed), keep the
      // previous object so the fetch doesn't refire.
      setCommitted((prev) => {
        const next = { q: queryInput, values, dates };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      const params = new URLSearchParams();
      if (queryInput) params.set("q", queryInput);
      if (typeFilter !== "all") params.set("type", typeFilter);
      appendEventFilterParams(params, { ...values, ...dates });
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
    search({ q, type: typeFilter, ...v, ...d })
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
      results.total.users +
      results.total.organizations
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
    group: "geolocation" | "request" | "collection" | "user" | "organization"
  ): boolean => {
    if (typeFilter === "all") return true;
    // The Events scope is the two event groups; a collection is not an event.
    if (typeFilter === "event") return group === "geolocation" || group === "request";
    return typeFilter === group;
  };

  return (
    <PageShell
      title="Search"
      rail={renderPanel({ values, dates }, applyFilters)}
      railLabel="Filters"
      narrowRail="hidden"
      controls={
        <SegmentedControl
          options={TYPE_OPTIONS}
          value={onEventScope ? "event" : typeFilter}
          onChange={onChipClick}
          aria-label="Result type"
        />
      }
    >
        <Input
          type="search"
          icon={<SearchIcon size={14} />}
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Try a location, an analyst handle, or a keyword from a title…"
          autoFocus
        />

        {filterSections ? (
          <FilterBar
            value={{ values, dates }}
            empty={EMPTY_SEARCH_FILTERS}
            count={countActiveFilters(values, dates)}
            pills={activeFilters}
            onClearAll={clearFilters}
            onApply={applyFilters}
            renderPanel={renderPanel}
          />
        ) : (
          <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />
        )}

        {(activeQuery.trim() || hasActiveFilters) && (
          <div className="flex items-center justify-between text-[11px] text-neutral-500 min-h-[16px]">
            <span>
              {loading
                ? "Searching…"
                : results
                  ? `${countLabel(totalHits, "result")}${activeQuery.trim() ? " for " : ""}`
                  : null}
              {!loading && results && activeQuery.trim() && (
                <span className="text-neutral-300 font-medium">
                  &ldquo;{activeQuery.trim()}&rdquo;
                </span>
              )}
              {!loading && results && values.author.trim() && (
                <span> by <span className="text-neutral-300 font-medium">{values.author.trim()}</span></span>
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
            Start typing to search across geolocations, requests, collections,
            analysts and organizations.
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

            {showGroup("organization") && results.organizations.length > 0 && (
              <ResultGroup title="Organizations" count={results.total.organizations}>
                {results.organizations.map((o) => (
                  <OrganizationResult key={o.id} hit={o} />
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
      detailHref={eventHref(hit.id)}
      title={<Highlighted value={hit.title_highlight} />}
      titleText={hit.title}
      badge={<StatusBadge status={hit.status} />}
      media={hit.media[0]}
      isGraphic={hit.is_graphic}
      {...creditProps(hit)}
      date={hit.occurred_date ?? undefined}
      coords={{ lat: hit.lat, lng: hit.lng }}
      tags={hit.tags}
    />
  );
}

function RequestResult({ hit }: { hit: SearchRequestHit }) {
  return (
    <EntityCard
      variant="compact"
      detailHref={requestHref(hit.id)}
      title={<Highlighted value={hit.title_highlight} />}
      titleText={hit.title}
      badge={<StatusBadge status={hit.status} />}
      media={hit.media[0]}
      isGraphic={hit.is_graphic}
      author={hit.owner}
      source={{ url: hit.source_urls[0] ?? null }}
    />
  );
}

/** One profile hit, an analyst or an organization. */
function ProfileResult({
  href,
  avatarUrl,
  avatarName,
  name,
  meta,
  bioHighlight,
}: {
  href: string;
  avatarUrl: string | null;
  avatarName: string;
  name: ReactNode;
  meta?: ReactNode;
  bioHighlight: string | null;
}) {
  // Sanctioned duplicate of EntityCard's shell (see design.md): a profile hit has no media slot
  // or meta rows, and folding it in would leak avatar and no-thumb conditionals into the card.
  return (
    <Link
      href={href}
      className={`flex items-start gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <Avatar src={avatarUrl} username={avatarName} size="size-10" />
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-medium text-neutral-100">
          {name}
        </h3>
        {meta}
        {bioHighlight && (
          <p className="text-xs text-neutral-400 line-clamp-2">
            <Highlighted value={bioHighlight} />
          </p>
        )}
      </div>
    </Link>
  );
}

function UserResult({ hit }: { hit: SearchUserHit }) {
  return (
    <ProfileResult
      href={profileHref(hit.username)}
      avatarUrl={hit.avatar_url}
      avatarName={hit.username}
      name={<Highlighted value={hit.username_highlight} />}
      bioHighlight={hit.bio_highlight}
    />
  );
}

function OrganizationResult({ hit }: { hit: SearchOrganizationHit }) {
  return (
    <ProfileResult
      href={organizationPath(hit.slug)}
      avatarUrl={hit.avatar_url}
      avatarName={hit.name}
      name={<Highlighted value={hit.name_highlight} />}
      meta={
        <p className={META_LINE}>
          <Building2 size={11} aria-hidden />
          {`Organization · ${memberCountLabel(hit.member_count)}`}
        </p>
      }
      bioHighlight={hit.bio_highlight}
    />
  );
}
