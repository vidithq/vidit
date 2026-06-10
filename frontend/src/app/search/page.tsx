"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  MapPin,
  Search as SearchIcon,
  User as UserIcon,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import TrustBadge from "@/components/profile/TrustBadge";
import { search, splitHighlights } from "@/lib/search";
import { formatDate } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import SourceLabel from "@/components/ui/SourceLabel";
import type {
  SearchBountyHit,
  SearchGeolocationHit,
  SearchResponse,
  SearchType,
  SearchUserHit,
} from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

import {
  FILTER_CHIP_ACTIVE,
  FILTER_CHIP_INACTIVE,
  STATUS_PILL_ACTIVE,
  STATUS_PILL_CLOSED,
  STATUS_PILL_FULFILLED,
  TAG_CHIP,
  TAPPABLE_HOVER,
} from "@/components/ui/styles";

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
    <Suspense
      fallback={
        <PageCenter>
          <span className="text-neutral-500">Loading...</span>
        </PageCenter>
      }
    >
      <SearchPageBody />
    </Suspense>
  );
}

function SearchPageBody() {
  const { user, loading: authLoading } = useAuth();
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

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

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
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  const showGroup = (group: SearchType): boolean =>
    typeFilter === "all" || typeFilter === group;

  return (
    <PageShell
      title="Search"
      subtitle="One discovery surface across the platform: type to search geolocations, bounties and analysts at once. Matched fragments are highlighted in each result."
    >
        <div className="relative">
          <SearchIcon
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Try a location, an analyst handle, or a keyword from a title…"
            autoFocus
            className="w-full pl-9 pr-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-hidden focus:border-orange-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChipClick(opt.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                typeFilter === opt.value ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE
              }`}
            >
              {opt.label}
            </button>
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
          <div className="text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-6 text-center">
            Start typing to search across geolocations, bounties and analysts.
          </div>
        )}

        {activeQuery.trim() && results && totalHits === 0 && !loading && (
          <div className="text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-6 text-center">
            No matches for <span className="text-neutral-300">&ldquo;{activeQuery.trim()}&rdquo;</span>.
            {typeFilter !== "all" && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => onChipClick("all")}
                  className="text-orange-400 hover:underline"
                >
                  Try searching all types
                </button>
                .
              </>
            )}
          </div>
        )}

        {results && (
          <>
            {showGroup("geolocation") && results.geolocations.length > 0 && (
              <ResultGroup
                title="Geolocations"
                count={results.total.geolocations}
              >
                {results.geolocations.map((g) => (
                  <GeolocationResult key={g.id} hit={g} />
                ))}
              </ResultGroup>
            )}

            {showGroup("bounty") && results.bounties.length > 0 && (
              <ResultGroup title="Bounties" count={results.total.bounties}>
                {results.bounties.map((b) => (
                  <BountyResult key={b.id} hit={b} />
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
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        {title} · <span className="text-neutral-300 font-medium">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function GeolocationResult({ hit }: { hit: SearchGeolocationHit }) {
  // Tags render as one uniform chip regardless of category.
  return (
    <Link
      href={`/geolocations/${hit.id}`}
      className={`block p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
          <Highlighted value={hit.title_highlight} />
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <UserIcon size={11} />@{hit.author.username}
            <TrustBadge
              isTrusted={hit.author.is_trusted}
              trustReason={hit.author.trust_reason}
              size={11}
            />
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            {formatDate(hit.event_date)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} />
            {hit.lat.toFixed(3)}, {hit.lng.toFixed(3)}
          </span>
        </div>
        {hit.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {hit.tags.map((t) => (
              <span
                key={t.id}
                className={`px-1.5 py-0.5 rounded-full ${TAG_CHIP}`}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function BountyResult({ hit }: { hit: SearchBountyHit }) {
  const hero = hit.media[0];
  return (
    <Link
      href={`/bounties/${hit.id}`}
      className={`flex gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <div className="relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0">
        {hero ? (
          hero.media_type === "image" ? (
            // `w-28 aspect-video` ≈ 112 CSS px; thumbnail variant fits
            // the dense results, re-fetched on every render.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrlsFor(hero).thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <video src={hero.storage_url} className="w-full h-full object-cover" muted />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
            no media
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
            <Highlighted value={hit.title_highlight} />
          </h3>
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${
              hit.status === "open"
                ? STATUS_PILL_ACTIVE
                : hit.status === "fulfilled"
                  ? STATUS_PILL_FULFILLED
                  : STATUS_PILL_CLOSED
            }`}
          >
            {hit.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <UserIcon size={11} />@{hit.author.username}
          </span>
          <SourceLabel
            isDemo={hit.is_demo}
            url={hit.source_url}
            variant="inline"
          />
          {hit.claimer_count > 0 && (
            <span className="inline-flex items-center gap-1 text-neutral-400">
              <Users size={11} />
              {hit.claimer_count} working
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function UserResult({ hit }: { hit: SearchUserHit }) {
  return (
    <Link
      href={`/profile/${hit.username}`}
      className={`flex items-start gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      {hit.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hit.avatar_url}
          alt=""
          className="size-10 rounded-full object-cover border border-neutral-700 shrink-0"
        />
      ) : (
        <div className="size-10 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-300 font-medium shrink-0">
          {hit.username[0]?.toUpperCase() ?? "?"}
        </div>
      )}
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
