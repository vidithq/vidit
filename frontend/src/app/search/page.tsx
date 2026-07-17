"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Filter, MapPin, Megaphone, Search as SearchIcon, User, Users } from "lucide-react";
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
import { ChipBucket } from "@/components/ui/ChipBucket";
import { FilterSection, chipSummary, rangeSummary } from "@/components/ui/FilterSection";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { useApiResource } from "@/hooks/useApiResource";

import { TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";

const TYPE_FILTERS: { value: SearchType; label: string; icon?: ReactNode }[] = [
  { value: "all", label: "All" },
  { value: "geolocation", label: "Geolocations", icon: <MapPin size={11} /> },
  { value: "request", label: "Requests", icon: <Megaphone size={11} /> },
  { value: "user", label: "Analysts", icon: <Users size={11} /> },
];

// Fixed media-presence options (Media.media_type values), same as the map.
const MEDIA_TYPES: ReadonlyArray<[string, string]> = [
  ["image", "Image"],
  ["video", "Video"],
];

// Debounce window: reactive enough to feel live, long enough not to fire
// on every keystroke of a long phrase.
const DEBOUNCE_MS = 300;

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
  // the input binds to local state so typing isn't gated on URL round-trips.
  const initialQ = searchParams.get("q") ?? "";
  const initialType = (searchParams.get("type") as SearchType) || "all";

  const [queryInput, setQueryInput] = useState(initialQ);
  const [activeQuery, setActiveQuery] = useState(initialQ);
  const [typeFilter, setTypeFilter] = useState<SearchType>(initialType);
  // The standard event filter set (the map's vocabulary), URL-synced. The
  // author leg has no input on this page: it arrives via the URL (the
  // profile's "Show more" link) and clears via its pill.
  const [authorFilter, setAuthorFilter] = useState<string | null>(searchParams.get("author"));
  const [selectedConflicts, setSelectedConflicts] = useState<string[]>(
    searchParams.getAll("conflict")
  );
  const [selectedCaptureSources, setSelectedCaptureSources] = useState<string[]>(
    searchParams.getAll("capture_source")
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(searchParams.getAll("tag"));
  const [selectedMediaTypes, setSelectedMediaTypes] = useState<string[]>(
    searchParams.getAll("media")
  );
  const [eventFrom, setEventFrom] = useState(searchParams.get("event_date_from") ?? "");
  const [eventTo, setEventTo] = useState(searchParams.get("event_date_to") ?? "");
  const [trustedOnly, setTrustedOnly] = useState(searchParams.get("trusted_only") === "true");

  const [filtersOpen, setFiltersOpen] = useState(false);
  // Accordion open-state, like the map panel: curated buckets open first.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Conflict: true,
    "Capture source": true,
  });
  const toggleSection = (title: string) =>
    setOpenSections((s) => ({ ...s, [title]: !s[title] }));

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same pickers as the map: the live taxonomy + the used-conflict list.
  const { data: tagsData } = useApiResource<Tag[]>("/tags");
  const tags = tagsData ?? [];
  const { data: conflictsData } = useApiResource<Conflict[]>("/conflicts?used=true");
  const conflicts = conflictsData ?? [];
  const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);
  const captureSourceTags = tags.filter((t) => t.category === "capture_source").sort(byName);
  const freeTags = tags.filter((t) => t.category === "free").sort(byName);

  const toggleInBucket = (
    name: string,
    set: (v: string[] | ((prev: string[]) => string[])) => void
  ) => set((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  const removeFromBucket = (
    name: string,
    set: (v: string[] | ((prev: string[]) => string[])) => void
  ) => set((prev) => prev.filter((n) => n !== name));

  const clearFilters = () => {
    setAuthorFilter(null);
    setSelectedConflicts([]);
    setSelectedCaptureSources([]);
    setSelectedTags([]);
    setSelectedMediaTypes([]);
    setEventFrom("");
    setEventTo("");
    setTrustedOnly(false);
  };

  const eventActive = !!(eventFrom || eventTo);

  // The shared removable-pill row (same pattern as the map's overlay).
  const activeFilters: ActiveFilter[] = [
    ...selectedConflicts.map((n) => ({
      key: `conflict:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedConflicts),
    })),
    ...selectedCaptureSources.map((n) => ({
      key: `capture:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedCaptureSources),
    })),
    ...selectedTags.map((n) => ({
      key: `tag:${n}`,
      label: n,
      onRemove: () => removeFromBucket(n, setSelectedTags),
    })),
    ...selectedMediaTypes.map((n) => ({
      key: `media:${n}`,
      label: n[0].toUpperCase() + n.slice(1),
      onRemove: () => removeFromBucket(n, setSelectedMediaTypes),
    })),
    ...(eventActive
      ? [
          {
            key: "event-window",
            label: `Event: ${rangeSummary(eventFrom, eventTo)}`,
            onRemove: () => {
              setEventFrom("");
              setEventTo("");
            },
          },
        ]
      : []),
    ...(authorFilter
      ? [
          {
            key: "author",
            label: `by @${authorFilter}`,
            icon: <User size={11} />,
            onRemove: () => setAuthorFilter(null),
          },
        ]
      : []),
    ...(trustedOnly
      ? [{ key: "trusted", label: "Trusted only", onRemove: () => setTrustedOnly(false) }]
      : []),
  ];
  const hasActiveFilters = activeFilters.length > 0;

  // Monotonic request token: each fetch increments it, late responses
  // apply only if their token is still latest. Comparing on `response.query`
  // alone missed the type-filter race — same `q`, different `type` could
  // land an older response over a newer one.
  const latestRequestId = useRef<number>(0);

  // Debounced commit: input → activeQuery + URL via `replace` (not `push`)
  // so the back button doesn't fill with intermediate query states.
  useEffect(() => {
    const t = setTimeout(() => {
      setActiveQuery(queryInput);
      const params = new URLSearchParams();
      if (queryInput) params.set("q", queryInput);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (authorFilter) params.set("author", authorFilter);
      selectedConflicts.forEach((n) => params.append("conflict", n));
      selectedCaptureSources.forEach((n) => params.append("capture_source", n));
      selectedTags.forEach((n) => params.append("tag", n));
      selectedMediaTypes.forEach((n) => params.append("media", n));
      if (eventFrom) params.set("event_date_from", eventFrom);
      if (eventTo) params.set("event_date_to", eventTo);
      if (trustedOnly) params.set("trusted_only", "true");
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [
    queryInput,
    typeFilter,
    authorFilter,
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    selectedMediaTypes,
    eventFrom,
    eventTo,
    trustedOnly,
    router,
  ]);

  // Issue the API call whenever the committed query / type / filters change.
  // Any active filter with an empty query is a valid search (browse mode:
  // the filtered view, the profile's "Show more" landing).
  useEffect(() => {
    const q = activeQuery.trim();
    if (!q && !hasActiveFilters) {
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
      author: authorFilter ?? undefined,
      conflict: selectedConflicts,
      captureSource: selectedCaptureSources,
      tag: selectedTags,
      media: selectedMediaTypes,
      eventDateFrom: eventFrom || undefined,
      eventDateTo: eventTo || undefined,
      trustedOnly,
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
  }, [
    activeQuery,
    typeFilter,
    authorFilter,
    selectedConflicts,
    selectedCaptureSources,
    selectedTags,
    selectedMediaTypes,
    eventFrom,
    eventTo,
    trustedOnly,
    hasActiveFilters,
  ]);

  const totalHits = useMemo(() => {
    if (!results) return 0;
    return (
      results.total.geolocations + results.total.requests + results.total.users
    );
  }, [results]);

  const onChipClick = useCallback((t: SearchType) => {
    setTypeFilter(t);
  }, []);

  const showGroup = (group: SearchType): boolean =>
    typeFilter === "all" || typeFilter === group;

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
          {TYPE_FILTERS.filter(
            // The users group empties while any event filter is active, so
            // its chip would be a dead toggle.
            (opt) => !hasActiveFilters || opt.value !== "user"
          ).map((opt) => (
            <Pill
              key={opt.value}
              tone={typeFilter === opt.value ? "accent" : "neutral"}
              icon={opt.icon}
              onClick={() => onChipClick(opt.value)}
            >
              {opt.label}
            </Pill>
          ))}
          <Pill
            tone={filtersOpen ? "accent" : "secondary"}
            icon={<Filter size={11} />}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filters
          </Pill>
        </div>

        <ActiveFilterPills filters={activeFilters} onClearAll={clearFilters} />

        {filtersOpen && (
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 px-3">
            {conflicts.length > 0 && (
              <FilterSection
                title="Conflict"
                concept="conflict"
                summary={chipSummary(selectedConflicts)}
                active={selectedConflicts.length > 0}
                open={!!openSections["Conflict"]}
                onToggle={() => toggleSection("Conflict")}
              >
                <ChipBucket
                  options={conflicts}
                  selected={selectedConflicts}
                  onToggle={(n) => toggleInBucket(n, setSelectedConflicts)}
                />
              </FilterSection>
            )}

            {captureSourceTags.length > 0 && (
              <FilterSection
                title="Capture source"
                concept="capture_source"
                summary={chipSummary(selectedCaptureSources)}
                active={selectedCaptureSources.length > 0}
                open={!!openSections["Capture source"]}
                onToggle={() => toggleSection("Capture source")}
              >
                <ChipBucket
                  options={captureSourceTags}
                  selected={selectedCaptureSources}
                  onToggle={(n) => toggleInBucket(n, setSelectedCaptureSources)}
                />
              </FilterSection>
            )}

            <FilterSection
              title="Source media"
              concept="source_media"
              summary={chipSummary(
                selectedMediaTypes.map((m) => m[0].toUpperCase() + m.slice(1))
              )}
              active={selectedMediaTypes.length > 0}
              open={!!openSections["Source media"]}
              onToggle={() => toggleSection("Source media")}
            >
              <ChipBucket
                options={MEDIA_TYPES.map(([value, label]) => ({ id: value, name: value, label }))}
                selected={selectedMediaTypes}
                onToggle={(n) => toggleInBucket(n, setSelectedMediaTypes)}
              />
            </FilterSection>

            <FilterSection
              title="Event date"
              concept="event_date"
              summary={rangeSummary(eventFrom, eventTo)}
              active={eventActive}
              open={!!openSections["Event date"]}
              onToggle={() => toggleSection("Event date")}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={eventFrom}
                  onChange={(e) => setEventFrom(e.target.value)}
                  aria-label="Event date from"
                  className="bg-neutral-800 text-[11px]"
                />
                <span className="text-neutral-500 text-xs">–</span>
                <Input
                  type="date"
                  value={eventTo}
                  onChange={(e) => setEventTo(e.target.value)}
                  aria-label="Event date to"
                  className="bg-neutral-800 text-[11px]"
                />
              </div>
            </FilterSection>

            {freeTags.length > 0 && (
              <FilterSection
                title="Tags"
                summary={chipSummary(selectedTags)}
                active={selectedTags.length > 0}
                open={!!openSections["Tags"]}
                onToggle={() => toggleSection("Tags")}
              >
                <ChipBucket
                  options={freeTags}
                  selected={selectedTags}
                  onToggle={(n) => toggleInBucket(n, setSelectedTags)}
                />
              </FilterSection>
            )}

            <ToggleRow
              label="Trusted analysts only"
              on={trustedOnly}
              onToggle={() => setTrustedOnly((v) => !v)}
            />
          </div>
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
              {!loading && results && authorFilter && (
                <span> by <span className="text-neutral-300 font-medium">@{authorFilter}</span></span>
              )}
            </span>
          </div>
        )}

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {!activeQuery.trim() && !hasActiveFilters && (
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
            {typeFilter !== "all" && (
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

        {results && (
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
