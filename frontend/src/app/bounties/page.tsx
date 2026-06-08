"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Clock, User, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listBounties } from "@/lib/bounties";
import { formatDate, safeHostname } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { BountyListItem, BountyStatus } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

import {
  FILTER_CHIP_ACTIVE,
  FILTER_CHIP_INACTIVE,
  PRIMARY_BUTTON,
  STATUS_PILL_ACTIVE,
  STATUS_PILL_CLOSED,
  STATUS_PILL_FULFILLED,
  TAG_CHIP,
  TAPPABLE_HOVER,
} from "@/components/ui/styles";

// Default filter is "open" — the actionable subset. Status pills no longer
// render on cards, so a non-"open" default would leave the user unable to
// tell at a glance which entries are still actionable. "Open" makes the
// list "things you can pick up today" by default.
const STATUS_FILTERS: { value: BountyStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default function BountiesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [bounties, setBounties] = useState<BountyListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BountyStatus | "all">("open");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    setBounties(null);
    setError(null);
    listBounties(statusFilter === "all" ? {} : { status: statusFilter })
      .then(setBounties)
      .catch((err: Error) => setError(err.message));
  }, [user, statusFilter]);

  if (loading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  const countLabel =
    bounties === null
      ? null
      : statusFilter === "all"
        ? `${bounties.length} bounties`
        : `${bounties.length} ${statusFilter}`;

  return (
    <PageShell
      title="Bounties"
      subtitle="A queue of events someone has spotted but couldn't geolocate — title, media, source and tags, but no coordinates and no proof yet. Anyone with an account can post one; analysts pick them up, do the geolocation work, and promote the result into a full geolocation."
    >
        {/* Filter chips + new-bounty CTA share one header row. The previous
            "Post a bounty" pane explained the feature in two paragraphs —
            the page subtitle above already does that. Single button is
            enough. */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  statusFilter === opt.value ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Link
            href="/bounties/new"
            className={`whitespace-nowrap px-3 py-1.5 text-xs rounded-md ${PRIMARY_BUTTON}`}
          >
            Post bounty
          </Link>
        </div>

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {!error && bounties === null && (
          <p className="text-sm text-neutral-500">Loading bounties…</p>
        )}

        {!error && bounties !== null && bounties.length === 0 && (
          <div className="text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-6 text-center">
            No {statusFilter === "all" ? "bounties" : `${statusFilter} bounties`} yet.
            {statusFilter === "all" && (
              <>
                {" "}
                <Link href="/bounties/new" className="text-orange-400 hover:underline">
                  Post the first one
                </Link>
                .
              </>
            )}
          </div>
        )}

        {!error && bounties !== null && bounties.length > 0 && (
          <>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>
                <span className="text-neutral-300 font-medium">{countLabel}</span>{" "}
                · sorted by newest
              </span>
            </div>
            <div className="space-y-3">
              {bounties.map((b) => (
                <BountyCard key={b.id} bounty={b} />
              ))}
            </div>
          </>
        )}
    </PageShell>
  );
}

function BountyCard({ bounty }: { bounty: BountyListItem }) {
  const hero = bounty.media[0];
  const sourceHost = safeHostname(bounty.source_url);

  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className={`flex gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-md ${TAPPABLE_HOVER}`}
    >
      <div className="relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0">
        {hero ? (
          hero.media_type === "image" ? (
            // ``w-28 aspect-video`` ≈ 112 CSS px wide — thumbnail is
            // the right fit for the dense bounty index.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrlsFor(hero).thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              src={`${hero.storage_url}#t=0.1`}
              className="w-full h-full object-cover"
              preload="metadata"
              muted
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
            no media
          </div>
        )}
      </div>
      {/* Status + "N working" sit beside the whole text column (title +
          meta + tags), not inside the title row. If they sat in the title
          row the row's height would be max(title, stack) — short titles
          would leave a visible gap between title and meta on the left. */}
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className="text-sm font-medium text-neutral-100 line-clamp-2">
            {bounty.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <User size={11} />@{bounty.author.username}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatDate(bounty.created_at)}
            </span>
            {/* Demo bounties carry a sentinel source_url that doesn't resolve
                to a real page — show "synthetic" instead of an out-link a
                beta tester would 404 on. Mirrors the geolocation detail page. */}
            {bounty.is_demo ? (
              <span className="italic text-neutral-500">synthetic</span>
            ) : (
              sourceHost && (
                <span className="inline-flex items-center gap-1">
                  {sourceHost}
                  <ExternalLink size={11} />
                </span>
              )
            )}
          </div>
          {bounty.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {bounty.tags.map((t) => (
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
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={bounty.status} />
          {bounty.claimer_count > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-neutral-400"
              title={
                bounty.claimer_sample.length > 0
                  ? `Working on this: ${bounty.claimer_sample
                      .map((u) => `@${u.username}`)
                      .join(", ")}${
                      bounty.claimer_count > bounty.claimer_sample.length
                        ? ` (+${bounty.claimer_count - bounty.claimer_sample.length} more)`
                        : ""
                    }`
                  : undefined
              }
            >
              <Users size={10} />
              {bounty.claimer_count} working
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: BountyStatus }) {
  const classes: Record<BountyStatus, string> = {
    open: STATUS_PILL_ACTIVE,
    fulfilled: STATUS_PILL_FULFILLED,
    closed: STATUS_PILL_CLOSED,
  };
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${classes[status]}`}
    >
      {status}
    </span>
  );
}
