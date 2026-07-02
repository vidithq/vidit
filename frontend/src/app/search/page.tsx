"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { StatusBadge } from "@/components/event/StatusBadge";
import TrustBadge from "@/components/profile/TrustBadge";
import { search, splitHighlights } from "@/lib/search";
import { Avatar } from "@/components/ui/Avatar";
import { EntityCard } from "@/components/ui/EntityCard";
import type {
  SearchEventHit,
  SearchResponse,
  SearchType,
  SearchUserHit,
} from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, LABEL_TEXT } from "@/components/ui/form-styles";

import { TAPPABLE_HOVER, TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";

const TYPE_FILTERS: { value: SearchType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "geolocation", label: "Geolocations" },
  { value: "bounty", label: "Bounties" },
  { value: "user", label: "Analysts" },
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
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth so shared links land in the same view;
  // the input binds to local state so typing isn't gated on URL round-trips.
  const initialQ = searchParams.get("q") ?? "";
  const initialType = (searchParams.get("type") as SearchType) || "all";

  const [queryInput, setQueryInput] = useState(initialQ);
  const [activeQuery, setActiveQuery] = useState(initialQ);
  const [typeFilter, setTypeFilter] = useState<SearchType>(initialType);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput, typeFilter, router]);

  // Issue the API call whenever the committed query / type changes.
  useEffect(() => {
    if (!user) return;
    const q = activeQuery.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    search({ q, type: typeFilter })
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
  }, [activeQuery, typeFilter, user]);

  const totalHits = useMemo(() => {
    if (!results) return 0;
    return (
      results.total.geolocations + results.total.bounties + results.total.users
    );
  }, [results]);

  const onChipClick = useCallback((t: SearchType) => {
    setTypeFilter(t);
  }, []);

  if (authLoading || !user) {
    return <PageLoading />;
  }

  const showGroup = (group: SearchType): boolean =>
    typeFilter === "all" || typeFilter === group;

  return (
    <PageShell
      title="Search"
      subtitle="One discovery surface across the platform: type to search geolocations, bounties and analysts at once. Matched fragments are highlighted in each result."
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
              tone={typeFilter === opt.value ? "accent" : "neutral"}
              onClick={() => onChipClick(opt.value)}
            >
              {opt.label}
            </Pill>
          ))}
        </div>

        {activeQuery.trim() && (
          <div className="flex items-center justify-between text-[11px] text-neutral-500 min-h-[16px]">
            <span>
              {loading
                ? "Searching…"
                : results
                  ? `${totalHits} result${totalHits === 1 ? "" : "s"} for `
                  : null}
              {!loading && results && (
                <span className="text-neutral-300 font-medium">
                  &ldquo;{activeQuery.trim()}&rdquo;
                </span>
              )}
            </span>
          </div>
        )}

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {!activeQuery.trim() && (
          <EmptyState>
            Start typing to search across geolocations, bounties and analysts.
          </EmptyState>
        )}

        {activeQuery.trim() && results && totalHits === 0 && !loading && (
          <EmptyState>
            No matches for <span className="text-neutral-300">&ldquo;{activeQuery.trim()}&rdquo;</span>.
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

            {showGroup("bounty") && results.bounties.length > 0 && (
              <ResultGroup title="Bounties" count={results.total.bounties}>
                {results.bounties.map((b) => (
                  <EntityCard
                    key={b.id}
                    variant="compact"
                    detailHref={`/bounties/${b.id}`}
                    title={<Highlighted value={b.title_highlight} />}
                    titleText={b.title}
                    badge={<StatusBadge status={b.status} />}
                    media={b.media[0]}
                    author={b.author}
                    source={{ url: b.source_url, isDemo: b.is_demo }}
                    working={b.claimer_count}
                  />
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
      author={hit.author}
      date={hit.event_date ?? undefined}
      coords={{ lat: hit.lat, lng: hit.lng }}
      tags={hit.tags}
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
