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
import { StatusBadge } from "@/components/event/StatusBadge";
import TrustBadge from "@/components/profile/TrustBadge";
import { search, splitHighlights } from "@/lib/search";
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
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  buildActiveFilterPills,
  type EventFilterPatch,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { useApiResource } from "@/hooks/useApiResource";

import { TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";

// The reader-facing type picker: the two event groups are one "Events" entry
// (the filter set below only applies to events, so the picker doesn't force
// the geolocation vs request split; results still render as two groups).
const TYPE_FILTERS: { value: SearchType; label: string; icon?: ReactNode }[] = [
  { value: "all", label: "All" },
  { value: "event", label: "Events", icon: <MapPin size={11} /> },
  { value: "user", label: "Analysts", icon: <Users size={11} /> },
];

// The type values that scope to events (the legacy singletons stay valid in
// a shared URL even though the picker no longer offers them).
const EVENT_TYPES: ReadonlyArray<SearchType> = ["event", "geolocation", "request"];

// Debounce window: reactive enough to feel live, long enough not to fire
// on every keystroke of a long phrase.
const DEBOUNCE_MS = 300;

interface DateWindows {
  eventFrom: string;
  eventTo: string;
  addedFrom: string;
  addedTo: string;
}

export default function SearchPage() {
  // `useSearchParams` opts out of static prerender, so the body lives
  // under a Suspense boundary (Next 14 requirement).
  return (
    <Suspense fallback={<PageLoading />}>
      <SearchPageBody />
    </Suspense>
  );
}

function SearchPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth so shared links land in the same view;
  // the inputs bind to local state so typing isn't gated on URL round-trips.
  const initialQ = searchParams.get("q") ?? "";
  const initialValues: EventFilterValues = {
    conflicts: searchParams.getAll("conflict"),
    captureSources: searchParams.getAll("capture_source"),
    tags: searchParams.getAll("tag"),
    mediaTypes: searchParams.getAll("media"),
    author: searchParams.get("author") ?? "",
    trustedOnly: searchParams.get("trusted_only") === "true",
  };
  const initialDates: DateWindows = {
    eventFrom: searchParams.get("event_date_from") ?? "",
    eventTo: searchParams.get("event_date_to") ?? "",
    addedFrom: searchParams.get("submitted_from") ?? "",
    addedTo: searchParams.get("submitted_to") ?? "",
  };
  const arrivedFiltered =
    Object.values(initialDates).some(Boolean) ||
    initialValues.conflicts.length > 0 ||
    initialValues.captureSources.length > 0 ||
    initialValues.tags.length > 0 ||
    initialValues.mediaTypes.length > 0 ||
    !!initialValues.author ||
    initialValues.trustedOnly;
  // A filtered link without an explicit type (the profile's "Show more")
  // lands on the Events scope: filters are event predicates.
  const initialType =
    (searchParams.get("type") as SearchType) || (arrivedFiltered ? "event" : "all");

  const [queryInput, setQueryInput] = useState(initialQ);
  const [typeFilter, setTypeFilter] = useState<SearchType>(initialType);
  const [values, setValues] = useState<EventFilterValues>(initialValues);
  const [dates, setDates] = useState<DateWindows>(initialDates);

  // The debounced snapshot the fetch + URL run on, so typing (the query or
  // the author field) doesn't fire a request per keystroke.
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
    setDates({ eventFrom: "", eventTo: "", addedFrom: "", addedTo: "" });
  };

  const eventWindowActive = !!(dates.eventFrom || dates.eventTo);
  const addedWindowActive = !!(dates.addedFrom || dates.addedTo);

  // The shared pill entries plus this surface's two window entries.
  const activeFilters: ActiveFilter[] = [
    ...buildActiveFilterPills(values, onPatch),
    ...(eventWindowActive
      ? [
          {
            key: "event-window",
            label: `Event: ${rangeSummary(dates.eventFrom, dates.eventTo)}`,
            onRemove: () => setDates((d) => ({ ...d, eventFrom: "", eventTo: "" })),
          },
        ]
      : []),
    ...(addedWindowActive
      ? [
          {
            key: "added-window",
            label: `Added: ${rangeSummary(dates.addedFrom, dates.addedTo)}`,
            onRemove: () => setDates((d) => ({ ...d, addedFrom: "", addedTo: "" })),
          },
        ]
      : []),
  ];
  // The author narrows the view without carrying a pill (its chip lives in
  // the Author section), so it counts as active on its own.
  const hasActiveFilters = activeFilters.length > 0 || !!values.author.trim();
  const onEventScope = EVENT_TYPES.includes(typeFilter);

  // Monotonic request token: each fetch increments it, late responses
  // apply only if their token is still latest. Comparing on `response.query`
  // alone missed the type-filter race — same `q`, different `type` could
  // land an older response over a newer one.
  const latestRequestId = useRef<number>(0);

  // Debounced commit: inputs → the committed snapshot + the URL via
  // `replace` (not `push`) so the back button doesn't fill with
  // intermediate states.
  useEffect(() => {
    const t = setTimeout(() => {
      setCommitted({ q: queryInput, values, dates });
      const params = new URLSearchParams();
      if (queryInput) params.set("q", queryInput);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (values.author.trim()) params.set("author", values.author.trim());
      values.conflicts.forEach((n) => params.append("conflict", n));
      values.captureSources.forEach((n) => params.append("capture_source", n));
      values.tags.forEach((n) => params.append("tag", n));
      values.mediaTypes.forEach((n) => params.append("media", n));
      if (dates.eventFrom) params.set("event_date_from", dates.eventFrom);
      if (dates.eventTo) params.set("event_date_to", dates.eventTo);
      if (dates.addedFrom) params.set("submitted_from", dates.addedFrom);
      if (dates.addedTo) params.set("submitted_to", dates.addedTo);
      if (values.trustedOnly) params.set("trusted_only", "true");
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput, typeFilter, values, dates, router]);

  // Issue the API call whenever the committed snapshot / type changes.
  // Any active filter with an empty query is a valid search (browse mode:
  // the filtered view, the profile's "Show more" landing).
  useEffect(() => {
    const q = committed.q.trim();
    const v = committed.values;
    const d = committed.dates;
    const filtersActive =
      v.conflicts.length > 0 ||
      v.captureSources.length > 0 ||
      v.tags.length > 0 ||
      v.mediaTypes.length > 0 ||
      !!v.author.trim() ||
      v.trustedOnly ||
      Object.values(d).some(Boolean);
    if (!q && !filtersActive) {
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
      conflict: v.conflicts,
      captureSource: v.captureSources,
      tag: v.tags,
      media: v.mediaTypes,
      eventDateFrom: d.eventFrom || undefined,
      eventDateTo: d.eventTo || undefined,
      submittedFrom: d.addedFrom || undefined,
      submittedTo: d.addedTo || undefined,
      trustedOnly: v.trustedOnly,
    })
      .then((response) => {
        // Stale response (a newer request started since) — drop so the
        // in-flight fetch gets the final word.
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
      results.total.geolocations + results.total.requests + results.total.users
    );
  }, [results]);

  const onChipClick = (t: SearchType) => {
    // The filters are event predicates: leaving the Events scope while some
    // are active would silently keep constraining the event groups, so they
    // clear with the scope.
    if (!EVENT_TYPES.includes(t) && hasActiveFilters) {
      clearFilters();
    }
    setTypeFilter(t);
  };

  const showGroup = (group: "geolocation" | "request" | "user"): boolean => {
    if (typeFilter === "all") return true;
    if (typeFilter === "event") return group !== "user";
    return typeFilter === group;
  };

  return (
    <PageShell
      title="Search"
      subtitle="One discovery surface across the platform: type to search geolocations, requests and analysts at once. Matched fragments are highlighted in each result."
    >
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

        {/* Picking the Events scope surfaces the filter panel directly (the
            sections collapse individually); no separate toggle to find. */}
        {onEventScope && (
          <EventFilterSections
            tags={tagsData ?? []}
            conflicts={conflictsData ?? []}
            values={values}
            onPatch={onPatch}
            dateSections={[
              {
                title: "Event date",
                concept: "event_date",
                summary: rangeSummary(dates.eventFrom, dates.eventTo),
                active: eventWindowActive,
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
                active: addedWindowActive,
                children: (
                  <DateRange
                    label="Added"
                    from={dates.addedFrom}
                    to={dates.addedTo}
                    onChange={(from, to) => setDates((d) => ({ ...d, addedFrom: from, addedTo: to }))}
                  />
                ),
              },
            ]}
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

        {/* Emptiness gates read the LIVE inputs (not the debounced snapshot)
            so clearing filters doesn't flash stale results under the
            start-typing prompt for a debounce window. */}
        {!queryInput.trim() && !hasActiveFilters && (
          <EmptyState>
            Start typing to search across geolocations, requests and analysts.
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

/** The search surface's date controls (the map uses its timeline scrubbers
 *  for the same two sections): a from/to pair of native date inputs. */
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
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label={`${label} from`}
        className="bg-neutral-800 text-[11px]"
      />
      <span className="text-neutral-500 text-xs">–</span>
      <Input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label={`${label} to`}
        className="bg-neutral-800 text-[11px]"
      />
    </div>
  );
}

/**
 * Render a sentinel-wrapped highlight string as text + `<mark>` elements.
 * The backend emits well-formed pairs, so `splitHighlights`' even/odd
 * index parity is safe without a stateful parser.
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
  // Tags render as one uniform chip regardless of category.
  return (
    <EntityCard
      variant="compact"
      detailHref={`/events/${hit.id}`}
      title={<Highlighted value={hit.title_highlight} />}
      titleText={hit.title}
      badge={<StatusBadge status={hit.status} />}
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
      author={hit.owner}
      source={{ url: hit.source_url, isDemo: hit.is_demo }}
      working={hit.claimer_count}
    />
  );
}

function UserResult({ hit }: { hit: SearchUserHit }) {
  // Sanctioned duplicate of EntityCard's shell (see design.md): a user hit has
  // no media slot / meta rows, and folding it into EntityCard would leak
  // avatar + no-thumb conditionals into the card for one consumer.
  return (
    <Link
      href={`/profile/${hit.username}`}
      className={`flex items-start gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <Avatar src={hit.avatar_url} username={hit.username} size="size-10" />
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-medium text-neutral-100 inline-flex items-center gap-1.5">
          @<Highlighted value={hit.username_highlight} />
          <TrustBadge
            isTrusted={hit.is_trusted}
            trustReason={hit.trust_reason}
            size={12}
          />
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
